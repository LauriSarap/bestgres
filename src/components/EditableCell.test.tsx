import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditableCell, parseEditValue } from "./EditableCell";

describe("EditableCell", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["NULL", null],
    ["''", ""],
    [" value ", " value "],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseEditValue(raw)).toBe(expected);
  });

  it("commits an edited value with Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableCell value="before" onSave={onSave} />);

    await userEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "after{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("after"));
    expect(screen.getByRole("button")).toHaveTextContent("before");
  });

  it("cancels editing with Escape", async () => {
    const onSave = vi.fn();
    render(<EditableCell value="before" onSave={onSave} />);
    await userEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("before");
  });

  it("keeps the editor open and shows save errors", async () => {
    render(<EditableCell value="before" onSave={vi.fn().mockRejectedValue(new Error("write failed"))} />);
    await userEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(await screen.findByTitle("Error: write failed")).toBeVisible();
    expect(screen.getByRole("textbox")).toBeVisible();
  });
});
