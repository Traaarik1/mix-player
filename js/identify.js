// Определяем, что это за трек. По порядку: по звуку (AcoustID), по названию (LRCLIB и iTunes), по звуку через AudD.
import { searchItunes, searchDeezer, norm } from './covers.js';
import { normKey } from './wave.js';

export const IDENT_VER = 5;
export const AUTO_SCORE = .78; // с такой уверенностью название и обложка меняются сами, без проверки

// Мусор, который каналы и сайты дописывают к именам файлов
export function cleanName(s) {
  return (s || '')
    .replace(/\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i, '')
    .replace(/[_+]/g, ' ')
    .replace(/https?:\/\/\S+|@\w+|\b[\w-]+\.(fm|ru|net|com|me|org|su|cc|io|to|online|site|pro|info|top|club|xyz|biz|tv|by|ua|kz|mobi|name|cool|live|music)\b/gi, ' ')
    .replace(/[([](?:[^)\]]*?(official|video|audio|lyric|clip|клип|\bhd\b|\bhq\b|kbps|премьера|visuali[sz]er|mood video|текст|скачать)[^)\]]*?)[)\]]/gi, ' ')
    .replace(/\b(320|256|192|128)\s*kbps\b|\bmp3\b|\bскачать\b|\bбесплатно\b/gi, ' ')
    .replace(/[([]\s*[)\]]/g, ' ')
    .replace(/^\s*\d{1,3}\s*[.\-_)]\s*/, '')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Реклама каналов внутри названия и артиста: «Трек [@newcloudrl]», «Артист | t.me/канал»
export function cleanTag(s) {
  return String(s || '')
    .replace(/[([{][^)\]}]*(?:@|t\.me|telegram|телеграм|vk\.com|\.ru\b|\.com\b)[^)\]}]*[)\]}]?/gi, ' ')
    .replace(/https?:\/\/\S+|t\.me\/\S+|@[\w.]+/gi, ' ')
    .replace(/[([{]\s*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s|/\-–—•]+|[\s|/\-–—•]+$/g, '').trim();
}

// track_0042, audio_2024-01-05 и подобное: искать по такому имени бессмысленно
const JUNK_WORD = new Set(['track', 'audio', 'music', 'song', 'voice', 'unknown', 'new', 'file', 'трек', 'аудио', 'музыка', 'песня', 'неизвестен', 'неизвестный', 'исполнитель']);
const isJunkName = s => !(s || '').toLowerCase().split(/[^\p{L}]+/u).filter(w => w && !JUNK_WORD.has(w)).length;

// Обратный транслит: skriptonit polozhenie → скриптонит положение
const CYR = [['shch', 'щ'], ['yo', 'ё'], ['zh', 'ж'], ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'], ['kh', 'х'], ['ts', 'ц'], ['iy', 'ий'], ['yy', 'ый'], ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['j', 'й'], ['y', 'ы'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'к'], ['w', 'в'], ['x', 'кс'], ['q', 'к']];
export function toCyrillic(s) {
  let out = s.toLowerCase();
  for (const [lat, cyr] of CYR) out = out.split(lat).join(cyr);
  return out;
}
const isLatin = s => /[a-z]/i.test(s) && !/[а-яё]/i.test(s);

// Слова сравниваем в транслите: Кино = Kino. Одна опечатка в длинном слове не мешает.
const words = s => [...new Set(norm(s).split(' ').map(normKey).filter(w => w && w.length > 1))];
function near(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, miss = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++miss > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return miss + (a.length - i) + (b.length - j) <= 1;
}
const covered = (part, of) => part.length ? part.filter(w => of.some(x => near(w, x))).length / part.length : 0;

const VERSION = /\b(edit|remix|mix|live|version|instrumental|acoustic|karaoke|cover|sped up|slowed|nightcore|remaster\w*|ремикс|версия|минус)\b/i;
// Насколько кандидат похож на то, что написано в имени файла. Важно, чтобы нашлись и артист, и название:
// иначе «Король и Шут - Лесник» совпадает с песней Ленинграда «Король и Шут».
export function scoreCandidate(query, c, duration = 0) {
  const q = words(query), title = words(c.title), artist = words(c.artist);
  if (!q.length || !title.length) return 0;
  let s = covered(title, q) * .5 + covered(artist, q) * .35 + covered(q, [...title, ...artist]) * .15;
  if (VERSION.test(c.title) && !VERSION.test(query)) s -= .2;
  if (c.from === 'lrclib') {
    // LRCLIB заполняют люди: бывают перепутанные поля и артист внутри названия. Тогда пусть решает iTunes.
    const [left, right] = query.split(/\s+[-–—]\s+/);
    if (right && covered(words(left), title) >= .8 && covered(words(right), artist) >= .8) s -= .4;
    if (covered(artist, title) >= .8 || c.artist.length > 40) s -= .4;
  }
  if (duration && c.duration) {
    const gap = Math.abs(c.duration - duration);
    s += gap < 3 ? .15 : gap > 20 ? -.35 : 0;
  }
  return Math.max(0, Math.min(1, s));
}

async function lrclib(term) {
  const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(term)}`);
  if (!r.ok) return [];
  const list = await r.json();
  return (Array.isArray(list) ? list : []).slice(0, 15).map(x => ({ title: x.trackName, artist: x.artistName, album: x.albumName || '', duration: x.duration || 0, art: null, preview: null, from: 'lrclib' }));
}

// Третий каталог: MusicBrainz, не больше запроса в секунду
let mbLast = 0;
async function musicbrainz(query) {
  const wait = mbLast + 1100 - Date.now();
  mbLast = Math.max(Date.now(), mbLast + 1100);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  const q = s => '"' + s.replace(/["\\]/g, ' ') + '"';
  const [left, right] = query.split(/\s+[-–—]\s+/);
  const lucene = right ? `recording:${q(right)} AND artist:${q(left)}` : q(query);
  const r = await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(lucene)}&fmt=json&limit=8`);
  if (!r.ok) return [];
  const { recordings = [] } = await r.json();
  return recordings.filter(x => x.score >= 80 && x.title && x['artist-credit']?.length).map(x => ({
    title: x.title, artist: x['artist-credit'].map(a => a.name + (a.joinphrase || '')).join(''),
    album: x.releases?.[0]?.title || '', duration: (x.length || 0) / 1000, art: null, preview: null, released: x['first-release-date'] || '',
  }));
}

async function acoustid(fp, duration, key) {
  const body = new URLSearchParams({ client: key, meta: 'recordings releasegroups compress', duration: Math.round(duration), fingerprint: fp, format: 'json' });
  const r = await fetch('https://api.acoustid.org/v2/lookup', { method: 'POST', body });
  const j = await r.json();
  if (j.status !== 'ok') {
    const e = new Error(j.error?.message || 'acoustid'); e.code = j.error?.code; throw e;
  }
  for (const res of (j.results || []).sort((a, b) => b.score - a.score)) {
    if (res.score < .5) break;
    const recs = (res.recordings || []).filter(x => x.title && x.artists?.length);
    const rec = recs.find(x => x.duration && Math.abs(x.duration - duration) < 5) || recs[0];
    if (!rec) continue;
    const artist = rec.artists.map(a => a.name + (a.joinphrase || '')).join('').trim();
    const rg = rec.releasegroups || [];
    const g = rg.find(x => x.type === 'Album') || rg.find(x => x.type === 'Single') || rg[0];
    return { title: rec.title, artist, album: g?.title || '', score: res.score, rgid: g?.id || null };
  }
  return null;
}

// Оригинальная запись в каталоге iTunes: обложка и альбом для уже известных артиста и названия
export async function findOriginal(artist, title, duration = 0) {
  const query = `${artist} ${title}`.trim();
  for (const country of ['RU', 'US']) {
    const res = await searchItunes(query, 10, country).catch(() => []);
    let best = null, top = 0;
    for (const c of res) { const s = scoreCandidate(query, c, duration); if (s > top) { best = c; top = s; } }
    if (best && top >= .7) return best;
  }
  { // в iTunes нет — обложку и альбом берём из Deezer
    let best = null, top = 0;
    for (const c of await searchDeezer(query).catch(() => [])) { const s = scoreCandidate(query, c, duration); if (s > top) { best = c; top = s; } }
    if (best?.art && top >= .7) return best;
  }
  const art = await coverFromMusicBrainz(artist, title).catch(() => null);
  return art ? { title, artist, album: '', art, duration, preview: null } : null;
}

// Запасной источник обложек: MusicBrainz + Cover Art Archive (бесплатно, без ключа)
async function coverFromMusicBrainz(artist, title) {
  const esc = s => s.replace(/["\\]/g, ' ');
  const q = `recording:"${esc(title)}"` + (artist ? ` AND artist:"${esc(artist)}"` : '');
  const r = await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=5`);
  if (!r.ok) return null;
  const { recordings = [] } = await r.json();
  const ids = [...new Set(recordings.filter(x => x.score >= 90).flatMap(x => (x.releases || []).map(y => y['release-group']?.id)).filter(Boolean))].slice(0, 3);
  for (const id of ids) {
    const url = `https://coverartarchive.org/release-group/${id}/front-500`;
    if ((await fetch(url, { method: 'HEAD' }).catch(() => null))?.ok) return url;
  }
  return null;
}

function queriesFor(t) {
  const out = [];
  const add = raw => {
    const q = cleanName(raw);
    if (q && !isJunkName(q) && !out.some(x => words(x).join() === words(q).join())) out.push(q);
  };
  // без приписок: «Трек 2.0 (prod. X) feat. Y» → «Трек»
  const bare = s => String(s || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s(?:feat\.?|ft\.?|prod\.?|при уч\S*)\s.*$/i, ' ').replace(/\s+\d+(?:\.\d+)?\s*$/, ' ').replace(/\s+/g, ' ').trim();
  const lead = String(t.artist || '').split(/\s*(?:,|;|&|\/|\sx\s|\sfeat\.?\s|\sft\.?\s)\s*/i)[0];
  if (t.artist && t.title) add(`${t.artist} - ${t.title}`);
  add(t.fileName);
  if (lead && t.title) add(`${lead} - ${bare(t.title)}`);
  const name = cleanName(t.fileName || '');
  if (name) add(bare(name));
  if (t.title) add(bare(t.title));
  return out.slice(0, 4);
}

// t — трек, blob — его аудио, key — ключ AcoustID (может быть пустым), audd — необязательное распознавание по куску звука
export async function identify(t, blob, key, { audd } = {}) {
  const duration = t.duration || t.bounds?.d || 0;
  if (key && blob) {
    // отдельный файл: сбой отпечатка не должен ронять плеер; файл, который не декодируется, ищем по имени
    let fp = null, d = duration;
    try { ({ fp, duration: d } = await (await import('./audiokey.js')).fingerprint(blob)); } catch (e) { console.warn('audiokey', e); }
    const hit = fp ? await acoustid(fp, d, key) : null;
    if (hit) {
      const it = await findOriginal(hit.artist, hit.title, d);
      const art = it?.art || (hit.rgid ? `https://coverartarchive.org/release-group/${hit.rgid}/front-500` : null);
      return { title: hit.title, artist: hit.artist, album: hit.album || it?.album || '', art, source: 'sound', score: hit.score, auto: hit.score >= .8 };
    }
  }
  let best = null, top = 0;
  const consider = (query, list) => { for (const c of list) { const s = scoreCandidate(query, c, duration); if (s > top) { best = c; top = s; } } };
  // Сначала LRCLIB: он без жёсткого лимита, поэтому тысячи треков проходят быстро. iTunes (20 запросов в минуту) — когда он не нашёл.
  // Обложки подтягиваются потом отдельно, чтобы не держать очередь.
  const itunes = (term, country) => searchItunes(term, 10, country).catch(() => []);
  search: for (const query of queriesFor(t)) {
    const plain = query.replace(/\s+[-–—]\s+/g, ' '); // дефис между артистом и названием каталоги воспринимают как часть слова
    const parts = query.split(/\s+[-–—]\s+/);
    const terms = isLatin(query) ? [plain, toCyrillic(plain)] : [plain];
    for (const term of terms) { consider(query, await lrclib(term).catch(() => [])); if (top >= AUTO_SCORE) break search; }
    consider(query, await searchDeezer(plain).catch(() => [])); if (top >= AUTO_SCORE) break search;
    for (const term of terms) { consider(query, await itunes(term, 'RU')); if (top >= AUTO_SCORE) break search; }
    if (parts.length > 1) { // артист в имени часто записан неточно: ищем и по одному названию
      consider(query, await lrclib(parts.at(-1)).catch(() => []));
      if (top >= AUTO_SCORE) break search;
    }
    if (isLatin(query)) { consider(query, await itunes(plain, 'US')); if (top >= AUTO_SCORE) break search; }
    consider(query, await musicbrainz(query).catch(() => []));
    if (top >= AUTO_SCORE) break search;
  }
  if (top < AUTO_SCORE && audd && blob) {
    const r = await audd(blob);
    if (r) return { title: r.title, artist: r.artist, album: r.album || '', art: r.art || null, preview: r.preview || null, source: 'sound', score: .95, auto: true };
  }
  if (!best || top < .6) return null;
  return { ...best, source: 'name', score: top, auto: top >= AUTO_SCORE };
}

export const sameName = (a, b) => norm(a.title) === norm(b.title) && norm(a.artist) === norm(b.artist);
