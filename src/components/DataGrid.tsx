import React, { useRef, useState, useEffect, useCallback, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { parseEditValue } from "@/components/EditableCell";
import { Copy, ClipboardList, Ban, ExternalLink } from "lucide-react";

export interface GridColumn {
  name: string;
  /** Data type shown beneath the header name */
  type?: string;
  sortDirection?: "asc" | "desc" | null;
  editable?: boolean;
  isPrimaryKey?: boolean;
  /** Foreign-key target, enabling "Follow" on this column's cells */
  fk?: { ref_schema: string; ref_table: string; ref_column: string };
}

interface DataGridProps {
  columns: GridColumn[];
  /** Raw, column-aligned rows */
  rows: unknown[][];
  className?: string;
  /** Stable key per row (enables selection); required for checkboxes */
  getRowKey?: (rowIndex: number) => string;
  selectedKeys?: Set<string>;
  onToggleRow?: (key: string, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
  onSort?: (columnName: string) => void;
  /** Commit an inline edit (rowIndex, colIndex in data-column space) */
  onEditCommit?: (rowIndex: number, colIndex: number, value: string | null) => void | Promise<void>;
  /** Dirty cells keyed `${rowIndex}:${colIndex}` → staged value */
  pendingEdits?: Map<string, string | null>;
  /** Called when the focused cell changes (for the inspector panel) */
  onFocusCell?: (rowIndex: number, colIndex: number) => void;
  onFollowFk?: (colIndex: number, value: unknown) => void;
  /** Called when scrolled near the end (infinite scroll) */
  onReachEnd?: () => void;
  readOnly?: boolean;
}

interface CellMenu {
  x: number;
  y: number;
  rowIndex: number;
  colIndex: number;
}

const CHECKBOX_W = 40;
const DEFAULT_COL_W = 200;
const MIN_COL_W = 60;
const ROW_H = 28;

export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatInspectorValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value !== "string") return String(value);

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function rowToObject(columns: GridColumn[], row: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  columns.forEach((c, i) => (obj[c.name] = row[i]));
  return obj;
}

/** Build delimited / structured text for copy + export of a set of rows. */
export function formatRows(
  columns: GridColumn[],
  rows: unknown[][],
  format: "csv" | "tsv" | "json" | "markdown"
): string {
  const names = columns.map((c) => c.name);
  if (format === "json") {
    return JSON.stringify(rows.map((r) => rowToObject(columns, r)), null, 2);
  }
  if (format === "markdown") {
    const header = `| ${names.join(" | ")} |`;
    const sep = `| ${names.map(() => "---").join(" | ")} |`;
    const body = rows.map((r) => `| ${r.map((v) => stringifyCell(v).replace(/\|/g, "\\|")).join(" | ")} |`);
    return [header, sep, ...body].join("\n");
  }
  const delim = format === "csv" ? "," : "\t";
  const esc = (v: unknown) => {
    const s = stringifyCell(v);
    if (format === "csv" && /[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [names.join(delim), ...rows.map((r) => r.map(esc).join(delim))].join("\n");
}

export const DataGrid = React.memo(function DataGrid({
  columns,
  rows,
  className,
  getRowKey,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  onSort,
  onEditCommit,
  pendingEdits,
  onFocusCell,
  onFollowFk,
  onReachEnd,
  readOnly,
}: DataGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selectable = !!getRowKey && !!selectedKeys;

  // Column widths (data columns only, by data index)
  const [widths, setWidths] = useState<number[]>([]);
  useEffect(() => {
    setWidths((prev) =>
      columns.map((_, i) => prev[i] ?? DEFAULT_COL_W)
    );
  }, [columns]);

  const colOffset = selectable ? CHECKBOX_W : 0;
  const totalWidth = colOffset + widths.reduce((a, b) => a + b, 0);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // Infinite scroll: fire when last virtual row nears the end
  const virtualRows = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    if (!onReachEnd) return;
    const last = virtualRows[virtualRows.length - 1];
    if (last && last.index >= rows.length - 10) onReachEnd();
  }, [virtualRows, rows.length, onReachEnd]);

  // Focused / editing cell (colIndex in data space)
  const [focused, setFocused] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<CellMenu | null>(null);

  useLayoutEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

  const focusCell = useCallback(
    (r: number, c: number) => {
      setFocused({ r, c });
      onFocusCell?.(r, c);
      rowVirtualizer.scrollToIndex(r, { align: "auto" });
    },
    [onFocusCell, rowVirtualizer]
  );

  const startEdit = useCallback(
    (r: number, c: number) => {
      if (readOnly || !onEditCommit || !columns[c]?.editable) return;
      setEditValue(stringifyCell(rows[r]?.[c]) === "NULL" ? "" : stringifyCell(rows[r]?.[c]));
      setEditing({ r, c });
    },
    [readOnly, onEditCommit, columns, rows]
  );

  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const { r, c } = editing;
    setEditing(null);
    await onEditCommit?.(r, c, parseEditValue(editValue));
  }, [editing, editValue, onEditCommit]);

  // Keyboard navigation over the grid
  const copySelection = useCallback(
    (format: "csv" | "tsv" | "json" | "markdown" = "tsv") => {
      if (!selectable || selectedKeys!.size === 0) return false;
      const sel = rows.filter((_, i) => selectedKeys!.has(getRowKey!(i)));
      navigator.clipboard.writeText(formatRows(columns, sel, format)).catch(() => {});
      return true;
    },
    [selectable, selectedKeys, rows, getRowKey, columns]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return; // input handles its own keys
      const ctrl = e.ctrlKey || e.metaKey;

      // Select-all / copy-selection work whenever the grid is focused
      if (ctrl && (e.key === "a" || e.key === "A")) {
        if (selectable) { e.preventDefault(); onToggleAll?.(true); }
        return;
      }
      if (ctrl && (e.key === "c" || e.key === "C")) {
        // Copy the whole selection (TSV, spreadsheet-friendly); fall back to focused cell
        e.preventDefault();
        if (!copySelection("tsv") && focused) {
          navigator.clipboard.writeText(stringifyCell(rows[focused.r]?.[focused.c])).catch(() => {});
        }
        return;
      }
      if (e.key === "Escape") {
        // Clear selection first, then cell focus
        if (selectable && selectedKeys!.size > 0) { e.preventDefault(); onToggleAll?.(false); return; }
        if (focused) { e.preventDefault(); setFocused(null); }
        return;
      }

      if (!focused) return;
      const { r, c } = focused;
      const maxR = rows.length - 1;
      const maxC = columns.length - 1;
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); focusCell(Math.min(r + 1, maxR), c); break;
        case "ArrowUp": e.preventDefault(); focusCell(Math.max(r - 1, 0), c); break;
        case "ArrowLeft": e.preventDefault(); focusCell(r, Math.max(c - 1, 0)); break;
        case "ArrowRight":
        case "Tab": e.preventDefault(); focusCell(r, Math.min(c + 1, maxC)); break;
        case "Enter": e.preventDefault(); startEdit(r, c); break;
      }
    },
    [editing, focused, rows, columns, focusCell, startEdit, selectable, selectedKeys, onToggleAll, copySelection]
  );

  // Close context menu on outside click / Escape
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Column resize via header handle drag
  const resizeRef = useRef<{ idx: number; startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const next = Math.max(MIN_COL_W, r.startW + (e.clientX - r.startX));
      setWidths((prev) => {
        const w = [...prev];
        w[r.idx] = next;
        return w;
      });
    };
    const onUp = () => (resizeRef.current = null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const allSelected =
    selectable && rows.length > 0 && rows.every((_, i) => selectedKeys!.has(getRowKey!(i)));
  const someSelected =
    selectable && !allSelected && rows.some((_, i) => selectedKeys!.has(getRowKey!(i)));

  const menuRow = menu ? rows[menu.rowIndex] : null;

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn("selectable relative overflow-auto outline-none", className)}
    >
      <div style={{ width: totalWidth, height: rowVirtualizer.getTotalSize() + ROW_H, position: "relative" }}>
        {/* Header */}
        <div
          className="sticky top-0 z-20 flex bg-muted"
          style={{ height: ROW_H, width: totalWidth }}
        >
          {selectable && (
            <div
              className="flex shrink-0 items-center justify-center border-b border-r border-border"
              style={{ width: CHECKBOX_W }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={(e) => onToggleAll?.(e.target.checked)}
                className="cursor-pointer"
              />
            </div>
          )}
          {columns.map((col, ci) => (
            <div
              key={col.name}
              className="group relative flex shrink-0 flex-col justify-center border-b border-r border-border px-3 text-xs font-medium text-muted-foreground"
              style={{ width: widths[ci] ?? DEFAULT_COL_W }}
            >
              <div
                className="flex cursor-pointer select-none items-center gap-1 truncate"
                onClick={() => onSort?.(col.name)}
                title={col.name}
              >
                <span className="truncate">{col.name}</span>
                {col.isPrimaryKey && <span className="text-[9px] text-primary">PK</span>}
                {col.sortDirection === "asc" ? "▲" : col.sortDirection === "desc" ? "▼" : ""}
              </div>
              {col.type && (
                <span className="truncate text-[10px] font-normal text-muted-foreground/60">
                  {col.type}
                </span>
              )}
              {/* resize handle */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  resizeRef.current = { idx: ci, startX: e.clientX, startW: widths[ci] ?? DEFAULT_COL_W };
                }}
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40"
              />
            </div>
          ))}
        </div>

        {/* Body */}
        {rows.length === 0 ? (
          <div className="absolute left-0 flex w-full justify-center py-8 text-sm text-muted-foreground" style={{ top: ROW_H }}>
            No data
          </div>
        ) : (
          virtualRows.map((vr) => {
            const ri = vr.index;
            const row = rows[ri];
            const key = selectable ? getRowKey!(ri) : String(ri);
            const isSelected = selectable && selectedKeys!.has(key);
            return (
              <div
                key={key}
                className={cn("absolute left-0 flex", isSelected && "bg-primary/5")}
                style={{ top: vr.start + ROW_H, height: ROW_H, width: totalWidth }}
              >
                {selectable && (
                  <div
                    className="flex shrink-0 items-center justify-center border-b border-r border-border"
                    style={{ width: CHECKBOX_W }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => onToggleRow?.(key, e.target.checked)}
                      className="cursor-pointer"
                    />
                  </div>
                )}
                {columns.map((col, ci) => {
                  const raw = row[ci];
                  const editKey = `${ri}:${ci}`;
                  const pending = pendingEdits?.has(editKey);
                  const displayVal = pending ? pendingEdits!.get(editKey) : raw;
                  const isFocused = focused?.r === ri && focused?.c === ci;
                  const isEditing = editing?.r === ri && editing?.c === ci;
                  const isNull = displayVal === null || displayVal === undefined;
                  return (
                    <div
                      key={col.name}
                      className={cn(
                        "shrink-0 truncate border-b border-r border-border px-3 text-xs font-mono leading-[27px]",
                        col.editable && !readOnly ? "cursor-text" : "cursor-default",
                        isFocused && "ring-1 ring-inset ring-primary",
                        pending && "bg-yellow-400/20"
                      )}
                      style={{ width: widths[ci] ?? DEFAULT_COL_W, height: ROW_H }}
                      title={isNull ? undefined : stringifyCell(displayVal)}
                      onMouseDown={() => focusCell(ri, ci)}
                      onDoubleClick={() => startEdit(ri, ci)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        focusCell(ri, ci);
                        setMenu({ x: e.clientX, y: e.clientY, rowIndex: ri, colIndex: ci });
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                            else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                          }}
                          placeholder="NULL"
                          className="h-[22px] w-full rounded border border-primary bg-background px-1 text-xs font-mono focus:outline-none"
                        />
                      ) : isNull ? (
                        <span className="italic text-muted-foreground/50">NULL</span>
                      ) : (
                        stringifyCell(displayVal)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Context menu */}
      {menu && menuRow && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-48 rounded-md border border-border bg-popover py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem icon={<Copy className="h-3 w-3" />} label="Copy cell" onClick={() => {
            navigator.clipboard.writeText(stringifyCell(menuRow[menu.colIndex])).catch(() => {});
            setMenu(null);
          }} />
          <MenuItem icon={<ClipboardList className="h-3 w-3" />} label="Copy row as JSON" onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(rowToObject(columns, menuRow), null, 2)).catch(() => {});
            setMenu(null);
          }} />
          {selectable && (selectedKeys!.size > 0) && (
            <>
              <div className="my-1 border-t border-border" />
              {(["csv", "tsv", "json", "markdown"] as const).map((fmt) => (
                <MenuItem
                  key={fmt}
                  label={`Copy selection as ${fmt.toUpperCase()}`}
                  onClick={() => {
                    const sel = rows.filter((_, i) => selectedKeys!.has(getRowKey!(i)));
                    navigator.clipboard.writeText(formatRows(columns, sel, fmt)).catch(() => {});
                    setMenu(null);
                  }}
                />
              ))}
            </>
          )}
          {columns[menu.colIndex]?.fk && onFollowFk && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem icon={<ExternalLink className="h-3 w-3" />} label={`Follow → ${columns[menu.colIndex].fk!.ref_table}`} onClick={() => {
                onFollowFk(menu.colIndex, menuRow[menu.colIndex]);
                setMenu(null);
              }} />
            </>
          )}
          {columns[menu.colIndex]?.editable && !readOnly && onEditCommit && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem icon={<Ban className="h-3 w-3" />} label="Set NULL" onClick={() => {
                onEditCommit(menu.rowIndex, menu.colIndex, null);
                setMenu(null);
              }} />
            </>
          )}
        </div>
      )}
    </div>
  );
});

function MenuItem({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
    >
      {icon ?? <span className="w-3" />}
      {label}
    </button>
  );
}
