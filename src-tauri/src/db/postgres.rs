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
