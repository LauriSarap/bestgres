import { useEffect, useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, AlertCircle, Clock, Rows3, ChevronDown } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/DataGrid";
import type { QueryResult, ColumnInfo } from "@/types";

const PAGE_SIZE = 100;

interface TableBrowserProps {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

export function TableBrowser({ connectionId, database, schema, table }: TableBrowserProps) {
  const [rows, setRows] = useState<unknown[][]>([]);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<Map<string, string>>(new Map());
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [execTime, setExecTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: count + first page + column info
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setLoading(true);
      setError(null);
      setRows([]);
      setColumnNames([]);
      setColumnTypes(new Map());
      setTotalCount(null);

      try {
        // Fire all three queries in parallel
        const [dataRes, countRes, colInfo] = await Promise.all([
          invoke<QueryResult>("execute_query", {
            connectionId,
            database,
            sql: `SELECT * FROM "${schema}"."${table}" LIMIT ${PAGE_SIZE}`,
          }),
          invoke<QueryResult>("execute_query", {
            connectionId,
            database,
            sql: `SELECT COUNT(*) FROM "${schema}"."${table}"`,
          }),
          invoke<ColumnInfo[]>("get_columns", {
            connectionId,
            database,
            schema,
            table,
          }),
        ]);

        if (cancelled) return;

        setColumnNames(dataRes.columns);
        setRows(dataRes.rows);
        setExecTime(dataRes.execution_time_ms);

        // Parse count
        const cnt = countRes.rows[0]?.[0];
        if (cnt !== null && cnt !== undefined) {
          setTotalCount(Number(cnt));
        }

        // Build column type map
        const typeMap = new Map<string, string>();
        for (const col of colInfo) {
          typeMap.set(col.name, col.data_type);
        }
        setColumnTypes(typeMap);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInitial();
    return () => { cancelled = true; };
  }, [connectionId, database, schema, table]);

  // Load more pages
  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const offset = rows.length;
      const res = await invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        sql: `SELECT * FROM "${schema}"."${table}" LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      });
      setRows((prev) => [...prev, ...res.rows]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [connectionId, database, schema, table, rows.length, loadingMore]);

  const columns: ColumnDef<Record<string, unknown>, unknown>[] = useMemo(() => {
    if (columnNames.length === 0) return [];
    return columnNames.map((col) => ({
      accessorKey: col,
      header: () => (
        <div className="flex flex-col gap-0.5">
          <span>{col}</span>
          {columnTypes.has(col) && (
            <span className="font-normal text-[10px] text-muted-foreground/70">
              {columnTypes.get(col)}
            </span>
          )}
        </div>
      ),
      cell: ({ getValue }) => {
        const v = getValue();
        if (v === null || v === undefined) {
          return <span className="text-muted-foreground/50 italic">NULL</span>;
        }
        if (typeof v === "object") {
          return JSON.stringify(v);
        }
        return String(v);
      },
    }));
  }, [columnNames, columnTypes]);

  const data: Record<string, unknown>[] = useMemo(() => {
    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      columnNames.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }, [rows, columnNames]);

  const hasMore = totalCount !== null && rows.length < totalCount;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {database}.{schema}.{table}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Rows3 className="h-3 w-3" />
          {rows.length}{totalCount !== null ? ` / ${totalCount}` : ""} rows
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {execTime}ms
        </span>
      </div>
      <DataGrid data={data} columns={columns} className="flex-1" />
      {hasMore && (
        <div className="flex items-center justify-center border-t border-border py-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {loadingMore ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            Load more ({totalCount! - rows.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
