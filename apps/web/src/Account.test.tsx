// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "./Account";
import { request } from "./api";

const desktop = vi.hoisted(() => ({
  native: vi.fn(() => false),
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, request: vi.fn() };
});
vi.mock("./desktop-session", () => ({
  isNativeDesktop: desktop.native,
  saveDesktopSessionToken: desktop.save,
  clearInMemoryDesktopSessionToken: desktop.clear,
}));

const user = {
  id: 4,
  fullName: "Caissier",
  username: "cashier",
  email: null,
  role: "cashier" as const,
  mustChangePassword: false,
  permissions: ["pos.use"],
};

describe("page Mon compte", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.mocked(request).mockReset();
    desktop.native.mockReturnValue(false);
    desktop.save.mockReset();
    desktop.clear.mockReset();
    vi.mocked(request).mockResolvedValueOnce({
      profile: {
        ...user,
        phone: null,
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
        lastLoginAt: null,
      },
    } as never);
  });
  it("affiche rôle et permissions en lecture seule", async () => {
    render(<AccountPage user={user} />);
    expect((await screen.findAllByText("cashier")).length).toBe(2);
    expect(screen.queryByRole("textbox", { name: /rôle/i })).toBeNull();
    expect(screen.getByText("pos.use")).toBeInTheDocument();
  });
  it("affiche clairement une erreur de validation API", async () => {
    vi.mocked(request).mockRejectedValueOnce(
      new Error("Numéro de téléphone invalide."),
    );
    render(<AccountPage user={user} />);
    await screen.findByRole("heading", { name: "Sécurité" });
    fireEvent.submit(screen.getByText("Enregistrer le profil").closest("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Numéro de téléphone invalide.",
      ),
    );
  });
  it("enregistre et vérifie le nouveau jeton après un changement de mot de passe Tauri", async () => {
    desktop.native.mockReturnValue(true);
    const token = "N".repeat(64);
    vi.mocked(request).mockResolvedValueOnce({
      user,
      desktopSession: { token },
    } as never);
    desktop.save.mockResolvedValue(undefined);
    render(<AccountPage user={user} />);
    await screen.findByRole("heading", { name: "Sécurité" });
    const securityForm = screen
      .getByRole("heading", { name: "Sécurité" })
      .closest("form") as HTMLFormElement;
    fireEvent.change(
      securityForm.elements.namedItem("currentPassword") as HTMLInputElement,
      { target: { value: "Ancien123" } },
    );
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), { target: { value: "Nouveau123" } });
    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "Nouveau123" } });
    fireEvent.submit(screen.getByText("Modifier le mot de passe").closest("form")!);
    await waitFor(() => expect(desktop.save).toHaveBeenCalledWith(token));
    expect(screen.getByText(/autres sessions ont été déconnectées/i)).toBeInTheDocument();
  });
});
