// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SafeUser } from "@maktaba/shared-types";
import { ProductForm } from "./Phase2";
import { request } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, request: vi.fn() };
});

const admin: SafeUser = {
  id: 1,
  fullName: "Administrateur",
  username: "admin",
  email: null,
  role: "global_admin",
  mustChangePassword: false,
  permissions: ["products.create", "products.edit", "labels.print"],
};

function renderRoute(offline = false, initialEntry = "/products/new") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/products/new" element={<ProductForm user={admin} offline={offline} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("actual /products/new route", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.mocked(request).mockReset();
    vi.mocked(request).mockResolvedValue({ rows: [] } as never);
  });

  it("renders the authorized barcode and product actions", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Code-barres" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scanner" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Générer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Imprimer l’étiquette" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enregistrer le produit" })).toBeTruthy();
  });

  it("calls the atomic API once and fills the visible input", async () => {
    vi.mocked(request)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ barcode: "MKT000000123" } as never);
    renderRoute();
    const generate = screen.getByRole("button", { name: "Générer" });
    fireEvent.click(generate);
    fireEvent.click(generate);
    await waitFor(() => expect(document.querySelector("[data-scanner-input='true']")).toHaveValue("MKT000000123"));
    expect(vi.mocked(request).mock.calls.filter(([path]) => path === "/products/barcodes/generate")).toHaveLength(1);
  });

  it("keeps generation visible but disabled offline and for services", () => {
    const { unmount } = renderRoute(true);
    expect(screen.getByRole("button", { name: "Générer" })).toBeDisabled();
    expect(screen.getByText(/nécessite une connexion au serveur/)).toBeTruthy();
    unmount();
    renderRoute(false);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "service" } });
    expect(screen.getByRole("button", { name: "Générer" })).toBeDisabled();
  });
});
