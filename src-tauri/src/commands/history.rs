use crate::models::{AppError, HistoryEntry, SavedQuery};

const MAX_HISTORY: usize = 200;

fn bestgres_dir() -> Result<std::path::PathBuf, AppError> {
    let dir = dirs::config_dir()
        .ok_or_else(|| AppError::Config("Cannot determine config directory".into()))?
        .join("bestgres");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Config(format!("Cannot create config dir: {}", e)))?;
    }
    Ok(dir)
}

fn history_path() -> Result<std::path::PathBuf, AppError> {
    Ok(bestgres_dir()?.join("history.json"))
}

fn queries_dir() -> Result<std::path::PathBuf, AppError> {
    let dir = bestgres_dir()?.join("queries");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Config(format!("Cannot create queries dir: {}", e)))?;
    }
    Ok(dir)
}

// ── History ──

#[tauri::command]
pub async fn add_to_history(sql: String, database: String) -> Result<(), AppError> {
    let path = history_path()?;
    let mut entries = load_history_entries(&path);

    let entry = HistoryEntry {
        sql,
        database,
        executed_at: chrono::Utc::now().to_rfc3339(),
    };

    // Prepend new entry
    entries.insert(0, entry);

    // Trim to max
    entries.truncate(MAX_HISTORY);

    let json = serde_json::to_string_pretty(&entries)
        .map_err(|e| AppError::Config(format!("JSON serialize error: {}", e)))?;
    std::fs::write(&path, json)
        .map_err(|e| AppError::Config(format!("Cannot write history: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn get_history() -> Result<Vec<HistoryEntry>, AppError> {
    let path = history_path()?;
    Ok(load_history_entries(&path))
}

#[tauri::command]
pub async fn clear_history() -> Result<(), AppError> {
    let path = history_path()?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Config(format!("Cannot delete history: {}", e)))?;
    }
    Ok(())
}

fn load_history_entries(path: &std::path::Path) -> Vec<HistoryEntry> {
    if !path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

// ── Saved queries ──

#[tauri::command]
pub async fn save_query(id: String, name: String, sql: String, database: String) -> Result<(), AppError> {
    let dir = queries_dir()?;
    let entry = SavedQuery { id: id.clone(), name, sql, database };

    let safe_id: String = id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{}.json", safe_id));

    let json = serde_json::to_string_pretty(&entry)
        .map_err(|e| AppError::Config(format!("JSON serialize error: {}", e)))?;
    std::fs::write(&path, json)
        .map_err(|e| AppError::Config(format!("Cannot write saved query: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn list_saved_queries() -> Result<Vec<SavedQuery>, AppError> {
    let dir = queries_dir()?;
    let mut queries = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| AppError::Config(format!("Cannot read queries dir: {}", e)))?;

    for entry in entries {
        let entry = entry.map_err(|e| AppError::Config(e.to_string()))?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(query) = serde_json::from_str::<SavedQuery>(&content) {
                    queries.push(query);
                }
            }
        }
    }

    queries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(queries)
}

#[tauri::command]
pub async fn delete_saved_query(id: String) -> Result<(), AppError> {
    let dir = queries_dir()?;
    let safe_id: String = id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{}.json", safe_id));

    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Config(format!("Cannot delete saved query: {}", e)))?;
    }

    Ok(())
}
