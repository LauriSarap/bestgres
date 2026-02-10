import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database,
  Plus,
  Moon,
  Sun,
  Plug,
  ChevronRight,
  ChevronDown,
  Table,
  Eye,
  TerminalSquare,
  Loader2,
  Pencil,
  HardDrive,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionEntry, SchemaObject } from "@/types";

interface SidebarProps {
  className?: string;
  connections: ConnectionEntry[];
  activeConnectionId: string | null;
  onSelectConnection: (id: string) => void;
  onAddConnection: () => void;
  onEditConnection: (conn: ConnectionEntry) => void;
  onOpenTable: (connectionId: string, database: string, schema: string, table: string) => void;
  onOpenQuery: (connectionId: string, database: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function Sidebar({
  className,
  connections,
  activeConnectionId,
  onSelectConnection,
  onAddConnection,
  onEditConnection,
  onOpenTable,
  onOpenQuery,
  theme,
  onToggleTheme,
}: SidebarProps) {
  // Databases per connection
  const [databases, setDatabases] = useState<Record<string, string[]>>({});
  // Schema objects per "connectionId:database"
  const [schemas, setSchemas] = useState<Record<string, SchemaObject[]>>({});
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [loadingConn, setLoadingConn] = useState<string | null>(null);
  const [loadingDb, setLoadingDb] = useState<string | null>(null);
  // Per-connection errors
  const [connErrors, setConnErrors] = useState<Record<string, string>>({});

  const toggleConnection = useCallback(
    async (connId: string) => {
      // If already expanded and no error, collapse it
      if (expandedConnections.has(connId) && !connErrors[connId]) {
        setExpandedConnections((prev) => {
          const next = new Set(prev);
          next.delete(connId);
          return next;
        });
        return;
      }

      onSelectConnection(connId);
      setExpandedConnections((prev) => new Set(prev).add(connId));

      // Always retry if there was an error, otherwise skip if already loaded
      if (databases[connId] && !connErrors[connId]) return;

      setLoadingConn(connId);
      setConnErrors((prev) => {
        const next = { ...prev };
        delete next[connId];
        return next;
      });

      try {
        const dbs = await invoke<string[]>("list_databases", { connectionId: connId });
        setDatabases((prev) => ({ ...prev, [connId]: dbs }));
      } catch (err) {
        setConnErrors((prev) => ({ ...prev, [connId]: String(err) }));
      } finally {
        setLoadingConn(null);
      }
    },
    [expandedConnections, databases, connErrors, onSelectConnection]
  );

  const toggleDatabase = useCallback(
    async (connId: string, dbName: string) => {
      const key = `${connId}:${dbName}`;

      if (expandedDatabases.has(key)) {
        setExpandedDatabases((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        return;
      }

      setExpandedDatabases((prev) => new Set(prev).add(key));

      if (!schemas[key]) {
        setLoadingDb(key);
        try {
          const objects = await invoke<SchemaObject[]>("get_schema", {
            connectionId: connId,
            database: dbName,
          });
          setSchemas((prev) => ({ ...prev, [key]: objects }));
        } catch (err) {
          setConnErrors((prev) => ({ ...prev, [key]: String(err) }));
        } finally {
          setLoadingDb(null);
        }
      }
    },
    [expandedDatabases, schemas]
  );

  // Auto-expand newly added connections
  useEffect(() => {
    if (activeConnectionId && !expandedConnections.has(activeConnectionId)) {
      toggleConnection(activeConnectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  return (
    <aside
      className={cn(
        "flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Connections</span>
        </div>
        <button
          onClick={onAddConnection}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-primary transition-colors"
          title="Add connection"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Connection Tree */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-2 py-10 text-center">
            <Plug className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              No connections yet.
              <br />
              Click <strong className="text-primary">+</strong> to add one.
            </p>
          </div>
        ) : (
          connections.map((conn) => {
            const isExpanded = expandedConnections.has(conn.id);
            const isLoadingConn = loadingConn === conn.id;
            const connError = connErrors[conn.id];
            const dbs = databases[conn.id] || [];

            return (
              <div key={conn.id} className="mb-0.5">
                {/* Connection row */}
                <div className="group flex items-center">
                  <button
                    onClick={() => toggleConnection(conn.id)}
                    className={cn(
                      "flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      connError
                        ? "text-destructive hover:bg-destructive/10"
                        : conn.id === activeConnectionId
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-sidebar-foreground hover:bg-accent"
                    )}
                  >
                    {isLoadingConn ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    ) : connError ? (
                      <AlertCircle className="h-3 w-3 shrink-0" />
                    ) : isExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    )}
                    <Database className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{conn.name}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditConnection(conn);
                    }}
                    className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 transition-opacity"
                    title="Edit connection"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>

                {/* Connection error */}
                {isExpanded && connError && !isLoadingConn && (
                  <div className="ml-5 mt-1 mb-1">
                    <p className="px-2 py-1 text-[10px] text-destructive leading-tight break-words">
                      {connError}
                    </p>
                    <button
                      onClick={() => toggleConnection(conn.id)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                    >
                      <RefreshCw className="h-2.5 w-2.5" />
                      Retry
                    </button>
                  </div>
                )}

                {/* Databases tree */}
                {isExpanded && !isLoadingConn && !connError && (
                  <div className="ml-3 border-l border-border pl-1.5 mt-0.5">
                    {dbs.map((dbName) => {
                      const dbKey = `${conn.id}:${dbName}`;
                      const isDbExpanded = expandedDatabases.has(dbKey);
                      const isDbLoading = loadingDb === dbKey;
                      const dbError = connErrors[dbKey];
                      const objects = schemas[dbKey] || [];
                      const tables = objects.filter((o) => o.object_type === "table");
                      const views = objects.filter((o) => o.object_type === "view");

                      return (
                        <div key={dbName} className="mb-0.5">
                          {/* Database row */}
                          <button
                            onClick={() => toggleDatabase(conn.id, dbName)}
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-sidebar-foreground hover:bg-accent transition-colors"
                          >
                            {isDbLoading ? (
                              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                            ) : isDbExpanded ? (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0" />
                            )}
                            <HardDrive className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{dbName}</span>
                          </button>

                          {/* Database error */}
                          {isDbExpanded && dbError && !isDbLoading && (
                            <div className="ml-5 mt-0.5">
                              <p className="px-2 py-0.5 text-[10px] text-destructive leading-tight break-words">
                                {dbError}
                              </p>
                            </div>
                          )}

                          {/* Schema objects inside this database */}
                          {isDbExpanded && !isDbLoading && !dbError && (
                            <div className="ml-3 border-l border-border pl-1.5 mt-0.5">
                              {/* New Query */}
                              <button
                                onClick={() => onOpenQuery(conn.id, dbName)}
                                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                              >
                                <TerminalSquare className="h-3 w-3 shrink-0 text-primary" />
                                <span>New Query</span>
                              </button>

                              {/* Tables */}
                              {tables.length > 0 && (
                                <div className="mt-0.5">
                                  <p className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Tables ({tables.length})
                                  </p>
                                  {tables.map((t) => (
                                    <button
                                      key={`${t.schema}.${t.name}`}
                                      onClick={() => onOpenTable(conn.id, dbName, t.schema, t.name)}
                                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-accent transition-colors"
                                    >
                                      <Table className="h-3 w-3 shrink-0 text-muted-foreground" />
                                      <span className="truncate">{t.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Views */}
                              {views.length > 0 && (
                                <div className="mt-0.5">
                                  <p className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Views ({views.length})
                                  </p>
                                  {views.map((v) => (
                                    <button
                                      key={`${v.schema}.${v.name}`}
                                      onClick={() => onOpenTable(conn.id, dbName, v.schema, v.name)}
                                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-accent transition-colors"
                                    >
                                      <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                                      <span className="truncate">{v.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {objects.length === 0 && (
                                <p className="px-2 py-1 text-xs text-muted-foreground">
                                  No tables found
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {dbs.length === 0 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        No databases found
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom — Theme Toggle */}
      <div className="flex items-center justify-end border-t border-sidebar-border px-4 py-2">
        <button
          onClick={onToggleTheme}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
