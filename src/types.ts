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

/** A tab in the main area */
export interface Tab {
  id: string;
  title: string;
  type: "table-browser" | "query-editor";
  connectionId: string;
  /** Target database on the server */
  database: string;
  /** For table-browser tabs */
  schema?: string;
  table?: string;
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
