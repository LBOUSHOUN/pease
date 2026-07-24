// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JsBarcode from "jsbarcode";
import { LabelBarcode, ProductLabel, isValidEan13, labelBarcodeFormat } from "./Phase5";
import { request } from "./api";

vi.mock("jsbarcode", () => ({
  default: vi.fn((element: SVGSVGElement, code: string, options: { format: string }) => {
    element.setAttribute("data-encoded-value", code);
    element.setAttribute("data-barcode-format", options.format);
    element.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
  }),
}));
vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, request: vi.fn() };
});

const product = {
  id: 7,
  name: "Calculatrice scientifique",
  manufacturerBarcode: null,
  internalBarcode: "MKT000000123",
  sellingPriceCents: 123450,
};
const settings = { shopName: "Double Library", labelSize: "40x30" };

function renderRoute() {
  return render(<MemoryRouter initialEntries={["/products/7/label"]}>
    <Routes><Route path="/products/:id/label" element={<ProductLabel />} /></Routes>
  </MemoryRouter>);
}

describe("actual product label route", () => {
  beforeEach(() => {
    vi.mocked(JsBarcode).mockClear();
    vi.mocked(request)
      .mockResolvedValueOnce(product as never)
      .mockResolvedValueOnce(settings as never);
  });
  afterEach(cleanup);

  it("selects EAN13 only for a valid checksum and CODE128 otherwise", () => {
    expect(isValidEan13("6111273780040")).toBe(true);
    expect(labelBarcodeFormat("6111273780040")).toBe("EAN13");
    expect(labelBarcodeFormat("6111273780041")).toBe("CODE128");
    expect(labelBarcodeFormat("MKT000000123")).toBe("CODE128");
  });

  it("renders the corrected route as a linear SVG with the exact visible value", async () => {
    renderRoute();
    const barcode = await screen.findByRole("img", { name: "Code-barres MKT000000123" });
    expect(barcode.tagName.toLowerCase()).toBe("svg");
    expect(screen.getByText("MKT000000123")).toBeTruthy();
    expect(document.querySelector(".product-label img")).toBeNull();
  });

  it("reuses the same linear barcode for A4 and every requested copy", async () => {
    renderRoute();
    await screen.findByRole("img");
    fireEvent.change(screen.getByLabelText("Format d'impression"), { target: { value: "a4" } });
    fireEvent.change(screen.getByLabelText(/Quantit/), { target: { value: "6" } });
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(6));
    expect(document.querySelector(".label-format-a4")).toBeTruthy();
    for (const barcode of screen.getAllByRole("img")) {
      expect(barcode.tagName.toLowerCase()).toBe("svg");
    }
  });

  it("shows the French error instead of falling back to QR", () => {
    vi.mocked(JsBarcode).mockImplementationOnce(() => { throw new Error("invalid"); });
    render(<LabelBarcode code="MKT000000123" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Le code-barres ne peut pas être généré.");
    expect(document.querySelector("img")).toBeNull();
  });
});
