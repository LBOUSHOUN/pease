// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { BarcodeInput } from "./BarcodeInput";
import { scannerContexts } from "./scanner-context";

function Harness({ onScan = vi.fn() }: { onScan?: (code: string) => void }) {
  const [value, setValue] = useState("");
  return <BarcodeInput value={value} onChange={setValue} onScan={onScan}
    mode="capture" allowCamera={false} />;
}
describe("BarcodeInput", () => {
  afterEach(cleanup);
  it("captures a scanner value as text without submitting or navigating", async () => {
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    const input = screen.getByLabelText("Code-barres");
    fireEvent.focus(input);
    await act(async () => {
      await scannerContexts.dispatch({ code: "00123ABC", source: "usb" });
    });
    expect(input).toHaveValue("00123ABC");
    expect(onScan).toHaveBeenCalledWith("00123ABC");
    expect(screen.getByText("Code-barres renseigné.")).toBeInTheDocument();
  });
  it("keeps manual editing available", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Code-barres");
    fireEvent.change(input, { target: { value: "0007XZ" } });
    expect(input).toHaveValue("0007XZ");
  });
});
