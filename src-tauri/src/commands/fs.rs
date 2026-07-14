use crate::models::AppError;

/// Write text content to a file path chosen by the user (via the native save
/// dialog on the frontend). Used for exporting query/table results.
#[tauri::command]
pub async fn save_text_file(path: String, contents: String) -> Result<(), AppError> {
    std::fs::write(&path, contents)
        .map_err(|e| AppError::Config(format!("Cannot write file: {}", e)))?;
    Ok(())
}
