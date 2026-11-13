// Поиск по каталогу iTunes (бесплатно, без ключа): обложки, правильные названия, альбомы.
import { normKey, soundKey } from './wave.js';
export const norm = s => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\(.*?\)|\[.*?\]|feat\..*$|ft\..*$/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

let last = 0;
const GAP = 3200; // iTunes позволяет ~20 запросов в минуту
async function throttle() {
  const wait = last + GAP - Date.now();
  last = Math.max(Date.now(), last + GAP);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

// country важен: в американском каталоге русская музыка записана латиницей или её нет вовсе
export async function searchItunes(term, limit = 10, country = 'RU') {
  await throttle();
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}&country=${country}`;
  let r = await fetch(url);
  if (r.status === 403 || r.status === 429) { // превысили лимит — ждём и пробуем ещё раз
    last = Date.now() + 60000;
    await new Promise(res => setTimeout(res, 60000));
    r = await fetch(url);
  }
  if (!r.ok) throw new Error('itunes ' + r.status);
  const { results = [] } = await r.json();
  return results.filter(x => x.trackName).map(x => ({
    title: x.trackName, artist: x.artistName, album: x.collectionName || '',
    art: x.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
    duration: (x.trackTimeMillis || 0) / 1000, preview: x.previewUrl || null, released: x.releaseDate?.slice(0, 10) || '', genre: x.primaryGenreName || '', albumId: x.collectionId || null, albumTotal: x.trackCount || 0, trackNo: x.trackNumber || 0,
  }));
}

// Deezer: бесплатно, без ключа, много русской музыки. Браузеру он отвечает только через JSONP.
let dzSeq = 0, dzLast = 0;
function jsonp(url) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise(res => {
    const cb = '__dz' + (++dzSeq), s = document.createElement('script');
    const done = v => { clearTimeout(tm); delete globalThis[cb]; s.remove(); res(v); };
    const tm = setTimeout(() => done(null), 8000);
    globalThis[cb] = done; s.onerror = () => done(null);
    s.src = url + '&output=jsonp&callback=' + cb;
    document.head.appendChild(s);
  });
}
export async function searchDeezer(term, limit = 10) {
  const wait = dzLast + 150 - Date.now(); dzLast = Math.max(Date.now(), dzLast + 150); // лимит Deezer — 50 запросов за 5 секунд
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  const j = await jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=${limit}`);
  return (j?.data || []).filter(x => x.title && x.artist?.name).map(x => ({
    title: x.title, artist: x.artist.name, album: x.album?.title || '',
    art: x.album?.cover_xl || x.album?.cover_big || null, duration: x.duration || 0, preview: x.preview || null, released: '', genre: '', albumId: null, albumTotal: 0, trackNo: 0, from: 'deezer',
  }));
}

// Весь трек-лист альбома: чтобы показать, каких песен не хватает
export async function albumTracks(albumId) {
  for (const country of ['RU', 'US']) {
    await throttle();
    const r = await fetch(`https://itunes.apple.com/lookup?id=${albumId}&entity=song&country=${country}`).catch(() => null);
    if (!r?.ok) continue;
    const { results = [] } = await r.json();
    const songs = results.filter(x => x.wrapperType === 'track').map(x => ({
      title: x.trackName, artist: x.artistName, album: x.collectionName || '', trackNo: x.trackNumber || 0,
      art: x.artworkUrl100?.replace('100x100bb', '600x600bb') || null, preview: x.previewUrl || null, duration: (x.trackTimeMillis || 0) / 1000,
    }));
    if (songs.length) return songs.sort((a, b) => a.trackNo - b.trackNo);
  }
  return [];
}

// Дискография артиста: его альбомы и песни из каталога iTunes
const nk = s => soundKey(normKey(s)); // Кизару = kizaru = KIZARU
export async function artistCatalog(name) {
  for (const country of ['RU', 'US']) {
    await throttle();
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5&country=${country}`).catch(() => null);
    if (!r?.ok) continue;
    const { results = [] } = await r.json();
    const a = results.find(x => nk(x.artistName) === nk(name)) || null;
    if (!a) continue;
    await throttle();
    const r2 = await fetch(`https://itunes.apple.com/lookup?id=${a.artistId}&entity=album&limit=60&country=${country}`).catch(() => null);
    const items = r2?.ok ? (await r2.json()).results || [] : [];
    const albums = items.filter(x => x.wrapperType === 'collection' && x.collectionName).map(x => ({
      id: x.collectionId, name: x.collectionName.replace(/\s+-\s+(Single|EP)$/i, ''), single: / - Single$/i.test(x.collectionName), ep: / - EP$/i.test(x.collectionName),
      total: x.trackCount || 0, year: (x.releaseDate || '').slice(0, 4), art: x.artworkUrl100?.replace('100x100bb', '400x400bb') || null, artist: x.artistName,
    }));
    // повторы (чистая и explicit-версии) убираем, новые сверху
    const seen = new Set();
    return { artistId: a.artistId, name: a.artistName, albums: albums.sort((x, y) => (y.year || '').localeCompare(x.year || '')).filter(x => { const k = nk(x.name); if (seen.has(k)) return false; seen.add(k); return true; }) };
  }
  return null;
}

export async function fetchArt(url) {
  if (!url) return null;
  const r = await fetch(url);
  return r.ok ? r.blob() : null;
}
