import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import {
  clearDevelopmentServiceWorkers,
  shouldRegisterServiceWorker,
} from "./pwa";
if (shouldRegisterServiceWorker(import.meta.env.PROD)) {
  void import("virtual:pwa-register").then(({ registerSW }) =>
    registerSW({
      onNeedRefresh() {
        window.dispatchEvent(new Event("pwa-update"));
      },
    }),
  );
} else {
  void clearDevelopmentServiceWorkers();
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
