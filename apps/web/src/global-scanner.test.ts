import { describe, expect, it, vi } from "vitest";
import {
  hasBlockingScannerContext,
  OrderedScanQueue,
  type QueuedScan,
} from "./global-scanner";
import { ScannerBuffer, isEditable } from "./scanner";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("global barcode scanning", () => {
  it("emits one scan for fast keyboard-wedge input", () => {
    const emit = vi.fn(), buffer = new ScannerBuffer(emit, { duplicateWindowMs: 0 });
    [..."6111234567890"].forEach((key, index) => buffer.key(key, 100 + index * 15));
    buffer.key("Enter", 310);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("6111234567890");
  });

  it("does not interpret slow human typing as a scan", () => {
    const emit = vi.fn(), buffer = new ScannerBuffer(emit);
    [..."611123"].forEach((key, index) => buffer.key(key, 100 + index * 150));
    buffer.key("Enter", 1000);
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not capture normal form fields", () => {
    const target = { matches: (selector: string) => selector.includes("input"), closest: () => null } as unknown as EventTarget;
    expect(isEditable(target)).toBe(true);
  });

  it("preserves a scan until the POS handler mounts", async () => {
    const queue = new OrderedScanQueue(), received: string[] = [];
    queue.enqueue("MKT-001");
    expect(queue.size()).toBe(1);
    queue.register(async ({ barcode }) => { received.push(barcode); });
    await flush();
    expect(received).toEqual(["MKT-001"]);
  });

  it("processes rapid A, B, A scans strictly in order", async () => {
    const queue = new OrderedScanQueue(), received: string[] = [];
    queue.register(async ({ barcode }) => {
      await Promise.resolve();
      received.push(barcode);
    });
    queue.enqueue("AAA");
    queue.enqueue("BBB");
    queue.enqueue("AAA");
    await flush();
    expect(received).toEqual(["AAA", "BBB", "AAA"]);
  });

  it("routes camera and USB input through the same queue", async () => {
    const queue = new OrderedScanQueue(), received: QueuedScan[] = [];
    queue.register(async (scan) => { received.push(scan); });
    queue.enqueue("USB-1", "usb");
    queue.enqueue("CAM-1", "camera");
    await flush();
    expect(received.map((scan) => scan.source)).toEqual(["usb", "camera"]);
  });

  it("recognizes blocking dialogs and unsaved forms", () => {
    const blocked = { querySelector: vi.fn().mockReturnValue({}) } as unknown as Document;
    const clear = { querySelector: vi.fn().mockReturnValue(null) } as unknown as Document;
    expect(hasBlockingScannerContext(blocked)).toBe(true);
    expect(hasBlockingScannerContext(clear)).toBe(false);
  });
});
