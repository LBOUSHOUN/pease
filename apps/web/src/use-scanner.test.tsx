// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { queueScanForPos } from "./global-scanner";
import { useScanner } from "./use-scanner";

function Harness({
  scan,
  duplicateWindowMs = 0,
}: {
  scan: (code: string) => void;
  duplicateWindowMs?: number;
}) {
  useScanner(scan, { minLength: 3, maxIntervalMs: 80, duplicateWindowMs });
  return null;
}

function NavigationHarness({ enqueue }: { enqueue: (code: string) => boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  useScanner((code) =>
    queueScanForPos(code, location.pathname, navigate, enqueue),
  );
  return (
    <>
      <Link to="/">Tableau de bord</Link>
      <Link to="/stock">Stock</Link>
      <output aria-label="route">{location.pathname}</output>
    </>
  );
}

function key(target: EventTarget, value: string, timeStamp: number) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
  return event;
}

function scan(target: EventTarget, barcode = "611000001") {
  let time = 100;
  for (const character of barcode) key(target, character, time += 10);
  return key(target, "Enter", time + 10);
}

describe("hardware scanner Enter interception", () => {
  afterEach(cleanup);

  it("annule Enter avant qu’un bouton focalisé puisse agir et émet une seule fois", () => {
    const onScan = vi.fn();
    const action = vi.fn();
    const button = document.createElement("button");
    button.textContent = "Action destructive";
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.defaultPrevented) action();
    });
    document.body.appendChild(button);
    button.focus();
    render(<Harness scan={onScan} />);

    const enter = scan(button);

    expect(enter.defaultPrevented).toBe(true);
    expect(action).not.toHaveBeenCalled();
    expect(onScan).toHaveBeenCalledOnce();
    expect(onScan).toHaveBeenCalledWith("611000001");
    expect(button).not.toHaveFocus();
    button.remove();
  });

  it("ne supprime pas Enter lorsque le buffer est vide ou trop court", () => {
    const onScan = vi.fn();
    const action = vi.fn();
    const button = document.createElement("button");
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.defaultPrevented) action();
    });
    document.body.appendChild(button);
    button.focus();
    render(<Harness scan={onScan} />);

    expect(key(button, "Enter", 100).defaultPrevented).toBe(false);
    expect(action).toHaveBeenCalledOnce();
    key(button, "1", 110);
    key(button, "2", 120);
    expect(key(button, "Enter", 130).defaultPrevented).toBe(false);
    expect(action).toHaveBeenCalledTimes(2);
    expect(onScan).not.toHaveBeenCalled();
    button.remove();
  });

  it("laisse la saisie et Enter fonctionner normalement dans un champ éditable", () => {
    const onScan = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    render(<Harness scan={onScan} />);

    const enter = scan(input);

    expect(enter.defaultPrevented).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
    input.remove();
  });

  it.each(["Tableau de bord", "Stock"])(
    "reste sur /pos après un scan avec le lien %s focalisé",
    async (label) => {
      const enqueue = vi.fn(() => true);
      render(
        <MemoryRouter initialEntries={["/products"]}>
          <NavigationHarness enqueue={enqueue} />
        </MemoryRouter>,
      );
      const link = screen.getByRole("link", { name: label });
      link.focus();

      const enter = scan(link);

      expect(enter.defaultPrevented).toBe(true);
      await waitFor(() =>
        expect(screen.getByLabelText("route")).toHaveTextContent("/pos"),
      );
      expect(enqueue).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledWith("611000001");
    },
  );

  it.each(["Déconnexion", "Supprimer"])(
    "n’active pas le bouton %s après un scan",
    (label) => {
      const onScan = vi.fn();
      const action = vi.fn();
      render(<Harness scan={onScan} />);
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.defaultPrevented) action();
      });
      document.body.appendChild(button);
      button.focus();

      scan(button);

      expect(action).not.toHaveBeenCalled();
      expect(onScan).toHaveBeenCalledOnce();
      button.remove();
    },
  );

  it("neutralise aussi Enter pour un doublon ultra-rapide sans émettre deux fois", () => {
    const onScan = vi.fn();
    const button = document.createElement("button");
    document.body.appendChild(button);
    render(<Harness scan={onScan} duplicateWindowMs={750} />);

    const first = scan(button, "611000001");
    const duplicate = scan(button, "611000001");

    expect(first.defaultPrevented).toBe(true);
    expect(duplicate.defaultPrevented).toBe(true);
    expect(onScan).toHaveBeenCalledOnce();
    button.remove();
  });
});
