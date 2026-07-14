import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "@/components/Sidebar";
import { TabManager } from "@/components/TabManager";
import {
  ConnectionDialog,
  type ConnectionFormData,
} from "@/components/ConnectionDialog";
import { ToastProvider, useToast } from "@/components/Toast";
import { SettingsDialog } from "@/components/SettingsDialog";
import { useTheme } from "@/hooks/use-theme";
import type { Tab, ConnectionEntry } from "@/types";

function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionEntry | null>(null);
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const restoredRef = useRef(false);

  const getConnection = useCallback(
    (id: string) => connections.find((c) => c.id === id),
    [connections]
  );

  /* ── Load config connections on mount, then restore saved tabs ── */

  useEffect(() => {
    async function loadFromConfig() {
      try {
        const loaded = await invoke<ConnectionEntry[]>("load_config_connections");
        if (loaded.length > 0) {
          setConnections(loaded);
          setActiveConnectionId(loaded[0].id);
        }
        // Restore tabs whose connection still exists (ids are stable across launches)
        if (!restoredRef.current) {
          restoredRef.current = true;
          try {
            const savedTabs: Tab[] = JSON.parse(localStorage.getItem("bestgres:tabs") ?? "[]");
            const validIds = new Set(loaded.map((c) => c.id));
            const restored = savedTabs.filter((t) => validIds.has(t.connectionId));
            if (restored.length > 0) {
              setTabs(restored);
              const savedActive = localStorage.getItem("bestgres:activeTab");
              setActiveTabId(
                savedActive && restored.some((t) => t.id === savedActive)
                  ? savedActive
                  : restored[0].id
              );
            }
          } catch {
            // ignore malformed saved state
          }
        }
      } catch {
        // Config dir may not exist or have no files — that's fine
      }
    }
    loadFromConfig();
  }, []);

  /* ── Quiet update check on startup ── */

  useEffect(() => {
    let cancelled = false;
    import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((update) => {
        if (!cancelled && update) {
          toast("info", `Update ${update.version} available — open Settings to install`);
        }
      })
      .catch(() => {
        // No update endpoint reachable (e.g. dev, draft release) — ignore
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  /* ── Persist tabs + active tab for session restore ── */

  useEffect(() => {
    if (!restoredRef.current) return;
    localStorage.setItem("bestgres:tabs", JSON.stringify(tabs));
    if (activeTabId) localStorage.setItem("bestgres:activeTab", activeTabId);
    else localStorage.removeItem("bestgres:activeTab");
  }, [tabs, activeTabId]);

  /* ── Tab reorder / rename / dirty tracking ── */

  const handleReorderTabs = useCallback((next: Tab[]) => setTabs(next), []);

  const handleRenameTab = useCallback((id: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, customTitle: title || undefined } : t))
    );
  }, []);

  const handleTabDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyTabs((prev) => {
      if (prev.has(id) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /* ── Tab management ── */

  const openTab = useCallback((tab: Tab) => {
    setTabs((prev) => {
      // Deduplicate table-browser and table-structure tabs
      if (tab.type === "table-browser" || tab.type === "table-structure") {
        const existing = prev.find(
          (t) =>
            t.type === tab.type &&
            t.connectionId === tab.connectionId &&
            t.database === tab.database &&
            t.schema === tab.schema &&
            t.table === tab.table
        );
        if (existing) {
          setActiveTabId(existing.id);
          return prev;
        }
      }
      setActiveTabId(tab.id);
      return [...prev, tab];
    });
  }, []);

  const handleSelectTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((currentActive) => {
        if (currentActive !== id) return currentActive;
        if (next.length === 0) return null;
        const newIdx = Math.min(idx, next.length - 1);
        return next[newIdx].id;
      });
      return next;
    });
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const handleCloseOtherTabs = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveTabId(id);
  }, []);

  const handleCloseTabsToRight = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      return prev.slice(0, idx + 1);
    });
  }, []);

  /* ── Connection management ── */

  const handleAddConnection = useCallback(async (data: ConnectionFormData) => {
    const id = crypto.randomUUID();
    const entry: ConnectionEntry = {
      id,
      name: data.name,
      host: data.host,
      port: data.port,
      user: data.user,
      database: data.database,
      ssl: data.sslMode !== "disable",
      ssl_mode: data.sslMode,
      ssl_root_cert: data.sslRootCert || null,
      color: data.color,
      read_only: data.readOnly,
    };
    await invoke("add_connection", { config: entry, password: data.password });
    setConnections((prev) => [...prev, entry]);
    setActiveConnectionId(id);
    toast("success", `Connected to ${data.name}`);
  }, [toast]);

  const handleEditConnection = useCallback(async (data: ConnectionFormData) => {
    if (!editingConnection) return;
    const id = editingConnection.id;
    const entry: ConnectionEntry = {
      id,
      name: data.name,
      host: data.host,
      port: data.port,
      user: data.user,
      database: data.database,
      ssl: data.sslMode !== "disable",
      ssl_mode: data.sslMode,
      ssl_root_cert: data.sslRootCert || null,
      color: data.color,
      read_only: data.readOnly,
    };
    await invoke("update_connection", { config: entry, password: data.password });
    setConnections((prev) => prev.map((c) => (c.id === id ? entry : c)));
    toast("success", `Updated ${data.name}`);
  }, [editingConnection, toast]);

  const handleSelectConnection = useCallback((id: string) => {
    setActiveConnectionId(id);
  }, []);

  /* ── Dialog open/close helpers ── */

  const openAddDialog = useCallback(() => {
    setEditingConnection(null);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((conn: ConnectionEntry) => {
    setEditingConnection(conn);
    setDialogOpen(true);
  }, []);

  const handleDeleteConnection = useCallback(
    async (conn: ConnectionEntry) => {
      if (!window.confirm(`Delete connection "${conn.name}"? This will close any open tabs for this connection.`)) {
        return;
      }
      try {
        await invoke("remove_connection", { connectionId: conn.id });
        const nextConnections = connections.filter((c) => c.id !== conn.id);
        const nextTabs = tabs.filter((t) => t.connectionId !== conn.id);
        setConnections(nextConnections);
        setTabs(nextTabs);
        const activeTabWasRemoved = tabs.some((t) => t.id === activeTabId && t.connectionId === conn.id);
        if (activeTabWasRemoved) {
          setActiveTabId(nextTabs.length > 0 ? nextTabs[0].id : null);
        }
        if (activeConnectionId === conn.id) {
          setActiveConnectionId(nextConnections[0]?.id ?? null);
        }
        toast("success", `Deleted ${conn.name}`);
      } catch (err) {
        toast("error", String(err));
      }
    },
    [activeConnectionId, activeTabId, connections, tabs, toast]
  );

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingConnection(null);
  }, []);

  /* ── Sidebar actions ── */

  const handleOpenTable = useCallback(
    (connectionId: string, database: string, schema: string, table: string) => {
      openTab({
        id: crypto.randomUUID(),
        title: table,
        type: "table-browser",
        connectionId,
        database,
        schema,
        table,
      });
    },
    [openTab]
  );

  const handleOpenStructure = useCallback(
    (connectionId: string, database: string, schema: string, table: string) => {
      openTab({
        id: crypto.randomUUID(),
        title: `${table} (structure)`,
        type: "table-structure",
        connectionId,
        database,
        schema,
        table,
      });
    },
    [openTab]
  );

  const handleOpenQuery = useCallback(
    (connectionId: string, database: string) => {
      const conn = connections.find((c) => c.id === connectionId);
      openTab({
        id: crypto.randomUUID(),
        title: `Query — ${conn?.name ?? "untitled"} / ${database}`,
        type: "query-editor",
        connectionId,
        database,
      });
    },
    [connections, openTab]
  );

  // FK navigation: open the referenced table pre-filtered. Always a fresh tab
  // (bypasses dedup) so the filter context isn't lost.
  const handleOpenRelated = useCallback(
    (
      connectionId: string,
      database: string,
      schema: string,
      table: string,
      filters: Record<string, string>
    ) => {
      const id = crypto.randomUUID();
      const newTab: Tab = {
        id,
        title: table,
        type: "table-browser",
        connectionId,
        database,
        schema,
        table,
        initialFilters: filters,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(id);
    },
    []
  );

  /* ── Keyboard shortcuts ── */

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const activeConnectionIdRef = useRef(activeConnectionId);
  activeConnectionIdRef.current = activeConnectionId;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+T — new query tab
      if (ctrl && e.key === "t") {
        e.preventDefault();
        const connId = activeConnectionIdRef.current;
        if (!connId) return;
        const conn = connectionsRef.current.find((c) => c.id === connId);
        if (!conn) return;
        // Find a database for this connection: use the active tab's database, or the connection's default
        const currentTab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        const db = (currentTab?.connectionId === connId ? currentTab?.database : null) ?? conn.database;
        openTab({
          id: crypto.randomUUID(),
          title: `Query — ${conn.name} / ${db}`,
          type: "query-editor",
          connectionId: connId,
          database: db,
        });
        return;
      }

      // Ctrl+W — close active tab
      if (ctrl && e.key === "w") {
        e.preventDefault();
        const id = activeTabIdRef.current;
        if (id) handleCloseTab(id);
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — switch tabs
      if (ctrl && e.key === "Tab") {
        e.preventDefault();
        const currentTabs = tabsRef.current;
        const currentId = activeTabIdRef.current;
        if (currentTabs.length <= 1) return;
        const idx = currentTabs.findIndex((t) => t.id === currentId);
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = idx <= 0 ? currentTabs.length - 1 : idx - 1;
        } else {
          nextIdx = idx >= currentTabs.length - 1 ? 0 : idx + 1;
        }
        setActiveTabId(currentTabs[nextIdx].id);
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openTab, handleCloseTab]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelectConnection={handleSelectConnection}
        onAddConnection={openAddDialog}
        onEditConnection={openEditDialog}
        onDeleteConnection={handleDeleteConnection}
        onOpenTable={handleOpenTable}
        onOpenStructure={handleOpenStructure}
        onOpenQuery={handleOpenQuery}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex-1 overflow-hidden">
        <TabManager
          tabs={tabs}
          activeTabId={activeTabId}
          dirtyTabs={dirtyTabs}
          getConnection={getConnection}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseTabsToRight={handleCloseTabsToRight}
          onReorder={handleReorderTabs}
          onRenameTab={handleRenameTab}
          onTabDirtyChange={handleTabDirtyChange}
          onOpenRelated={handleOpenRelated}
        />
      </main>

      <ConnectionDialog
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={editingConnection ? handleEditConnection : handleAddConnection}
        editing={editingConnection}
      />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
