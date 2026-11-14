// Service worker Mix: приложение открывается без сети.
// Свои файлы: сначала сеть (так обновления приходят сами), при её отсутствии или задержке — кэш.
// Шрифты и зафиксированные модули esm.sh: сначала кэш. Всё остальное (Telegram, LRCLIB, iTunes, AcoustID, аудио) не трогаем.
// VERSION и список ниже обновляет deploy.ps1.
const VERSION = '2026-11-14-1111';
// PRECACHE:BEGIN
const APP = [
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/apple-touch-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'js/app.js',
  'js/audiokey.js',
  'js/audiokey-worker.js',
  'js/covers.js',
  'js/db.js',
  'js/engine.js',
  'js/gestures.js',
  'js/id3.js',
  'js/identify.js',
  'js/listen.js',
  'js/lyrics.js',
  'js/mini.js',
  'js/pwa.js',
  'js/similar.js',
  'js/soundcheck.js',
  'js/sync.js',
  'js/tg.js',
  'js/wave.js',
  'vendor/chromaprint/chromaprint.js',
  'vendor/qrcode/qrcode.js',
  'vendor/chromaprint/chromaprint.wasm',
];
// PRECACHE:END
const CORE = ['index.html', 'js/app.js', 'js/engine.js', 'js/db.js', 'css/app.css']; // без них новую версию не ставим
const SHELL = 'mix-shell-' + VERSION, RUNTIME = 'mix-runtime-1';
const BASE = new URL('./', self.location).href;
const NET_WAIT = 3000; // столько ждём сеть, если в кэше уже есть копия
const RUNTIME_HOSTS = new Set(['esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const MEDIA = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm)$/i;

// Safari не принимает от service worker ответ с редиректом на переход по странице
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(SHELL);
  const failed = [];
  await Promise.all(APP.map(async f => {
    try {
      const res = await fetch(BASE + f, { cache: 'reload' });
      if (!res.ok) throw new Error(res.status);
      await cache.put(BASE + f, await clean(res));
    } catch { failed.push(f); }
  }));
  // Необязательный файл докачается при первом обращении; без основных остаётся старая версия
  if (failed.some(f => CORE.includes(f))) throw new Error('precache: ' + failed.join(', '));
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('mix-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(BASE) || url.href.split(/[?#]/)[0] === new URL('sw.js', BASE).href) return;
    if (req.destination === 'audio' || req.destination === 'video' || MEDIA.test(url.pathname)) return;
    e.respondWith(networkFirst(e, req, url));
  } else if (RUNTIME_HOSTS.has(url.hostname)) {
    e.respondWith(cacheFirst(e, req));
  }
});

async function networkFirst(e, req, url) {
  const key = (url.pathname.endsWith('/') ? url.href.split(/[?#]/)[0] + 'index.html' : url.href.split(/[?#]/)[0]);
  const cache = await caches.open(SHELL);
  let cached = await cache.match(key);
  if (!cached && req.mode === 'navigate') cached = await cache.match(BASE + 'index.html');
  // no-cache: GitHub Pages разрешает браузеру 10 минут не спрашивать сервер, а мы хотим свежее сразу
  const net = fetch(req.url, { cache: 'no-cache' }).then(async res => {
    if (res.ok && res.type === 'basic') await cache.put(key, await clean(res.clone()));
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const fallback = () => cached || new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  try {
    if (!cached) return await clean(await net);
    let timer;
    const res = await Promise.race([net, new Promise(r => { timer = setTimeout(() => r(null), NET_WAIT); })]);
    clearTimeout(timer);
    return res?.ok ? await clean(res) : cached;
  } catch { return fallback(); }
}

async function cacheFirst(e, req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // таблица шрифтов запрашивается как no-cors; просим CORS, чтобы в кэше лежал читаемый ответ, а не непрозрачный
    let res;
    try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); }
    catch { res = await fetch(req); }
    if (res.ok) e.waitUntil(cache.put(req.url, res.clone()).catch(() => {}));
    return res;
  } catch { return Response.error(); }
}
