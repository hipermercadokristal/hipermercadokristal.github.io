const CACHE_NAME = "hipermercado-kristal-v79";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=storefront-audit-v1",
  "/app.js?v=pending-product-photo-v2",
  "/product-image-fallbacks.js?v=product-department-rules-v1",
  "/chat-widget.js?v=kristal-chat-v2",
  "/client/app-orders.js?v=delivery-fee-courier-pay-v1-20261017",
  "/auth-routing.js?v=staff-navigation-v1-20261017",
  "/staff-store-navigation.js?v=staff-navigation-v1-20261017",
  "/staff-collapsible.js?v=staff-collapsible-v1-20261017",
  "/login/",
  "/login/index.html",
  "/login/login.css?v=commerce-redesign-v2",
  "/login/login.js?v=commerce-redesign-v2",
  "/pwa.js?v=commerce-redesign-v2",
  "/manifest.webmanifest",
  "/assets/kristal-logo.png",
  "/assets/kristal-favicon.png",
  "/assets/kristal-assistant.svg",
  "/assets/app-icons/icon-192.png",
  "/assets/app-icons/icon-512.png",
  "/assets/app-icons/icon-180.png",
  "/assets/vendor/qrcode-generator-2.0.4.min.js",
  "/delivery/",
  "/delivery/index.html",
  "/delivery/manifest.webmanifest",
  "/delivery/delivery.css?v=delivery-no-install-v1-20261017",
  "/delivery/delivery.js?v=delivery-pages-v1-20261017",
  "/delivery/delivery-pwa.js?v=delivery-no-install-v1-20261017",
  "/assets/vendor/jsqr-1.4.0.min.js",
  "/client/",
  "/client/index.html",
  "/cashier/",
  "/cashier/index.html",
  "/caja/",
  "/caja/index.html",
  "/caja/manifest.webmanifest",
  "/admin/manifest.webmanifest",
  "/admin/staff-pwa.js?v=staff-no-install-v1-20261017",
  "/admin/inventory-import.js?v=chrystal-photo-repair-v3",
  "/admin/marketing.js?v=marketing-flash-import-v2",
  "/admin/admin.css?v=marketing-flash-import-v2",
  "/admin/admin.js?v=trash-purge-v1",
  "/supabase-config.js",
  "/supabase-client.js",
  "/restaurante/",
  "/restaurante/index.html",
  "/restaurante/restaurante.css",
  "/restaurante/restaurante.js",
  "/restaurante/assets/kristal-logo.png",
  "/restaurante/assets/kristal-favicon.png",
  "/restaurante/assets/payment-banks/banco-de-venezuela.png",
  "/restaurante/assets/payment-banks/banesco.png",
  "/restaurante/assets/payment-banks/mercantil.png",
  "/restaurante/assets/payment-banks/provincial.png",
];
const APP_SHELL_PATHS = new Set(APP_SHELL.map((path) => new URL(path, self.location.origin).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("hipermercado-kristal-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname === "/admin"
    || url.pathname.startsWith("/admin/")
    || url.pathname === "/restaurante/admin"
    || url.pathname.startsWith("/restaurante/admin/")
  ) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallbackPath = url.pathname.startsWith("/delivery/")
          ? "/delivery/"
          : url.pathname.startsWith("/login/")
            ? "/login/"
          : url.pathname.startsWith("/client/")
            ? "/client/"
            : url.pathname.startsWith("/cashier/")
              ? "/cashier/"
          : url.pathname.startsWith("/caja/")
            ? "/caja/"
            : url.pathname.startsWith("/restaurante/")
              ? "/restaurante/"
              : "/";
        const cachedApp = await caches.match(fallbackPath) || await caches.match("/");
        if (cachedApp) return cachedApp;
        throw new Error("No hay una versión guardada de la tienda para abrir sin conexión.");
      }),
    );
    return;
  }

  if (url.pathname === "/styles.css") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("/styles.css", response.clone());
          }
          return response;
        })
        .catch(async (error) => {
          const cachedStyles = await caches.match("/styles.css");
          if (cachedStyles) return cachedStyles;
          throw error;
        }),
    );
    return;
  }

  if (!APP_SHELL_PATHS.has(url.pathname)) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => cachedResponse || fetch(request)),
  );
});
