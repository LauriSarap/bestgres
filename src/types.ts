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
}
