mod commands;
mod db;
mod models;

use commands::connection::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::connection::add_connection,
            commands::connection::update_connection,
            commands::connection::remove_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::check_connection,
            commands::connection::list_connections,
            commands::connection::load_config_connections,
            commands::query::list_databases,
            commands::query::get_schema,
            commands::query::get_primary_key_columns,
            commands::query::get_columns,
            commands::query::get_table_structure,
            commands::query::execute_query,
            commands::query::update_cell,
            commands::query::insert_row,
            commands::query::delete_rows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
