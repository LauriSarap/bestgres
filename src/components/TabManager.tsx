import { useState, useEffect, useCallback, useRef } from "react";
import { X, Table, TerminalSquare, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableBrowser } from "@/components/TableBrowser";
import { QueryEditor } from "@/components/QueryEditor";
import { TableStructureView } from "@/components/TableStructureView";
import type { Tab, ConnectionEntry } from "@/types";

interface ContextMenu {
  x: number;
  y: number;
  tabId: string;
}

interface TabManagerProps {
  tabs: Tab[];
  activeTabId: string | null;
  dirtyTabs: Set<string>;
  getConnection: (id: string) => ConnectionEntry | undefined;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  onReorder: (tabs: Tab[]) => void;
  onRenameTab: (id: string, title: string) => void;
  onTabDirtyChange: (id: string, dirty: boolean) => void;
  onOpenRelated: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    filters: Record<string, string>
  ) => void;
}

export function TabManager({
  tabs,
  activeTabId,
  dirtyTabs,
  getConnection,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onReorder,
  onRenameTab,
  onTabDirtyChange,
  onOpenRelated,
}: TabManagerProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  const runAction = useCallback((action: () => void) => {
    action();
    setContextMenu(null);
  }, []);

  const handleDrop = useCallback(
    (targetId: string) => {
      const from = dragId.current;
      dragId.current = null;
      if (!from || from === targetId) return;
      const fromIdx = tabs.findIndex((t) => t.id === from);
      const toIdx = tabs.findIndex((t) => t.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...tabs];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      onReorder(next);
    },
    [tabs, onReorder]
  );

  const startRename = useCallback((tab: Tab) => {
    setRenamingId(tab.id);
    setRenameValue(tab.customTitle ?? tab.title);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId) onRenameTab(renamingId, renameValue.trim());
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameTab]);

  const tabIdx = contextMenu ? tabs.findIndex((t) => t.id === contextMenu.tabId) : -1;
  const hasTabsToRight = tabIdx >= 0 && tabIdx < tabs.length - 1;

  return (
    <div className="flex h-full flex-col">
      {tabs.length > 0 && (
        <div className="flex h-9 items-center overflow-x-auto border-b border-border bg-muted/50">
          {tabs.map((tab) => {
            const conn = getConnection(tab.connectionId);
            const isDirty = dirtyTabs.has(tab.id);
            const title = tab.customTitle ?? tab.title;
            return (
              <button
                key={tab.id}
                draggable={renamingId !== tab.id}
                onDragStart={() => (dragId.current = tab.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(tab.id)}
                onClick={() => onSelectTab(tab.id)}
                onDoubleClick={() => tab.type === "query-editor" && startRename(tab)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                className={cn(
                  "group flex h-full shrink-0 items-center gap-2 border-r border-border px-3 text-xs transition-colors",
                  tab.id === activeTabId
                    ? "border-b-2 border-b-primary bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background/50"
                )}
              >
                {conn?.color && (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: conn.color }} title={conn.name} />
                )}
                {tab.type === "table-browser" ? (
                  <Table className="h-3 w-3 shrink-0" />
                ) : tab.type === "table-structure" ? (
                  <FileCode className="h-3 w-3 shrink-0" />
                ) : (
                  <TerminalSquare className="h-3 w-3 shrink-0" />
                )}
                {renamingId === tab.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="w-28 rounded border border-primary bg-background px-1 py-0.5 text-xs focus:outline-none"
                  />
                ) : (
                  <span className="max-w-40 truncate">{title}</span>
                )}
                {isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes" />}
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Open a table or start a new query
          </div>
        )}
        {tabs.map((tab) => {
          const conn = getConnection(tab.connectionId);
          const readOnly = !!conn?.read_only;
          return (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility: tab.id === activeTabId ? "visible" : "hidden",
                zIndex: tab.id === activeTabId ? 1 : 0,
              }}
            >
              {tab.type === "table-browser" && tab.schema && tab.table ? (
                <TableBrowser
                  connectionId={tab.connectionId}
                  database={tab.database}
                  schema={tab.schema}
                  table={tab.table}
                  readOnly={readOnly}
                  initialFilters={tab.initialFilters}
                  onOpenRelated={(db, schema, table, filters) =>
                    onOpenRelated(tab.connectionId, db, schema, table, filters)
                  }
                />
              ) : tab.type === "table-structure" && tab.schema && tab.table ? (
                <TableStructureView
                  connectionId={tab.connectionId}
                  database={tab.database}
                  schema={tab.schema}
                  table={tab.table}
                />
              ) : tab.type === "query-editor" ? (
                <QueryEditor
                  tabId={tab.id}
                  connectionId={tab.connectionId}
                  database={tab.database}
                  onDirtyChange={(dirty) => onTabDirtyChange(tab.id, dirty)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {tabs.find((t) => t.id === contextMenu.tabId)?.type === "query-editor" && (
            <>
              <CtxItem label="Rename" onClick={() => runAction(() => {
                const tab = tabs.find((t) => t.id === contextMenu.tabId);
                if (tab) startRename(tab);
              })} />
              <div className="my-1 border-t border-border" />
            </>
          )}
          <CtxItem label="Close" onClick={() => runAction(() => onCloseTab(contextMenu.tabId))} />
          <CtxItem label="Close Others" disabled={tabs.length <= 1} onClick={() => runAction(() => onCloseOtherTabs(contextMenu.tabId))} />
          <CtxItem label="Close to the Right" disabled={!hasTabsToRight} onClick={() => runAction(() => onCloseTabsToRight(contextMenu.tabId))} />
          <div className="my-1 border-t border-border" />
          <CtxItem label="Close All" onClick={() => runAction(() => onCloseAllTabs())} />
        </div>
      )}
    </div>
  );
}

function CtxItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={cn(
        "flex w-full px-3 py-1.5 text-left text-xs transition-colors",
        disabled ? "cursor-default text-muted-foreground/40" : "text-popover-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}
