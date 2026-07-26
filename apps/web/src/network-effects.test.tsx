// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, request: api.request };
});

import Dashboard from "./Dashboard";
import { StockPage } from "./Phase2";
import { CustomersPage } from "./Phase3";

const user = {
  id: 1,
  fullName: "Gérante",
  username: "gerante",
  email: null,
  role: "manager" as const,
  mustChangePassword: false,
  permissions: ["stock.view", "customers.view"],
};
const dashboard = {
  salesTodayCents: 1000,
  returnsTodayCents: 0,
  netSalesTodayCents: 1000,
  estimatedProfitTodayCents: null,
  customerDebtCents: 0,
  supplierDebtCents: 0,
  expensesTodayCents: 0,
  lowStockCount: 0,
  outOfStockCount: 0,
  openRegisters: 0,
  recentSales: [],
};
const list = { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 1 };

beforeEach(() => api.request.mockReset());
afterEach(cleanup);

describe("stale network effects", () => {
  it("keeps dashboard data when the secondary request is cancelled", async () => {
    api.request.mockImplementation((path: string) => {
      if (path === "/reports/dashboard") return Promise.resolve(dashboard);
      if (String(path).startsWith("/reports/top-products"))
        return Promise.reject(
          new DOMException("operation cancelled", "AbortError"),
        );
      return Promise.resolve(list);
    });
    render(<MemoryRouter><Dashboard user={user} /></MemoryRouter>);
    expect((await screen.findAllByText("10.00 MAD")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Tableau de bord indisponible")).toBeNull();
    expect(screen.queryByText("operation cancelled")).toBeNull();
  });

  it("ignores the first StrictMode cancellation and renders the latest success", async () => {
    let mainCall = 0;
    api.request.mockImplementation((path: string) => {
      if (path !== "/reports/dashboard")
        return Promise.resolve({ rows: [], period: "30d" });
      mainCall += 1;
      return mainCall === 1
        ? Promise.reject(new Error("signal is aborted without reason"))
        : Promise.resolve(dashboard);
    });
    render(<StrictMode><MemoryRouter><Dashboard user={user} /></MemoryRouter></StrictMode>);
    expect((await screen.findAllByText("10.00 MAD")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Impossible de joindre le serveur")).toBeNull();
  });

  it("shows unavailable only for the latest real dashboard failure", async () => {
    api.request.mockImplementation((path: string) =>
      path === "/reports/dashboard"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ rows: [], period: "30d" }),
    );
    render(<MemoryRouter><Dashboard user={user} /></MemoryRouter>);
    expect(await screen.findByText("Tableau de bord indisponible")).toBeInTheDocument();
  });

  it("clears an old Stock error after a successful empty response", async () => {
    let stockCalls = 0;
    api.request.mockImplementation((path: string) => {
      if (String(path ?? "").startsWith("/categories")) return Promise.resolve(list);
      stockCalls += 1;
      return stockCalls === 1
        ? Promise.reject(new TypeError("Impossible de joindre le serveur."))
        : Promise.resolve(list);
    });
    render(<MemoryRouter><StockPage user={user} /></MemoryRouter>);
    expect(await screen.findByText("Impossible de joindre le serveur.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("État"), { target: { value: "active" } });
    expect(await screen.findByText("Aucun produit en stock.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Impossible de joindre le serveur.")).toBeNull(),
    );
  });

  it("clears an old Clients error after a successful empty response", async () => {
    api.request
      .mockRejectedValueOnce(new TypeError("Impossible de joindre le serveur."))
      .mockResolvedValueOnce(list);
    render(<MemoryRouter><CustomersPage user={user} /></MemoryRouter>);
    expect(await screen.findByText("Impossible de joindre le serveur.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });
    expect(await screen.findByText("Aucun client.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Impossible de joindre le serveur.")).toBeNull(),
    );
  });
});
