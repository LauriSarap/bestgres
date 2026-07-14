use serde::{Deserialize, Serialize};

/// Metadata for a saved database connection (passwords stored in system keychain).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    /// Legacy on/off SSL flag; superseded by ssl_mode when set.
    pub ssl: bool,
    /// Postgres sslmode: "disable", "require", or "verify-full".
    #[serde(default)]
    pub ssl_mode: Option<String>,
    /// Path to a CA certificate for verify-full.
    #[serde(default)]
    pub ssl_root_cert: Option<String>,
    /// UI accent color for this connection (e.g. to mark prod red).
    #[serde(default)]
    pub color: Option<String>,
    /// When true, sessions run with default_transaction_read_only=on
    /// and the UI hides editing affordances.
    #[serde(default)]
    pub read_only: bool,
}

/// Config format for JSON files in ~/.config/bestgres/connections/.
/// Passwords live in the system keychain, keyed by the stable `id`.
/// `password` is only read for migrating legacy files that stored it inline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionFileConfig {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    pub database: String,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl_root_cert: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub read_only: bool,
}

/// Information about a single table/view in the schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaObject {
    pub name: String,
    pub schema: String,
    pub object_type: SchemaObjectType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchemaObjectType {
    Table,
    View,
    Function,
}

/// A column in a table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
}

/// Detailed column info for DDL/structure view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDetail {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
}

/// Index info for structure view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub definition: String,
}

/// Constraint info for structure view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub definition: String,
}

/// Foreign key info for structure view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column_name: String,
    pub ref_schema: String,
    pub ref_table: String,
    pub ref_column: String,
}

/// Full table structure for the DDL view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub columns: Vec<ColumnDetail>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

/// A single staged cell edit, identifying the row by its primary key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellEdit {
    pub column: String,
    pub primary_key_columns: Vec<String>,
    pub primary_key_values: Vec<serde_json::Value>,
    pub new_value: serde_json::Value,
}

/// Result of executing a query — column names + rows of JSON values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    /// Rows affected by INSERT/UPDATE/DELETE statements (summed across a script).
    pub rows_affected: u64,
    /// True if the result set was cut off at MAX_QUERY_ROWS.
    pub truncated: bool,
    pub execution_time_ms: u64,
}

/// A single entry in query history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub sql: String,
    pub database: String,
    pub executed_at: String,
}

/// A saved / favorite query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub database: String,
}

/// Errors returned to the frontend as user-friendly strings.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Keychain error: {0}")]
    Keychain(String),
}

// Allow AppError to be returned from Tauri commands as a serialized string.
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
