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
      expect.objectContaining({
        method: "POST",
        json: { login: "responsable", password: "secret" },
      }),
    );
    expect(mocks.request).toHaveBeenNthCalledWith(2, "/auth/me");
  });

  it("préserve l’identifiant, efface le mot de passe et signale l’échec de confirmation", async () => {
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
      await screen.findByText(
        "La connexion a réussi, mais la session n’a pas pu être confirmée.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Identifiant ou e-mail")).toHaveValue(
      "responsable",
    );
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("");
  });

  it.each([
    [
      new ApiFailure(
        { code: "INVALID_CREDENTIALS", message: "Réponse masquée" },
        401,
      ),
      "Identifiant ou mot de passe incorrect.",
    ],
    [
      new ApiFailure({ code: "ACCOUNT_DISABLED", message: "Réponse masquée" }, 401),
      "Ce compte est désactivé.",
    ],
    [
      new ApiFailure({ code: "FORBIDDEN", message: "Réponse masquée" }, 403),
      "Vous n’êtes pas autorisé à accéder à cette application.",
    ],
    [
      new ApiFailure({ code: "TOO_MANY_ATTEMPTS", message: "Réponse masquée" }, 429),
      "Trop de tentatives. Réessayez dans quelques minutes.",
    ],
    [
      new ApiFailure({ code: "INTERNAL_ERROR", message: "Erreur" }, 500),
      "Une erreur interne empêche la connexion.",
    ],
    [
      new ApiFailure({ code: "NETWORK_ERROR", message: "Réseau" }, 0),
      "Impossible de contacter le serveur.",
    ],
    [new TypeError("Failed to fetch"), "Impossible de contacter le serveur."],
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

  it("n’écrit jamais le mot de passe dans les journaux", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.request.mockRejectedValueOnce(
      new ApiFailure({ code: "INVALID_CREDENTIALS", message: "Refus" }, 401),
    );
    render(<Login done={vi.fn()} notice="" />);
    fillAndSubmit();
    await screen.findByText("Identifiant ou mot de passe incorrect.");
    expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]))
      .not.toContain("secret");
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
