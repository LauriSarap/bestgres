import { useEffect, useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, AlertCircle, Clock, Rows3, ChevronDown, Plus, Trash2 } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/DataGrid";
import { EditableCell } from "@/components/EditableCell";
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
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [execTime, setExecTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [showAddRow, setShowAddRow] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [inserting, setInserting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);

  // Initial load: count + first page + column info
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setLoading(true);
      setError(null);
      setRows([]);
      setColumnNames([]);
      setColumnTypes(new Map());
      setPrimaryKeyColumns([]);
      setTotalCount(null);
      setShowAddRow(false);
      setRowSelection({});
      setInsertError(null);

      try {
        // Fire all four queries in parallel
        const [dataRes, countRes, colInfo, pkCols] = await Promise.all([
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
          invoke<string[]>("get_primary_key_columns", {
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
        setPrimaryKeyColumns(pkCols);
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

  const parseCellValue = useCallback((raw: string): string | number | boolean | null => {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === "null" || trimmed === "") return null;
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
    const num = Number(trimmed);
    if (!Number.isNaN(num) && trimmed !== "") return num;
    return trimmed;
  }, []);

  const handleInsert = useCallback(async () => {
    const columns: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    const types: string[] = [];
    for (const col of columnNames) {
      const raw = (draftValues[col] ?? "").trim();
      if (raw === "") continue;
      const parsed = parseCellValue(raw);
      columns.push(col);
      values.push(parsed);
      types.push(columnTypes.get(col) ?? "text");
    }
    if (columns.length === 0) {
      setInsertError("Fill in at least one column");
      return;
    }
    setInsertError(null);
    setInserting(true);
    try {
      await invoke("insert_row", {
        connectionId,
        database,
        schema,
        table,
        columns,
        values,
        columnTypes: types,
      });
      setShowAddRow(false);
      setDraftValues({});
      setInsertError(null);
      setTotalCount((c) => (c !== null ? c + 1 : null));
      // Refetch first page to include the new row (order may vary)
      const res = await invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        sql: `SELECT * FROM "${schema}"."${table}" LIMIT ${PAGE_SIZE}`,
      });
      setRows(res.rows);
    } catch (err) {
      setInsertError(String(err));
    } finally {
      setInserting(false);
    }
  }, [
    connectionId,
    database,
    schema,
    table,
    columnNames,
    columnTypes,
    draftValues,
    parseCellValue,
  ]);

  const handleDelete = useCallback(async () => {
    const selectedIds = Object.entries(rowSelection)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (selectedIds.length === 0) return;
    const pkValuesList = selectedIds.map((id) => {
      const parts = id.split("\x01");
      return parts.map((p) => {
        try {
          return JSON.parse(p) as unknown;
        } catch {
          return p;
        }
      });
    });
    setDeleting(true);
    setError(null);
    try {
      await invoke("delete_rows", {
        connectionId,
        database,
        schema,
        table,
        primaryKeyColumns,
        primaryKeyValuesList: pkValuesList,
      });
      setRowSelection({});
      const indicesToRemove = new Set(
        selectedIds.map((id) =>
          rows.findIndex((row) => {
            const pkVals = primaryKeyColumns.map((pk) => {
              const colIdx = columnNames.indexOf(pk);
              return colIdx >= 0 ? row[colIdx] : undefined;
            });
            return pkVals.map((v) => JSON.stringify(v ?? null)).join("\x01") === id;
          })
        )
      );
      setRows((prev) => prev.filter((_, i) => !indicesToRemove.has(i)));
      setTotalCount((c) => (c !== null ? Math.max(0, c - selectedIds.length) : null));
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleting(false);
    }
  }, [
    connectionId,
    database,
    schema,
    table,
    rowSelection,
    primaryKeyColumns,
    columnNames,
    rows,
  ]);

  const getRowId = useCallback(
    (row: Record<string, unknown>) => {
      if (primaryKeyColumns.length === 0) return "";
      return primaryKeyColumns
        .map((pk) => JSON.stringify(row[pk] ?? null))
        .join("\x01");
    },
    [primaryKeyColumns]
  );

  const handleCellSave = useCallback(
    async (
      rowIndex: number,
      columnName: string,
      newValue: string | number | boolean | null
    ) => {
      const rowArr = rows[rowIndex];
      if (!rowArr) return;
      const pkValues = primaryKeyColumns.map((pk) => {
        const colIndex = columnNames.indexOf(pk);
        return colIndex >= 0 ? rowArr[colIndex] ?? null : null;
      });
      const jsonValue =
        newValue === null
          ? null
          : typeof newValue === "boolean"
            ? newValue
            : typeof newValue === "number"
              ? newValue
              : newValue;
      await invoke("update_cell", {
        connectionId,
        database,
        schema,
        table,
        column: columnName,
        primaryKeyColumns,
        primaryKeyValues: pkValues,
        newValue: jsonValue,
      });
      const colIndex = columnNames.indexOf(columnName);
      if (colIndex === -1) return;
      setRows((prev) => {
        const next = [...prev];
        const rowCopy = [...next[rowIndex]];
        rowCopy[colIndex] = newValue;
        next[rowIndex] = rowCopy;
        return next;
      });
    },
    [
      connectionId,
      database,
      schema,
      table,
      primaryKeyColumns,
      columnNames,
      rows,
    ]
  );

  const selectionColumn: ColumnDef<Record<string, unknown>, unknown> | null =
    primaryKeyColumns.length > 0
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
      : null;

  const columns: ColumnDef<Record<string, unknown>, unknown>[] = useMemo(() => {
    if (columnNames.length === 0) return [];
    const canEdit = primaryKeyColumns.length > 0;
    const dataCols = columnNames.map((col) => {
      const isPk = primaryKeyColumns.includes(col);
      const editable = canEdit && !isPk;
      return {
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
                onSave={(newVal) =>
                  handleCellSave(rowIndex, col, newVal)
                }
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
  }, [
    columnNames,
    columnTypes,
    primaryKeyColumns,
    handleCellSave,
    selectionColumn,
  ]);

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

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const canAddRow = primaryKeyColumns.length > 0;
  const canDelete = primaryKeyColumns.length > 0 && selectedCount > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Rows3 className="h-3 w-3" />
            {rows.length}{totalCount !== null ? ` / ${totalCount}` : ""} rows
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {execTime}ms
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canAddRow && !showAddRow && (
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
        rowSelection={canAddRow ? rowSelection : undefined}
        onRowSelectionChange={
          canAddRow
            ? (updater) =>
                setRowSelection((prev) => {
                  const next =
                    typeof updater === "function" ? updater(prev) : updater;
                  return next ?? {};
                })
            : undefined
        }
        getRowId={(row) => getRowId(row)}
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
            Load more ({totalCount! - rows.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
