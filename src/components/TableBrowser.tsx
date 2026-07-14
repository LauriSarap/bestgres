import { useState, useCallback, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Loader2, AlertCircle, Clock, Rows3, Plus, Trash2, Filter, X, Check,
  Download, PanelBottom, Ban, Save, Undo2, Zap, RefreshCw, Copy,
} from "lucide-react";
import { DataGrid, formatRows, stringifyCell } from "@/components/DataGrid";
import { parseEditValue } from "@/components/EditableCell";
import { useToast } from "@/components/Toast";
import { useTableData } from "@/hooks/use-table-data";

interface TableBrowserProps {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  readOnly: boolean;
  initialFilters?: Record<string, string>;
  onOpenRelated: (database: string, schema: string, table: string, filters: Record<string, string>) => void;
}

export function TableBrowser({
  connectionId, database, schema, table, readOnly, initialFilters, onOpenRelated,
}: TableBrowserProps) {
  const { toast } = useToast();
  const t = useTableData({ connectionId, database, schema, table, readOnly, initialFilters });

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showAddRow, setShowAddRow] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [inserting, setInserting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [focusedCell, setFocusedCell] = useState<{ r: number; c: number } | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState("");
  const [previewSql, setPreviewSql] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Reset selection when the underlying query changes
  useEffect(() => { setSelectedKeys(new Set()); }, [t.sort, t.columnFilters]);

  const editable = t.canEdit;

  /* ── Selection ── */
  const toggleRow = useCallback((key: string, selected: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (selected) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  const toggleAll = useCallback((selected: boolean) => {
    setSelectedKeys(selected ? new Set(t.rows.map((_, i) => t.getRowKey(i))) : new Set());
  }, [t]);

  /* ── Edits ── */
  const handleEditCommit = useCallback(
    async (rowIndex: number, colIndex: number, value: string | null) => {
      if (quickMode) {
        try {
          await t.updateCellNow(rowIndex, colIndex, value);
          toast("success", `Updated ${t.columnNames[colIndex]}`);
        } catch (err) {
          toast("error", String(err));
        }
      } else {
        t.stageEdit(rowIndex, colIndex, value);
      }
    },
    [quickMode, t, toast]
  );

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      await t.applyEdits();
      setPreviewSql(null);
      toast("success", "Changes applied");
    } catch (err) {
      toast("error", String(err));
    } finally {
      setApplying(false);
    }
  }, [t, toast]);

  const handleReview = useCallback(async () => {
    try {
      setPreviewSql(await t.previewEdits());
    } catch (err) {
      toast("error", String(err));
    }
  }, [t, toast]);

  // Ctrl+S applies staged edits
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && t.pendingCount > 0) {
        e.preventDefault();
        handleApply();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [t.pendingCount, handleApply]);

  /* ── Insert / delete ── */
  const handleInsert = useCallback(async () => {
    const columns: string[] = [];
    const values: (string | null)[] = [];
    for (const col of t.columnNames) {
      const raw = draftValues[col] ?? "";
      if (raw.trim() === "") continue;
      columns.push(col);
      values.push(parseEditValue(raw));
    }
    if (columns.length === 0) { setInsertError("Fill in at least one column"); return; }
    setInsertError(null);
    setInserting(true);
    try {
      await t.insertRow(columns, values);
      setShowAddRow(false);
      setDraftValues({});
      toast("success", "Row inserted");
    } catch (err) {
      setInsertError(String(err));
      toast("error", "Insert failed");
    } finally {
      setInserting(false);
    }
  }, [t, draftValues, toast]);

  const handleCopySelection = useCallback(() => {
    if (selectedKeys.size === 0) return;
    const sel = t.rows.filter((_, i) => selectedKeys.has(t.getRowKey(i)));
    navigator.clipboard.writeText(formatRows(t.gridColumns, sel, "tsv")).catch(() => {});
    toast("success", `Copied ${sel.length} row${sel.length > 1 ? "s" : ""}`);
  }, [selectedKeys, t, toast]);

  const handleDelete = useCallback(async () => {
    if (selectedKeys.size === 0) return;
    setDeleting(true);
    try {
      await t.deleteRowsByKeys([...selectedKeys]);
      setSelectedKeys(new Set());
      toast("success", `Deleted ${selectedKeys.size} row${selectedKeys.size > 1 ? "s" : ""}`);
    } catch {
      toast("error", "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [selectedKeys, t, toast]);

  /* ── FK follow ── */
  const handleFollowFk = useCallback(
    (colIndex: number, value: unknown) => {
      const fk = t.gridColumns[colIndex]?.fk;
      if (!fk) return;
      onOpenRelated(database, fk.ref_schema, fk.ref_table, {
        [fk.ref_column]: value === null || value === undefined ? "null" : String(value),
      });
    },
    [t.gridColumns, database, onOpenRelated]
  );

  /* ── Inspector ── */
  const handleFocusCell = useCallback((r: number, c: number) => {
    setFocusedCell({ r, c });
    setInspectorDraft(stringifyCell(t.rows[r]?.[c]) === "NULL" ? "" : stringifyCell(t.rows[r]?.[c]));
  }, [t.rows]);

  const focusedValue = focusedCell ? t.rows[focusedCell.r]?.[focusedCell.c] : undefined;
  const focusedColEditable = focusedCell ? t.gridColumns[focusedCell.c]?.editable : false;

  const prettyInspector = useMemo(() => {
    if (focusedValue === null || focusedValue === undefined) return "NULL";
    const s = String(focusedValue);
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  }, [focusedValue]);

  const saveInspector = useCallback(() => {
    if (!focusedCell) return;
    handleEditCommit(focusedCell.r, focusedCell.c, parseEditValue(inspectorDraft));
  }, [focusedCell, inspectorDraft, handleEditCommit]);

  /* ── Export ── */
  const handleExport = useCallback(async (format: "csv" | "json") => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const base = `${database}_${schema}_${table}_${date}`.replace(/[^\w.-]/g, "_");
      const path = await save({
        defaultPath: `${base}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      const contents = formatRows(t.gridColumns, t.rows, format);
      await invoke("save_text_file", { path, contents });
      toast("success", `Exported ${t.rows.length} rows`);
    } catch (err) {
      toast("error", String(err));
    }
  }, [database, schema, table, t.gridColumns, t.rows, toast]);

  // Toggle inspector with Ctrl+I
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "i") { e.preventDefault(); setShowInspector((v) => !v); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (t.loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading {database}.{schema}.{table}...
      </div>
    );
  }
  if (t.error && t.columnNames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 px-6 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" /> <span className="break-all">{t.error}</span>
      </div>
    );
  }

  const activeFilterCount = Object.values(t.columnFilters).filter((v) => v.trim()).length;
  const countLabel = t.totalCount === null ? "" : `${t.countIsEstimate ? "~" : ""}${t.totalCount}`;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Rows3 className="h-3 w-3" />
            {t.rows.length}{countLabel ? ` / ${countLabel}` : ""} rows
            {t.countIsEstimate && (
              <button onClick={t.loadExactCount} className="ml-1 text-primary hover:underline" title="Get exact count">
                (exact)
              </button>
            )}
          </span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{t.execTime}ms</span>
          <button onClick={t.refresh} className="flex items-center gap-1 rounded-md px-2 py-0.5 hover:text-foreground transition-colors" title="Refresh data">
            <RefreshCw className="h-3 w-3" />Refresh
          </button>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors ${
              showFilters || activeFilterCount > 0 ? "bg-primary/10 text-primary" : "hover:text-foreground"
            }`}
          >
            <Filter className="h-3 w-3" />Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={t.clearFilters} className="flex items-center gap-1 hover:text-foreground"><X className="h-3 w-3" />Clear</button>
          )}
          <button
            onClick={() => setShowInspector((v) => !v)}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${showInspector ? "bg-primary/10 text-primary" : "hover:text-foreground"}`}
            title="Cell inspector (Ctrl+I)"
          >
            <PanelBottom className="h-3 w-3" />Inspect
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => handleExport("csv")} className="flex items-center gap-1 rounded-md px-2 py-1 hover:text-foreground" title="Export loaded rows to CSV">
              <Download className="h-3 w-3" />CSV
            </button>
            <button onClick={() => handleExport("json")} className="rounded-md px-2 py-1 hover:text-foreground" title="Export loaded rows to JSON">JSON</button>
          </div>
          {editable && (
            <button
              onClick={() => setQuickMode((v) => !v)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${quickMode ? "bg-yellow-400/20 text-yellow-600 dark:text-yellow-400" : "hover:text-foreground"}`}
              title={quickMode ? "Quick mode: edits write immediately" : "Staged mode: edits batch into one transaction"}
            >
              <Zap className="h-3 w-3" />{quickMode ? "Quick" : "Staged"}
            </button>
          )}
          {editable && !showAddRow && (
            <button onClick={() => { setShowAddRow(true); setInsertError(null); }} className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 font-medium text-secondary-foreground hover:bg-accent">
              <Plus className="h-3 w-3" />Add row
            </button>
          )}
          {selectedKeys.size > 0 && (
            <button onClick={handleCopySelection} className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 font-medium text-secondary-foreground hover:bg-accent" title="Copy selected rows (TSV)">
              <Copy className="h-3 w-3" />Copy {selectedKeys.size}
            </button>
          )}
          {editable && selectedKeys.size > 0 && (
            <button onClick={handleDelete} disabled={deleting} className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50">
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Delete {selectedKeys.size}
            </button>
          )}
          {readOnly && <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Read-only</span>}
        </div>
      </div>

      {/* Staged edits bar */}
      {t.pendingCount > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-yellow-400/10 px-4 py-1.5 text-xs">
          <span className="font-medium text-yellow-700 dark:text-yellow-300">{t.pendingCount} pending change{t.pendingCount > 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <button onClick={handleReview} className="rounded-md px-2 py-1 text-muted-foreground hover:text-foreground">Review SQL</button>
            <button onClick={handleApply} disabled={applying} className="flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Apply (Ctrl+S)
            </button>
            <button onClick={t.discardEdits} className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:text-destructive">
              <Undo2 className="h-3 w-3" />Discard
            </button>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="border-b border-border bg-muted/20 px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {t.columnNames.map((col) => (
              <div key={col} className="flex items-center gap-1">
                <label className="whitespace-nowrap text-[10px] font-medium text-muted-foreground">{col}:</label>
                <input
                  type="text"
                  value={t.columnFilters[col] ?? ""}
                  onChange={(e) => t.setFilter(col, e.target.value)}
                  placeholder="filter..."
                  className="w-24 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground/60">Type to filter (ILIKE). Use &quot;null&quot; / &quot;not null&quot; for NULL checks.</p>
        </div>
      )}

      {t.error && (
        <div className="flex items-start justify-between gap-2 border-b border-border bg-destructive/10 px-4 py-1.5">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /><span className="break-all">{t.error}</span>
          </div>
          <button onClick={t.clearError} className="rounded p-0.5 text-destructive/70 hover:text-destructive"><X className="h-3 w-3" /></button>
        </div>
      )}

      {showAddRow && (
        <div className="border-b border-border bg-muted/30 px-4 py-2">
          {insertError && <div className="mb-2 text-xs text-destructive">{insertError}</div>}
          <div className="flex flex-wrap items-end gap-3">
            {t.columnNames.map((col) => (
              <div key={col} className="flex flex-col gap-0.5">
                <label className="text-[10px] font-medium text-muted-foreground">{col}</label>
                <input
                  type="text"
                  value={draftValues[col] ?? ""}
                  onChange={(e) => setDraftValues((prev) => ({ ...prev, [col]: e.target.value }))}
                  placeholder="NULL"
                  className="min-w-[100px] rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={handleInsert} disabled={inserting} className="flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {inserting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Insert
              </button>
              <button onClick={() => { setShowAddRow(false); setDraftValues({}); setInsertError(null); }} disabled={inserting} className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-50">Discard</button>
            </div>
          </div>
        </div>
      )}

      <DataGrid
        columns={t.gridColumns}
        rows={t.rows}
        className="flex-1"
        getRowKey={t.getRowKey}
        selectedKeys={selectedKeys}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        onSort={t.toggleSort}
        onEditCommit={editable ? handleEditCommit : undefined}
        pendingEdits={t.pendingEdits}
        onFocusCell={handleFocusCell}
        onFollowFk={handleFollowFk}
        onReachEnd={t.hasMore ? t.loadMore : undefined}
        readOnly={readOnly}
      />

      {t.loadingMore && (
        <div className="flex items-center justify-center gap-1.5 border-t border-border py-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading more…
        </div>
      )}

      {/* Cell inspector */}
      {showInspector && (
        <div className="flex h-48 shrink-0 flex-col border-t border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
            <span className="font-medium">
              {focusedCell ? `${t.columnNames[focusedCell.c]} (${t.gridColumns[focusedCell.c]?.type ?? "?"})` : "Cell inspector — click a cell"}
            </span>
            <div className="flex items-center gap-2">
              {focusedColEditable && !readOnly && (
                <>
                  <button onClick={() => focusedCell && handleEditCommit(focusedCell.r, focusedCell.c, null)} className="flex items-center gap-1 hover:text-destructive" title="Set NULL">
                    <Ban className="h-3 w-3" />NULL
                  </button>
                  <button onClick={saveInspector} className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-primary-foreground hover:bg-primary/90">
                    <Check className="h-3 w-3" />{quickMode ? "Save" : "Stage"}
                  </button>
                </>
              )}
              <button onClick={() => setShowInspector(false)} className="hover:text-foreground"><X className="h-3 w-3" /></button>
            </div>
          </div>
          {focusedColEditable && !readOnly ? (
            <textarea
              value={inspectorDraft}
              onChange={(e) => setInspectorDraft(e.target.value)}
              placeholder="NULL"
              className="flex-1 resize-none bg-transparent p-3 font-mono text-xs focus:outline-none"
              spellCheck={false}
            />
          ) : (
            <pre className="selectable flex-1 overflow-auto p-3 font-mono text-xs">{focusedCell ? prettyInspector : ""}</pre>
          )}
        </div>
      )}

      {/* SQL preview modal */}
      {previewSql !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay" onClick={() => setPreviewSql(null)}>
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Review {t.pendingCount} change{t.pendingCount > 1 ? "s" : ""}</h2>
              <button onClick={() => setPreviewSql(null)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <pre className="selectable flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">{previewSql}</pre>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button onClick={() => setPreviewSql(null)} className="rounded-md border border-border px-4 py-2 text-xs text-muted-foreground hover:bg-accent">Cancel</button>
              <button onClick={handleApply} disabled={applying} className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Apply in one transaction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
