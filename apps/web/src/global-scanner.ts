export type ScanSource = "usb" | "camera";
export type QueuedScan = { barcode: string; source: ScanSource };
export type ScanHandler = (scan: QueuedScan) => Promise<void>;

export class OrderedScanQueue {
  private pending: QueuedScan[] = [];
  private handler?: ScanHandler;
  private draining = false;

  enqueue(barcode: string, source: ScanSource = "usb") {
    const normalized = barcode.trim();
    if (normalized.length < 3) return false;
    this.pending.push({ barcode: normalized, source });
    void this.drain();
    return true;
  }

  register(handler: ScanHandler) {
    this.handler = handler;
    void this.drain();
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  size() {
    return this.pending.length;
  }

  private async drain() {
    if (this.draining || !this.handler) return;
    this.draining = true;
    try {
      while (this.pending.length) {
        const handler = this.handler;
        if (!handler) break;
        await handler(this.pending.shift()!);
      }
    } finally {
      this.draining = false;
      if (this.pending.length) void this.drain();
    }
  }
}

export const globalScanQueue = new OrderedScanQueue();
export const enqueueGlobalScan = (barcode: string, source: ScanSource = "usb") =>
  globalScanQueue.enqueue(barcode, source);
export const hasBlockingScannerContext = (root: Document = document) =>
  Boolean(root.querySelector('dialog[open],[role="dialog"],main form,form[data-unsaved="true"],[data-scanner-blocking="true"]'));
