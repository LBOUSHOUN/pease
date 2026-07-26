// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, request: mocks.request };
});
vi.mock("./desktop-session", () => ({
  DesktopTokenStorageError: class extends Error {},
  isNativeDesktop: () => false,
  saveDesktopSessionToken: vi.fn(),
  clearInMemoryDesktopSessionToken: vi.fn(),
  deleteDesktopSessionToken: vi.fn(),
}));
vi.mock("./offline-auth", () => ({
  saveOfflineAuthSnapshot: vi.fn(),
  clearOfflineAuthSnapshot: vi.fn(),
}));

import { ApiFailure } from "./api";
import { Login } from "./App";

const user = {
  id: 1,
  fullName: "Responsable",
  username: "responsable",
  email: null,
  role: "manager" as const,
  mustChangePassword: false,
  permissions: [],
};

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Identifiant ou e-mail"), {
    target: { value: "responsable" },
  });
  fireEvent.change(screen.getByLabelText("Mot de passe"), {
    target: { value: "secret" },
  });
  const form = screen.getByRole("button", { name: "Se connecter" }).closest("form")!;
  fireEvent.submit(form);
  return form;
}

describe("authentification navigateur", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("valide la session avec auth/me avant d’ouvrir l’application", async () => {
    const done = vi.fn();
    mocks.request
      .mockResolvedValueOnce({ user })
      .mockResolvedValueOnce({ user });
    render(<Login done={done} notice="" />);
    fillAndSubmit();
    await waitFor(() => expect(done).toHaveBeenCalledWith(user));
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      "/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.request).toHaveBeenNthCalledWith(2, "/auth/me");
  });

  it("préserve l’identifiant, efface le mot de passe et affiche un refus de cookie", async () => {
    mocks.request
      .mockResolvedValueOnce({ user })
      .mockRejectedValueOnce(
        new ApiFailure(
          { code: "UNAUTHENTICATED", message: "Session absente" },
          401,
        ),
      );
    render(<Login done={vi.fn()} notice="" />);
    fillAndSubmit();
    expect(
      await screen.findByText(/Session refusée par le navigateur/u),
    ).toBeVisible();
    expect(screen.getByLabelText("Identifiant ou e-mail")).toHaveValue(
      "responsable",
    );
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("");
  });

  it.each([
    [
      new ApiFailure(
        { code: "BAD_CREDENTIALS", message: "Identifiant ou mot de passe incorrect." },
        401,
      ),
      "Identifiant ou mot de passe incorrect.",
    ],
    [
      new ApiFailure({ code: "INTERNAL_ERROR", message: "Erreur" }, 500),
      "Erreur interne. Réessayez plus tard.",
    ],
    [
      new ApiFailure({ code: "NETWORK_ERROR", message: "Réseau" }, 0),
      "Serveur indisponible. Vérifiez votre connexion.",
    ],
  ])("affiche une erreur sûre et visible", async (failure, message) => {
    mocks.request.mockRejectedValueOnce(failure);
    render(<Login done={vi.fn()} notice="" />);
    fillAndSubmit();
    expect(await screen.findByText(message)).toBeVisible();
  });

  it("une double soumission ne crée qu’une requête de connexion", async () => {
    let resolveLogin!: (value: { user: typeof user }) => void;
    mocks.request
      .mockImplementationOnce(
        () =>
          new Promise<{ user: typeof user }>((resolve) => {
            resolveLogin = resolve;
          }),
      )
      .mockResolvedValue({ user });
    render(<Login done={vi.fn()} notice="" />);
    const form = fillAndSubmit();
    fireEvent.submit(form);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    resolveLogin({ user });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });
});
