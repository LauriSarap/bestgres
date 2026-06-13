use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use sqlx::{Column, PgPool, Row};

use crate::models::{AppError, ColumnInfo, QueryResult, SchemaObject, SchemaObjectType};

/// Create a new connection pool for the given connection string.
/// Eagerly connects and validates the connection.
pub async fn create_pool(connection_string: &str) -> Result<PgPool, AppError> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(connection_string)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))
}

/// Create a lazy connection pool that only connects when first used.
/// Uses a short acquire timeout so unreachable hosts fail fast.
pub fn create_pool_lazy(connection_string: &str) -> Result<PgPool, AppError> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect_lazy(connection_string)
        .map_err(|e| AppError::Connection(e.to_string()))
}

/// Test that a connection pool is valid by running a simple query.
pub async fn test_connection(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    Ok(())
}

/// List all non-template databases on the server.
pub async fn list_databases(pool: &PgPool) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    let dbs = rows.iter().map(|row| row.get("datname")).collect();
    Ok(dbs)
}

/// List all tables, views, and functions in the database.
pub async fn get_schema_objects(pool: &PgPool) -> Result<Vec<SchemaObject>, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT table_name AS name, table_schema AS schema,
               CASE table_type
                   WHEN 'BASE TABLE' THEN 'table'
                   WHEN 'VIEW' THEN 'view'
               END AS object_type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    let objects = rows
        .iter()
        .map(|row| {
            let obj_type: String = row.get("object_type");
            SchemaObject {
                name: row.get("name"),
                schema: row.get("schema"),
                object_type: match obj_type.as_str() {
                    "view" => SchemaObjectType::View,
                    _ => SchemaObjectType::Table,
                },
            }
        })
        .collect();

    Ok(objects)
}

/// Get column info for a specific table.
pub async fn get_columns(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT
            c.column_name AS name,
            c.data_type,
            c.is_nullable = 'YES' AS is_nullable,
            COALESCE(
                (SELECT true FROM information_schema.key_column_usage kcu
                 JOIN information_schema.table_constraints tc
                   ON kcu.constraint_name = tc.constraint_name
                  AND kcu.table_schema = tc.table_schema
                 WHERE tc.constraint_type = 'PRIMARY KEY'
                   AND kcu.table_schema = c.table_schema
                   AND kcu.table_name = c.table_name
                   AND kcu.column_name = c.column_name),
                false
            ) AS is_primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2
        ORDER BY c.ordinal_position
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    let columns = rows
        .iter()
        .map(|row| ColumnInfo {
            name: row.get("name"),
            data_type: row.get("data_type"),
            is_nullable: row.get("is_nullable"),
            is_primary_key: row.get("is_primary_key"),
        })
        .collect();

    Ok(columns)
}

/// Get the full DDL and structure info for a table.
/// Returns: (columns, indexes, constraints, foreign_keys) as structured data.
pub async fn get_table_structure(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<crate::models::TableStructure, AppError> {
    use crate::models::{ColumnDetail, IndexInfo, ConstraintInfo, ForeignKeyInfo};

    // 1. Detailed column info
    let col_rows = sqlx::query(
        r#"
        SELECT
            c.column_name,
            c.data_type,
            c.udt_name,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.is_nullable,
            c.column_default
        FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2
        ORDER BY c.ordinal_position
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    let columns: Vec<ColumnDetail> = col_rows
        .iter()
        .map(|row| {
            let data_type: String = row.get("data_type");
            let udt_name: String = row.get("udt_name");
            let char_len: Option<i32> = row.get("character_maximum_length");
            let num_prec: Option<i32> = row.get("numeric_precision");
            let num_scale: Option<i32> = row.get("numeric_scale");

            // Build a display type like "varchar(255)" or "numeric(10,2)"
            let display_type = if data_type == "character varying" {
                match char_len {
                    Some(l) => format!("varchar({})", l),
                    None => "varchar".into(),
                }
            } else if data_type == "character" {
                match char_len {
                    Some(l) => format!("char({})", l),
                    None => "char".into(),
                }
            } else if data_type == "numeric" {
                match (num_prec, num_scale) {
                    (Some(p), Some(s)) => format!("numeric({},{})", p, s),
                    (Some(p), None) => format!("numeric({})", p),
                    _ => "numeric".into(),
                }
            } else if data_type == "USER-DEFINED" {
                udt_name.clone()
            } else if data_type == "ARRAY" {
                format!("{}[]", udt_name.trim_start_matches('_'))
            } else {
                data_type.clone()
            };

            let nullable: String = row.get("is_nullable");
            let default_val: Option<String> = row.get("column_default");

            ColumnDetail {
                name: row.get("column_name"),
                data_type: display_type,
                is_nullable: nullable == "YES",
                default_value: default_val,
            }
        })
        .collect();

    // 2. Indexes
    let idx_rows = sqlx::query(
        r#"
        SELECT
            i.relname AS index_name,
            ix.indisunique AS is_unique,
            ix.indisprimary AS is_primary,
            pg_get_indexdef(ix.indexrelid) AS definition
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = $2
        ORDER BY i.relname
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    let indexes: Vec<IndexInfo> = idx_rows
        .iter()
        .map(|row| IndexInfo {
            name: row.get("index_name"),
            is_unique: row.get("is_unique"),
            is_primary: row.get("is_primary"),
            definition: row.get("definition"),
        })
        .collect();

    // 3. Constraints (CHECK, UNIQUE — excluding PKs and FKs which are shown separately)
    let con_rows = sqlx::query(
        r#"
        SELECT
            con.conname AS name,
            CASE con.contype
                WHEN 'c' THEN 'CHECK'
                WHEN 'u' THEN 'UNIQUE'
                WHEN 'x' THEN 'EXCLUSION'
            END AS constraint_type,
            pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class t ON t.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = $2
          AND con.contype IN ('c', 'u', 'x')
        ORDER BY con.conname
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    let constraints: Vec<ConstraintInfo> = con_rows
        .iter()
        .map(|row| ConstraintInfo {
            name: row.get("name"),
            constraint_type: row.get("constraint_type"),
            definition: row.get("definition"),
        })
        .collect();

    // 4. Foreign keys
    let fk_rows = sqlx::query(
        r#"
        SELECT
            con.conname AS name,
            att.attname AS column_name,
            ref_ns.nspname AS ref_schema,
            ref_cl.relname AS ref_table,
            ref_att.attname AS ref_column
        FROM pg_constraint con
        JOIN pg_class t ON t.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
        JOIN pg_class ref_cl ON ref_cl.oid = con.confrelid
        JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cl.relnamespace
        JOIN pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = ANY(con.confkey)
        WHERE n.nspname = $1 AND t.relname = $2 AND con.contype = 'f'
        ORDER BY con.conname, att.attnum
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    let foreign_keys: Vec<ForeignKeyInfo> = fk_rows
        .iter()
        .map(|row| ForeignKeyInfo {
            name: row.get("name"),
            column_name: row.get("column_name"),
            ref_schema: row.get("ref_schema"),
            ref_table: row.get("ref_table"),
            ref_column: row.get("ref_column"),
        })
        .collect();

    Ok(crate::models::TableStructure {
        columns,
        indexes,
        constraints,
        foreign_keys,
    })
}

/// Get primary key column names for a table, in constraint order.
/// Returns empty vec if the table has no primary key.
pub async fn get_primary_key_columns(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1 AND tc.table_name = $2
        ORDER BY kcu.ordinal_position
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows.iter().map(|r| r.get("column_name")).collect())
}

/// Quote a PostgreSQL identifier, escaping embedded double quotes.
fn quote_ident(s: &str) -> String {
    format!(r#""{}""#, s.replace('"', r#""""#))
}

fn check_ident(s: &str) -> Result<(), AppError> {
    if s.is_empty() || s.contains('\0') {
        return Err(AppError::Database("Invalid identifier".into()));
    }
    Ok(())
}

/// Fetch the base type (without typmod) of every column in a table, keyed by column name.
/// Used to cast text-bound parameters to the column's real type in UPDATE/INSERT/DELETE.
/// The typmod is dropped on purpose: casting to e.g. varchar(3) would silently truncate,
/// while assignment to the column still enforces the length.
async fn get_column_types(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT a.attname AS name, format_type(a.atttypid, NULL) AS data_type
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|r| (r.get::<String, _>("name"), r.get::<String, _>("data_type")))
        .collect())
}

/// Build a `$N::type` placeholder. Without a known type the bare placeholder is
/// bound as text, which only works for text-like columns.
fn typed_placeholder(idx: u32, col: &str, types: &std::collections::HashMap<String, String>) -> String {
    match types.get(col) {
        Some(t) => format!("${}::{}", idx, t),
        None => format!("${}", idx),
    }
}

/// Update a single cell value. Values are bound as text and cast to the column's
/// actual type server-side, so editing works for any column type.
pub async fn update_cell(
    pool: &PgPool,
    schema: &str,
    table: &str,
    column: &str,
    primary_key_columns: &[String],
    primary_key_values: &[serde_json::Value],
    new_value: &serde_json::Value,
) -> Result<u64, AppError> {
    check_ident(schema)?;
    check_ident(table)?;
    check_ident(column)?;
    if primary_key_columns.is_empty() {
        return Err(AppError::Database("Table has no primary key; cannot update".into()));
    }
    if primary_key_columns.len() != primary_key_values.len() {
        return Err(AppError::Database("Primary key column/value count mismatch".into()));
    }
    for pk_col in primary_key_columns {
        check_ident(pk_col)?;
    }

    let types = get_column_types(pool, schema, table).await?;

    // UPDATE "schema"."table" SET "column" = $1::type WHERE "pk1" = $2::type AND ...
    let set_clause = format!("{} = {}", quote_ident(column), typed_placeholder(1, column, &types));
    let where_clause = primary_key_columns
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{} = {}", quote_ident(c), typed_placeholder(i as u32 + 2, c, &types)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!(
        "UPDATE {}.{} SET {} WHERE {}",
        quote_ident(schema),
        quote_ident(table),
        set_clause,
        where_clause
    );

    let mut q = sqlx::query(&sql).bind(serde_json_value_to_sql(new_value));
    for v in primary_key_values {
        q = q.bind(serde_json_value_to_sql(v));
    }

    let result = q.execute(pool).await.map_err(|e| AppError::Database(e.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(AppError::Database("No row matched the primary key; nothing updated".into()));
    }
    Ok(result.rows_affected())
}

/// Insert a new row. Values are bound as text and cast to each column's actual type.
pub async fn insert_row(
    pool: &PgPool,
    schema: &str,
    table: &str,
    columns: &[String],
    values: &[serde_json::Value],
) -> Result<u64, AppError> {
    check_ident(schema)?;
    check_ident(table)?;
    if columns.len() != values.len() {
        return Err(AppError::Database("Column/value count mismatch".into()));
    }
    if columns.is_empty() {
        return Err(AppError::Database("No columns specified".into()));
    }
    for col in columns {
        check_ident(col)?;
    }

    let types = get_column_types(pool, schema, table).await?;

    let col_list: Vec<String> = columns.iter().map(|c| quote_ident(c)).collect();
    let placeholders: Vec<String> = columns
        .iter()
        .enumerate()
        .map(|(i, col)| typed_placeholder(i as u32 + 1, col, &types))
        .collect();
    let sql = format!(
        "INSERT INTO {}.{} ({}) VALUES ({})",
        quote_ident(schema),
        quote_ident(table),
        col_list.join(", "),
        placeholders.join(", ")
    );

    let mut q = sqlx::query(&sql);
    for v in values {
        q = q.bind(serde_json_value_to_sql(v));
    }

    let result = q.execute(pool).await.map_err(|e| AppError::Database(e.to_string()))?;
    Ok(result.rows_affected())
}

/// Delete rows by primary key. Each inner vec is one row's PK values.
pub async fn delete_rows(
    pool: &PgPool,
    schema: &str,
    table: &str,
    primary_key_columns: &[String],
    primary_key_values_list: &[Vec<serde_json::Value>],
) -> Result<u64, AppError> {
    check_ident(schema)?;
    check_ident(table)?;
    if primary_key_columns.is_empty() {
        return Err(AppError::Database("Table has no primary key; cannot delete".into()));
    }
    for pk_col in primary_key_columns {
        check_ident(pk_col)?;
    }
    if primary_key_values_list.is_empty() {
        return Ok(0);
    }

    let types = get_column_types(pool, schema, table).await?;

    let pk_cols_quoted: Vec<String> = primary_key_columns.iter().map(|c| quote_ident(c)).collect();
    let pk_tuple = format!("({})", pk_cols_quoted.join(", "));

    let mut param_idx = 1u32;
    let mut value_tuples = Vec::with_capacity(primary_key_values_list.len());
    for row_vals in primary_key_values_list {
        if row_vals.len() != primary_key_columns.len() {
            return Err(AppError::Database("Primary key value count mismatch".into()));
        }
        let placeholders: Vec<String> = primary_key_columns
            .iter()
            .map(|col| {
                let s = typed_placeholder(param_idx, col, &types);
                param_idx += 1;
                s
            })
            .collect();
        value_tuples.push(format!("({})", placeholders.join(", ")));
    }

    let in_clause = value_tuples.join(", ");
    let sql = format!(
        "DELETE FROM {}.{} WHERE {} IN ({})",
        quote_ident(schema),
        quote_ident(table),
        pk_tuple,
        in_clause
    );

    let mut q = sqlx::query(&sql);
    for row_vals in primary_key_values_list {
        for v in row_vals {
            q = q.bind(serde_json_value_to_sql(v));
        }
    }

    let result = q.execute(pool).await.map_err(|e| AppError::Database(e.to_string()))?;
    Ok(result.rows_affected())
}

/// Convert serde_json::Value to a type sqlx can bind.
/// We use a custom enum/struct to handle the variety of types.
fn serde_json_value_to_sql(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Some(serde_json::to_string(v).unwrap_or_default())
        }
    }
}

/// Decode a single cell into a JSON value for the frontend.
/// NULL is detected explicitly; then types are tried from most to least common.
/// Values we can't decode are surfaced as "<typename>" placeholders instead of
/// being silently shown as NULL.
fn decode_cell(row: &sqlx::postgres::PgRow, i: usize) -> serde_json::Value {
    use sqlx::TypeInfo;
    use sqlx::ValueRef;

    match row.try_get_raw(i) {
        Ok(raw) if raw.is_null() => return serde_json::Value::Null,
        Err(_) => return serde_json::Value::Null,
        _ => {}
    }

    if let Ok(v) = row.try_get::<String, _>(i) {
        serde_json::Value::String(v)
    } else if let Ok(v) = row.try_get::<bool, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<i16, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<i32, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<i64, _>(i) {
        json_i64(v)
    } else if let Ok(v) = row.try_get::<f32, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<f64, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<rust_decimal::Decimal, _>(i) {
        // String keeps full precision; JS numbers would round large decimals
        serde_json::Value::String(v.to_string())
    } else if let Ok(v) = row.try_get::<uuid::Uuid, _>(i) {
        serde_json::Value::String(v.to_string())
    } else if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
        serde_json::Value::String(v.to_rfc3339())
    } else if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
        serde_json::Value::String(v.to_string())
    } else if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
        serde_json::Value::String(v.to_string())
    } else if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(i) {
        serde_json::Value::String(v.to_string())
    } else if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
        v
    } else if let Ok(v) = row.try_get::<sqlx::types::ipnetwork::IpNetwork, _>(i) {
        serde_json::Value::String(v.to_string())
    } else if let Ok(v) = row.try_get::<sqlx::types::mac_address::MacAddress, _>(i) {
        serde_json::Value::String(v.to_string())
    } else if let Ok(v) = row.try_get::<sqlx::postgres::types::PgInterval, _>(i) {
        serde_json::Value::String(format_interval(&v))
    } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
        serde_json::Value::String(format!("\\x{}", hex_encode(&v)))
    } else if let Ok(v) = row.try_get::<Vec<String>, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<Vec<i32>, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<Vec<i64>, _>(i) {
        serde_json::Value::Array(v.into_iter().map(json_i64).collect())
    } else if let Ok(v) = row.try_get::<Vec<f64>, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get::<Vec<bool>, _>(i) {
        serde_json::json!(v)
    } else if let Ok(v) = row.try_get_unchecked::<String, _>(i) {
        // Last resort for text-compatible wire formats: enums, citext, domains, etc.
        serde_json::Value::String(v)
    } else {
        let type_name = row.column(i).type_info().name().to_string();
        serde_json::Value::String(format!("<{}>", type_name.to_lowercase()))
    }
}

/// JS numbers lose precision past 2^53 - 1, so bigints outside the safe
/// range are sent as strings.
fn json_i64(v: i64) -> serde_json::Value {
    const JS_MAX_SAFE: i64 = 9_007_199_254_740_991;
    if (-JS_MAX_SAFE..=JS_MAX_SAFE).contains(&v) {
        serde_json::json!(v)
    } else {
        serde_json::Value::String(v.to_string())
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn format_interval(v: &sqlx::postgres::types::PgInterval) -> String {
    let mut parts: Vec<String> = Vec::new();
    if v.months != 0 {
        parts.push(format!("{} mon", v.months));
    }
    if v.days != 0 {
        parts.push(format!("{} days", v.days));
    }
    let total_secs = v.microseconds / 1_000_000;
    let micros = (v.microseconds % 1_000_000).abs();
    let hours = total_secs / 3600;
    let mins = (total_secs % 3600).abs() / 60;
    let secs = (total_secs % 60).abs();
    if v.microseconds != 0 || parts.is_empty() {
        if micros != 0 {
            parts.push(format!("{:02}:{:02}:{:02}.{:06}", hours, mins, secs, micros));
        } else {
            parts.push(format!("{:02}:{:02}:{:02}", hours, mins, secs));
        }
    }
    parts.join(" ")
}

/// Hard cap on rows returned to the frontend per statement. Results beyond
/// this are dropped and the result is flagged `truncated`.
pub const MAX_QUERY_ROWS: usize = 5000;

/// Execute SQL and return results as JSON values.
///
/// With `params`, the SQL is run as a single parameterized statement
/// ($1, $2, ... bound as text). Without params, the input may contain
/// multiple semicolon-separated statements: they run sequentially, the last
/// result set is returned, and `rows_affected` is summed across statements.
pub async fn execute_query(
    pool: &PgPool,
    sql: &str,
    params: &[serde_json::Value],
) -> Result<QueryResult, AppError> {
    let start = std::time::Instant::now();

    let mut result = if !params.is_empty() {
        run_statement(pool, sql, params).await?
    } else {
        let statements = crate::db::sql_split::split_statements(sql);
        if statements.is_empty() {
            return Err(AppError::Database("Empty query".into()));
        }
        let total = statements.len();
        let mut shown: Option<QueryResult> = None;
        let mut total_affected = 0u64;
        for (idx, stmt) in statements.iter().enumerate() {
            let res = run_statement(pool, stmt, &[]).await.map_err(|e| {
                if total > 1 {
                    AppError::Database(format!("Statement {} of {}: {}", idx + 1, total, e))
                } else {
                    e
                }
            })?;
            total_affected += res.rows_affected;
            // Show the result set of the last statement that produced columns
            if !res.columns.is_empty() || shown.is_none() {
                shown = Some(res);
            }
        }
        let mut r = shown.expect("at least one statement ran");
        r.rows_affected = total_affected;
        r
    };

    result.execution_time_ms = start.elapsed().as_millis() as u64;
    Ok(result)
}

/// Run a single statement, streaming rows so huge result sets don't exhaust
/// memory: reading stops at MAX_QUERY_ROWS and the rest is discarded.
async fn run_statement(
    pool: &PgPool,
    sql: &str,
    params: &[serde_json::Value],
) -> Result<QueryResult, AppError> {
    use futures_util::TryStreamExt;

    let mut q = sqlx::query(sql);
    for p in params {
        q = q.bind(serde_json_value_to_sql(p));
    }

    // fetch_many is the only stream yielding both rows and affected-row counts.
    // Deprecated over SQLite multi-statement semantics, which don't apply here:
    // each call receives exactly one statement.
    #[allow(deprecated)]
    let mut stream = q.fetch_many(pool);
    let mut columns: Vec<String> = Vec::new();
    let mut result_rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut rows_affected = 0u64;
    let mut truncated = false;

    while let Some(item) = stream
        .try_next()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
    {
        match item {
            sqlx::Either::Left(done) => rows_affected += done.rows_affected(),
            sqlx::Either::Right(row) => {
                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                if result_rows.len() >= MAX_QUERY_ROWS {
                    truncated = true;
                    break;
                }
                result_rows.push((0..columns.len()).map(|i| decode_cell(&row, i)).collect());
            }
        }
    }

    // Postgres's command tag counts returned rows for SELECT too; only
    // statements without a result set count as "affected rows"
    if !columns.is_empty() {
        rows_affected = 0;
    }

    let row_count = result_rows.len();
    Ok(QueryResult {
        columns,
        rows: result_rows,
        row_count,
        rows_affected,
        truncated,
        execution_time_ms: 0, // filled in by execute_query
    })
}
