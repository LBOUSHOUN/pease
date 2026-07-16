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
        if (isEditable(event.target)) return;
        buffer.key(event.key, event.timeStamp);
      };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [duplicateWindowMs, maxIntervalMs, minLength]);
}
