/* Офлайн-оболочка программы: страницы, стили и скрипты лежат в кэше телефона, данные в нём не хранятся.
   Версию и список файлов между маркерами пишет tools/build_sw.py (запускать перед выдачей), руками их не править.
   Новая версия ставится, но не включается сама: страница показывает «Доступна новая версия — Обновить»
   и по кнопке присылает сюда сообщение SKIP_WAITING. Старые кэши удаляются при включении новой версии. */
const VERSION = /*VERSION*/'693f77ad9120'/*END*/;
const FILES = /*FILES*/[
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "css/app.css",
  "js/splash.js",
  "engine/gk.js",
  "engine/sheets-core.js",
  "engine/rules.js",
  "engine/validation.js",
  "engine/config.js",
  "engine/store.js",
  "engine/svc-sheets.js",
  "engine/reports.js",
  "engine/zip.js",
  "engine/xlsx.js",
  "engine/importer.js",
  "engine/compare.js",
  "engine/exporter.js",
  "engine/underlay.js",
  "engine/api.js",
  "engine/boot.js",
  "js/core.js",
  "js/nav.js",
  "js/grid.js",
  "js/sheet.js",
  "js/map.js",
  "js/geo.js",
  "js/stats.js",
  "js/check.js",
  "js/data.js",
  "js/touch.js",
  "js/app.js",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png"
]/*END*/;
const PREFIX = 'razmotka-';
const CACHE = PREFIX + VERSION;
const BASE = new URL('./', self.registration.scope).pathname;     // «/» или «/папка/»

self.addEventListener('install', e => {
  // cache: 'reload' - файлы берутся с сервера, а не из обычного кэша браузера, иначе версия окажется смешанной
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(new URL(f, self.registration.scope).href, {cache: 'reload'})))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
  else if (e.data.type === 'VERSION' && e.source) e.source.postMessage({type: 'VERSION', version: VERSION});
});

self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin) return;       // чужое и не GET - мимо кэша
  if (u.pathname.startsWith(BASE + 'api/')) return;                            // данные программы не кэшируются
  if (req.mode === 'navigate' && u.searchParams.has('remote')) return;         // ?remote: проверка на настоящем сервере
  e.respondWith((async () => {
    const hit = await caches.match(req, {cacheName: CACHE, ignoreSearch: true});
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) {
      if (req.mode === 'navigate') { const page = await caches.match(new URL('index.html', self.registration.scope).href, {cacheName: CACHE}); if (page) return page; }
      throw err;
    }
  })());
});
