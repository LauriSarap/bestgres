import { useEffect, useState, useMemo, useCallback, useRef, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, AlertCircle, Clock, Rows3, ChevronDown, Plus, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Filter, X } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/DataGrid";
import { EditableCell } from "@/components/EditableCell";
import { useToast } from "@/components/Toast";
import type { QueryResult, ColumnInfo } from "@/types";

const PAGE_SIZE = 100;

type SortDirection = "asc" | "desc" | null;
interface SortState {
  column: string;
  direction: SortDirection;
}

interface TableBrowserProps {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

export function TableBrowser({ connectionId, database, schema, table }: TableBrowserProps) {
  const { toast } = useToast();
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
  const [sort, setSort] = useState<SortState>({ column: "", direction: null });
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);

  const buildWhereClause = useCallback((): string => {
    const parts: string[] = [];
    for (const [col, val] of Object.entries(columnFilters)) {
      const trimmed = val.trim();
      if (!trimmed) continue;
      // Support: "NULL", "NOT NULL", or ILIKE pattern
      if (trimmed.toLowerCase() === "null") {
        parts.push(`"${col}" IS NULL`);
      } else if (trimmed.toLowerCase() === "not null") {
        parts.push(`"${col}" IS NOT NULL`);
      } else {
        // Use ILIKE for text search; cast to text for non-text columns
        parts.push(`"${col}"::text ILIKE '%${trimmed.replace(/'/g, "''")}%'`);
      }
    }
    return parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "";
  }, [columnFilters]);

  const buildOrderClause = useCallback((): string => {
    if (!sort.column || !sort.direction) return "";
    return ` ORDER BY "${sort.column}" ${sort.direction.toUpperCase()}`;
  }, [sort]);

  const buildSelectSql = useCallback(
    (limit: number, offset = 0): string => {
      return `SELECT * FROM "${schema}"."${table}"${buildWhereClause()}${buildOrderClause()} LIMIT ${limit} OFFSET ${offset}`;
    },
    [schema, table, buildWhereClause, buildOrderClause]
  );

  const buildCountSql = useCallback((): string => {
    return `SELECT COUNT(*) FROM "${schema}"."${table}"${buildWhereClause()}`;
  }, [schema, table, buildWhereClause]);

  // Load metadata (columns, PK) — only when the table changes
  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
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
      setSort({ column: "", direction: null });
      setColumnFilters({});

      try {
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

        const cnt = countRes.rows[0]?.[0];
        if (cnt !== null && cnt !== undefined) {
          setTotalCount(Number(cnt));
        }

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

    loadMeta();
    return () => { cancelled = true; };
  }, [connectionId, database, schema, table]);

  // Refetch data when sort/filter changes (not on initial load)
  const [dataGeneration, setDataGeneration] = useState(0);
  useEffect(() => {
    // Skip the first render — the metadata effect handles the initial load
    if (loading) return;
    let cancelled = false;

    async function refetchData() {
      setError(null);
      setRowSelection({});

      try {
        const [dataRes, countRes] = await Promise.all([
          invoke<QueryResult>("execute_query", {
            connectionId,
            database,
            sql: buildSelectSql(PAGE_SIZE),
          }),
          invoke<QueryResult>("execute_query", {
            connectionId,
            database,
            sql: buildCountSql(),
          }),
        ]);

        if (cancelled) return;

        setRows(dataRes.rows);
        setExecTime(dataRes.execution_time_ms);

        const cnt = countRes.rows[0]?.[0];
        if (cnt !== null && cnt !== undefined) {
          setTotalCount(Number(cnt));
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refetchData();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataGeneration]);

  // Load more pages
  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const offset = rows.length;
      const res = await invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        sql: buildSelectSql(PAGE_SIZE, offset),
      });
      setRows((prev) => [...prev, ...res.rows]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [connectionId, database, schema, table, rows.length, loadingMore, buildSelectSql]);

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
      // Refetch first page to include the new row
      const res = await invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        sql: buildSelectSql(PAGE_SIZE),
      });
      setRows(res.rows);
      toast("success", "Row inserted");
    } catch (err) {
      setInsertError(String(err));
      toast("error", "Insert failed");
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
    buildSelectSql,
    toast,
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
      toast("success", `Deleted ${selectedIds.length} row${selectedIds.length > 1 ? "s" : ""}`);
    } catch (err) {
      setError(String(err));
      toast("error", "Delete failed");
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
    toast,
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

  const handleRowSelectionChange = useCallback(
    (updater: SetStateAction<Record<string, boolean>>) => {
      setRowSelection((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        return next ?? {};
      });
    },
    []
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const handleCellSave = useCallback(
    async (
      rowIndex: number,
      columnName: string,
      newValue: string | number | boolean | null
    ) => {
      const rowArr = rowsRef.current[rowIndex];
      if (!rowArr) return;
      const pkValues = primaryKeyColumns.map((pk) => {
        const colIndex = columnNames.indexOf(pk);
        return colIndex >= 0 ? rowArr[colIndex] ?? null : null;
      });
      await invoke("update_cell", {
        connectionId,
        database,
        schema,
        table,
        column: columnName,
        primaryKeyColumns,
        primaryKeyValues: pkValues,
        newValue,
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
      toast("success", `Updated ${columnName}`);
    },
    [connectionId, database, schema, table, primaryKeyColumns, columnNames, toast]
  );

  const toggleSort = useCallback(
    (col: string) => {
      setSort((prev) => {
        if (prev.column !== col) return { column: col, direction: "asc" };
        if (prev.direction === "asc") return { column: col, direction: "desc" };
        return { column: "", direction: null };
      });
      setDataGeneration((g) => g + 1);
    },
    []
  );

  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFilterChange = useCallback(
    (col: string, value: string) => {
      setColumnFilters((prev) => ({ ...prev, [col]: value }));
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
      filterDebounceRef.current = setTimeout(() => {
        setDataGeneration((g) => g + 1);
      }, 400);
    },
    []
  );

  const clearFilters = useCallback(() => {
    setColumnFilters({});
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    setDataGeneration((g) => g + 1);
  }, []);

  const hasPk = primaryKeyColumns.length > 0;

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
    sort,
    toggleSort,
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
  const canDelete = hasPk && selectedCount > 0;
  const activeFilterCount = Object.values(columnFilters).filter((v) => v.trim()).length;

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
                  onChange={(e) => handleFilterChange(col, e.target.value)}
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
            Load more ({totalCount! - rows.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
