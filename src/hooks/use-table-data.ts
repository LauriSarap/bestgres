import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, ColumnInfo, ForeignKeyInfo, CellEdit } from "@/types";
import type { GridColumn } from "@/components/DataGrid";
import { TruncatedValue } from "@/lib/truncated-value";

export const PAGE_SIZE = 200;

/**
 * Per-cell preview cap for the table browser. Columns of a type that can hold
 * arbitrarily large values are selected as `left(col::text, cap + 1)` so a
 * page of 200 rows stays small even when the table holds multi-megabyte JSON
 * blobs. A value that comes back longer than the cap is marked as a
 * TruncatedValue; the inspector fetches the full value by primary key.
 */
export const MAX_CELL_CHARS = 2048;

const WIDE_TYPES = new Set([
  "json",
  "jsonb",
  "text",
  "character varying",
  "bytea",
  "xml",
  "tsvector",
  "USER-DEFINED",
]);

/** Column names (in table order) whose values are fetched as capped previews. */
export function wideColumns(columns: Iterable<[name: string, dataType: string]>, pkCols: string[]): Set<string> {
  const wide = new Set<string>();
  for (const [name, type] of columns) {
    if (WIDE_TYPES.has(type) && !pkCols.includes(name)) wide.add(name);
  }
  return wide;
}

/**
 * SELECT list with wide columns capped server-side. Output aliases keep the
 * original names so ORDER BY and the result's column list are unchanged.
 * Falls back to `*` when column metadata is unavailable.
 */
export function buildSelectList(columns: Iterable<[name: string, dataType: string]>, pkCols: string[]): string {
  const cols = [...columns];
  if (cols.length === 0) return "*";
  const wide = wideColumns(cols, pkCols);
  return cols
    .map(([name]) =>
      wide.has(name)
        ? `left(${quoteIdent(name)}::text, ${MAX_CELL_CHARS + 1}) AS ${quoteIdent(name)}`
        : quoteIdent(name)
    )
    .join(", ");
}

/** Replace over-cap previews in wide columns with TruncatedValue markers. */
export function markTruncated(rows: unknown[][], columnNames: string[], wide: Set<string>): unknown[][] {
  const wideIdx = columnNames.flatMap((c, i) => (wide.has(c) ? [i] : []));
  if (wideIdx.length === 0) return rows;
  return rows.map((row) => {
    let out = row;
    for (const i of wideIdx) {
      const v = row[i];
      if (typeof v === "string" && v.length > MAX_CELL_CHARS) {
        if (out === row) out = [...row];
        out[i] = new TruncatedValue(v.slice(0, MAX_CELL_CHARS));
      }
    }
    return out;
  });
}

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
  readOnly: boolean;
  initialFilters?: Record<string, string>;
}

interface WhereClause {
  clause: string;
  params: string[];
}

export function useTableData({
  connectionId,
  database,
  schema,
  table,
  readOnly,
  initialFilters,
}: TableDataArgs) {
  const [rows, setRows] = useState<unknown[][]>([]);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<Map<string, string>>(new Map());
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [countIsEstimate, setCountIsEstimate] = useState(false);
  const [execTime, setExecTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ column: "", direction: null });
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(initialFilters ?? {});
  const [dataGeneration, setDataGeneration] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // True once a page returns fewer than PAGE_SIZE rows — the authoritative
  // end-of-data signal (the row count may be an estimate and can't be trusted).
  const [reachedEnd, setReachedEnd] = useState(false);
  // Staged edits keyed `${rowIndex}:${colIndex}` → new value
  const [pendingEdits, setPendingEdits] = useState<Map<string, string | null>>(new Map());

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
    return { clause: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", params };
  }, [columnFilters]);

  // Keyset pagination is used only in the common, correct-by-construction case:
  // single scalar-typed PK, no user sort. Otherwise fall back to OFFSET.
  // The PK param is bound as text, so it must be cast back to the column type
  // (e.g. `$1::uuid`) — enum/domain/array PKs aren't safely castable, so skip them.
  const pkType = primaryKeyColumns.length === 1 ? columnTypes.get(primaryKeyColumns[0]) : undefined;
  const canKeyset =
    primaryKeyColumns.length === 1 &&
    !sort.column &&
    !!pkType &&
    pkType !== "USER-DEFINED" &&
    pkType !== "ARRAY";

  // A STABLE order is required for correct pagination. Order by the sort column
  // (tie-broken by PK), else by the full PK. Without a PK there's no stable order,
  // so pagination may repeat rows — acceptable for keyless tables/views.
  const orderClause = useCallback((): string => {
    const pkOrder = primaryKeyColumns.map((c) => `${quoteIdent(c)} ASC`);
    if (sort.column && sort.direction) {
      const tieBreak = pkOrder.filter((_, i) => primaryKeyColumns[i] !== sort.column);
      return ` ORDER BY ${[`${quoteIdent(sort.column)} ${sort.direction.toUpperCase()}`, ...tieBreak].join(", ")}`;
    }
    if (pkOrder.length > 0) return ` ORDER BY ${pkOrder.join(", ")}`;
    return "";
  }, [sort, primaryKeyColumns]);

  const runQuery = useCallback(
    (sql: string, params: string[]): Promise<QueryResult> =>
      invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        sql,
        params: params.length ? params : undefined,
      }),
    [connectionId, database]
  );

  const selectList = useMemo(
    () => buildSelectList(columnTypes, primaryKeyColumns),
    [columnTypes, primaryKeyColumns]
  );
  const wideCols = useMemo(
    () => wideColumns(columnTypes, primaryKeyColumns),
    [columnTypes, primaryKeyColumns]
  );

  const fetchFirstPage = useCallback(async (): Promise<QueryResult> => {
    const where = buildWhere();
    const res = await runQuery(
      `SELECT ${selectList} FROM ${tableRef}${where.clause}${orderClause()} LIMIT ${PAGE_SIZE}`,
      where.params
    );
    return { ...res, rows: markTruncated(res.rows, res.columns, wideCols) as QueryResult["rows"] };
  }, [tableRef, selectList, wideCols, buildWhere, orderClause, runQuery]);

  const fetchExactCount = useCallback((): Promise<QueryResult> => {
    const where = buildWhere();
    return runQuery(`SELECT COUNT(*) FROM ${tableRef}${where.clause}`, where.params);
  }, [tableRef, buildWhere, runQuery]);

  // Initial load: metadata + first page + count estimate
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setRows([]);
      setColumnNames([]);
      setColumnTypes(new Map());
      setPrimaryKeyColumns([]);
      setForeignKeys([]);
      setTotalCount(null);
      setReachedEnd(false);
      setPendingEdits(new Map());
      setSort({ column: "", direction: null });
      setColumnFilters(initialFilters ?? {});

      try {
        // Metadata first so the first page can be ordered by the real PK —
        // pagination needs the same stable ORDER BY as loadMore (else duplicates).
        const [colInfo, pkCols, fks] = await Promise.all([
          invoke<ColumnInfo[]>("get_columns", { connectionId, database, schema, table }),
          invoke<string[]>("get_primary_key_columns", { connectionId, database, schema, table }),
          invoke<ForeignKeyInfo[]>("get_foreign_keys", { connectionId, database, schema, table }),
        ]);
        if (cancelled) return;
        setColumnTypes(new Map(colInfo.map((c) => [c.name, c.data_type])));
        setPrimaryKeyColumns(pkCols);
        setForeignKeys(fks);

        const order = pkCols.length > 0
          ? ` ORDER BY ${pkCols.map((c) => `${quoteIdent(c)} ASC`).join(", ")}`
          : "";
        const colEntries: [string, string][] = colInfo.map((c) => [c.name, c.data_type]);
        const dataRes = await invoke<QueryResult>("execute_query", {
          connectionId,
          database,
          sql: `SELECT ${buildSelectList(colEntries, pkCols)} FROM ${tableRef}${order} LIMIT ${PAGE_SIZE}`,
        });
        if (cancelled) return;
        setColumnNames(dataRes.columns);
        setRows(markTruncated(dataRes.rows, dataRes.columns, wideColumns(colEntries, pkCols)));
        setReachedEnd(dataRes.rows.length < PAGE_SIZE);
        setExecTime(dataRes.execution_time_ms);

        // Fast estimate first; exact count is opt-in (click) to avoid slow COUNT(*)
        invoke<number>("get_row_estimate", { connectionId, database, schema, table })
          .then((est) => {
            if (cancelled) return;
            if (est >= 0) {
              setTotalCount(est);
              setCountIsEstimate(true);
            } else {
              // never analyzed — fall back to exact
              fetchExactCount().then((r) => {
                if (cancelled) return;
                const c = r.rows[0]?.[0];
                if (c != null) { setTotalCount(Number(c)); setCountIsEstimate(false); }
              }).catch(() => {});
            }
          })
          .catch(() => {});
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [connectionId, database, schema, table, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // Refetch on sort/filter change (exact count, since filters invalidate estimate)
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    async function refetch() {
      setError(null);
      setPendingEdits(new Map());
      try {
        const dataRes = await fetchFirstPage();
        if (cancelled) return;
        setRows(dataRes.rows);
        setReachedEnd(dataRes.rows.length < PAGE_SIZE);
        setExecTime(dataRes.execution_time_ms);
        const hasFilters = Object.values(columnFilters).some((v) => v.trim());
        if (hasFilters || sort.column) {
          const countRes = await fetchExactCount();
          if (cancelled) return;
          const c = countRes.rows[0]?.[0];
          if (c != null) { setTotalCount(Number(c)); setCountIsEstimate(false); }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }
    refetch();
    return () => { cancelled = true; };
  }, [dataGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (loadingMore || reachedEnd) return;
    setLoadingMore(true);
    try {
      const where = buildWhere();
      let res: QueryResult;
      if (canKeyset && rows.length > 0) {
        // Keyset: WHERE pk > last seen pk — no OFFSET re-scan.
        // Cast the placeholder to the PK type since params bind as text
        // (e.g. uuid > $1::uuid, not uuid > text).
        const pkCol = primaryKeyColumns[0];
        const pkIdx = columnNames.indexOf(pkCol);
        const lastPk = rows[rows.length - 1][pkIdx];
        const ksParams = [...where.params, String(lastPk)];
        const cmp = `${quoteIdent(pkCol)} > $${ksParams.length}::${pkType}`;
        const ksClause = where.clause ? `${where.clause} AND ${cmp}` : ` WHERE ${cmp}`;
        res = await runQuery(`SELECT ${selectList} FROM ${tableRef}${ksClause}${orderClause()} LIMIT ${PAGE_SIZE}`, ksParams);
      } else {
        res = await runQuery(
          `SELECT ${selectList} FROM ${tableRef}${where.clause}${orderClause()} LIMIT ${PAGE_SIZE} OFFSET ${rows.length}`,
          where.params
        );
      }
      if (res.rows.length < PAGE_SIZE) setReachedEnd(true);
      const nextRows = markTruncated(res.rows, res.columns, wideCols);
      setRows((prev) => [...prev, ...nextRows]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, reachedEnd, buildWhere, canKeyset, pkType, rows, primaryKeyColumns, columnNames, tableRef, selectList, wideCols, orderClause, runQuery]);

  const loadExactCount = useCallback(async () => {
    try {
      const r = await fetchExactCount();
      const c = r.rows[0]?.[0];
      if (c != null) { setTotalCount(Number(c)); setCountIsEstimate(false); }
    } catch (err) {
      setError(String(err));
    }
  }, [fetchExactCount]);

  const toggleSort = useCallback((col: string) => {
    setSort((prev) => {
      if (prev.column !== col) return { column: col, direction: "asc" };
      if (prev.direction === "asc") return { column: col, direction: "desc" };
      return { column: "", direction: null };
    });
    setDataGeneration((g) => g + 1);
  }, []);

  const filterDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setFilter = useCallback((col: string, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [col]: value }));
    if (filterDebounce.current) clearTimeout(filterDebounce.current);
    filterDebounce.current = setTimeout(() => setDataGeneration((g) => g + 1), 400);
  }, []);

  const clearFilters = useCallback(() => {
    setColumnFilters({});
    if (filterDebounce.current) clearTimeout(filterDebounce.current);
    setDataGeneration((g) => g + 1);
  }, []);

  /* ── Row identity for selection / edits ── */
  const getRowKey = useCallback(
    (rowIndex: number) => {
      if (primaryKeyColumns.length === 0) return String(rowIndex);
      const row = rows[rowIndex];
      return primaryKeyColumns
        .map((pk) => JSON.stringify(row[columnNames.indexOf(pk)] ?? null))
        .join("\x01");
    },
    [primaryKeyColumns, rows, columnNames]
  );

  const pkValuesForRow = useCallback(
    (rowIndex: number) =>
      primaryKeyColumns.map((pk) => {
        const i = columnNames.indexOf(pk);
        return i >= 0 ? rows[rowIndex][i] ?? null : null;
      }),
    [primaryKeyColumns, columnNames, rows]
  );

  /** Fetch the untruncated value of one cell by primary key. */
  const fetchFullCell = useCallback(
    async (rowIndex: number, colIndex: number): Promise<unknown> => {
      if (primaryKeyColumns.length === 0) {
        throw new Error("Table has no primary key; the full value cannot be fetched");
      }
      const params: string[] = [];
      const pkValues = pkValuesForRow(rowIndex);
      const conds = primaryKeyColumns.map((pk, i) => {
        const v = pkValues[i];
        params.push(typeof v === "object" ? JSON.stringify(v) : String(v));
        const type = columnTypes.get(pk);
        // Params bind as text; cast back to the column type so the PK index is
        // usable. Enum/array PKs aren't safely castable, so compare as text.
        return type && type !== "USER-DEFINED" && type !== "ARRAY"
          ? `${quoteIdent(pk)} = $${params.length}::${type}`
          : `${quoteIdent(pk)}::text = $${params.length}`;
      });
      const res = await runQuery(
        `SELECT ${quoteIdent(columnNames[colIndex])} FROM ${tableRef} WHERE ${conds.join(" AND ")} LIMIT 1`,
        params
      );
      if (res.rows.length === 0) throw new Error("Row no longer exists");
      return res.rows[0][0];
    },
    [primaryKeyColumns, pkValuesForRow, columnTypes, columnNames, tableRef, runQuery]
  );

  /* ── Staged edits ── */
  const stageEdit = useCallback((rowIndex: number, colIndex: number, value: string | null) => {
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(`${rowIndex}:${colIndex}`, value);
      return next;
    });
  }, []);

  const discardEdits = useCallback(() => setPendingEdits(new Map()), []);

  const buildEdits = useCallback((): CellEdit[] => {
    const edits: CellEdit[] = [];
    for (const [key, value] of pendingEdits) {
      const [r, c] = key.split(":").map(Number);
      edits.push({
        column: columnNames[c],
        primary_key_columns: primaryKeyColumns,
        primary_key_values: pkValuesForRow(r),
        new_value: value,
      });
    }
    return edits;
  }, [pendingEdits, columnNames, primaryKeyColumns, pkValuesForRow]);

  const previewEdits = useCallback(
    () => invoke<string>("preview_cell_edits", { connectionId, database, schema, table, edits: buildEdits() }),
    [connectionId, database, schema, table, buildEdits]
  );

  const applyEdits = useCallback(async () => {
    await invoke("apply_cell_edits", { connectionId, database, schema, table, edits: buildEdits() });
    // Merge staged values into local rows, then clear
    setRows((prev) => {
      const next = prev.map((r) => [...r]);
      for (const [key, value] of pendingEdits) {
        const [r, c] = key.split(":").map(Number);
        if (next[r]) next[r][c] = value;
      }
      return next;
    });
    setPendingEdits(new Map());
  }, [connectionId, database, schema, table, buildEdits, pendingEdits]);

  /* ── Immediate (quick-mode) single-cell write ── */
  const updateCellNow = useCallback(
    async (rowIndex: number, colIndex: number, value: string | null) => {
      await invoke("update_cell", {
        connectionId,
        database,
        schema,
        table,
        column: columnNames[colIndex],
        primaryKeyColumns,
        primaryKeyValues: pkValuesForRow(rowIndex),
        newValue: value,
      });
      setRows((prev) => {
        const next = prev.map((r) => [...r]);
        if (next[rowIndex]) next[rowIndex][colIndex] = value;
        return next;
      });
    },
    [connectionId, database, schema, table, columnNames, primaryKeyColumns, pkValuesForRow]
  );

  const insertRow = useCallback(
    async (columns: string[], values: (string | null)[]) => {
      await invoke("insert_row", { connectionId, database, schema, table, columns, values });
      setTotalCount((c) => (c !== null ? c + 1 : null));
      const res = await fetchFirstPage();
      setRows(res.rows);
    },
    [connectionId, database, schema, table, fetchFirstPage]
  );

  const deleteRowsByKeys = useCallback(
    async (selectedKeys: string[]) => {
      if (selectedKeys.length === 0) return;
      const keySet = new Set(selectedKeys);
      const pkValuesList: unknown[][] = [];
      rows.forEach((_, i) => {
        if (keySet.has(getRowKey(i))) pkValuesList.push(pkValuesForRow(i));
      });
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
      setRows((prev) => prev.filter((_, i) => !keySet.has(getRowKey(i))));
      setTotalCount((c) => (c !== null ? Math.max(0, c - pkValuesList.length) : null));
    },
    [connectionId, database, schema, table, primaryKeyColumns, rows, getRowKey, pkValuesForRow]
  );

  /* ── Grid columns ── */
  const fkByColumn = useMemo(() => {
    const m = new Map<string, ForeignKeyInfo>();
    for (const fk of foreignKeys) m.set(fk.column_name, fk);
    return m;
  }, [foreignKeys]);

  const canEdit = !readOnly && primaryKeyColumns.length > 0;

  const gridColumns: GridColumn[] = useMemo(
    () =>
      columnNames.map((name) => {
        const isPk = primaryKeyColumns.includes(name);
        const fk = fkByColumn.get(name);
        return {
          name,
          type: columnTypes.get(name),
          isPrimaryKey: isPk,
          editable: canEdit && !isPk,
          sortDirection: sort.column === name ? sort.direction : null,
          fk: fk ? { ref_schema: fk.ref_schema, ref_table: fk.ref_table, ref_column: fk.ref_column } : undefined,
        };
      }),
    [columnNames, columnTypes, primaryKeyColumns, fkByColumn, canEdit, sort]
  );

  return {
    rows,
    gridColumns,
    columnNames,
    columnTypes,
    primaryKeyColumns,
    totalCount,
    countIsEstimate,
    loadExactCount,
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
    hasMore: !reachedEnd,
    loadMore,
    refresh,
    getRowKey,
    canEdit,
    fetchFullCell,
    // staged edits
    pendingEdits,
    pendingCount: pendingEdits.size,
    stageEdit,
    discardEdits,
    previewEdits,
    applyEdits,
    // immediate
    updateCellNow,
    insertRow,
    deleteRowsByKeys,
  };
}
