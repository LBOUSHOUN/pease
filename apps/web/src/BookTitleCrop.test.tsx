// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import BookTitleCrop from "./BookTitleCrop";

describe("recadrage local du titre", () => {
  afterEach(() => vi.restoreAllMocks());

  it("produit uniquement les octets de la zone sélectionnée et peut être réinitialisé", async () => {
    const cropped = vi.fn();
    const reset = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["crop"], { type: "image/png" }));
    });
    const { container, unmount } = render(
      <BookTitleCrop imageUrl="blob:original" onCrop={cropped} onReset={reset} />,
    );
    const image = screen.getByAltText("Couverture à recadrer");
    Object.defineProperties(image, {
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 1600 },
    });
    const stage = container.querySelector(".book-title-crop-stage") as HTMLDivElement;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 800,
      right: 500,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    stage.setPointerCapture = vi.fn();
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 50, clientY: 80 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 450, clientY: 240 });
    fireEvent.pointerUp(stage, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Lire cette zone" }));
    await waitFor(() => expect(cropped).toHaveBeenCalledOnce());
    expect(cropped.mock.calls[0][0]).toMatchObject({
      name: "title-region.png",
      type: "image/png",
    });
    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser la zone" }));
    expect(reset).toHaveBeenCalledOnce();
    unmount();
    expect(reset).toHaveBeenCalledTimes(2);
  });
});
