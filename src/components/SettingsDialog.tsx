import { useState, useEffect, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { X, Loader2, RefreshCw, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/components/Toast";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; update: Update }
  | { status: "downloading"; pct: number | null }
  | { status: "error"; message: string };

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { toast } = useToast();
  const [version, setVersion] = useState<string>("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("?"));
  }, []);

  const checkForUpdates = useCallback(async () => {
    setUpdate({ status: "checking" });
    try {
      const result = await check();
      if (result) setUpdate({ status: "available", update: result });
      else setUpdate({ status: "up-to-date" });
    } catch (err) {
      // The endpoint 404s / has no latest.json until a signed release is published.
      // Don't show a scary raw error for the common "nothing to check yet" case.
      const msg = String(err);
      if (/release JSON|404|not found|fetch/i.test(msg)) {
        setUpdate({ status: "error", message: "Couldn't reach the update server. You may already be on the latest version." });
      } else {
        setUpdate({ status: "error", message: msg });
      }
    }
  }, []);

  // Auto-check whenever the dialog opens
  useEffect(() => {
    if (open) checkForUpdates();
  }, [open, checkForUpdates]);

  // Close on Escape (but NOT on outside click — avoids accidental dismissal)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const installUpdate = useCallback(async () => {
    if (update.status !== "available") return;
    const u = update.update;
    setUpdate({ status: "downloading", pct: null });
    try {
      let total = 0;
      let downloaded = 0;
      await u.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdate({ status: "downloading", pct: total > 0 ? Math.round((downloaded / total) * 100) : null });
        }
      });
      toast("success", "Update installed — restarting…");
      await relaunch();
    } catch (err) {
      setUpdate({ status: "error", message: String(err) });
      toast("error", "Update failed");
    }
  }, [update, toast]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-card-foreground">Settings</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Version + update status */}
          <div className="rounded-md border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-card-foreground">Bestgres</p>
                <p className="text-xs text-muted-foreground">Version {version || "…"}</p>
              </div>
              <button
                onClick={checkForUpdates}
                disabled={update.status === "checking" || update.status === "downloading"}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                {update.status === "checking" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Check for updates
              </button>
            </div>

            <div className="mt-3 text-xs">
              {update.status === "checking" && (
                <p className="text-muted-foreground">Checking…</p>
              )}
              {update.status === "up-to-date" && (
                <p className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> You&apos;re on the latest version.
                </p>
              )}
              {update.status === "available" && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-primary">
                    <Download className="h-3.5 w-3.5" /> Version {update.update.version} is available.
                  </p>
                  {update.update.body && (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                      {update.update.body}
                    </pre>
                  )}
                  <button
                    onClick={installUpdate}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <Download className="h-3 w-3" /> Download &amp; install
                  </button>
                </div>
              )}
              {update.status === "downloading" && (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Downloading{update.pct !== null ? ` ${update.pct}%` : "…"}
                </p>
              )}
              {update.status === "error" && (
                <p className="flex items-start gap-1.5 text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-all">{update.message}</span>
                </p>
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground/70">
            A fast, minimal PostgreSQL client built with Tauri, React, and Rust.
          </p>
        </div>
      </div>
    </div>
  );
}
