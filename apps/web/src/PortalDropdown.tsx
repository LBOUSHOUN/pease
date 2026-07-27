import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_GAP = 8;

type Position = { left: number; top: number; visibility: "hidden" | "visible" };

export function PortalDropdown({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({
    left: VIEWPORT_GAP,
    top: VIEWPORT_GAP,
    visibility: "hidden",
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusFirstOnOpen = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const menu = panel.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom - VIEWPORT_GAP;
    const above = anchor.top - VIEWPORT_GAP;
    const top =
      below >= menu.height || below >= above
        ? Math.min(anchor.bottom + 4, window.innerHeight - menu.height - VIEWPORT_GAP)
        : Math.max(VIEWPORT_GAP, anchor.top - menu.height - 4);
    const left = Math.min(
      Math.max(VIEWPORT_GAP, anchor.right - menu.width),
      Math.max(VIEWPORT_GAP, window.innerWidth - menu.width - VIEWPORT_GAP),
    );
    setPosition({ left, top, visibility: "visible" });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      reposition();
      if (focusFirstOnOpen.current) {
        focusFirstOnOpen.current = false;
        panelRef.current
          ?.querySelector<HTMLElement>('[role="menuitem"]')
          ?.focus();
      }
    }
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      )
        close();
    };
    const update = () => reposition();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [close, open, reposition]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next !== undefined && items[next]) {
      event.preventDefault();
      items[next].focus();
    }
  };

  return (
    <span className="action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="secondary action-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            focusFirstOnOpen.current = true;
            setOpen(true);
          }
        }}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="action-menu-panel action-menu-portal"
            role="menu"
            style={position}
            onKeyDown={onKeyDown}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </span>
  );
}
