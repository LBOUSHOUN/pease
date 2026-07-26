import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import {
  clearDevelopmentServiceWorkers,
  shouldRegisterServiceWorker,
} from "./pwa";
import { isNativeDesktop } from "./desktop-session";
if (shouldRegisterServiceWorker(import.meta.env.PROD, isNativeDesktop())) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        window.dispatchEvent(new Event("pwa-update"));
        if (
          window.confirm(
            "Une nouvelle version de Double Library est disponible. Mettre à jour maintenant ?",
          )
        ) {
          void update(true);
        }
      },
    });
  });
} else {
  void clearDevelopmentServiceWorkers();
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
