import { useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Loader2, AlertCircle, Clock, Rows3 } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/DataGrid";
import type { QueryResult } from "@/types";

interface QueryEditorProps {
  connectionId: string;
  database: string;
}

export function QueryEditor({ connectionId, database }: QueryEditorProps) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQuery = useCallback(async () => {
    const trimmed = sql.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const res = await invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        sql: trimmed,
      });
      setResult(res);
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, sql]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runQuery();
      }
    },
    [runQuery]
  );

  const columns: ColumnDef<Record<string, unknown>, unknown>[] = useMemo(() => {
    if (!result) return [];
    return result.columns.map((col) => ({
      accessorKey: col,
      header: col,
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
  }, [result]);

  const data: Record<string, unknown>[] = useMemo(() => {
    if (!result) return [];
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }, [result]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col border-b border-border">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write SQL here... (Ctrl+Enter to run)"
          className="selectable min-h-[120px] resize-y bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          spellCheck={false}
        />
        <div className="flex items-center justify-between border-t border-border px-4 py-1.5">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {result && (
              <>
                <span className="flex items-center gap-1">
                  <Rows3 className="h-3 w-3" />
                  {result.row_count} rows
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {result.execution_time_ms}ms
                </span>
              </>
            )}
          </div>
          <button
            onClick={runQuery}
            disabled={loading || !sql.trim()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Run
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {error && (
          <div className="flex items-start gap-2 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <pre className="selectable whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        )}
        {result && !error && (
          <DataGrid data={data} columns={columns} className="h-full" />
        )}
        {!result && !error && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Run a query to see results
          </div>
        )}
      </div>
    </div>
  );
}
