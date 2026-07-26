// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import BookCoverCamera from "./BookCoverCamera";

describe("caméra de couverture", () => {
  afterEach(cleanup);

  it("arrête toutes les pistes après capture", async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 1200,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["photo"], { type: "image/jpeg" })),
    );
    const captured = vi.fn();
    const close = vi.fn();
    render(<BookCoverCamera close={close} captured={captured} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Prendre la photo" }));

    expect(captured).toHaveBeenCalledOnce();
    expect(captured.mock.calls[0]![0]).toBeInstanceOf(File);
    expect(stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
