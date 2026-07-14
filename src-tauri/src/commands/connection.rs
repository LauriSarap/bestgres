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
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
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
        ssl_mode: config.ssl_mode.clone(),
        ssl_root_cert: config.ssl_root_cert.clone(),
        color: config.color.clone(),
        read_only: config.read_only,
    };
    let json = serde_json::to_string_pretty(&file_config)
        .map_err(|e| AppError::Config(format!("Cannot serialize config: {}", e)))?;
    std::fs::write(dir.join(connection_filename(config)), json)
        .map_err(|e| AppError::Config(format!("Cannot write config file: {}", e)))?;
    Ok(())
}

struct PreparedConnection {
    config: ConnectionConfig,
    password: Option<String>,
    should_rewrite: bool,
}

/// Convert a connection file into runtime metadata and resolve its credential.
/// Metadata is always returned, even when the credential is unavailable, so a
/// saved connection remains visible and can be repaired by editing it.
fn prepare_connection<G, S>(
    file_config: ConnectionFileConfig,
    get_stored_password: G,
    store_stored_password: S,
) -> PreparedConnection
where
    G: FnOnce(&str) -> Result<String, AppError>,
    S: FnOnce(&str, &str) -> Result<(), AppError>,
{
    let generated_id = file_config.id.is_none();
    let id = file_config
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let legacy_password = file_config.password.clone();

    let config = ConnectionConfig {
        id: id.clone(),
        name: file_config.name,
        host: file_config.host,
        port: file_config.port,
        user: file_config.user,
        database: file_config.database,
        ssl: file_config.ssl,
        ssl_mode: file_config.ssl_mode,
        ssl_root_cert: file_config.ssl_root_cert,
        color: file_config.color,
        read_only: file_config.read_only,
    };

    let mut migrated_legacy_password = false;
    let password = match get_stored_password(&id) {
        Ok(password) => Some(password),
        Err(_) => match legacy_password.as_deref() {
            Some(password) if store_stored_password(&id, password).is_ok() => {
                migrated_legacy_password = true;
                Some(password.to_owned())
            }
            _ => None,
        },
    };

    let should_rewrite = migrated_legacy_password
        || (generated_id && legacy_password.is_none() && password.is_some());

    PreparedConnection {
        config,
        password,
        // Never remove the only copy of a legacy password unless migration
        // into the platform credential store succeeded.
        should_rewrite,
    }
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

/// Percent-encode a connection string component (RFC 3986 unreserved set).
fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Build a connection string for a config, targeting `database`
/// (which may differ from the config's default database).
pub fn build_connection_string(
    config: &ConnectionConfig,
    password: &str,
    database: &str,
) -> String {
    let ssl_mode = match config.ssl_mode.as_deref() {
        Some(m) if !m.is_empty() => m,
        _ => {
            if config.ssl {
                "require"
            } else {
                "disable"
            }
        }
    };
    let mut url = format!(
        "postgres://{}:{}@{}:{}/{}?sslmode={}",
        pct_encode(&config.user),
        pct_encode(password),
        config.host,
        config.port,
        pct_encode(database),
        ssl_mode
    );
    if let Some(cert) = config.ssl_root_cert.as_deref().filter(|c| !c.is_empty()) {
        url.push_str(&format!("&sslrootcert={}", pct_encode(cert)));
    }
    if config.read_only {
        // Enforced server-side: every session opens read-only
        url.push_str("&options=-c%20default_transaction_read_only%3Don");
    }
    url
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
    let conn_str = build_connection_string(&config, &password, database);
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
    save_connection_to_file(&config)?;

    // Try to connect — save the connection regardless of outcome
    let conn_str = build_connection_string(&config, &password, &config.database);
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

    // Persist the new file before removing an old renamed file. A failed write
    // must not silently destroy the last good copy of the connection metadata.
    let old_config = {
        let connections = state.connections.lock().await;
        connections.iter().find(|c| c.id == config.id).cloned()
    };
    save_connection_to_file(&config)?;
    if let Some(old) = old_config {
        if connection_filename(&old) != connection_filename(&config) {
            delete_connection_file(&old)?;
        }
    }

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
    let conn_str = build_connection_string(&config, &effective_password, &config.database);
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
            delete_connection_file(config)?;
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
pub async fn connect(state: State<'_, AppState>, connection_id: String) -> Result<(), AppError> {
    let connections = state.connections.lock().await;
    let config = connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| AppError::Connection("Connection not found".into()))?
        .clone();
    drop(connections);

    let password = get_password(&connection_id)?;
    let conn_str = build_connection_string(&config, &password, &config.database);
    let pool = postgres::create_pool(&conn_str).await?;
    postgres::test_connection(&pool).await?;

    let mut pools = state.pools.lock().await;
    pools.insert(connection_id, pool);

    Ok(())
}

/// Disconnect and remove a pool.
#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, connection_id: String) -> Result<(), AppError> {
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

/// Test a connection's settings without saving it. Returns Ok on success,
/// or an error string describing why the connection failed.
#[tauri::command]
pub async fn test_connection_config(
    config: ConnectionConfig,
    password: String,
) -> Result<(), AppError> {
    // If editing, an empty password means "use the stored one"
    let effective_password = if password.is_empty() {
        get_password(&config.id).unwrap_or_default()
    } else {
        password
    };
    let conn_str = build_connection_string(&config, &effective_password, &config.database);
    let pool = postgres::create_pool(&conn_str).await?;
    let result = postgres::test_connection(&pool).await;
    pool.close().await;
    result
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

        let prepared = prepare_connection(file_config, get_password, store_password);
        let config = prepared.config;
        let id = config.id.clone();

        // Rewrite the file if it's missing the stable id or still has the password inline
        if prepared.should_rewrite {
            save_connection_to_file(&config)?;
        }

        // A missing credential no longer hides saved metadata. The connection
        // stays visible without a pool until the user edits it and re-enters
        // the password once.
        if let Some(password) = prepared.password {
            let conn_str = build_connection_string(&config, &password, &config.database);
            if let Ok(pool) = postgres::create_pool_lazy(&conn_str) {
                new_pools.push((id, pool));
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn file_config(password: Option<&str>) -> ConnectionFileConfig {
        ConnectionFileConfig {
            id: Some("connection-id".into()),
            name: "Saved connection".into(),
            host: "localhost".into(),
            port: 5432,
            user: "postgres".into(),
            password: password.map(str::to_owned),
            database: "postgres".into(),
            ssl: false,
            ssl_mode: None,
            ssl_root_cert: None,
            color: None,
            read_only: false,
        }
    }

    #[test]
    fn saved_metadata_remains_visible_when_password_is_missing() {
        let prepared = prepare_connection(
            file_config(None),
            |_| Err(AppError::Keychain("missing".into())),
            |_, _| Ok(()),
        );

        assert_eq!(prepared.config.id, "connection-id");
        assert_eq!(prepared.config.name, "Saved connection");
        assert!(prepared.password.is_none());
        assert!(!prepared.should_rewrite);
    }

    #[test]
    fn stored_password_is_used_without_rewriting_metadata() {
        let prepared = prepare_connection(
            file_config(None),
            |_| Ok("secret".into()),
            |_, _| panic!("legacy migration should not run"),
        );

        assert_eq!(prepared.password.as_deref(), Some("secret"));
        assert!(!prepared.should_rewrite);
    }

    #[test]
    fn legacy_inline_password_is_migrated_and_removed_from_disk() {
        let prepared = prepare_connection(
            file_config(Some("legacy-secret")),
            |_| Err(AppError::Keychain("missing".into())),
            |id, password| {
                assert_eq!(id, "connection-id");
                assert_eq!(password, "legacy-secret");
                Ok(())
            },
        );

        assert_eq!(prepared.password.as_deref(), Some("legacy-secret"));
        assert!(prepared.should_rewrite);
    }

    #[test]
    fn failed_legacy_migration_keeps_inline_password_file_unchanged() {
        let prepared = prepare_connection(
            file_config(Some("legacy-secret")),
            |_| Err(AppError::Keychain("missing".into())),
            |_, _| Err(AppError::Keychain("locked".into())),
        );

        assert!(prepared.password.is_none());
        assert!(!prepared.should_rewrite);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_uses_the_reboot_persistent_secret_service_backend() {
        let entry = keyring::Entry::new("bestgres", "backend-test").unwrap();
        assert!(entry
            .get_credential()
            .is::<keyring::secret_service::SsCredential>());
    }
}
