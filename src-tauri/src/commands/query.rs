use tauri::State;

use crate::commands::connection::{get_or_create_db_pool, AppState};
use crate::db::postgres;
use crate::models::{AppError, ColumnInfo, QueryResult, SchemaObject};

/// List all databases on the server for a connection.
#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<String>, AppError> {
    let pools = state.pools.lock().await;
    let pool = pools
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?
        .clone();
    drop(pools);

    postgres::list_databases(&pool).await
}

/// Get the schema tree (tables, views) for a specific database on a connection.
#[tauri::command]
pub async fn get_schema(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<Vec<SchemaObject>, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::get_schema_objects(&pool).await
}

/// Get columns for a specific table.
#[tauri::command]
pub async fn get_columns(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::get_columns(&pool, &schema, &table).await
}

/// Execute a SQL query against a specific database on a connection.
#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    sql: String,
) -> Result<QueryResult, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::execute_query(&pool, &sql).await
}
