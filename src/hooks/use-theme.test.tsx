import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTheme } from "./use-theme";

describe("useTheme", () => {
  it("loads, applies, toggles, and persists the selected theme", async () => {
    localStorage.setItem("bestgres-theme", "dark");
    const { result } = renderHook(() => useTheme());

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(result.current.theme).toBe("dark");

    act(() => result.current.toggleTheme());
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
    expect(localStorage.getItem("bestgres-theme")).toBe("light");

    act(() => result.current.setTheme("dark"));
    await waitFor(() => expect(localStorage.getItem("bestgres-theme")).toBe("dark"));
  });
});
