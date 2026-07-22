import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ProductListRow, SafeUser } from "@maktaba/shared-types";
import { ApiFailure, request } from "./api";

export type ConnectionState = "checking" | "online" | "offline";
export type OfflineSalePayload = {
  schemaVersion: 1;
  customerId: null;
  items: Array<{
    productId: number;
    quantity: number;
    cachedUnitPriceCents: number;
    unitBarcodes?: string[];
    serializedUnits?: Array<{ id: number; barcode: string }>;
  }>;
  paymentMode: "cash";
  cashPaidCents: 0;
  idempotencyKey: string;
  clientTimestamp: string;
  registerIdSnapshot: number;
  userSnapshot: Pick<SafeUser, "id" | "fullName" | "role">;
};

export type OfflineSaleRecord = {
  id: string;
  operationType: "cash_sale";
  idempotencyKey: string;
  payload: OfflineSalePayload;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "syncing" | "synced" | "rejected";
  attemptCount: number;
  lastError?: string | null;
  lastStatusCode?: number | null;
  serverEntityId?: number | null;
  syncedAt?: string | null;
};

export type OfflineQueueSummary = {
  pendingCount: number;
  syncingCount: number;
  syncedCount: number;
  rejectedCount: number;
};

export type CacheRefreshInput = {
  categories: unknown[];
  products: ProductListRow[];
  serializedUnits?: CachedSerializedUnit[];
  settings: unknown;
  register: { isOpen: boolean; sessionId?: number };
};
export type OfflineCacheStatus = {
  productCount: number;
  serializedUnitCount: number;
  availableSerializedUnitCount: number;
  pendingSerializedUnitCount: number;
  lastRefreshAt?: string | null;
  register?: { isOpen: boolean; sessionId?: number } | null;
};
export type CachedSerializedUnit = {
  id: number;
  barcode: string;
  productId: number;
  productName: string;
  sellingPriceCents: number;
  productActive: boolean;
  status: "available" | "sold" | "damaged" | "lost" | "inactive";
  reservationId?: string | null;
  updatedAt: string;
};

let syncInFlight: Promise<void> | null = null;

export function isTauriRuntime(): boolean {
  return isTauri();
}

export async function checkConnection(timeoutMs = 3_500): Promise<ConnectionState> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await request<{ status: string }>("/health", { signal: controller.signal, cache: "no-store", skipDesktopAuth: true });
    return "online";
  } catch (error) {
    if (error instanceof ApiFailure && error.status > 0) return "online";
    return "offline";
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function replaceOfflineCache(input: CacheRefreshInput) {
  if (!isTauriRuntime()) return undefined;
  return invoke<{ productCount: number; lastRefreshAt: string }>("replace_offline_cache", {
    categoriesJson: JSON.stringify(input.categories),
    productsJson: JSON.stringify(input.products),
    serializedUnitsJson: JSON.stringify(input.serializedUnits ?? []),
    settingsJson: JSON.stringify(input.settings),
    registerJson: JSON.stringify(input.register),
  });
}

export async function refreshOfflineCache(register: { isOpen: boolean; sessionId?: number }) {
  if (!isTauriRuntime()) return undefined;
  const [categoriesResult, settings] = await Promise.all([
    request<{ rows: unknown[] }>("/categories?page=1&pageSize=100&status=active"),
    request<unknown>("/settings"),
  ]);
  const products: ProductListRow[] = [];
  const serializedUnits: CachedSerializedUnit[] = [];
  let page = 1;
  while (true) {
    const result = await request<{ rows: ProductListRow[]; total: number }>(
      `/products?page=${page}&pageSize=100&status=active`,
    );
    products.push(...result.rows);
    if (products.length >= result.total || result.rows.length === 0) break;
    page += 1;
  }
  page = 1;
  while (true) {
    const result = await request<{ rows: CachedSerializedUnit[]; total: number }>(
      `/product-units/cache?page=${page}&pageSize=500`,
    );
    serializedUnits.push(...result.rows);
    if (serializedUnits.length >= result.total || result.rows.length === 0) break;
    page += 1;
  }
  return replaceOfflineCache({
    categories: categoriesResult.rows,
    products,
    serializedUnits,
    settings,
    register,
  });
}

export async function getCachedProducts(search: string, limit = 20): Promise<ProductListRow[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ProductListRow[]>("list_cached_products", { search, limit });
}

export async function getOfflineCacheStatus(): Promise<OfflineCacheStatus | undefined> {
  if (!isTauriRuntime()) return undefined;
  return invoke<OfflineCacheStatus>("get_offline_cache_status");
}

export async function findCachedProductByCode(code: string): Promise<ProductListRow | undefined> {
  if (!isTauriRuntime()) return undefined;
  return (await invoke<ProductListRow | null>("lookup_cached_product", { code })) ?? undefined;
}

export async function markCachedProductArchived(productId: number) {
  if (!isTauriRuntime()) return;
  await invoke("mark_cached_product_archived", { productId });
}

export async function queueOfflineSale(payload: OfflineSalePayload, reservationId?: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Les ventes hors ligne sont disponibles uniquement dans l’application de bureau.");
  }
  if (
    payload.paymentMode !== "cash" ||
    payload.customerId !== null ||
    !payload.registerIdSnapshot ||
    !payload.items.length ||
    payload.items.some(
      (item) =>
        item.productId <= 0 || item.quantity <= 0 || item.cachedUnitPriceCents < 0 ||
        (item.serializedUnits !== undefined &&
          (item.serializedUnits.length !== item.quantity ||
            item.unitBarcodes?.length !== item.quantity)),
    )
  ) {
    throw new Error("Cette vente ne peut pas être enregistrée hors ligne.");
  }
  const result = await invoke<{ id: string }>("queue_offline_sale", {
    payloadJson: JSON.stringify(payload),
    idempotencyKey: payload.idempotencyKey,
    reservationId: reservationId ?? null,
  });
  return result.id;
}

export async function findCachedSerializedUnit(code: string): Promise<CachedSerializedUnit | undefined> {
  if (!isTauriRuntime()) return undefined;
  return (await invoke<CachedSerializedUnit | null>("lookup_cached_serialized_unit", { code })) ?? undefined;
}

export async function reserveCachedSerializedUnit(code: string, reservationId: string) {
  if (!isTauriRuntime()) throw new Error("Le cache sérialisé est réservé à l’application de bureau.");
  return invoke<CachedSerializedUnit>("reserve_cached_serialized_unit", { code, reservationId });
}

export async function releaseCachedSerializedUnits(reservationId: string, code?: string) {
  if (!isTauriRuntime()) return;
  await invoke("release_cached_serialized_unit", { reservationId, code: code ?? null });
}

export async function readQueueAsync(): Promise<OfflineSaleRecord[]> {
  if (!isTauriRuntime()) return [];
  return invoke<OfflineSaleRecord[]>("list_offline_queue");
}

export async function getOfflineQueueSummary(): Promise<OfflineQueueSummary> {
  const records = await readQueueAsync();
  return {
    pendingCount: records.filter((record) => record.status === "pending").length,
    syncingCount: records.filter((record) => record.status === "syncing").length,
    syncedCount: records.filter((record) => record.status === "synced").length,
    rejectedCount: records.filter((record) => record.status === "rejected").length,
  };
}

async function transition(
  record: OfflineSaleRecord,
  status: OfflineSaleRecord["status"],
  error?: unknown,
  serverEntityId?: number,
) {
  const failure = error instanceof ApiFailure ? error : undefined;
  await invoke("transition_offline_sale", {
    id: record.id,
    status,
    lastError: error instanceof Error ? error.message : null,
    lastStatusCode: failure?.status ?? null,
    serverEntityId: serverEntityId ?? null,
  });
}

export async function syncPendingOfflineSales(
  requestFn: typeof request = request,
  currentUserId?: number,
): Promise<void> {
  if (!isTauriRuntime()) return;
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const records = await readQueueAsync();
    for (const record of records) {
      if (record.status !== "pending") continue;
      if (currentUserId !== undefined && record.payload.userSnapshot.id !== currentUserId) continue;
      await transition(record, "syncing");
      try {
        const result = await requestFn<{ id: number }>("/sales", {
          method: "POST",
          headers: { "Idempotency-Key": record.idempotencyKey },
          json: record.payload,
        });
        await transition(record, "synced", undefined, result.id);
      } catch (error) {
        const status = error instanceof ApiFailure ? error.status : 0;
        if ([400, 403, 404, 409].includes(status)) {
          await transition(record, "rejected", error);
          continue;
        }
        await transition(record, "pending", error);
        break;
      }
    }
  })();
  try {
    await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

export function estimatedStock(
  products: ProductListRow[],
  records: OfflineSaleRecord[],
): ProductListRow[] {
  const reserved = new Map<number, number>();
  for (const record of records) {
    if (record.status !== "pending" && record.status !== "syncing") continue;
    for (const item of record.payload.items) {
      reserved.set(item.productId, (reserved.get(item.productId) ?? 0) + item.quantity);
    }
  }
  return products.map((product) => {
    const currentStock = product.currentStock - (reserved.get(product.id) ?? 0);
    return {
      ...product,
      currentStock,
      isOutOfStock: product.trackStock && currentStock <= 0,
      isLowStock: product.trackStock && currentStock <= product.minimumStock,
    };
  });
}
