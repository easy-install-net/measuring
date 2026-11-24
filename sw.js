const CACHE_NAME = "measuring-offline-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/config/firebase-init.js",
  "./js/config/master-dict.js",
  "./js/core/auth.js",
  "./js/core/image-upload.js",
  "./js/core/offline-db.js",
  "./js/modules/measure-canvas.js",
  "./js/modules/report-builder.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 跳過 Firestore 動態 API 請求，交由前端 IndexedDB 離線機制處理
  if (url.hostname.includes("googleapis.com") && url.pathname.includes("/google.firestore")) {
    return;
  }

  // 同源資源與 Firebase SDK：網路優先，斷網自動無縫切換本機快取
  if (url.origin === self.location.origin || url.hostname.includes("gstatic.com")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            if (req.mode === "navigate") return caches.match("./index.html");
            return new Response("", { status: 503, statusText: "Offline" });
          })
        )
    );
  }
});
