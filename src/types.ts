/** Matches Rust SchemaObject */
export interface SchemaObject {
  name: string;
  schema: string;
  object_type: "table" | "view" | "function";
}

/** Matches Rust QueryResult */
export interface QueryResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
  /** Rows affected by INSERT/UPDATE/DELETE statements (summed across a script) */
  rows_affected: number;
  /** True if the result set was cut off at the server-side row cap */
  truncated: boolean;
  execution_time_ms: number;
}

/** Matches Rust ColumnInfo */
export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
}

/** Detailed column info for DDL view */
export interface ColumnDetail {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
}

/** Index info for DDL view */
export interface IndexInfo {
  name: string;
  is_unique: boolean;
  is_primary: boolean;
  definition: string;
}

/** Constraint info for DDL view */
export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  definition: string;
}

/** Foreign key info for DDL view */
export interface ForeignKeyInfo {
  name: string;
  column_name: string;
  ref_schema: string;
  ref_table: string;
  ref_column: string;
}

/** Full table structure for DDL view */
export interface TableStructure {
  columns: ColumnDetail[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
  foreign_keys: ForeignKeyInfo[];
}

/** A staged cell edit sent to the backend (matches Rust CellEdit) */
export interface CellEdit {
  column: string;
  primary_key_columns: string[];
  primary_key_values: unknown[];
  new_value: string | null;
}

/** Progressive event from execute_query_stream (matches Rust StreamEvent) */
export type StreamEvent =
  | { type: "columns"; columns: string[] }
  | { type: "rows"; rows: (string | number | boolean | null)[][] };

/** Summary returned by execute_query_stream (matches Rust StreamSummary) */
export interface StreamSummary {
  columns: string[];
  row_count: number;
  rows_affected: number;
  truncated: boolean;
  execution_time_ms: number;
}

/** A tab in the main area */
export interface Tab {
  id: string;
  title: string;
  type: "table-browser" | "query-editor" | "table-structure";
  connectionId: string;
  /** Target database on the server */
  database: string;
  /** For table-browser and table-structure tabs */
  schema?: string;
  table?: string;
  /** Custom title set by the user (query tabs); falls back to `title` */
  customTitle?: string;
  /** Initial column filters (e.g. when opened via FK navigation) */
  initialFilters?: Record<string, string>;
}

/** Query history entry */
export interface HistoryEntry {
  sql: string;
  database: string;
  executed_at: string;
}

/** Saved / favorite query */
export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  database: string;
}

/** A connected database shown in the sidebar */
export interface ConnectionEntry {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  database: string;
  ssl: boolean;
  /** Postgres sslmode: "disable" | "require" | "verify-full" */
  ssl_mode?: string | null;
  /** Path to a CA cert for verify-full */
  ssl_root_cert?: string | null;
  /** UI accent color (hex) to distinguish connections, e.g. red for prod */
  color?: string | null;
  /** When true, sessions are read-only and editing UI is hidden */
  read_only?: boolean;
}
