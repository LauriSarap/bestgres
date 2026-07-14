import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  check: vi.fn(),
  relaunch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

describe("SettingsDialog", () => {
  beforeEach(() => {
    mocks.getVersion.mockResolvedValue("0.3.0");
    mocks.check.mockReset();
    mocks.relaunch.mockReset();
    mocks.toast.mockReset();
  });

  it("shows the running version and a clean up-to-date state", async () => {
    mocks.check.mockResolvedValue(null);
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(await screen.findByText("Version 0.3.0")).toBeVisible();
    expect(await screen.findByText("You're on the latest version.")).toBeVisible();
  });

  it("installs an available update and relaunches", async () => {
    const downloadAndInstall = vi.fn(async (listener) => {
      listener({ event: "Started", data: { contentLength: 100 } });
      listener({ event: "Progress", data: { chunkLength: 40 } });
    });
    mocks.check.mockResolvedValue({ version: "0.4.0", body: "Changes", downloadAndInstall });
    render(<SettingsDialog open onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Download & install" }));
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalled());
    expect(mocks.toast).toHaveBeenCalledWith("success", "Update installed — restarting…");
    expect(mocks.relaunch).toHaveBeenCalled();
  });

  it("turns update endpoint failures into a useful message", async () => {
    mocks.check.mockRejectedValue(new Error("404 release JSON not found"));
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(await screen.findByText(/Couldn't reach the update server/)).toBeVisible();
  });

  it("closes on Escape", async () => {
    mocks.check.mockResolvedValue(null);
    const onClose = vi.fn();
    render(<SettingsDialog open onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
