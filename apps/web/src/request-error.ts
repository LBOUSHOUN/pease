export function isAbortError(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const candidate = reason as { name?: unknown; message?: unknown };
  if (candidate.name === "AbortError") return true;
  if (typeof candidate.message !== "string") return false;
  return /(?:signal is aborted|abort(?:ed|ing)|operation (?:was )?cancel(?:ed|led)|request (?:was )?cancel(?:ed|led))/i.test(
    candidate.message,
  );
}
