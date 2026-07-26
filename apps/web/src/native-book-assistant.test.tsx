// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SafeUser } from "@maktaba/shared-types";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    request: vi.fn((path: string) =>
      Promise.resolve(
        path.startsWith("/categories")
          ? { rows: [] }
          : { rows: [], pagination: { page: 1, pageSize: 20, total: 0, pages: 0 } },
      ),
    ),
  };
});

import { NativeBookAssistantGate } from "./App";
import { ProductsPage } from "./Phase2";

const user: SafeUser = {
  id: 1,
  fullName: "Responsable",
  username: "responsable",
  email: null,
  role: "manager",
  mustChangePassword: false,
  permissions: ["products.create", "products.use_book_assistant"],
};

describe("capacité assistant livre natif", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it.each([
    ["navigateur/PWA", false],
    ["Tauri sans OCR", false],
    ["Tauri avec OCR", true],
  ])("affiche le bouton uniquement pour %s", async (_mode, available) => {
    render(
      <MemoryRouter>
        <ProductsPage
          user={user}
          nativeBookAssistantAvailable={available}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Nouveau produit" })).toBeVisible();
    if (available) {
      expect(
        screen.getByRole("link", { name: "Ajouter un livre" }),
      ).toBeVisible();
    } else {
      expect(
        screen.queryByRole("link", { name: "Ajouter un livre" }),
      ).not.toBeInTheDocument();
    }
    await waitFor(() =>
      expect(screen.queryByText("Chargement…")).not.toBeInTheDocument(),
    );
  });

  it("redirige l’accès direct sans capacité avant de rendre la page", () => {
    render(
      <MemoryRouter initialEntries={["/products/new/book-assistant"]}>
        <Routes>
          <Route
            path="/products/new/book-assistant"
            element={
              <NativeBookAssistantGate available={false} allowed>
                <p>OCR natif rendu</p>
              </NativeBookAssistantGate>
            }
          />
          <Route path="/products/new" element={<p>Création manuelle</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Création manuelle")).toBeVisible();
    expect(screen.queryByText("OCR natif rendu")).not.toBeInTheDocument();
  });

  it("autorise l’accès direct dans Tauri lorsque l’OCR est disponible", () => {
    render(
      <MemoryRouter initialEntries={["/products/new/book-assistant"]}>
        <Routes>
          <Route
            path="/products/new/book-assistant"
            element={
              <NativeBookAssistantGate available allowed>
                <p>OCR natif rendu</p>
              </NativeBookAssistantGate>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("OCR natif rendu")).toBeVisible();
  });
});
