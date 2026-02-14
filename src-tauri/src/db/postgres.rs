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

/// Validate that a string is a safe PostgreSQL identifier (for schema, table, column).
fn is_valid_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && s.chars().next().map(|c| !c.is_ascii_digit()).unwrap_or(false)
}

/// Update a single cell value. Uses parameterized queries for values; validates identifiers.
pub async fn update_cell(
    pool: &PgPool,
    schema: &str,
    table: &str,
    column: &str,
    primary_key_columns: &[String],
    primary_key_values: &[serde_json::Value],
    new_value: &serde_json::Value,
) -> Result<u64, AppError> {
    if !is_valid_identifier(schema) || !is_valid_identifier(table) || !is_valid_identifier(column) {
        return Err(AppError::Database("Invalid identifier".into()));
    }
    if primary_key_columns.is_empty() {
        return Err(AppError::Database("Table has no primary key; cannot update".into()));
    }
    if primary_key_columns.len() != primary_key_values.len() {
        return Err(AppError::Database("Primary key column/value count mismatch".into()));
    }
    for pk_col in primary_key_columns {
        if !is_valid_identifier(pk_col) {
            return Err(AppError::Database("Invalid primary key column name".into()));
        }
    }

    // Build: UPDATE "schema"."table" SET "column" = $1 WHERE "pk1" = $2 AND "pk2" = $3 ...
    let set_clause = format!(r#""{}" = $1"#, column);
    let mut param_idx = 2u32;
    let where_parts: Vec<String> = primary_key_columns
        .iter()
        .map(|c| {
            let part = format!(r#""{}" = ${}"#, c, param_idx);
            param_idx += 1;
            part
        })
        .collect();
    let where_clause = where_parts.join(" AND ");
    let sql = format!(
        r#"UPDATE "{}"."{}" SET {} WHERE {}"#,
        schema,
        table,
        set_clause,
        where_clause
    );

    let mut q = sqlx::query(&sql).bind(serde_json_value_to_sql(new_value));

    for v in primary_key_values {
        q = q.bind(serde_json_value_to_sql(v));
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

/// Execute an arbitrary SQL query and return results as JSON values.
pub async fn execute_query(pool: &PgPool, sql: &str) -> Result<QueryResult, AppError> {
    let start = std::time::Instant::now();

    let rows = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let execution_time_ms = start.elapsed().as_millis() as u64;

    let columns: Vec<String> = if let Some(first_row) = rows.first() {
        first_row
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect()
    } else {
        Vec::new()
    };

    let result_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row| {
            columns
                .iter()
                .enumerate()
                .map(|(i, _)| {
                    // Try types from most common to least common.
                    // String covers text, varchar, char, etc.
                    if let Ok(v) = row.try_get::<String, _>(i) {
                        serde_json::Value::String(v)
                    } else if let Ok(v) = row.try_get::<bool, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(v) = row.try_get::<i16, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(v) = row.try_get::<i32, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(v) = row.try_get::<f32, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        serde_json::json!(v)
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
                    } else {
                        serde_json::Value::Null
                    }
                })
                .collect()
        })
        .collect();

    let row_count = result_rows.len();

    Ok(QueryResult {
        columns,
        rows: result_rows,
        row_count,
        execution_time_ms,
    })
}
