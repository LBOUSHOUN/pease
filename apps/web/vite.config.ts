import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      devOptions: { enabled: false },
      manifest: {
        name: "Double Library POS",
        short_name: "Double Library",
        description: "Gestion en ligne de papeterie",
        theme_color: "#102b24",
        background_color: "#f5f7f6",
        display: "standalone",
        lang: "fr",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname === "/api" || url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
            method: "GET",
            options: { cacheName: "authenticated-api-network-only" },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname === "/api" || url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
            method: "POST",
            options: { cacheName: "authenticated-api-network-only" },
          },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: false,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
});
