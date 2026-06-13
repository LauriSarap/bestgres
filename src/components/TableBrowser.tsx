import { useState, useEffect, useMemo, useCallback, type SetStateAction } from "react";
import { Loader2, AlertCircle, Clock, Rows3, ChevronDown, Plus, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Filter, X } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/DataGrid";
import { EditableCell, parseEditValue } from "@/components/EditableCell";
import { useToast } from "@/components/Toast";
import { useTableData } from "@/hooks/use-table-data";

interface TableBrowserProps {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

export function TableBrowser({ connectionId, database, schema, table }: TableBrowserProps) {
  const { toast } = useToast();
  const {
    data,
    rowCount,
    columnNames,
    columnTypes,
    primaryKeyColumns,
    totalCount,
    execTime,
    loading,
    loadingMore,
    error,
    clearError,
    sort,
    toggleSort,
    columnFilters,
    setFilter,
    clearFilters,
    hasMore,
    loadMore,
    getRowId,
    updateCell,
    insertRow,
    deleteRowsByIds,
  } = useTableData({ connectionId, database, schema, table });

  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [showAddRow, setShowAddRow] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [inserting, setInserting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const hasPk = primaryKeyColumns.length > 0;

  // Sort/filter changes refetch the page — drop any selection so rows that
  // fall out of view can't be deleted invisibly
  useEffect(() => {
    setRowSelection({});
  }, [sort, columnFilters]);

  const handleInsert = useCallback(async () => {
    const columns: string[] = [];
    const values: (string | null)[] = [];
    for (const col of columnNames) {
      const raw = draftValues[col] ?? "";
      // Blank fields are omitted entirely so column defaults apply
      if (raw.trim() === "") continue;
      columns.push(col);
      values.push(parseEditValue(raw));
    }
    if (columns.length === 0) {
      setInsertError("Fill in at least one column");
      return;
    }
    setInsertError(null);
    setInserting(true);
    try {
      await insertRow(columns, values);
      setShowAddRow(false);
      setDraftValues({});
      toast("success", "Row inserted");
    } catch (err) {
      setInsertError(String(err));
      toast("error", "Insert failed");
    } finally {
      setInserting(false);
    }
  }, [columnNames, draftValues, insertRow, toast]);

  const handleDelete = useCallback(async () => {
    const selectedIds = Object.entries(rowSelection)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (selectedIds.length === 0) return;
    setDeleting(true);
    try {
      await deleteRowsByIds(selectedIds);
      setRowSelection({});
      toast("success", `Deleted ${selectedIds.length} row${selectedIds.length > 1 ? "s" : ""}`);
    } catch {
      toast("error", "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [rowSelection, deleteRowsByIds, toast]);

  const handleCellSave = useCallback(
    async (rowIndex: number, columnName: string, newValue: string | null) => {
      await updateCell(rowIndex, columnName, newValue);
      toast("success", `Updated ${columnName}`);
    },
    [updateCell, toast]
  );

  const handleRowSelectionChange = useCallback(
    (updater: SetStateAction<Record<string, boolean>>) => {
      setRowSelection((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        return next ?? {};
      });
    },
    []
  );

  const selectionColumn: ColumnDef<Record<string, unknown>, unknown> | null = useMemo(
    () =>
      hasPk
        ? {
            id: "select",
            size: 32,
            header: ({ table }) => (
              <input
                type="checkbox"
                checked={table.getIsAllRowsSelected()}
                ref={(el) => {
                  if (el) el.indeterminate = table.getIsSomeRowsSelected();
                }}
                onChange={table.getToggleAllRowsSelectedHandler()}
                className="cursor-pointer"
              />
            ),
            cell: ({ row }) => (
              <input
                type="checkbox"
                checked={row.getIsSelected()}
                onChange={row.getToggleSelectedHandler()}
                className="cursor-pointer"
              />
            ),
          }
        : null,
    [hasPk]
  );

  const columns: ColumnDef<Record<string, unknown>, unknown>[] = useMemo(() => {
    if (columnNames.length === 0) return [];
    const canEdit = primaryKeyColumns.length > 0;
    const dataCols = columnNames.map((col) => {
      const isPk = primaryKeyColumns.includes(col);
      const editable = canEdit && !isPk;
      const colSort = sort.column === col ? sort.direction : null;
      return {
        accessorKey: col,
        header: () => (
          <div
            className="flex flex-col gap-0.5 cursor-pointer select-none group"
            onClick={() => toggleSort(col)}
          >
            <div className="flex items-center gap-1">
              <span>{col}</span>
              {colSort === "asc" ? (
                <ArrowUp className="h-3 w-3 text-primary" />
              ) : colSort === "desc" ? (
                <ArrowDown className="h-3 w-3 text-primary" />
              ) : (
                <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity" />
              )}
            </div>
            {columnTypes.has(col) && (
              <span className="font-normal text-[10px] text-muted-foreground/70">
                {columnTypes.get(col)}
              </span>
            )}
          </div>
        ),
        cell: ({
          getValue,
          row,
        }: {
          getValue: () => unknown;
          row: { index: number };
        }) => {
          const v = getValue();
          const rowIndex = row.index;
          if (editable) {
            return (
              <EditableCell
                value={v}
                onSave={(newVal) => handleCellSave(rowIndex, col, newVal)}
                disabled={false}
              />
            );
          }
          if (v === null || v === undefined) {
            return <span className="text-muted-foreground/50 italic">NULL</span>;
          }
          if (typeof v === "object") {
            return JSON.stringify(v);
          }
          return String(v);
        },
      };
    });
    return selectionColumn ? [selectionColumn, ...dataCols] : dataCols;
  }, [columnNames, columnTypes, primaryKeyColumns, handleCellSave, selectionColumn, sort, toggleSort]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {database}.{schema}.{table}...
      </div>
    );
  }

  // Full-screen error only when we never got the table loaded;
  // later errors (bad filter, lost connection) show as a banner instead
  if (error && columnNames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 px-6 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="break-all">{error}</span>
      </div>
    );
  }

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const canDelete = hasPk && selectedCount > 0;
  const activeFilterCount = Object.values(columnFilters).filter((v) => v.trim()).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Rows3 className="h-3 w-3" />
            {rowCount}{totalCount !== null ? ` / ${totalCount}` : ""} rows
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {execTime}ms
          </span>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              showFilters || activeFilterCount > 0
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Filter className="h-3 w-3" />
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasPk && !showAddRow && (
            <button
              onClick={() => {
                setShowAddRow(true);
                setInsertError(null);
              }}
              className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add row
            </button>
          )}
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Delete {selectedCount} {selectedCount === 1 ? "row" : "rows"}
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="border-b border-border bg-muted/20 px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {columnNames.map((col) => (
              <div key={col} className="flex items-center gap-1">
                <label className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                  {col}:
                </label>
                <input
                  type="text"
                  value={columnFilters[col] ?? ""}
                  onChange={(e) => setFilter(col, e.target.value)}
                  placeholder="filter..."
                  className="w-24 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground/60">
            Type to filter (ILIKE). Use &quot;null&quot; or &quot;not null&quot; for NULL checks.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start justify-between gap-2 border-b border-border bg-destructive/10 px-4 py-1.5">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
          <button
            onClick={clearError}
            className="rounded p-0.5 text-destructive/70 hover:text-destructive transition-colors"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {showAddRow && (
        <div className="border-b border-border bg-muted/30 px-4 py-2">
          {insertError && (
            <div className="mb-2 text-xs text-destructive">{insertError}</div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            {columnNames.map((col) => (
              <div key={col} className="flex flex-col gap-0.5">
                <label className="text-[10px] font-medium text-muted-foreground">
                  {col}
                </label>
                <input
                  type="text"
                  value={draftValues[col] ?? ""}
                  onChange={(e) =>
                    setDraftValues((prev) => ({ ...prev, [col]: e.target.value }))
                  }
                  placeholder="NULL"
                  className="min-w-[100px] rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                onClick={handleInsert}
                disabled={inserting}
                className="flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {inserting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Insert
              </button>
              <button
                onClick={() => {
                  setShowAddRow(false);
                  setDraftValues({});
                  setInsertError(null);
                }}
                disabled={inserting}
                className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <DataGrid
        data={data}
        columns={columns}
        className="flex-1"
        rowSelection={hasPk ? rowSelection : undefined}
        onRowSelectionChange={hasPk ? handleRowSelectionChange : undefined}
        getRowId={hasPk ? getRowId : undefined}
      />
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
            Load more ({totalCount! - rowCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
