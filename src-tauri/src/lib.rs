mod commands;
pub mod db;
pub mod models;

use commands::connection::AppState;
use tauri::Manager;

const APP_ICON: tauri::image::Image<'_> = tauri::include_image!("icons/icon.png");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(APP_ICON.clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::add_connection,
            commands::connection::update_connection,
            commands::connection::remove_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::check_connection,
            commands::connection::list_connections,
            commands::connection::load_config_connections,
            commands::connection::test_connection_config,
            commands::query::list_databases,
            commands::query::get_schema,
            commands::query::get_primary_key_columns,
            commands::query::get_columns,
            commands::query::get_table_structure,
            commands::query::get_row_estimate,
            commands::query::get_foreign_keys,
            commands::query::execute_query,
            commands::query::execute_query_stream,
            commands::query::update_cell,
            commands::query::insert_row,
            commands::query::delete_rows,
            commands::query::apply_cell_edits,
            commands::query::preview_cell_edits,
            commands::fs::save_text_file,
            commands::history::add_to_history,
            commands::history::get_history,
            commands::history::clear_history,
            commands::history::save_query,
            commands::history::list_saved_queries,
            commands::history::delete_saved_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
