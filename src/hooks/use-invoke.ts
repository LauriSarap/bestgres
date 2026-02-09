import { useState, useCallback } from "react";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

interface UseInvokeResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  execute: (cmd: string, args?: InvokeArgs) => Promise<T | null>;
}

/**
 * Hook for calling Tauri backend commands with loading/error state.
 * Wraps `invoke()` with standard async state management.
 */
export function useInvoke<T>(): UseInvokeResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const execute = useCallback(
    async (cmd: string, args?: InvokeArgs): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<T>(cmd, args);
        setData(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { data, error, loading, execute };
}
