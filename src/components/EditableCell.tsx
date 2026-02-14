import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface EditableCellProps {
  value: unknown;
  onSave: (newValue: string | number | boolean | null) => Promise<void>;
  disabled?: boolean;
  className?: string;
}

export const EditableCell = React.memo(function EditableCell({
  value,
  onSave,
  disabled = false,
  className,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  const startEditing = useCallback(() => {
    if (disabled) return;
    setEditValue(displayValue);
    setError(null);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled, displayValue]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const parseValue = (raw: string): string | number | boolean | null => {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === "null" || trimmed === "") return null;
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
    const num = Number(trimmed);
    if (!Number.isNaN(num) && trimmed !== "") return num;
    return trimmed;
  };

  const save = useCallback(async () => {
    if (!editing) return;
    const parsed = parseValue(editValue);
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed);
      setEditing(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [editing, editValue, onSave]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
    setEditValue(displayValue);
  }, [displayValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
    [save, cancel]
  );

  const handleBlur = useCallback(() => {
    if (saving) return;
    cancel();
  }, [saving, cancel]);

  if (!editing) {
    return (
      <div
        onClick={startEditing}
        className={cn(
          "min-h-[20px] cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary focus:ring-inset",
          disabled && "cursor-default hover:bg-transparent",
          className
        )}
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            startEditing();
          }
        }}
      >
        {value === null || value === undefined ? (
          <span className="text-muted-foreground/50 italic">NULL</span>
        ) : typeof value === "object" ? (
          JSON.stringify(value)
        ) : (
          String(value)
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={saving}
        className={cn(
          "min-w-0 flex-1 rounded border border-primary bg-background px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50",
          className
        )}
        placeholder="NULL"
      />
      {error && (
        <span className="text-[10px] text-destructive truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
});
