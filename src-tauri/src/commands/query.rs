use tauri::ipc::Channel;
use tauri::State;

use crate::commands::connection::{get_or_create_db_pool, AppState};
use crate::db::postgres;
use crate::db::postgres::{StreamEvent, StreamSummary};
use crate::models::{
    AppError, CellEdit, ColumnInfo, ForeignKeyInfo, QueryResult, SchemaObject, TableStructure,
};
use serde_json::Value as JsonValue;

/// Rows per chunk streamed to the frontend.
const STREAM_CHUNK_SIZE: usize = 500;

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

/// Execute SQL against a specific database on a connection.
/// `params` (optional) are bound to $1, $2, ... as text — when present the
/// SQL must be a single statement.
#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    sql: String,
    params: Option<Vec<JsonValue>>,
) -> Result<QueryResult, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::execute_query(&pool, &sql, &params.unwrap_or_default()).await
}

/// Execute SQL and stream columns + row chunks to the frontend over `on_event`.
/// Returns a summary (final columns, row count, rows affected, truncated, time)
/// once complete.
#[tauri::command]
pub async fn execute_query_stream(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    sql: String,
    params: Option<Vec<JsonValue>>,
    on_event: Channel<StreamEvent>,
) -> Result<StreamSummary, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::execute_query_stream(
        &pool,
        &sql,
        &params.unwrap_or_default(),
        STREAM_CHUNK_SIZE,
        |event| {
            on_event
                .send(event)
                .map_err(|e| AppError::Database(format!("Channel send failed: {}", e)))
        },
    )
    .await
}

/// Get the planner's estimated row count for a table (instant, from pg_class).
/// Returns -1 if the table has never been analyzed.
#[tauri::command]
pub async fn get_row_estimate(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<i64, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::get_row_estimate(&pool, &schema, &table).await
}

/// Get foreign key relationships for a table.
#[tauri::command]
pub async fn get_foreign_keys(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::get_foreign_keys(&pool, &schema, &table).await
}

/// Apply a batch of staged cell edits in a single transaction.
#[tauri::command]
pub async fn apply_cell_edits(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    edits: Vec<CellEdit>,
) -> Result<u64, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::apply_cell_edits(&pool, &schema, &table, &edits).await
}

/// Build human-readable SQL for a set of staged edits (for preview).
#[tauri::command]
pub async fn preview_cell_edits(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    edits: Vec<CellEdit>,
) -> Result<String, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::preview_cell_edits(&pool, &schema, &table, &edits).await
}

/// Update a single cell value in a table. Requires a primary key to identify the row.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
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

/// Insert a new row into a table.
#[tauri::command]
pub async fn insert_row(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    columns: Vec<String>,
    values: Vec<JsonValue>,
) -> Result<u64, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::insert_row(&pool, &schema, &table, &columns, &values).await
}

/// Delete rows by primary key. Each inner vec is one row's PK values.
#[tauri::command]
pub async fn delete_rows(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    primary_key_columns: Vec<String>,
    primary_key_values_list: Vec<Vec<JsonValue>>,
) -> Result<u64, AppError> {
    let pool = get_or_create_db_pool(&state, &connection_id, &database).await?;
    postgres::delete_rows(
        &pool,
        &schema,
        &table,
        &primary_key_columns,
        &primary_key_values_list,
    )
    .await
}
