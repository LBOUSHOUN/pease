import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("desktop development launcher", () => {
  it("restricts native HTTP to the exact local API and embeds its production base URL", () => {
    const capability = JSON.parse(read("apps/desktop/src-tauri/capabilities/default.json"));
    const http = capability.permissions.find((entry: unknown) => typeof entry === "object" && entry !== null && (entry as { identifier?: string }).identifier === "http:default");
    expect(http.allow).toEqual([
      { url: "http://127.0.0.1:3000/**" },
      { url: "https://pease-production.up.railway.app/**" },
    ]);
    expect(JSON.stringify(http)).not.toContain("http://*");
    expect(read("apps/web/.env.production")).toContain("VITE_API_URL=/api");
    expect(read("apps/web/.env.production")).toContain(
      "VITE_DESKTOP_API_URL=https://pease-production.up.railway.app/api",
    );
    const caddy = read("apps/web/Caddyfile");
    expect(caddy).toContain("handle /api/*");
    expect(caddy).toContain(
      "reverse_proxy https://pease-production.up.railway.app",
    );
  });
  it("uses one strict canonical Vite URL across root, Vite and Tauri", () => {
    const rootPackage = JSON.parse(read("package.json"));
    const vite = read("apps/web/vite.config.ts");
    const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
    expect(rootPackage.scripts["dev:desktop"]).toContain("http-get://127.0.0.1:5173");
    expect(rootPackage.scripts["dev:desktop"]).toContain("npm --prefix apps/desktop run tauri -- dev");
    expect(vite).toContain('host: "127.0.0.1"');
    expect(vite).toContain("strictPort: true");
    expect(vite).toContain("open: false");
    expect(tauri.build.devUrl).toBe("http://127.0.0.1:5173");
    expect(tauri.build.beforeDevCommand).not.toContain("vite");
  });

  it("preflights both fixed development ports", () => {
    const script = read("scripts/desktop-preflight.mjs");
    expect(script).toContain("[3000, 5173]");
    expect(script).not.toContain("kill(");
  });
});

describe("shared application shell", () => {
  it("uses the Double Library brand in the rendered shell, login, PWA and desktop metadata", () => {
    const app = read("apps/web/src/App.tsx");
    const html = read("apps/web/index.html");
    const vite = read("apps/web/vite.config.ts");
    const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
    expect(app).toContain("Double Library POS");
    expect(app).toContain('className="auth-brand"');
    expect(html).toContain("<title>Double Library POS</title>");
    expect(vite).toContain('name: "Double Library POS"');
    expect(tauri.productName).toBe("Double Library POS");
    expect(tauri.identifier).toBe("com.pc.doublelibrary");
    expect(tauri.app.windows[0].title).toBe("Double Library POS");
  });
  it("has accessible drawer controls and separate scroll containers", () => {
    const app = read("apps/web/src/App.tsx");
    const css = read("apps/web/src/style.css");
    expect(app).toContain('aria-controls="app-sidebar"');
    expect(app).toContain("aria-expanded={menu}");
    expect(app).toContain('className="sidebar-overlay"');
    expect(app).toContain('className="page-scroll"');
    expect(app).toContain('event.key === "Escape"');
    expect(css).toContain("height: 100dvh");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("overflow-x: hidden");
  });

  it("keeps the dashboard active state exact and every sidebar target registered", () => {
    const app = read("apps/web/src/App.tsx");
    expect(app).toContain('<NavLink to="/" end>Tableau de bord</NavLink>');
    const menuTargets = [
      "/account", "/products", "/categories", "/stock", "/stock/receive",
      "/register", "/pos", "/offline-queue", "/sales", "/customers",
      "/suppliers", "/purchases", "/expenses", "/returns", "/employees",
      "/reports", "/audit", "/settings", "/backups",
    ];
    for (const target of menuTargets) {
      expect(app).toContain(`path="${target}"`);
    }
  });

  it("downloads serialized-unit CSV through the authenticated client", () => {
    const products = read("apps/web/src/Phase2.tsx");
    expect(products).toContain('downloadFile(');
    expect(products).toContain('"/serialized-units/export.csv"');
    expect(products).not.toContain('href={buildApiUrl("/serialized-units/export.csv")}');
    expect(products).toContain('disabled={exporting}');
  });

  it("keeps a desktop scan while navigating globally to the POS", () => {
    const app = read("apps/web/src/App.tsx");
    const scanner = read("apps/web/src/global-scanner.ts");
    expect(app).toContain('scannerContexts.dispatch({ code: barcode, source: "usb" })');
    expect(app).toContain("queueScanForPos(code, loc.pathname, navigate)");
    expect(scanner.indexOf("enqueue(barcode)")).toBeLessThan(
      scanner.indexOf('navigate("/pos")'),
    );
    expect(app).toContain("Scanner global activé");
  });

  it("preserves /api when proxying the production web service", () => {
    const caddy = read("apps/web/Caddyfile");
    expect(caddy).toContain("handle /api/*");
    expect(caddy).not.toContain("handle_path /api/*");
    expect(caddy).toContain(
      "reverse_proxy https://pease-production.up.railway.app",
    );
  });

  it("keeps dashboard metric labels and values in separate elements", () => {
    const dashboard = read("apps/web/src/Dashboard.tsx");
    expect(dashboard).toContain('className="metric-label"');
    expect(dashboard).toContain('className="metric-value"');
    expect(dashboard).toContain('aria-label="Indicateurs principaux"');
  });
});
