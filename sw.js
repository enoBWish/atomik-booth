// Offline cache for the booth. Everything the booth needs is saved on the tablet the first time it loads.
// Online: always fetch fresh copies (so updates show up) and refresh the saved copy.
// Offline: serve the saved copy. Guest uploads (POSTs to the Google backend) are never cached.
const CACHE = 'atomik-booth-v2';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'art.js', 'delivery.js', 'config.js', 'det-worker.js', 'manifest.json',
  'assets/logo_chrome.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/emblem_chrome.png', 'assets/word_chrome.png',
  'assets/fonts/Montserrat-Black.ttf', 'assets/fonts/Montserrat-ExtraBold.ttf', 'assets/fonts/Montserrat-SemiBold.ttf', 'assets/fonts/Montserrat-Medium.ttf',
  'assets/bg/desert.jpg', 'assets/bg/space.jpg', 'assets/bg/grid.jpg',
  'vendor/qrcode.min.js', 'vendor/mediapipe/vision_bundle.mjs',
  'vendor/mediapipe/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  'vendor/models/blaze_face_short_range.tflite', 'vendor/models/selfie_segmenter_landscape.tflite', 'vendor/models/selfie_segmenter.tflite',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
