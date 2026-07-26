import { useEffect, useRef } from "react";
import type { ScanSource } from "./global-scanner";

export type ScannerContextPriority = "fallback" | "page" | "field" | "modal";
export type ScannerContextResult = { code: string; source: ScanSource };
type Registration = {
  priority: number;
  active: () => boolean;
  handle: (scan: ScannerContextResult) => void | Promise<void>;
};
const priorities: Record<ScannerContextPriority, number> = {
  fallback: 100,
  page: 200,
  field: 300,
  modal: 400,
};

export class ScannerContextRegistry {
  private registrations = new Map<string, Registration>();
  private dispatching = false;
  register(
    id: string,
    priority: ScannerContextPriority,
    active: () => boolean,
    handle: Registration["handle"],
  ) {
    this.registrations.set(id, { priority: priorities[priority], active, handle });
    return () => {
      this.registrations.delete(id);
    };
  }
  async dispatch(scan: ScannerContextResult) {
    if (this.dispatching) return false;
    const target = [...this.registrations.values()]
      .filter((entry) => entry.active())
      .sort((a, b) => b.priority - a.priority)[0];
    if (!target) return false;
    this.dispatching = true;
    try {
      await target.handle(scan);
      return true;
    } finally {
      this.dispatching = false;
    }
  }
}
export const scannerContexts = new ScannerContextRegistry();

export function useScannerContext(
  id: string,
  priority: ScannerContextPriority,
  handle: Registration["handle"],
  active = true,
) {
  const handlerRef = useRef(handle);
  const activeRef = useRef(active);
  handlerRef.current = handle;
  activeRef.current = active;
  useEffect(
    () =>
      scannerContexts.register(
        id,
        priority,
        () => activeRef.current,
        (scan) => handlerRef.current(scan),
      ),
    [id, priority],
  );
}
