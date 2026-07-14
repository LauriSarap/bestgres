import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionEntry } from "@/types";

export interface ConnectionFormData {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: string; // "disable" | "require" | "verify-full"
  sslRootCert: string;
  color: string | null;
  readOnly: boolean;
}

const defaultForm: ConnectionFormData = {
  name: "",
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
  sslMode: "disable",
  sslRootCert: "",
  color: null,
  readOnly: false,
};

const COLORS = [
  { value: null, label: "None" },
  { value: "#ef4444", label: "Red (prod)" },
  { value: "#f59e0b", label: "Amber (staging)" },
  { value: "#22c55e", label: "Green (dev)" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#a855f7", label: "Purple" },
];

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ConnectionFormData) => Promise<void>;
  editing?: ConnectionEntry | null;
}

type TestState = { status: "idle" | "testing" | "ok" } | { status: "error"; message: string };

export function ConnectionDialog({ open, onClose, onSubmit, editing }: ConnectionDialogProps) {
  const [form, setForm] = useState<ConnectionFormData>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    if (open && editing) {
      setForm({
        name: editing.name,
        host: editing.host,
        port: editing.port,
        user: editing.user,
        password: "",
        database: editing.database,
        sslMode: editing.ssl_mode || (editing.ssl ? "require" : "disable"),
        sslRootCert: editing.ssl_root_cert ?? "",
        color: editing.color ?? null,
        readOnly: !!editing.read_only,
      });
      setError(null);
      setTest({ status: "idle" });
    } else if (open && !editing) {
      setForm(defaultForm);
      setError(null);
      setTest({ status: "idle" });
    }
  }, [open, editing]);

  if (!open) return null;
  const isEdit = !!editing;

  function updateField<K extends keyof ConnectionFormData>(key: K, value: ConnectionFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setTest({ status: "idle" });
  }

  function buildConfigPayload() {
    return {
      config: {
        id: editing?.id ?? "00000000-0000-0000-0000-000000000000",
        name: form.name,
        host: form.host,
        port: form.port,
        user: form.user,
        database: form.database,
        ssl: form.sslMode !== "disable",
        ssl_mode: form.sslMode,
        ssl_root_cert: form.sslRootCert || null,
        color: form.color,
        read_only: form.readOnly,
      },
      password: form.password,
    };
  }

  async function handleTest() {
    if (!form.host.trim() || !form.database.trim()) {
      setError("Host and database are required to test.");
      return;
    }
    setTest({ status: "testing" });
    try {
      await invoke("test_connection_config", buildConfigPayload());
      setTest({ status: "ok" });
    } catch (err) {
      setTest({ status: "error", message: String(err) });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.host.trim() || !form.database.trim()) {
      setError("Name, host, and database are required.");
      return;
    }
    if (!isEdit && !form.password) {
      setError("Password is required for new connections.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-card-foreground">{isEdit ? "Edit Connection" : "New Connection"}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Connection Name">
            <Input value={form.name} onChange={(v) => updateField("name", v)} placeholder="My Database" autoFocus />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Host"><Input value={form.host} onChange={(v) => updateField("host", v)} placeholder="localhost" /></Field>
            </div>
            <Field label="Port"><Input value={String(form.port)} onChange={(v) => updateField("port", parseInt(v) || 5432)} placeholder="5432" type="number" /></Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="User"><Input value={form.user} onChange={(v) => updateField("user", v)} placeholder="postgres" /></Field>
            <Field label="Password"><Input value={form.password} onChange={(v) => updateField("password", v)} placeholder={isEdit ? "Leave blank to keep current" : "Password"} type="password" /></Field>
          </div>

          <Field label="Database"><Input value={form.database} onChange={(v) => updateField("database", v)} placeholder="postgres" /></Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="SSL Mode">
              <select
                value={form.sslMode}
                onChange={(e) => updateField("sslMode", e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
              >
                <option value="disable">disable</option>
                <option value="require">require</option>
                <option value="verify-full">verify-full</option>
              </select>
            </Field>
            {form.sslMode === "verify-full" && (
              <Field label="CA Cert Path"><Input value={form.sslRootCert} onChange={(v) => updateField("sslRootCert", v)} placeholder="/path/to/ca.crt" /></Field>
            )}
          </div>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => updateField("color", c.value)}
                  title={c.label}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-transform",
                    form.color === c.value ? "border-foreground scale-110" : "border-transparent",
                    c.value === null && "bg-muted text-[9px] text-muted-foreground"
                  )}
                  style={c.value ? { backgroundColor: c.value } : undefined}
                >
                  {c.value === null && "—"}
                </button>
              ))}
            </div>
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={form.readOnly} onChange={(e) => updateField("readOnly", e.target.checked)} className="h-3.5 w-3.5 rounded border-input accent-primary" />
            Read-only (block edits, inserts, deletes &amp; DML)
          </label>

          {test.status === "ok" && (
            <p className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connection successful.
            </p>
          )}
          {test.status === "error" && (
            <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-all">{test.message}</span>
            </p>
          )}
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={test.status === "testing"}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {test.status === "testing" && <Loader2 className="h-3 w-3 animate-spin" />}
              Test Connection
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
              <button type="submit" disabled={loading} className={cn("flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors", loading && "cursor-not-allowed opacity-70")}>
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                {isEdit ? "Save" : "Connect"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Input({
  value, onChange, placeholder, type = "text", autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
    />
  );
}
