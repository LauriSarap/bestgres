import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database, Plus, Moon, Sun, Plug, ChevronRight, ChevronDown, Table, Eye,
  TerminalSquare, Loader2, Pencil, Trash2, HardDrive, FileCode, RefreshCw,
  Search, Star, Settings, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import type { ConnectionEntry, SchemaObject } from "@/types";

interface ConnContextMenu {
  x: number;
  y: number;
  conn: ConnectionEntry;
}

interface SidebarProps {
  className?: string;
  connections: ConnectionEntry[];
  activeConnectionId: string | null;
  onSelectConnection: (id: string) => void;
  onAddConnection: () => void;
  onEditConnection: (conn: ConnectionEntry) => void;
  onDeleteConnection: (conn: ConnectionEntry) => void;
  onOpenTable: (connectionId: string, database: string, schema: string, table: string) => void;
  onOpenStructure: (connectionId: string, database: string, schema: string, table: string) => void;
  onOpenQuery: (connectionId: string, database: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

const FAVORITES_KEY = "bestgres:favorites";

function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function Sidebar({
  className,
  connections,
  activeConnectionId,
  onSelectConnection,
  onAddConnection,
  onEditConnection,
  onDeleteConnection,
  onOpenTable,
  onOpenStructure,
  onOpenQuery,
  theme,
  onToggleTheme,
  onOpenSettings,
}: SidebarProps) {
  const { toast } = useToast();
  const [databases, setDatabases] = useState<Record<string, string[]>>({});
  const [schemas, setSchemas] = useState<Record<string, SchemaObject[]>>({});
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [loadingConn, setLoadingConn] = useState<string | null>(null);
  const [loadingDb, setLoadingDb] = useState<string | null>(null);
  const [connErrors, setConnErrors] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<Record<string, boolean>>({});
  const [ctxMenu, setCtxMenu] = useState<ConnContextMenu | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);

  // Resizable width (persisted)
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("bestgres:sidebarWidth"));
    return saved >= 180 && saved <= 600 ? saved : 256;
  });
  const resizing = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.min(600, Math.max(180, e.clientX));
      setWidth(w);
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("bestgres:sidebarWidth", String(width));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  const favKey = (c: string, d: string, s: string, t: string) => `${c}\x01${d}\x01${s}\x01${t}`;
  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCtxMenu(null);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // Health check for all connections
  useEffect(() => {
    if (connections.length === 0) return;
    let cancelled = false;
    Promise.all(
      connections.map(async (conn) => {
        try {
          return { id: conn.id, alive: await invoke<boolean>("check_connection", { connectionId: conn.id }) };
        } catch {
          return { id: conn.id, alive: false };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setHealth((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.id] = r.alive;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [connections]);

  const fetchDatabases = useCallback(async (connId: string) => {
    setLoadingConn(connId);
    try {
      const dbs = await invoke<string[]>("list_databases", { connectionId: connId });
      setDatabases((prev) => ({ ...prev, [connId]: dbs }));
      setHealth((prev) => ({ ...prev, [connId]: true }));
      setConnErrors((prev) => { const n = { ...prev }; delete n[connId]; return n; });
      return true;
    } catch (err) {
      setConnErrors((prev) => ({ ...prev, [connId]: String(err) }));
      setHealth((prev) => ({ ...prev, [connId]: false }));
      toast("error", String(err));
      return false;
    } finally {
      setLoadingConn(null);
    }
  }, [toast]);

  const fetchSchema = useCallback(async (connId: string, dbName: string) => {
    const key = `${connId}:${dbName}`;
    setLoadingDb(key);
    try {
      const objects = await invoke<SchemaObject[]>("get_schema", { connectionId: connId, database: dbName });
      setSchemas((prev) => ({ ...prev, [key]: objects }));
      setConnErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
      return true;
    } catch (err) {
      setConnErrors((prev) => ({ ...prev, [key]: String(err) }));
      toast("error", String(err));
      return false;
    } finally {
      setLoadingDb(null);
    }
  }, [toast]);

  const toggleConnection = useCallback(
    async (connId: string) => {
      if (expandedConnections.has(connId)) {
        setExpandedConnections((prev) => { const n = new Set(prev); n.delete(connId); return n; });
        return;
      }
      onSelectConnection(connId);
      if (databases[connId]) {
        setExpandedConnections((prev) => new Set(prev).add(connId));
        return;
      }
      if (await fetchDatabases(connId)) {
        setExpandedConnections((prev) => new Set(prev).add(connId));
      }
    },
    [expandedConnections, databases, onSelectConnection, fetchDatabases]
  );

  const toggleDatabase = useCallback(
    async (connId: string, dbName: string) => {
      const key = `${connId}:${dbName}`;
      if (expandedDatabases.has(key)) {
        setExpandedDatabases((prev) => { const n = new Set(prev); n.delete(key); return n; });
        return;
      }
      if (schemas[key]) {
        setExpandedDatabases((prev) => new Set(prev).add(key));
        return;
      }
      if (await fetchSchema(connId, dbName)) {
        setExpandedDatabases((prev) => new Set(prev).add(key));
      }
    },
    [expandedDatabases, schemas, fetchSchema]
  );

  const refreshConnection = useCallback(async (connId: string) => {
    setDatabases((prev) => { const n = { ...prev }; delete n[connId]; return n; });
    setSchemas((prev) => {
      const n = { ...prev };
      for (const k of Object.keys(n)) if (k.startsWith(`${connId}:`)) delete n[k];
      return n;
    });
    await fetchDatabases(connId);
    toast("info", "Connection refreshed");
  }, [fetchDatabases, toast]);

  // Auto-expand newly added/active connection
  useEffect(() => {
    if (activeConnectionId && !expandedConnections.has(activeConnectionId)) {
      toggleConnection(activeConnectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  // Refresh schema cache when DDL runs in a query editor
  useEffect(() => {
    function onSchemaChanged(e: Event) {
      const { connectionId, database } = (e as CustomEvent).detail ?? {};
      if (!connectionId || !database) return;
      const key = `${connectionId}:${database}`;
      if (expandedDatabases.has(key)) {
        fetchSchema(connectionId, database);
      } else {
        setSchemas((prev) => { const n = { ...prev }; delete n[key]; return n; });
      }
    }
    window.addEventListener("bestgres:schema-changed", onSchemaChanged);
    return () => window.removeEventListener("bestgres:schema-changed", onSchemaChanged);
  }, [expandedDatabases, fetchSchema]);

  const term = search.trim().toLowerCase();
  const matches = useCallback((name: string) => !term || name.toLowerCase().includes(term), [term]);

  return (
    <aside
      style={{ width }}
      className={cn("relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Connections</span>
        </div>
        <button onClick={onAddConnection} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-primary transition-colors" title="Add connection">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      {connections.length > 0 && (
        <div className="border-b border-sidebar-border px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter tables…"
              className="w-full bg-transparent text-xs placeholder:text-muted-foreground/50 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
            )}
          </div>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-2 py-10 text-center">
            <Plug className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">No connections yet.<br />Click <strong className="text-primary">+</strong> to add one.</p>
          </div>
        ) : (
          connections.map((conn) => {
            const isExpanded = expandedConnections.has(conn.id);
            const isLoadingConn = loadingConn === conn.id;
            const connError = connErrors[conn.id];
            const isAlive = health[conn.id];
            const dbs = databases[conn.id] || [];

            return (
              <div key={conn.id} className="mb-0.5">
                <div className="group flex items-center">
                  <button
                    onClick={() => toggleConnection(conn.id)}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, conn }); }}
                    title={connError || undefined}
                    className={cn(
                      "flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      conn.id === activeConnectionId ? "bg-primary/10 font-medium text-primary" : "text-sidebar-foreground hover:bg-accent"
                    )}
                  >
                    {isLoadingConn ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <span className="relative shrink-0">
                      <Database className="h-3.5 w-3.5" style={conn.color ? { color: conn.color } : undefined} />
                      {isAlive !== undefined && (
                        <span className={cn("absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-sidebar", isAlive ? "bg-green-500" : "bg-red-500")} />
                      )}
                    </span>
                    <span className="truncate">{conn.name}</span>
                    {conn.read_only && <span className="ml-1 rounded bg-muted px-1 text-[9px] font-semibold uppercase text-muted-foreground">RO</span>}
                  </button>
                  {isExpanded && (
                    <button onClick={(e) => { e.stopPropagation(); refreshConnection(conn.id); }} className="mr-0.5 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 transition-opacity" title="Refresh">
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); onEditConnection(conn); }} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 transition-opacity" title="Edit connection">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDeleteConnection(conn); }} className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100 transition-opacity" title="Delete connection">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="ml-3 mt-0.5 border-l border-border pl-1.5">
                    {dbs.map((dbName) => (
                      <DatabaseNode
                        key={dbName}
                        connId={conn.id}
                        dbName={dbName}
                        expanded={expandedDatabases.has(`${conn.id}:${dbName}`)}
                        loading={loadingDb === `${conn.id}:${dbName}`}
                        error={connErrors[`${conn.id}:${dbName}`]}
                        objects={schemas[`${conn.id}:${dbName}`] || []}
                        term={term}
                        matches={matches}
                        favorites={favorites}
                        favKey={favKey}
                        toggleFavorite={toggleFavorite}
                        onToggle={() => toggleDatabase(conn.id, dbName)}
                        onRefresh={() => fetchSchema(conn.id, dbName)}
                        onOpenTable={onOpenTable}
                        onOpenStructure={onOpenStructure}
                        onOpenQuery={onOpenQuery}
                      />
                    ))}
                    {dbs.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No databases found</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Connection context menu */}
      {ctxMenu && (
        <div ref={ctxMenuRef} className="fixed z-50 min-w-44 rounded-md border border-border bg-popover py-1 shadow-lg" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button onClick={() => { onEditConnection(ctxMenu.conn); setCtxMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent">
            <Pencil className="h-3 w-3" />Edit connection
          </button>
          <button onClick={() => { refreshConnection(ctxMenu.conn.id); setCtxMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent">
            <RefreshCw className="h-3 w-3" />Refresh
          </button>
          <button onClick={() => { onDeleteConnection(ctxMenu.conn); setCtxMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3 w-3" />Remove connection
          </button>
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center justify-between border-t border-sidebar-border px-3 py-2">
        <button onClick={onOpenSettings} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" title="Settings & updates">
          <Settings className="h-4 w-4" />
        </button>
        <button onClick={onToggleTheme} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={() => {
          resizing.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
        title="Drag to resize"
      />
    </aside>
  );
}

interface DatabaseNodeProps {
  connId: string;
  dbName: string;
  expanded: boolean;
  loading: boolean;
  error?: string;
  objects: SchemaObject[];
  term: string;
  matches: (name: string) => boolean;
  favorites: Set<string>;
  favKey: (c: string, d: string, s: string, t: string) => string;
  toggleFavorite: (key: string) => void;
  onToggle: () => void;
  onRefresh: () => void;
  onOpenTable: (connectionId: string, database: string, schema: string, table: string) => void;
  onOpenStructure: (connectionId: string, database: string, schema: string, table: string) => void;
  onOpenQuery: (connectionId: string, database: string) => void;
}

function DatabaseNode({
  connId, dbName, expanded, loading, error, objects, term, matches,
  favorites, favKey, toggleFavorite, onToggle, onRefresh,
  onOpenTable, onOpenStructure, onOpenQuery,
}: DatabaseNodeProps) {
  const tables = useMemo(() => objects.filter((o) => o.object_type === "table" && matches(o.name)), [objects, matches]);
  const views = useMemo(() => objects.filter((o) => o.object_type === "view" && matches(o.name)), [objects, matches]);

  // Group tables by schema only when more than one schema is present
  const schemaNames = useMemo(() => [...new Set(tables.map((t) => t.schema))].sort(), [tables]);
  const groupBySchema = schemaNames.length > 1;

  const favTables = useMemo(
    () => tables.filter((t) => favorites.has(favKey(connId, dbName, t.schema, t.name))),
    [tables, favorites, favKey, connId, dbName]
  );

  const renderTable = (t: SchemaObject) => {
    const key = favKey(connId, dbName, t.schema, t.name);
    const isFav = favorites.has(key);
    return (
      <div key={`${t.schema}.${t.name}`} className="group/table flex items-center">
        <button onClick={() => onOpenTable(connId, dbName, t.schema, t.name)} className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-accent transition-colors">
          <Table className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{t.name}</span>
        </button>
        <button onClick={() => toggleFavorite(key)} className={cn("rounded p-0.5 transition-opacity", isFav ? "text-yellow-500 opacity-100" : "text-muted-foreground opacity-0 hover:text-yellow-500 group-hover/table:opacity-100")} title={isFav ? "Unfavorite" : "Favorite"}>
          <Star className="h-3 w-3" fill={isFav ? "currentColor" : "none"} />
        </button>
        <button onClick={() => onOpenStructure(connId, dbName, t.schema, t.name)} className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-primary group-hover/table:opacity-100 transition-opacity" title="View structure">
          <FileCode className="h-3 w-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="mb-0.5">
      <div className="group/db flex items-center">
        <button onClick={onToggle} title={error || undefined} className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-sidebar-foreground hover:bg-accent transition-colors">
          {loading ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <HardDrive className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{dbName}</span>
        </button>
        {expanded && (
          <button onClick={onRefresh} className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover/db:opacity-100 transition-opacity" title="Refresh schema">
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="ml-3 mt-0.5 border-l border-border pl-1.5">
          <button onClick={() => onOpenQuery(connId, dbName)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            <TerminalSquare className="h-3 w-3 shrink-0 text-primary" />
            <span>New Query</span>
          </button>

          {/* Favorites */}
          {favTables.length > 0 && (
            <div className="mt-0.5">
              <p className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Star className="h-2.5 w-2.5" fill="currentColor" /> Favorites
              </p>
              {favTables.map(renderTable)}
            </div>
          )}

          {/* Tables */}
          {tables.length > 0 && (
            groupBySchema ? (
              schemaNames.map((sn) => {
                const inSchema = tables.filter((t) => t.schema === sn);
                if (inSchema.length === 0) return null;
                return (
                  <div key={sn} className="mt-0.5">
                    <p className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{sn} ({inSchema.length})</p>
                    {inSchema.map(renderTable)}
                  </div>
                );
              })
            ) : (
              <div className="mt-0.5">
                <p className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tables ({tables.length})</p>
                {tables.map(renderTable)}
              </div>
            )
          )}

          {/* Views */}
          {views.length > 0 && (
            <div className="mt-0.5">
              <p className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Views ({views.length})</p>
              {views.map((v) => (
                <button key={`${v.schema}.${v.name}`} onClick={() => onOpenTable(connId, dbName, v.schema, v.name)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-accent transition-colors">
                  <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{v.name}</span>
                </button>
              ))}
            </div>
          )}

          {objects.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No tables found</p>}
          {objects.length > 0 && tables.length === 0 && views.length === 0 && term && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No matches for &quot;{term}&quot;</p>
          )}
        </div>
      )}
    </div>
  );
}
