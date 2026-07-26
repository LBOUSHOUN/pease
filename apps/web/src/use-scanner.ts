import { useEffect, useRef } from "react";
import { isEditable, ScannerBuffer, type ScannerOptions } from "./scanner";
export function useScanner(
  callback: (code: string) => void,
  options?: ScannerOptions,
) {
  const current = useRef(callback);
  current.current = callback;
  const maxIntervalMs = options?.maxIntervalMs,
    minLength = options?.minLength,
    duplicateWindowMs = options?.duplicateWindowMs;
  useEffect(() => {
    const buffer = new ScannerBuffer((code) => current.current(code), {
        maxIntervalMs,
        minLength,
        duplicateWindowMs,
      }),
      listener = (event: KeyboardEvent) => {
        const dedicated =
          event.target instanceof Element &&
          Boolean(event.target.closest("[data-barcode-input='true']"));
        if (isEditable(event.target) && !dedicated) return;
        buffer.key(event.key, event.timeStamp, () => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const focused = document.activeElement;
          if (
            focused instanceof HTMLElement &&
            focused.matches("a[href],button,[role='button']")
          ) {
            focused.blur();
          }
        });
      };
    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, [duplicateWindowMs, maxIntervalMs, minLength]);
}
