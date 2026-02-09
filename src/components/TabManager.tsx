import { useState, useEffect, useCallback, useRef } from "react";
import { X, Table, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableBrowser } from "@/components/TableBrowser";
import { QueryEditor } from "@/components/QueryEditor";
import type { Tab } from "@/types";

interface ContextMenu {
  x: number;
  y: number;
  tabId: string;
}

interface TabManagerProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
}

export function TabManager({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onCloseOtherTabs,
  onCloseTabsToRight,
}: TabManagerProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, tabId });
    },
    []
  );

  const runAction = useCallback(
    (action: () => void) => {
      action();
      setContextMenu(null);
    },
    []
  );

  const tabIdx = contextMenu
    ? tabs.findIndex((t) => t.id === contextMenu.tabId)
    : -1;
  const hasTabsToRight = tabIdx >= 0 && tabIdx < tabs.length - 1;

  return (
    <div className="flex h-full flex-col">
      {tabs.length > 0 && (
        <div className="flex h-9 items-center border-b border-border bg-muted/50 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              className={cn(
                "group flex h-full shrink-0 items-center gap-2 border-r border-border px-3 text-xs transition-colors",
                tab.id === activeTabId
                  ? "bg-background text-foreground border-b-2 border-b-primary"
                  : "text-muted-foreground hover:bg-background/50"
              )}
            >
              {tab.type === "table-browser" ? (
                <Table className="h-3 w-3 shrink-0" />
              ) : (
                <TerminalSquare className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate max-w-40">{tab.title}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {!activeTab ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Open a table or start a new query
          </div>
        ) : activeTab.type === "table-browser" && activeTab.schema && activeTab.table ? (
          <TableBrowser
            key={activeTab.id}
            connectionId={activeTab.connectionId}
            database={activeTab.database}
            schema={activeTab.schema}
            table={activeTab.table}
          />
        ) : activeTab.type === "query-editor" ? (
          <QueryEditor
            key={activeTab.id}
            connectionId={activeTab.connectionId}
            database={activeTab.database}
          />
        ) : null}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <CtxItem
            label="Close"
            onClick={() => runAction(() => onCloseTab(contextMenu.tabId))}
          />
          <CtxItem
            label="Close Others"
            disabled={tabs.length <= 1}
            onClick={() => runAction(() => onCloseOtherTabs(contextMenu.tabId))}
          />
          <CtxItem
            label="Close to the Right"
            disabled={!hasTabsToRight}
            onClick={() => runAction(() => onCloseTabsToRight(contextMenu.tabId))}
          />
          <div className="my-1 border-t border-border" />
          <CtxItem
            label="Close All"
            onClick={() => runAction(() => onCloseAllTabs())}
          />
        </div>
      )}
    </div>
  );
}

function CtxItem({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={cn(
        "flex w-full px-3 py-1.5 text-left text-xs transition-colors",
        disabled
          ? "text-muted-foreground/40 cursor-default"
          : "text-popover-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}
