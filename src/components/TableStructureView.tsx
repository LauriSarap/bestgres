import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, AlertCircle, Key, Hash, Link, ShieldCheck } from "lucide-react";
import type { TableStructure } from "@/types";

interface TableStructureViewProps {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

export function TableStructureView({
  connectionId,
  database,
  schema,
  table,
}: TableStructureViewProps) {
  const [structure, setStructure] = useState<TableStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await invoke<TableStructure>("get_table_structure", {
          connectionId,
          database,
          schema,
          table,
        });
        if (!cancelled) setStructure(res);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [connectionId, database, schema, table]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading structure for {schema}.{table}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (!structure) return null;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      <h2 className="text-sm font-semibold text-foreground">
        {schema}.{table}
      </h2>

      {/* Columns */}
      <Section title="Columns" count={structure.columns.length}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-4 font-medium">Name</th>
              <th className="py-1.5 pr-4 font-medium">Type</th>
              <th className="py-1.5 pr-4 font-medium">Nullable</th>
              <th className="py-1.5 font-medium">Default</th>
            </tr>
          </thead>
          <tbody>
            {structure.columns.map((col) => (
              <tr key={col.name} className="border-b border-border/50 hover:bg-muted/50">
                <td className="py-1.5 pr-4 font-mono text-foreground">{col.name}</td>
                <td className="py-1.5 pr-4 font-mono text-primary">{col.data_type}</td>
                <td className="py-1.5 pr-4">
                  {col.is_nullable ? (
                    <span className="text-muted-foreground">YES</span>
                  ) : (
                    <span className="font-medium text-foreground">NOT NULL</span>
                  )}
                </td>
                <td className="py-1.5 font-mono text-muted-foreground">
                  {col.default_value ?? <span className="italic">none</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Indexes */}
      {structure.indexes.length > 0 && (
        <Section title="Indexes" count={structure.indexes.length} icon={<Hash className="h-3.5 w-3.5" />}>
          <div className="space-y-2">
            {structure.indexes.map((idx) => (
              <div key={idx.name} className="rounded border border-border/50 p-2">
                <div className="flex items-center gap-2 text-xs">
                  {idx.is_primary && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      PK
                    </span>
                  )}
                  {idx.is_unique && !idx.is_primary && (
                    <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                      UNIQUE
                    </span>
                  )}
                  <span className="font-medium text-foreground">{idx.name}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                  {idx.definition}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Foreign Keys */}
      {structure.foreign_keys.length > 0 && (
        <Section title="Foreign Keys" count={structure.foreign_keys.length} icon={<Link className="h-3.5 w-3.5" />}>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Name</th>
                <th className="py-1.5 pr-4 font-medium">Column</th>
                <th className="py-1.5 font-medium">References</th>
              </tr>
            </thead>
            <tbody>
              {structure.foreign_keys.map((fk, i) => (
                <tr key={`${fk.name}-${i}`} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-1.5 pr-4 font-mono text-foreground">{fk.name}</td>
                  <td className="py-1.5 pr-4 font-mono text-primary">{fk.column_name}</td>
                  <td className="py-1.5 font-mono text-muted-foreground">
                    {fk.ref_schema}.{fk.ref_table}.{fk.ref_column}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Constraints */}
      {structure.constraints.length > 0 && (
        <Section title="Constraints" count={structure.constraints.length} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
          <div className="space-y-2">
            {structure.constraints.map((con) => (
              <div key={con.name} className="rounded border border-border/50 p-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {con.constraint_type}
                  </span>
                  <span className="font-medium text-foreground">{con.name}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                  {con.definition}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon ?? <Key className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title} ({count})
        </h3>
      </div>
      {children}
    </div>
  );
}
