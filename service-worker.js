const CACHE_NAME = "hipermercado-kristal-v7";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/app-orders.js",
  "/pwa.js",
  "/manifest.webmanifest",
  "/assets/kristal-logo.png",
  "/assets/kristal-favicon.png",
  "/assets/app-icons/icon-192.png",
  "/assets/app-icons/icon-512.png",
  "/assets/app-icons/icon-180.png",
  "/assets/vendor/qrcode-generator-2.0.4.min.js",
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
const APP_SHELL_PATHS = new Set(APP_SHELL);

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
        const fallbackPath = url.pathname.startsWith("/restaurante/") ? "/restaurante/" : "/";
        const cachedApp = await caches.match(fallbackPath) || await caches.match("/");
        if (cachedApp) return cachedApp;
        throw new Error("No hay una versión guardada de la tienda para abrir sin conexión.");
      }),
    );
    return;
  }

  if (!APP_SHELL_PATHS.has(url.pathname)) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => cachedResponse || fetch(request)),
  );
});
