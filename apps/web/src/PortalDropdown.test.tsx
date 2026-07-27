// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PortalDropdown } from "./PortalDropdown";

const rect = (values: Partial<DOMRect>): DOMRect =>
  ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
    ...values,
  }) as DOMRect;

function Example() {
  return (
    <PortalDropdown label="Actions">
      {(close) => (
        <>
          <button role="menuitem" tabIndex={-1} onClick={close}>Voir</button>
          <button role="menuitem" tabIndex={-1} onClick={close}>Modifier</button>
        </>
      )}
    </PortalDropdown>
  );
}

describe("portal dropdown", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(window, "innerWidth", { value: 320, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 240, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "menu"
          ? rect({ width: 220, height: 150 })
          : rect({ left: 270, right: 318, top: 200, bottom: 232, width: 48, height: 32 });
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the last-row menu upward, inside the viewport and above pagination", () => {
    render(<><Example /><div data-testid="pagination" /></>);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveStyle({ top: "46px", left: "92px" });
    expect(menu).toHaveClass("action-menu-portal");
  });

  it("closes outside and on Escape, then restores trigger focus", () => {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation, closes after selection and repositions on resize and scroll", () => {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    const before = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    fireEvent(window, new Event("resize"));
    fireEvent.scroll(window);
    expect(
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length,
    ).toBeGreaterThan(before);
    fireEvent.click(items[1]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
