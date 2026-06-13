use std::collections::HashMap;
use std::sync::Arc;

use sqlx::PgPool;
use tauri::State;
use tokio::sync::Mutex;

use crate::db::postgres;
use crate::models::{AppError, ConnectionConfig, ConnectionFileConfig};

/// Get the connections config directory path (~/.config/bestgres/connections/).
fn connections_dir() -> Result<std::path::PathBuf, AppError> {
    let dir = dirs::config_dir()
        .ok_or_else(|| AppError::Config("Cannot determine config directory".into()))?
        .join("bestgres")
        .join("connections");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Config(format!("Cannot create config dir: {}", e)))?;
    }
    Ok(dir)
}

/// Filename for a connection's config file, derived from its name (sanitized).
fn connection_filename(config: &ConnectionConfig) -> String {
    let safe_name: String = config
        .name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
        .to_lowercase();
    if safe_name.is_empty() {
        format!("{}.json", &config.id[..8])
    } else {
        format!("{}.json", safe_name)
    }
}

/// Persist a connection as a JSON file in the config directory.
/// The password is NOT written to disk — it lives in the system keychain.
fn save_connection_to_file(config: &ConnectionConfig) -> Result<(), AppError> {
    let dir = connections_dir()?;
    let file_config = ConnectionFileConfig {
        id: Some(config.id.clone()),
        name: config.name.clone(),
        host: config.host.clone(),
        port: config.port,
        user: config.user.clone(),
        password: None,
        database: config.database.clone(),
        ssl: config.ssl,
    };
    let json = serde_json::to_string_pretty(&file_config)
        .map_err(|e| AppError::Config(format!("Cannot serialize config: {}", e)))?;
    std::fs::write(dir.join(connection_filename(config)), json)
        .map_err(|e| AppError::Config(format!("Cannot write config file: {}", e)))?;
    Ok(())
}

/// Delete the config file for a connection by trying to match by name.
fn delete_connection_file(config: &ConnectionConfig) -> Result<(), AppError> {
    let dir = connections_dir()?;
    let path = dir.join(connection_filename(config));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Config(format!("Cannot delete config file: {}", e)))?;
    }
    Ok(())
}

/// Shared application state: a map of pool_key -> PgPool.
/// Pool keys: "connection_id" for the primary database,
///            "connection_id:database_name" for other databases on the same server.
pub struct AppState {
    pub pools: Arc<Mutex<HashMap<String, PgPool>>>,
    pub connections: Arc<Mutex<Vec<ConnectionConfig>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pools: Arc::new(Mutex::new(HashMap::new())),
            connections: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

/// Build a connection string from config fields.
pub fn build_connection_string(
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
    ssl: bool,
) -> String {
    let ssl_mode = if ssl { "require" } else { "disable" };
    format!(
        "postgres://{}:{}@{}:{}/{}?sslmode={}",
        user, password, host, port, database, ssl_mode
    )
}

/// Store a password in the system keychain.
pub fn store_password(connection_id: &str, password: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new("bestgres", connection_id)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    entry
        .set_password(password)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    Ok(())
}

/// Retrieve a password from the system keychain.
pub fn get_password(connection_id: &str) -> Result<String, AppError> {
    let entry = keyring::Entry::new("bestgres", connection_id)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| AppError::Keychain(e.to_string()))
}

/// Get or create a pool for a specific database on a connection's server.
/// If `database` matches the connection's configured database, returns the primary pool.
/// Otherwise, creates a new pool keyed as "connection_id:database".
pub async fn get_or_create_db_pool(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<PgPool, AppError> {
    let connections = state.connections.lock().await;
    let config = connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| AppError::Connection("Connection not found".into()))?
        .clone();
    drop(connections);

    // If it's the primary database, use the main pool key
    let pool_key = if database == config.database {
        connection_id.to_string()
    } else {
        format!("{}:{}", connection_id, database)
    };

    // Check if pool already exists
    {
        let pools = state.pools.lock().await;
        if let Some(pool) = pools.get(&pool_key) {
            return Ok(pool.clone());
        }
    }

    // Create a new pool for this database
    let password = get_password(connection_id)?;
    let conn_str = build_connection_string(
        &config.host,
        config.port,
        &config.user,
        &password,
        database,
        config.ssl,
    );
    let pool = postgres::create_pool(&conn_str).await?;

    let mut pools = state.pools.lock().await;
    pools.insert(pool_key, pool.clone());

    Ok(pool)
}

/// Add a new connection and store credentials.
/// Always saves the connection; creates a pool only if reachable.
/// Persists the connection as a JSON file in ~/.config/bestgres/connections/.
#[tauri::command]
pub async fn add_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: String,
) -> Result<(), AppError> {
    store_password(&config.id, &password)?;

    // Persist to config file (password stays in the keychain only)
    let _ = save_connection_to_file(&config);

    // Try to connect — save the connection regardless of outcome
    let conn_str = build_connection_string(
        &config.host,
        config.port,
        &config.user,
        &password,
        &config.database,
        config.ssl,
    );
    if let Ok(pool) = postgres::create_pool_lazy(&conn_str) {
        let mut pools = state.pools.lock().await;
        pools.insert(config.id.clone(), pool);
    }

    let mut connections = state.connections.lock().await;
    connections.push(config);

    Ok(())
}

/// Update an existing connection's configuration.
/// If password is non-empty, update it in keychain. Otherwise keep the old one.
/// Re-persists the connection to the config file.
#[tauri::command]
pub async fn update_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: String,
) -> Result<(), AppError> {
    // Determine which password to use
    let effective_password = if password.is_empty() {
        get_password(&config.id)?
    } else {
        password.clone()
    };

    // Update password if provided
    if !password.is_empty() {
        store_password(&config.id, &password)?;
    }

    // Delete old config file (old name may differ)
    {
        let connections = state.connections.lock().await;
        if let Some(old) = connections.iter().find(|c| c.id == config.id) {
            let _ = delete_connection_file(old);
        }
    }

    // Persist updated config
    let _ = save_connection_to_file(&config);

    // Close old pools for this connection
    {
        let mut pools = state.pools.lock().await;
        let keys_to_remove: Vec<String> = pools
            .keys()
            .filter(|k| *k == &config.id || k.starts_with(&format!("{}:", config.id)))
            .cloned()
            .collect();
        for key in keys_to_remove {
            if let Some(old_pool) = pools.remove(&key) {
                old_pool.close().await;
            }
        }
    }

    // Create a lazy pool for the updated config
    let conn_str = build_connection_string(
        &config.host,
        config.port,
        &config.user,
        &effective_password,
        &config.database,
        config.ssl,
    );
    if let Ok(pool) = postgres::create_pool_lazy(&conn_str) {
        let mut pools = state.pools.lock().await;
        pools.insert(config.id.clone(), pool);
    }

    // Update config in state
    let mut connections = state.connections.lock().await;
    if let Some(existing) = connections.iter_mut().find(|c| c.id == config.id) {
        *existing = config;
    }

    Ok(())
}

/// Remove a connection entirely. Deletes its config file too.
#[tauri::command]
pub async fn remove_connection(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), AppError> {
    // Delete config file
    {
        let connections = state.connections.lock().await;
        if let Some(config) = connections.iter().find(|c| c.id == connection_id) {
            let _ = delete_connection_file(config);
        }
    }

    // Close all pools for this connection
    {
        let mut pools = state.pools.lock().await;
        let keys_to_remove: Vec<String> = pools
            .keys()
            .filter(|k| *k == &connection_id || k.starts_with(&format!("{}:", connection_id)))
            .cloned()
            .collect();
        for key in keys_to_remove {
            if let Some(pool) = pools.remove(&key) {
                pool.close().await;
            }
        }
    }

    // Remove config from state
    let mut connections = state.connections.lock().await;
    connections.retain(|c| c.id != connection_id);

    Ok(())
}

/// Connect to an existing saved connection.
#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), AppError> {
    let connections = state.connections.lock().await;
    let config = connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| AppError::Connection("Connection not found".into()))?
        .clone();
    drop(connections);

    let password = get_password(&connection_id)?;
    let conn_str = build_connection_string(
        &config.host,
        config.port,
        &config.user,
        &password,
        &config.database,
        config.ssl,
    );
    let pool = postgres::create_pool(&conn_str).await?;
    postgres::test_connection(&pool).await?;

    let mut pools = state.pools.lock().await;
    pools.insert(connection_id, pool);

    Ok(())
}

/// Disconnect and remove a pool.
#[tauri::command]
pub async fn disconnect(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), AppError> {
    let mut pools = state.pools.lock().await;
    let keys_to_remove: Vec<String> = pools
        .keys()
        .filter(|k| *k == &connection_id || k.starts_with(&format!("{}:", connection_id)))
        .cloned()
        .collect();
    for key in keys_to_remove {
        if let Some(pool) = pools.remove(&key) {
            pool.close().await;
        }
    }
    Ok(())
}

/// Check if a connection is alive by running SELECT 1.
/// Returns true if reachable, false otherwise.
#[tauri::command]
pub async fn check_connection(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<bool, AppError> {
    let pools = state.pools.lock().await;
    let pool = match pools.get(&connection_id) {
        Some(p) => p.clone(),
        None => return Ok(false),
    };
    drop(pools);

    // Short timeout so dead hosts show a red dot quickly instead of
    // waiting out the pool's full 5s acquire timeout
    let probe = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        postgres::test_connection(&pool),
    )
    .await;
    Ok(matches!(probe, Ok(Ok(()))))
}

/// List all saved connections.
#[tauri::command]
pub async fn list_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, AppError> {
    let connections = state.connections.lock().await;
    Ok(connections.clone())
}

/// Load connections from JSON files in ~/.config/bestgres/connections/.
/// Returns the list of successfully loaded ConnectionConfigs.
///
/// Idempotent: rebuilds the in-memory connection list from scratch, so calling
/// it twice (e.g. React StrictMode in dev) does not duplicate connections.
/// Connection ids are stable — persisted in the file — so keychain entries are
/// reused across launches. Legacy files with an inline password are migrated:
/// the password moves to the keychain and the file is rewritten without it.
#[tauri::command]
pub async fn load_config_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, AppError> {
    let config_dir = connections_dir()?;

    let entries = std::fs::read_dir(&config_dir)
        .map_err(|e| AppError::Config(format!("Cannot read config dir: {}", e)))?;

    let mut loaded: Vec<ConnectionConfig> = Vec::new();
    let mut new_pools: Vec<(String, PgPool)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let file_config: ConnectionFileConfig = match serde_json::from_str(&content) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let id = file_config
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let config = ConnectionConfig {
            id: id.clone(),
            name: file_config.name,
            host: file_config.host,
            port: file_config.port,
            user: file_config.user,
            database: file_config.database,
            ssl: file_config.ssl,
        };

        // Resolve the password: keychain first, falling back to a legacy
        // inline password (which we then migrate into the keychain).
        let password = match get_password(&id) {
            Ok(p) => p,
            Err(_) => match &file_config.password {
                Some(p) => {
                    if store_password(&id, p).is_err() {
                        continue;
                    }
                    p.clone()
                }
                None => continue, // no usable credentials
            },
        };

        // Rewrite the file if it's missing the stable id or still has the password inline
        if file_config.id.is_none() || file_config.password.is_some() {
            let _ = save_connection_to_file(&config);
        }

        // Create a lazy pool — doesn't actually connect until first query.
        // This ensures the connection always appears in the sidebar instantly.
        let conn_str = build_connection_string(
            &config.host,
            config.port,
            &config.user,
            &password,
            &config.database,
            config.ssl,
        );
        if let Ok(pool) = postgres::create_pool_lazy(&conn_str) {
            new_pools.push((id, pool));
        }

        loaded.push(config);
    }

    // Swap the rebuilt state in atomically so concurrent calls
    // (e.g. React StrictMode double-mount) can't interleave into duplicates
    {
        let mut pools = state.pools.lock().await;
        let old: Vec<PgPool> = pools.drain().map(|(_, p)| p).collect();
        pools.extend(new_pools);
        let mut connections = state.connections.lock().await;
        connections.clear();
        connections.extend(loaded.iter().cloned());
        drop(connections);
        drop(pools);
        for pool in old {
            pool.close().await;
        }
    }

    Ok(loaded)
}
