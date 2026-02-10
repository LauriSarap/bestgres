use std::collections::HashMap;
use std::sync::Arc;

use sqlx::PgPool;
use tauri::State;
use tokio::sync::Mutex;

use crate::db::postgres;
use crate::models::{AppError, ConnectionConfig, ConnectionFileConfig};

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
#[tauri::command]
pub async fn add_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: String,
) -> Result<(), AppError> {
    store_password(&config.id, &password)?;

    // Try to connect — save the connection regardless of outcome
    let conn_str = build_connection_string(
        &config.host,
        config.port,
        &config.user,
        &password,
        &config.database,
        config.ssl,
    );
    if let Ok(pool) = postgres::create_pool(&conn_str).await {
        if postgres::test_connection(&pool).await.is_ok() {
            let mut pools = state.pools.lock().await;
            pools.insert(config.id.clone(), pool);
        }
    }

    let mut connections = state.connections.lock().await;
    connections.push(config);

    Ok(())
}

/// Update an existing connection's configuration.
/// If password is non-empty, update it in keychain. Otherwise keep the old one.
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

    // Test new config
    let conn_str = build_connection_string(
        &config.host,
        config.port,
        &config.user,
        &effective_password,
        &config.database,
        config.ssl,
    );
    let pool = postgres::create_pool(&conn_str).await?;
    postgres::test_connection(&pool).await?;

    // Update password if provided
    if !password.is_empty() {
        store_password(&config.id, &password)?;
    }

    // Close old pools for this connection (primary + any database-specific ones)
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
        pools.insert(config.id.clone(), pool);
    }

    // Update config
    let mut connections = state.connections.lock().await;
    if let Some(existing) = connections.iter_mut().find(|c| c.id == config.id) {
        *existing = config;
    }

    Ok(())
}

/// Remove a connection entirely.
#[tauri::command]
pub async fn remove_connection(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), AppError> {
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

    // Remove config
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
#[tauri::command]
pub async fn load_config_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, AppError> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| AppError::Config("Cannot determine config directory".into()))?
        .join("bestgres")
        .join("connections");

    // Create directory if it doesn't exist
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir)
            .map_err(|e| AppError::Config(format!("Cannot create config dir: {}", e)))?;
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(&config_dir)
        .map_err(|e| AppError::Config(format!("Cannot read config dir: {}", e)))?;

    let mut loaded: Vec<ConnectionConfig> = Vec::new();

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

        let id = uuid::Uuid::new_v4().to_string();

        // Store password in keychain (must succeed to be useful)
        if store_password(&id, &file_config.password).is_err() {
            continue;
        }

        let config = ConnectionConfig {
            id: id.clone(),
            name: file_config.name,
            host: file_config.host,
            port: file_config.port,
            user: file_config.user,
            database: file_config.database,
            ssl: file_config.ssl,
        };

        // Create a lazy pool — doesn't actually connect until first query.
        // This ensures the connection always appears in the sidebar instantly.
        let conn_str = build_connection_string(
            &config.host,
            config.port,
            &config.user,
            &file_config.password,
            &config.database,
            config.ssl,
        );
        if let Ok(pool) = postgres::create_pool_lazy(&conn_str) {
            let mut pools = state.pools.lock().await;
            pools.insert(id, pool);
            drop(pools);
        }

        let mut connections = state.connections.lock().await;
        connections.push(config.clone());
        drop(connections);

        loaded.push(config);
    }

    Ok(loaded)
}
