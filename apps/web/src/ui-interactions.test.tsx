// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SafeUser } from "@maktaba/shared-types";
import BookAssistant from "./BookAssistant";
import CameraScanner from "./CameraScanner";
import { request } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, request: vi.fn() };
});

const user: SafeUser = {
  id: 1,
  fullName: "Responsable",
  username: "manager",
  email: null,
  role: "manager",
  mustChangePassword: false,
  permissions: ["products.use_book_assistant"],
};

describe("interactions accessibles", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(request).mockReset();
    vi.mocked(request).mockResolvedValue({ rows: [] } as never);
  });

  it("ferme le scanner avec Échap et rend le focus au déclencheur", () => {
    const close = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<CameraScanner onScan={vi.fn()} close={close} />);

    expect(screen.getByRole("button", { name: "Fermer" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("supprime et révoque explicitement la photo temporaire", async () => {
    const createObjectURL = vi.fn(() => "blob:couverture");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: vi.fn(async () => ({ width: 600, height: 900, close: vi.fn() })),
    });

    render(<MemoryRouter><BookAssistant user={user} /></MemoryRouter>);
    const image = new File(["image"], "livre.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Importer une image"), {
      target: { files: [image] },
    });

    expect(await screen.findByAltText("Aperçu local de la couverture")).toHaveAttribute(
      "src",
      "blob:couverture",
    );
    expect(screen.getByText(/Elle ne sera ni envoyée ni enregistrée/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Effacer la photo" }));
    await waitFor(() =>
      expect(screen.queryByAltText("Aperçu local de la couverture")).not.toBeInTheDocument(),
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:couverture");
  });
});
