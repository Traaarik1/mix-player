// Поиск по каталогу iTunes (бесплатно, без ключа): обложки, правильные названия, альбомы.
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
    duration: (x.trackTimeMillis || 0) / 1000, preview: x.previewUrl || null, released: x.releaseDate?.slice(0, 10) || '',
  }));
}

export async function fetchArt(url) {
  if (!url) return null;
  const r = await fetch(url);
  return r.ok ? r.blob() : null;
}
