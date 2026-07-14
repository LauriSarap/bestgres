import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Play, Loader2, AlertCircle, Clock, Rows3, History, Star, StarOff,
  Trash2, X, ChevronRight, Download,
} from "lucide-react";
import { DataGrid, formatRows, type GridColumn } from "@/components/DataGrid";
import { SqlEditor } from "@/components/SqlEditor";
import { useToast } from "@/components/Toast";
import type { HistoryEntry, SavedQuery, StreamEvent, StreamSummary } from "@/types";

interface QueryEditorProps {
  tabId: string;
  connectionId: string;
  database: string;
  onDirtyChange?: (dirty: boolean) => void;
}

type PanelView = "none" | "history" | "saved";

const DDL_RE = /^\s*(create|alter|drop|truncate|comment|grant|revoke|reindex|vacuum)\b/i;

export function QueryEditor({ tabId, connectionId, database, onDirtyChange }: QueryEditorProps) {
  const { toast } = useToast();
  const sqlKey = `bestgres:sql:${tabId}`;
  const [sql, setSql] = useState(() => localStorage.getItem(`bestgres:sql:${tabId}`) ?? "");
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [summary, setSummary] = useState<StreamSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<PanelView>("none");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const lastRunSql = useRef<string>(localStorage.getItem(`bestgres:sql:${tabId}`) ?? "");

  // Persist SQL per tab + report dirty (unrun changes) for the tab dot
  useEffect(() => {
    localStorage.setItem(sqlKey, sql);
    onDirtyChange?.(sql.trim() !== "" && sql !== lastRunSql.current);
  }, [sql, sqlKey, onDirtyChange]);

  // Accumulate streamed rows in a ref, flush to state via rAF to limit renders
  const rowsBuf = useRef<unknown[][]>([]);
  const rafPending = useRef(false);
  const flush = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      setRows(rowsBuf.current.slice());
    });
  }, []);

  const runQuery = useCallback(async () => {
    const trimmed = sql.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setSummary(null);
    setColumns([]);
    setRows([]);
    setSelectedKeys(new Set());
    rowsBuf.current = [];

    const channel = new Channel<StreamEvent>();
    channel.onmessage = (msg) => {
      if (msg.type === "columns") {
        rowsBuf.current = [];
        setColumns(msg.columns.map((name) => ({ name })));
        setRows([]);
      } else {
        rowsBuf.current = rowsBuf.current.concat(msg.rows);
        flush();
      }
    };

    try {
      const sum = await invoke<StreamSummary>("execute_query_stream", {
        connectionId,
        database,
        sql: trimmed,
        onEvent: channel,
      });
      setRows(rowsBuf.current.slice());
      setSummary(sum);
      lastRunSql.current = sql;
      onDirtyChange?.(false);
      const label =
        sum.columns.length === 0
          ? `${sum.rows_affected} row${sum.rows_affected !== 1 ? "s" : ""} affected`
          : `${sum.row_count} row${sum.row_count !== 1 ? "s" : ""}`;
      toast("success", `${label} in ${sum.execution_time_ms}ms`);
      invoke("add_to_history", { sql: trimmed, database }).catch(() => {});
      // Notify the sidebar to refresh schema after DDL
      if (DDL_RE.test(trimmed)) {
        window.dispatchEvent(
          new CustomEvent("bestgres:schema-changed", { detail: { connectionId, database } })
        );
      }
    } catch (err) {
      setError(String(err));
      setSummary(null);
      toast("error", "Query failed");
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, sql, toast, flush, onDirtyChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runQuery();
      }
    },
    [runQuery]
  );

  useEffect(() => {
    if (panelView !== "history") return;
    invoke<HistoryEntry[]>("get_history").then(setHistory).catch(() => {});
  }, [panelView]);

  useEffect(() => {
    if (panelView !== "saved") return;
    invoke<SavedQuery[]>("list_saved_queries").then(setSavedQueries).catch(() => {});
  }, [panelView]);

  const handleSaveQuery = useCallback(async () => {
    const trimmed = saveName.trim();
    if (!trimmed || !sql.trim()) return;
    const id = crypto.randomUUID();
    try {
      await invoke("save_query", { id, name: trimmed, sql: sql.trim(), database });
      setSaveName("");
      setShowSaveInput(false);
      toast("success", `Saved "${trimmed}"`);
      if (panelView === "saved") setSavedQueries(await invoke<SavedQuery[]>("list_saved_queries"));
    } catch {
      toast("error", "Failed to save query");
    }
  }, [saveName, sql, database, panelView, toast]);

  const handleDeleteSaved = useCallback(async (id: string) => {
    try {
      await invoke("delete_saved_query", { id });
      setSavedQueries((prev) => prev.filter((q) => q.id !== id));
    } catch { /* ignore */ }
  }, []);

  const handleClearHistory = useCallback(async () => {
    try { await invoke("clear_history"); setHistory([]); } catch { /* ignore */ }
  }, []);

  const togglePanel = useCallback((view: PanelView) => {
    setPanelView((prev) => (prev === view ? "none" : view));
  }, []);

  const handleExport = useCallback(async (format: "csv" | "json") => {
    if (rows.length === 0) return;
    try {
      const date = new Date().toISOString().slice(0, 10);
      const base = `${database}_query_${date}`.replace(/[^\w-]/g, "_");
      const path = await save({
        defaultPath: `${base}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      await invoke("save_text_file", { path, contents: formatRows(columns, rows, format) });
      toast("success", `Exported ${rows.length} rows`);
    } catch (err) {
      toast("error", String(err));
    }
  }, [rows, columns, toast]);

  const getRowKey = useCallback((i: number) => String(i), []);
  const toggleRow = useCallback((key: string, sel: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (sel) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  const toggleAll = useCallback((sel: boolean) => {
    setSelectedKeys(sel ? new Set(rows.map((_, i) => String(i))) : new Set());
  }, [rows]);

  const hasResult = summary !== null || rows.length > 0;
  const showStats = useMemo(() => summary, [summary]);

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
            {showStats && (
              <>
                <span className="flex items-center gap-1">
                  <Rows3 className="h-3 w-3" />
                  {showStats.columns.length === 0
                    ? `${showStats.rows_affected} affected`
                    : `${showStats.row_count} rows`}
                </span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{showStats.execution_time_ms}ms</span>
              </>
            )}
            <button onClick={() => togglePanel("history")} className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${panelView === "history" ? "bg-primary/10 text-primary" : "hover:text-foreground"}`}>
              <History className="h-3 w-3" />History
            </button>
            <button onClick={() => togglePanel("saved")} className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${panelView === "saved" ? "bg-primary/10 text-primary" : "hover:text-foreground"}`}>
              <Star className="h-3 w-3" />Saved
            </button>
            {sql.trim() && (
              <button onClick={() => setShowSaveInput((v) => !v)} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-foreground transition-colors">
                <StarOff className="h-3 w-3" />Save
              </button>
            )}
            {rows.length > 0 && (
              <>
                <button onClick={() => handleExport("csv")} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-foreground transition-colors" title="Export to CSV">
                  <Download className="h-3 w-3" />CSV
                </button>
                <button onClick={() => handleExport("json")} className="rounded px-1.5 py-0.5 hover:text-foreground transition-colors" title="Export to JSON">JSON</button>
              </>
            )}
          </div>
          <button
            onClick={runQuery}
            disabled={loading || !sql.trim()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Run
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
            <button onClick={handleSaveQuery} disabled={!saveName.trim()} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">Save</button>
            <button onClick={() => setShowSaveInput(false)} className="rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"><X className="h-3 w-3" /></button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {panelView !== "none" && (
          <div className="w-72 shrink-0 overflow-y-auto border-r border-border bg-muted/30">
            {panelView === "history" && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</span>
                  {history.length > 0 && (
                    <button onClick={handleClearHistory} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">Clear all</button>
                  )}
                </div>
                {history.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">No history yet</div>
                ) : (
                  history.map((entry, i) => (
                    <button key={i} onClick={() => { setSql(entry.sql); setPanelView("none"); }} className="group flex flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left hover:bg-muted/50 transition-colors">
                      <span className="max-w-full truncate font-mono text-[11px] text-foreground">
                        {entry.sql.length > 80 ? entry.sql.slice(0, 80) + "..." : entry.sql}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">{entry.database} &middot; {new Date(entry.executed_at).toLocaleString()}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            {panelView === "saved" && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Saved Queries</span>
                </div>
                {savedQueries.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">No saved queries</div>
                ) : (
                  savedQueries.map((q) => (
                    <div key={q.id} className="group flex items-start justify-between border-b border-border/50 px-3 py-2 hover:bg-muted/50 transition-colors">
                      <button onClick={() => { setSql(q.sql); setPanelView("none"); }} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                        <div className="flex items-center gap-1">
                          <ChevronRight className="h-3 w-3 shrink-0 text-primary" />
                          <span className="truncate text-xs font-medium text-foreground">{q.name}</span>
                        </div>
                        <span className="max-w-full truncate pl-4 font-mono text-[11px] text-muted-foreground">
                          {q.sql.length > 60 ? q.sql.slice(0, 60) + "..." : q.sql}
                        </span>
                      </button>
                      <button onClick={() => handleDeleteSaved(q.id)} className="mt-0.5 shrink-0 p-0.5 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {error ? (
            <div className="flex items-start gap-2 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <pre className="selectable whitespace-pre-wrap font-mono text-xs">{error}</pre>
            </div>
          ) : hasResult && columns.length > 0 ? (
            <div className="flex h-full flex-col">
              {summary?.truncated && (
                <div className="flex items-center gap-2 border-b border-border bg-yellow-500/10 px-4 py-1.5 text-xs text-yellow-600 dark:text-yellow-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  Results truncated to the first {summary.row_count} rows. Add a LIMIT to refine.
                </div>
              )}
              <DataGrid
                columns={columns}
                rows={rows}
                className="flex-1"
                getRowKey={getRowKey}
                selectedKeys={selectedKeys}
                onToggleRow={toggleRow}
                onToggleAll={toggleAll}
              />
            </div>
          ) : hasResult ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {summary ? `${summary.rows_affected} row${summary.rows_affected !== 1 ? "s" : ""} affected` : "Done"}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Run a query to see results</div>
          )}
        </div>
      </div>
    </div>
  );
}
