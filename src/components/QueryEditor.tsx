import { useState, useMemo, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Play,
  Loader2,
  AlertCircle,
  Clock,
  Rows3,
  History,
  Star,
  StarOff,
  Trash2,
  X,
  ChevronRight,
} from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/DataGrid";
import { SqlEditor } from "@/components/SqlEditor";
import { useToast } from "@/components/Toast";
import type { QueryResult, HistoryEntry, SavedQuery } from "@/types";

interface QueryEditorProps {
  connectionId: string;
  database: string;
}

type PanelView = "none" | "history" | "saved";

export function QueryEditor({ connectionId, database }: QueryEditorProps) {
  const { toast } = useToast();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<PanelView>("none");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

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
      toast("success", `${res.row_count} row${res.row_count !== 1 ? "s" : ""} in ${res.execution_time_ms}ms`);
      // Add to history (fire-and-forget)
      invoke("add_to_history", { sql: trimmed, database }).catch(() => {});
    } catch (err) {
      setError(String(err));
      setResult(null);
      toast("error", "Query failed");
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, sql, toast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runQuery();
      }
    },
    [runQuery]
  );

  // Load history when panel opens
  useEffect(() => {
    if (panelView !== "history") return;
    invoke<HistoryEntry[]>("get_history").then(setHistory).catch(() => {});
  }, [panelView]);

  // Load saved queries when panel opens
  useEffect(() => {
    if (panelView !== "saved") return;
    invoke<SavedQuery[]>("list_saved_queries")
      .then(setSavedQueries)
      .catch(() => {});
  }, [panelView]);

  const handleSaveQuery = useCallback(async () => {
    const trimmed = saveName.trim();
    if (!trimmed || !sql.trim()) return;
    const id = crypto.randomUUID();
    try {
      await invoke("save_query", {
        id,
        name: trimmed,
        sql: sql.trim(),
        database,
      });
      setSaveName("");
      setShowSaveInput(false);
      toast("success", `Saved "${trimmed}"`);
      // Refresh list if panel is showing
      if (panelView === "saved") {
        const updated = await invoke<SavedQuery[]>("list_saved_queries");
        setSavedQueries(updated);
      }
    } catch {
      toast("error", "Failed to save query");
    }
  }, [saveName, sql, database, panelView, toast]);

  const handleDeleteSaved = useCallback(
    async (id: string) => {
      try {
        await invoke("delete_saved_query", { id });
        setSavedQueries((prev) => prev.filter((q) => q.id !== id));
      } catch {
        // ignore
      }
    },
    []
  );

  const handleClearHistory = useCallback(async () => {
    try {
      await invoke("clear_history");
      setHistory([]);
    } catch {
      // ignore
    }
  }, []);

  const togglePanel = useCallback(
    (view: PanelView) => {
      setPanelView((prev) => (prev === view ? "none" : view));
    },
    []
  );

  const columns: ColumnDef<Record<string, unknown>, unknown>[] = useMemo(() => {
    if (!result) return [];
    return result.columns.map((col) => ({
      accessorKey: col,
      header: col,
      cell: ({ getValue }: { getValue: () => unknown }) => {
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
        <SqlEditor
          value={sql}
          onChange={setSql}
          onKeyDown={handleKeyDown}
          placeholder="Write SQL here... (Ctrl+Enter to run)"
          className="min-h-[120px]"
        />
        <div className="flex items-center justify-between border-t border-border px-4 py-1.5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
            <button
              onClick={() => togglePanel("history")}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                panelView === "history"
                  ? "bg-primary/10 text-primary"
                  : "hover:text-foreground"
              }`}
            >
              <History className="h-3 w-3" />
              History
            </button>
            <button
              onClick={() => togglePanel("saved")}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                panelView === "saved"
                  ? "bg-primary/10 text-primary"
                  : "hover:text-foreground"
              }`}
            >
              <Star className="h-3 w-3" />
              Saved
            </button>
            {sql.trim() && (
              <button
                onClick={() => setShowSaveInput((v) => !v)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-foreground transition-colors"
              >
                <StarOff className="h-3 w-3" />
                Save
              </button>
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

        {showSaveInput && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-1.5">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveQuery();
                if (e.key === "Escape") setShowSaveInput(false);
              }}
              placeholder="Query name..."
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              onClick={handleSaveQuery}
              disabled={!saveName.trim()}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveInput(false)}
              className="rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Side panel for history / saved */}
        {panelView !== "none" && (
          <div className="w-72 shrink-0 border-r border-border overflow-y-auto bg-muted/30">
            {panelView === "history" && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    History
                  </span>
                  {history.length > 0 && (
                    <button
                      onClick={handleClearHistory}
                      className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No history yet
                  </div>
                ) : (
                  history.map((entry, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSql(entry.sql);
                        setPanelView("none");
                      }}
                      className="flex flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left hover:bg-muted/50 transition-colors group"
                    >
                      <span className="text-[11px] font-mono text-foreground truncate max-w-full">
                        {entry.sql.length > 80
                          ? entry.sql.slice(0, 80) + "..."
                          : entry.sql}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {entry.database} &middot;{" "}
                        {new Date(entry.executed_at).toLocaleString()}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {panelView === "saved" && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Saved Queries
                  </span>
                </div>
                {savedQueries.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No saved queries
                  </div>
                ) : (
                  savedQueries.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-start justify-between border-b border-border/50 px-3 py-2 hover:bg-muted/50 transition-colors group"
                    >
                      <button
                        onClick={() => {
                          setSql(q.sql);
                          setPanelView("none");
                        }}
                        className="flex flex-col gap-0.5 text-left flex-1 min-w-0"
                      >
                        <div className="flex items-center gap-1">
                          <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                          <span className="text-xs font-medium text-foreground truncate">
                            {q.name}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground truncate max-w-full pl-4">
                          {q.sql.length > 60
                            ? q.sql.slice(0, 60) + "..."
                            : q.sql}
                        </span>
                      </button>
                      <button
                        onClick={() => handleDeleteSaved(q.id)}
                        className="opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 p-0.5 text-muted-foreground hover:text-destructive transition-all"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Results area */}
        <div className="flex-1 overflow-hidden">
          {error && (
            <div className="flex items-start gap-2 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <pre className="selectable whitespace-pre-wrap font-mono text-xs">
                {error}
              </pre>
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
    </div>
  );
}
