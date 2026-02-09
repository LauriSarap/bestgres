import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionEntry } from "@/types";

export interface ConnectionFormData {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

const defaultForm: ConnectionFormData = {
  name: "",
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
  ssl: false,
};

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ConnectionFormData) => Promise<void>;
  /** If set, the dialog is in edit mode with pre-filled values. */
  editing?: ConnectionEntry | null;
}

export function ConnectionDialog({ open, onClose, onSubmit, editing }: ConnectionDialogProps) {
  const [form, setForm] = useState<ConnectionFormData>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When opening in edit mode, pre-fill the form
  useEffect(() => {
    if (open && editing) {
      setForm({
        name: editing.name,
        host: editing.host,
        port: editing.port,
        user: editing.user,
        password: "", // can't read from keychain, leave blank
        database: editing.database,
        ssl: editing.ssl,
      });
      setError(null);
    } else if (open && !editing) {
      setForm(defaultForm);
      setError(null);
    }
  }, [open, editing]);

  if (!open) return null;

  const isEdit = !!editing;

  function updateField<K extends keyof ConnectionFormData>(
    key: K,
    value: ConnectionFormData[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-card-foreground">
            {isEdit ? "Edit Connection" : "New Connection"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Connection Name">
            <Input
              value={form.name}
              onChange={(v) => updateField("name", v)}
              placeholder="My Database"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Host">
                <Input
                  value={form.host}
                  onChange={(v) => updateField("host", v)}
                  placeholder="localhost"
                />
              </Field>
            </div>
            <Field label="Port">
              <Input
                value={String(form.port)}
                onChange={(v) => updateField("port", parseInt(v) || 5432)}
                placeholder="5432"
                type="number"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="User">
              <Input
                value={form.user}
                onChange={(v) => updateField("user", v)}
                placeholder="postgres"
              />
            </Field>
            <Field label="Password">
              <Input
                value={form.password}
                onChange={(v) => updateField("password", v)}
                placeholder={isEdit ? "Leave blank to keep current" : "Password"}
                type="password"
              />
            </Field>
          </div>

          <Field label="Database">
            <Input
              value={form.database}
              onChange={(v) => updateField("database", v)}
              placeholder="postgres"
            />
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.ssl}
              onChange={(e) => updateField("ssl", e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            Use SSL
          </label>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={cn(
                "flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors",
                loading && "opacity-70 cursor-not-allowed"
              )}
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              {isEdit ? "Save" : "Connect"}
            </button>
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
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
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
