import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "./api";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
  isTauri: () => bridge.desktop,
}));

import {
  estimatedStock,
  findCachedSerializedUnit,
  reserveCachedSerializedUnit,
  releaseCachedSerializedUnits,
  queueOfflineSale,
  syncPendingOfflineSales,
  type OfflineSalePayload,
  type OfflineSaleRecord,
} from "./offline-pos";

const payload: OfflineSalePayload = {
  schemaVersion: 1,
  customerId: null,
  items: [{ productId: 42, quantity: 2, cachedUnitPriceCents: 500 }],
  paymentMode: "cash",
  cashPaidCents: 0,
  idempotencyKey: "stable-offline-key",
  clientTimestamp: "2026-01-01T00:00:00.000Z",
  registerIdSnapshot: 7,
  userSnapshot: { id: 3, fullName: "Caissier", role: "cashier" },
};

const record: OfflineSaleRecord = {
  id: "offline-1",
  operationType: "cash_sale",
  idempotencyKey: payload.idempotencyKey,
  payload,
  createdAt: payload.clientTimestamp,
  updatedAt: payload.clientTimestamp,
  status: "pending",
  attemptCount: 0,
};

describe("offline POS desktop boundary", () => {
  beforeEach(() => {
    bridge.desktop = true;
    bridge.invoke.mockReset();
  });

  it("never invokes SQLite from browser mode", async () => {
    bridge.desktop = false;
    await expect(queueOfflineSale(payload)).rejects.toThrow("uniquement");
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("persists the stable idempotency key with the sale", async () => {
    bridge.invoke.mockResolvedValue({ id: "offline-1" });
    await expect(queueOfflineSale(payload)).resolves.toBe("offline-1");
    expect(bridge.invoke).toHaveBeenCalledWith("queue_offline_sale", {
      payloadJson: JSON.stringify(payload),
      idempotencyKey: "stable-offline-key",
      reservationId: null,
    });
  });

  it("keeps serialized SQLite commands behind the Tauri boundary", async () => {
    bridge.desktop = false;
    await expect(findCachedSerializedUnit("6111")).resolves.toBeUndefined();
    await expect(releaseCachedSerializedUnits("cart-1")).resolves.toBeUndefined();
    await expect(reserveCachedSerializedUnit("6111", "cart-1")).rejects.toThrow("bureau");
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("looks up, reserves and releases an exact cached unit", async () => {
    bridge.invoke.mockResolvedValueOnce({ id: 9, barcode: "6111" }).mockResolvedValueOnce({ id: 9, barcode: "6111" }).mockResolvedValueOnce(undefined);
    await expect(findCachedSerializedUnit("6111")).resolves.toMatchObject({ id: 9 });
    await expect(reserveCachedSerializedUnit("6111", "cart-1")).resolves.toMatchObject({ barcode: "6111" });
    await releaseCachedSerializedUnits("cart-1", "6111");
    expect(bridge.invoke).toHaveBeenLastCalledWith("release_cached_serialized_unit", { reservationId: "cart-1", code: "6111" });
  });

  it("uses ordered transitions and the Idempotency-Key header", async () => {
    bridge.invoke.mockImplementation((command: string) =>
      command === "list_offline_queue" ? Promise.resolve([record]) : Promise.resolve(),
    );
    const send = vi.fn().mockResolvedValue({ id: 91 });
    await syncPendingOfflineSales(send as never);
    expect(send).toHaveBeenCalledWith(
      "/sales",
      expect.objectContaining({ headers: { "Idempotency-Key": "stable-offline-key" } }),
    );
    expect(bridge.invoke).toHaveBeenNthCalledWith(
      2,
      "transition_offline_sale",
      expect.objectContaining({ id: "offline-1", status: "syncing" }),
    );
    expect(bridge.invoke).toHaveBeenNthCalledWith(
      3,
      "transition_offline_sale",
      expect.objectContaining({ status: "synced", serverEntityId: 91 }),
    );
  });

  it("does not synchronize another user's pending financial operations", async () => {
    bridge.invoke.mockImplementation((command: string) =>
      command === "list_offline_queue" ? Promise.resolve([record]) : Promise.resolve(),
    );
    const send = vi.fn();
    await syncPendingOfflineSales(send as never, record.payload.userSnapshot.id + 1);
    expect(send).not.toHaveBeenCalled();
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404, 409])("rejects an HTTP %s conflict", async (status) => {
    bridge.invoke.mockImplementation((command: string) =>
      command === "list_offline_queue" ? Promise.resolve([record]) : Promise.resolve(),
    );
    const failure = new ApiFailure({ code: "CONFLICT", message: "Conflit" }, status);
    await syncPendingOfflineSales(vi.fn().mockRejectedValue(failure) as never);
    expect(bridge.invoke).toHaveBeenLastCalledWith(
      "transition_offline_sale",
      expect.objectContaining({ status: "rejected", lastStatusCode: status }),
    );
  });

  it.each([0, 401, 500])("returns HTTP %s/network failures to pending", async (status) => {
    bridge.invoke.mockImplementation((command: string) =>
      command === "list_offline_queue" ? Promise.resolve([record]) : Promise.resolve(),
    );
    const failure = new ApiFailure({ code: "FAILED", message: "Indisponible" }, status);
    await syncPendingOfflineSales(vi.fn().mockRejectedValue(failure) as never);
    expect(bridge.invoke).toHaveBeenLastCalledWith(
      "transition_offline_sale",
      expect.objectContaining({ status: "pending", lastStatusCode: status }),
    );
  });

  it("subtracts only pending and syncing quantities from cached stock", () => {
    const product = {
      id: 42, categoryId: null, categoryName: null, name: "Cahier", productType: "physical_product" as const,
      sku: null, internalBarcode: "42", sellingPriceCents: 500, currentStock: 10, minimumStock: 2,
      unit: "unité", shelfLocation: null, isActive: true, trackStock: true, isLowStock: false, isOutOfStock: false,
    };
    expect(estimatedStock([product], [record])[0]?.currentStock).toBe(8);
    expect(estimatedStock([product], [{ ...record, status: "rejected" }])[0]?.currentStock).toBe(10);
    expect(estimatedStock([product], [{ ...record, status: "synced" }])[0]?.currentStock).toBe(10);
  });
});
