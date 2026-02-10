import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "@/components/Sidebar";
import { TabManager } from "@/components/TabManager";
import {
  ConnectionDialog,
  type ConnectionFormData,
} from "@/components/ConnectionDialog";
import { useTheme } from "@/hooks/use-theme";
import type { Tab, ConnectionEntry } from "@/types";

function App() {
  const { theme, toggleTheme } = useTheme();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionEntry | null>(null);
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);

  /* ── Load config connections on mount ── */

  useEffect(() => {
    async function loadFromConfig() {
      try {
        const loaded = await invoke<ConnectionEntry[]>("load_config_connections");
        if (loaded.length > 0) {
          setConnections(loaded);
          setActiveConnectionId(loaded[0].id);
        }
      } catch {
        // Config dir may not exist or have no files — that's fine
      }
    }
    loadFromConfig();
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
    await invoke("add_connection", {
      config: {
        id,
        name: data.name,
        host: data.host,
        port: data.port,
        user: data.user,
        database: data.database,
        ssl: data.ssl,
      },
      password: data.password,
    });
    setConnections((prev) => [
      ...prev,
      {
        id,
        name: data.name,
        host: data.host,
        port: data.port,
        user: data.user,
        database: data.database,
        ssl: data.ssl,
      },
    ]);
    setActiveConnectionId(id);
  }, []);

  const handleEditConnection = useCallback(async (data: ConnectionFormData) => {
    if (!editingConnection) return;
    const id = editingConnection.id;
    await invoke("update_connection", {
      config: {
        id,
        name: data.name,
        host: data.host,
        port: data.port,
        user: data.user,
        database: data.database,
        ssl: data.ssl,
      },
      password: data.password,
    });
    setConnections((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              name: data.name,
              host: data.host,
              port: data.port,
              user: data.user,
              database: data.database,
              ssl: data.ssl,
            }
          : c
      )
    );
  }, [editingConnection]);

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelectConnection={handleSelectConnection}
        onAddConnection={openAddDialog}
        onEditConnection={openEditDialog}
        onOpenTable={handleOpenTable}
        onOpenStructure={handleOpenStructure}
        onOpenQuery={handleOpenQuery}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="flex-1 overflow-hidden">
        <TabManager
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseTabsToRight={handleCloseTabsToRight}
        />
      </main>

      <ConnectionDialog
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={editingConnection ? handleEditConnection : handleAddConnection}
        editing={editingConnection}
      />
    </div>
  );
}

export default App;
