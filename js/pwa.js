// Установка на устройство: service worker, обновления, память, обложка для экрана блокировки.
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// На iPhone установка только вручную: «Поделиться» → «На экран Домой»
export const needsIosInstallHint = () => isIOS && !isInstalled();

let reg = null, reloading = false;

// onUpdate вызывается, когда новая версия скачана, пока приложение открыто.
// Без этого ничего страшного: новая версия включится при следующем запуске.
export async function registerSW({ onUpdate } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const sw = navigator.serviceWorker, hadController = !!sw.controller;
    reg = await sw.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname, updateViaCache: 'none' });
    // Страница только что открылась и уже получила свежие файлы (сначала сеть), поэтому ждущую версию включаем без перезагрузки.
    // Иначе на iPhone она ждала бы вечно: установленное приложение редко закрывается полностью.
    if (reg.waiting && hadController) reg.waiting.postMessage('skipWaiting');
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) onUpdate?.(); });
    });
    sw.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
    let last = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - last < 3600e3) return;
      last = Date.now(); reg.update().catch(() => {});
    });
    return reg;
  } catch (e) { console.warn('service worker', e); return null; }
}

// Применить скачанную версию сейчас. Страница перезагрузится, поэтому вызывать только по кнопке.
export function applyUpdate() {
  if (!reg?.waiting) { location.reload(); return; }
  reloading = true;
  reg.waiting.postMessage('skipWaiting');
}

// Кнопка установки в Chrome и Edge (в Safari и Firefox её нет)
let installEvent = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
export const canPromptInstall = () => !!installEvent;
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === 'accepted';
}

// Сколько занято и защищены ли данные от автоудаления
export async function storageStatus() {
  const s = navigator.storage;
  const out = { persisted: false, usage: 0, quota: 0 };
  try { out.persisted = await s.persisted(); } catch {}
  try { Object.assign(out, await s.estimate()); } catch {}
  return out;
}

// Media Session на iOS ненадёжно показывает blob:-ссылки и требует точные размеры картинки,
// поэтому отдаём data:-URL квадратного JPEG 512×512. Без обложки — иконка приложения.
export async function artworkFor(blob) {
  const fallback = [{ src: new URL('../icons/icon-512.png', import.meta.url).href, sizes: '512x512', type: 'image/png' }];
  if (!blob) return fallback;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const s = Math.min(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 512, 512);
    bmp.close?.();
    return [{ src: c.toDataURL('image/jpeg', .86), sizes: '512x512', type: 'image/jpeg' }];
  } catch { return fallback; }
}

// Не гасить экран на время долгой загрузки: на заблокированном iPhone соединение с Telegram обрывается
let lock = null, wantLock = false;
export async function keepAwake(on) {
  wantLock = on;
  try {
    if (on && !lock) { lock = await navigator.wakeLock?.request('screen'); lock?.addEventListener('release', () => { lock = null; }); }
    else if (!on) { await lock?.release(); lock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && wantLock) keepAwake(true); });
