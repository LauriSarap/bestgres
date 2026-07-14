import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionDialog } from "./ConnectionDialog";
import type { ConnectionEntry } from "@/types";

describe("ConnectionDialog", () => {
  it("requires a password for a new connection", async () => {
    const onSubmit = vi.fn();
    render(<ConnectionDialog open onClose={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText("My Database"), "Local");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(screen.getByText("Password is required for new connections.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits all advanced connection settings", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ConnectionDialog open onClose={onClose} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText("My Database"), "Production");
    await userEvent.type(screen.getByPlaceholderText("Password"), "secret");
    await userEvent.selectOptions(screen.getByRole("combobox"), "verify-full");
    await userEvent.type(screen.getByPlaceholderText("/path/to/ca.crt"), "/tmp/ca.crt");
    await userEvent.click(screen.getByTitle("Red (prod)"));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Production",
      password: "secret",
      sslMode: "verify-full",
      sslRootCert: "/tmp/ca.crt",
      color: "#ef4444",
      readOnly: true,
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it("allows editing metadata without re-entering an existing password", async () => {
    const editing: ConnectionEntry = {
      id: "id-1",
      name: "Stage",
      host: "db.example.com",
      port: 5432,
      user: "postgres",
      database: "postgres",
      ssl: true,
      ssl_mode: "require",
      ssl_root_cert: null,
      color: null,
      read_only: false,
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionDialog open onClose={vi.fn()} onSubmit={onSubmit} editing={editing} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Stage", password: "" }));
  });
});
