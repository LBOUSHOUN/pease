// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, request: mocks.request };
});
vi.mock("./desktop-session", () => ({
  DesktopTokenStorageError: class extends Error {
    category = "credential_write_failed";
  },
  isNativeDesktop: () => true,
  saveDesktopSessionToken: mocks.save,
  clearInMemoryDesktopSessionToken: mocks.clear,
  deleteDesktopSessionToken: vi.fn(),
}));
vi.mock("./offline-auth", () => ({
  saveOfflineAuthSnapshot: mocks.snapshot,
  clearOfflineAuthSnapshot: vi.fn(),
}));

import { Login } from "./App";

const response = {
  user: {
    id: 1,
    fullName: "Gérante",
    username: "gerante",
    role: "manager",
    mustChangePassword: false,
    permissions: [],
  },
  desktopSession: { token: "T".repeat(64), expiresAt: new Date().toISOString() },
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("desktop login persistence", () => {
  it("revokes the newly issued server session when secure storage fails", async () => {
    mocks.request
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ok: true });
    mocks.save.mockRejectedValueOnce(new Error("storage failed"));
    render(<Login done={vi.fn()} notice="" />);
    fireEvent.change(screen.getByLabelText("Identifiant ou e-mail"), {
      target: { value: "gerante" },
    });
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "secret" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Se connecter" }).closest("form")!);
    expect(
      await screen.findByText(
        "Connexion réussie, mais la session n’a pas pu être enregistrée.",
      ),
    ).toBeTruthy();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      "/auth/logout",
      expect.objectContaining({
        method: "POST",
        desktopTokenOverride: response.desktopSession.token,
      }),
    );
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous submit events into one login request", async () => {
    let finish!: (value: typeof response) => void;
    mocks.request.mockImplementationOnce(
      () => new Promise<typeof response>((resolve) => (finish = resolve)),
    ).mockResolvedValue(response);
    mocks.save.mockResolvedValue(undefined);
    render(<Login done={vi.fn()} notice="" />);
    fireEvent.change(screen.getByLabelText("Identifiant ou e-mail"), {
      target: { value: "gerante" },
    });
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "secret" },
    });
    const form = screen.getByRole("button", { name: "Se connecter" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    finish(response);
    await screen.findByRole("button", { name: "Se connecter" });
  });
});
