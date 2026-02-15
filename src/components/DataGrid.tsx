import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Copy, ClipboardList } from "lucide-react";

interface CellContextMenu {
  x: number;
  y: number;
  cellValue: string;
  rowJson: string;
}

interface DataGridProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  className?: string;
  /** When set, enables row selection with checkboxes */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (
    updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)
  ) => void;
  /** Unique row id accessor for selection. Defaults to row index. */
  getRowId?: (row: TData, index: number) => string;
}

export const DataGrid = React.memo(function DataGrid<TData>({
  data,
  columns,
  className,
  rowSelection,
  onRowSelectionChange,
  getRowId = (_, i) => String(i),
}: DataGridProps<TData>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [cellMenu, setCellMenu] = useState<CellContextMenu | null>(null);
  const cellMenuRef = useRef<HTMLDivElement>(null);

  // Close cell context menu on click outside or Escape
  useEffect(() => {
    if (!cellMenu) return;
    function handleClick(e: MouseEvent) {
      if (cellMenuRef.current && !cellMenuRef.current.contains(e.target as Node)) {
        setCellMenu(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCellMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [cellMenu]);

  const handleCopyCell = useCallback(() => {
    if (!cellMenu) return;
    navigator.clipboard.writeText(cellMenu.cellValue).catch(() => {});
    setCellMenu(null);
  }, [cellMenu]);

  const handleCopyRow = useCallback(() => {
    if (!cellMenu) return;
    navigator.clipboard.writeText(cellMenu.rowJson).catch(() => {});
    setCellMenu(null);
  }, [cellMenu]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: rowSelection !== undefined ? { rowSelection } : {},
    onRowSelectionChange,
    getRowId,
    enableRowSelection: rowSelection !== undefined,
  });

  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom =
    totalHeight - (virtualItems[virtualItems.length - 1]?.end ?? 0);

  return (
    <div
      ref={parentRef}
      className={cn("selectable overflow-auto", className)}
    >
      <table className="w-max min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                No data
              </td>
            </tr>
          ) : (
            <>
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={columns.length} style={{ height: paddingTop, padding: 0, border: "none" }} />
                </tr>
              )}
              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border hover:bg-muted/50"
                    style={{ height: virtualRow.size }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const rawValue = cell.getValue();
                      return (
                        <td
                          key={cell.id}
                          className="border-r border-border px-3 py-1 text-xs font-mono whitespace-nowrap max-w-80 truncate"
                          onContextMenu={(e) => {
                            // Skip context menu for selection checkbox column
                            if (cell.column.id === "select") return;
                            e.preventDefault();
                            const cellStr =
                              rawValue === null || rawValue === undefined
                                ? "NULL"
                                : typeof rawValue === "object"
                                  ? JSON.stringify(rawValue)
                                  : String(rawValue);
                            const rowObj = row.original as Record<string, unknown>;
                            setCellMenu({
                              x: e.clientX,
                              y: e.clientY,
                              cellValue: cellStr,
                              rowJson: JSON.stringify(rowObj, null, 2),
                            });
                          }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={columns.length} style={{ height: paddingBottom, padding: 0, border: "none" }} />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>

      {/* Cell context menu */}
      {cellMenu && (
        <div
          ref={cellMenuRef}
          className="fixed z-50 min-w-44 rounded-md border border-border bg-popover py-1 shadow-lg"
          style={{ left: cellMenu.x, top: cellMenu.y }}
        >
          <button
            onClick={handleCopyCell}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
          >
            <Copy className="h-3 w-3" />
            Copy cell value
          </button>
          <button
            onClick={handleCopyRow}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
          >
            <ClipboardList className="h-3 w-3" />
            Copy row as JSON
          </button>
        </div>
      )}
    </div>
  );
}) as <TData>(props: DataGridProps<TData>) => React.ReactElement;
