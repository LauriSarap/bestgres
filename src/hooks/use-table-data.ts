import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, ColumnInfo } from "@/types";

export const PAGE_SIZE = 100;

export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  column: string;
  direction: SortDirection;
}

/** Quote a SQL identifier, escaping embedded double quotes. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface TableDataArgs {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

interface WhereClause {
  clause: string;
  params: string[];
}

/**
 * Data layer for the table browser: fetching, pagination, sort/filter state,
 * and row mutations. Filter values are bound as query parameters, never
 * interpolated into SQL.
 */
export function useTableData({ connectionId, database, schema, table }: TableDataArgs) {
  const [rows, setRows] = useState<unknown[][]>([]);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<Map<string, string>>(new Map());
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [execTime, setExecTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ column: "", direction: null });
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [dataGeneration, setDataGeneration] = useState(0);

  const tableRef = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  const buildWhere = useCallback((): WhereClause => {
    const parts: string[] = [];
    const params: string[] = [];
    for (const [col, val] of Object.entries(columnFilters)) {
      const trimmed = val.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase() === "null") {
        parts.push(`${quoteIdent(col)} IS NULL`);
      } else if (trimmed.toLowerCase() === "not null") {
        parts.push(`${quoteIdent(col)} IS NOT NULL`);
      } else {
        params.push(`%${trimmed}%`);
        parts.push(`${quoteIdent(col)}::text ILIKE $${params.length}`);
      }
    }
    return {
      clause: parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "",
      params,
    };
  }, [columnFilters]);

  const buildOrderClause = useCallback((): string => {
    if (!sort.column || !sort.direction) return "";
    return ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction.toUpperCase()}`;
  }, [sort]);

  const fetchPage = useCallback(
    (limit: number, offset = 0): Promise<QueryResult> => {
      const where = buildWhere();
      return invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        sql: `SELECT * FROM ${tableRef}${where.clause}${buildOrderClause()} LIMIT ${limit} OFFSET ${offset}`,
        params: where.params.length > 0 ? where.params : undefined,
      });
    },
    [connectionId, database, tableRef, buildWhere, buildOrderClause]
  );

  const fetchCount = useCallback((): Promise<QueryResult> => {
    const where = buildWhere();
    return invoke<QueryResult>("execute_query", {
      connectionId,
      database,
      sql: `SELECT COUNT(*) FROM ${tableRef}${where.clause}`,
      params: where.params.length > 0 ? where.params : undefined,
    });
  }, [connectionId, database, tableRef, buildWhere]);

  // Load metadata (columns, PK) and the first page — only when the table changes
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
      setSort({ column: "", direction: null });
      setColumnFilters({});

      try {
        const [dataRes, colInfo, pkCols] = await Promise.all([
          invoke<QueryResult>("execute_query", {
            connectionId,
            database,
            sql: `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT ${PAGE_SIZE}`,
          }),
          invoke<ColumnInfo[]>("get_columns", { connectionId, database, schema, table }),
          invoke<string[]>("get_primary_key_columns", { connectionId, database, schema, table }),
        ]);

        if (cancelled) return;

        setColumnNames(dataRes.columns);
        setRows(dataRes.rows);
        setExecTime(dataRes.execution_time_ms);
        setColumnTypes(new Map(colInfo.map((c) => [c.name, c.data_type])));
        setPrimaryKeyColumns(pkCols);

        // COUNT(*) can be slow on big tables — fill it in without blocking first paint
        invoke<QueryResult>("execute_query", {
          connectionId,
          database,
          sql: `SELECT COUNT(*) FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
        })
          .then((countRes) => {
            if (cancelled) return;
            const cnt = countRes.rows[0]?.[0];
            if (cnt !== null && cnt !== undefined) setTotalCount(Number(cnt));
          })
          .catch(() => {});
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [connectionId, database, schema, table]);

  // Refetch first page + count when sort/filter changes (not on initial load)
  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    async function refetch() {
      setError(null);
      try {
        const [dataRes, countRes] = await Promise.all([fetchPage(PAGE_SIZE), fetchCount()]);
        if (cancelled) return;
        setRows(dataRes.rows);
        setExecTime(dataRes.execution_time_ms);
        const cnt = countRes.rows[0]?.[0];
        if (cnt !== null && cnt !== undefined) setTotalCount(Number(cnt));
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refetch();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataGeneration]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(PAGE_SIZE, rows.length);
      setRows((prev) => [...prev, ...res.rows]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, rows.length, fetchPage]);

  const toggleSort = useCallback((col: string) => {
    setSort((prev) => {
      if (prev.column !== col) return { column: col, direction: "asc" };
      if (prev.direction === "asc") return { column: col, direction: "desc" };
      return { column: "", direction: null };
    });
    setDataGeneration((g) => g + 1);
  }, []);

  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFilter = useCallback((col: string, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [col]: value }));
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      setDataGeneration((g) => g + 1);
    }, 400);
  }, []);

  const clearFilters = useCallback(() => {
    setColumnFilters({});
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    setDataGeneration((g) => g + 1);
  }, []);

  /* ── Row identity (for selection / deletes) ── */

  const getRowId = useCallback(
    (row: Record<string, unknown>) => {
      if (primaryKeyColumns.length === 0) return "";
      return primaryKeyColumns.map((pk) => JSON.stringify(row[pk] ?? null)).join("\x01");
    },
    [primaryKeyColumns]
  );

  /* ── Mutations ── */

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  /** Throws on failure so the caller (EditableCell) can show the error inline. */
  const updateCell = useCallback(
    async (rowIndex: number, columnName: string, newValue: string | null) => {
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
    },
    [connectionId, database, schema, table, primaryKeyColumns, columnNames]
  );

  /** Throws on failure. On success refetches the first page. */
  const insertRow = useCallback(
    async (columns: string[], values: (string | null)[]) => {
      await invoke("insert_row", { connectionId, database, schema, table, columns, values });
      setTotalCount((c) => (c !== null ? c + 1 : null));
      const res = await fetchPage(PAGE_SIZE);
      setRows(res.rows);
    },
    [connectionId, database, schema, table, fetchPage]
  );

  /** Delete rows by their getRowId ids. Throws on failure. */
  const deleteRowsByIds = useCallback(
    async (selectedIds: string[]) => {
      if (selectedIds.length === 0) return;
      const pkValuesList = selectedIds.map((id) =>
        id.split("\x01").map((p) => {
          try {
            return JSON.parse(p) as unknown;
          } catch {
            return p;
          }
        })
      );
      try {
        await invoke("delete_rows", {
          connectionId,
          database,
          schema,
          table,
          primaryKeyColumns,
          primaryKeyValuesList: pkValuesList,
        });
      } catch (err) {
        setError(String(err));
        throw err;
      }
      const ids = new Set(selectedIds);
      setRows((prev) =>
        prev.filter((row) => {
          const id = primaryKeyColumns
            .map((pk) => {
              const colIdx = columnNames.indexOf(pk);
              return JSON.stringify((colIdx >= 0 ? row[colIdx] : null) ?? null);
            })
            .join("\x01");
          return !ids.has(id);
        })
      );
      setTotalCount((c) => (c !== null ? Math.max(0, c - selectedIds.length) : null));
    },
    [connectionId, database, schema, table, primaryKeyColumns, columnNames]
  );

  /* ── Derived ── */

  const data: Record<string, unknown>[] = useMemo(
    () =>
      rows.map((row) => {
        const obj: Record<string, unknown> = {};
        columnNames.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      }),
    [rows, columnNames]
  );

  return {
    data,
    rowCount: rows.length,
    columnNames,
    columnTypes,
    primaryKeyColumns,
    totalCount,
    execTime,
    loading,
    loadingMore,
    error,
    clearError: useCallback(() => setError(null), []),
    sort,
    toggleSort,
    columnFilters,
    setFilter,
    clearFilters,
    hasMore: totalCount !== null && rows.length < totalCount,
    loadMore,
    getRowId,
    updateCell,
    insertRow,
    deleteRowsByIds,
  };
}
