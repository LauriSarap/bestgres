use tauri::State;

use crate::commands::connection::{get_or_create_db_pool, AppState};
use crate::db::postgres;
use crate::models::{AppError, ColumnInfo, QueryResult, SchemaObject, TableStructure};
use serde_json::Value as JsonValue;

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

/// Get primary key column names for a table, in constraint order.
/// Returns empty vec if the table has no primary key (e.g. views).
#[tauri::command]
pub async fn get_primary_key_columns(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<String>, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::get_primary_key_columns(&pool, &schema, &table).await
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

/// Get the full structure (DDL info) for a table.
#[tauri::command]
pub async fn get_table_structure(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<TableStructure, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::get_table_structure(&pool, &schema, &table).await
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

/// Update a single cell value in a table. Requires a primary key to identify the row.
#[tauri::command]
pub async fn update_cell(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    column: String,
    primary_key_columns: Vec<String>,
    primary_key_values: Vec<JsonValue>,
    new_value: JsonValue,
) -> Result<u64, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::update_cell(
        &pool,
        &schema,
        &table,
        &column,
        &primary_key_columns,
        &primary_key_values,
        &new_value,
    )
    .await
}
