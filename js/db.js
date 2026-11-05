// Локальное хранилище: треки, аудиофайлы, обложки, настройки — всё в IndexedDB браузера.
const DB_NAME = 'mix', DB_VER = 1;
const STORES = ['tracks', 'blobs', 'covers', 'kv'];
let dbp;

function open() {
  dbp ??= new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('IndexedDB выключен в браузере')); return; }
    // Некоторые браузеры молча зависают на открытии хранилища — не ждём вечно
    const t = setTimeout(() => rej(new Error('хранилище браузера (IndexedDB) не отвечает 5 секунд')), 5000);
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => {
      clearTimeout(t);
      // Safari закрывает соединение, пока приложение в фоне
      r.result.onclose = () => { dbp = null; };
      r.result.onversionchange = () => { r.result.close(); dbp = null; };
      res(r.result);
    };
    r.onerror = () => { clearTimeout(t); rej(r.error); };
    r.onblocked = () => { clearTimeout(t); rej(new Error('хранилище занято другой вкладкой Mix — закрой её')); };
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

async function tx(store, mode, fn) {
  let db = await open(), t;
  try { t = db.transaction(store, mode); }
  catch (e) {
    if (e.name !== 'InvalidStateError') throw e;
    dbp = null; db = await open(); t = db.transaction(store, mode);
  }
  return new Promise((res, rej) => {
    const q = fn(t.objectStore(store));
    t.oncomplete = () => res(q?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const get = (store, key) => tx(store, 'readonly', s => s.get(key));
export const put = (store, key, val) => tx(store, 'readwrite', s => s.put(val, key));
export const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));
export const all = store => tx(store, 'readonly', s => s.getAll());
export const keys = store => tx(store, 'readonly', s => s.getAllKeys());

// Просим браузер не удалять наши данные при нехватке места
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
export async function usage() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
