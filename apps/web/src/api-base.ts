import { isTauri } from "@tauri-apps/api/core";

export type ApiBaseContext = {
  env?: Record<string, string | boolean | undefined>;
  location?: { protocol?: string; origin?: string };
  native?: boolean;
};

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/u, "");

export function resolveApiBaseUrl(context: ApiBaseContext = {}): string {
  const env = context.env ?? import.meta.env;
  const location =
    context.location ??
    (typeof window === "undefined" ? undefined : window.location);
  const native =
    context.native ?? (location?.protocol === "tauri:" || isTauri());

  if (native) {
    const desktopConfigured =
      typeof env.VITE_DESKTOP_API_URL === "string"
        ? env.VITE_DESKTOP_API_URL.trim()
        : "";
    const legacyConfigured =
      typeof env.VITE_API_URL === "string" &&
      /^https?:\/\//u.test(env.VITE_API_URL.trim())
        ? env.VITE_API_URL.trim()
        : "";
    const configured = desktopConfigured || legacyConfigured;
    if (configured) return withoutTrailingSlash(configured);
    if (env.DEV === true) return "http://127.0.0.1:3000/api";
    throw new Error(
      "VITE_DESKTOP_API_URL doit être configurée pour l’application de bureau.",
    );
  }

  const configured =
    typeof env.VITE_API_URL === "string" ? env.VITE_API_URL.trim() : "";
  if (!configured || /^https?:\/\//u.test(configured)) return "/api";
  const relative = withoutTrailingSlash(configured);
  return /^\/[a-z0-9/_-]*$/iu.test(relative) ? relative : "/api";
}

export function buildApiUrl(path: string, context: ApiBaseContext = {}): string {
  const base = resolveApiBaseUrl(context);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (
    base === normalizedPath ||
    (base.endsWith("/api") && normalizedPath.startsWith("/api/"))
  )
    return base.startsWith("http")
      ? `${base.slice(0, -4)}${normalizedPath}`
      : normalizedPath;
  return `${base}${normalizedPath}`;
}

export function resolveHealthUrl(context: ApiBaseContext = {}): string {
  const path = buildApiUrl("/health", context);
  if (/^https?:\/\//u.test(path)) return path;
  const origin =
    context.location?.origin ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  return origin && /^https?:\/\//u.test(origin)
    ? new URL(path, origin).toString()
    : path;
}
