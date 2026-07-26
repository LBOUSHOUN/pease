export type ScannerOptions = {
  maxIntervalMs?: number;
  minLength?: number;
  duplicateWindowMs?: number;
};
export const normalizeScannedCode = (value: string) =>
  value
    .trim()
    .replace(/^(?:(?:ØŒ)|[,\u060C;])+|(?:(?:ØŒ)|[,\u060C;])+$/g, "");

export class ScannerBuffer {
  private value = "";
  private last = 0;
  private lastCode = "";
  private emittedAt = 0;
  constructor(
    private emit: (code: string) => void,
    private options: ScannerOptions = {},
  ) {}
  key(key: string, time = Date.now(), beforeEmit?: () => void) {
    const max = this.options.maxIntervalMs ?? 80,
      min = this.options.minLength ?? 3,
      duplicate = this.options.duplicateWindowMs ?? 750;
    if (key === "Enter") {
      const code = normalizeScannedCode(this.value);
      this.value = "";
      if (code.length >= min) {
        beforeEmit?.();
        if (code === this.lastCode && time - this.emittedAt < duplicate)
          return true;
        this.lastCode = code;
        this.emittedAt = time;
        this.emit(code);
        return true;
      }
      return false;
    }
    if (key.length !== 1) return false;
    if (this.last && time - this.last > max) this.value = "";
    this.value += key;
    this.last = time;
    return false;
  }
}
export const isEditable = (target: EventTarget | null) => {
  if (!target || typeof target !== "object" || !("matches" in target))
    return false;
  const element = target as EventTarget & {
    matches: (selector: string) => boolean;
    closest?: (selector: string) => Element | null;
    isContentEditable?: boolean;
  };
  return (
    element.matches("input,textarea,select,[contenteditable='true']") ||
    Boolean(element.closest?.("dialog form,[role='dialog'] form")) ||
    element.isContentEditable === true
  );
};
