export const shouldRegisterServiceWorker = (production: boolean) => production;
export async function clearDevelopmentServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => /workbox|maktaba|precache/i.test(name))
        .map((name) => caches.delete(name)),
    );
  }
}
