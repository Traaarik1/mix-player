import * as db from './db.js';
import { readTags, parseFileName } from './id3.js';
import { searchItunes, searchDeezer, searchArtists, fetchArt, albumTracks, artistCatalog, artistTop, artistRelated, jsonp, deezerSimilarTracks } from './covers.js';
import { Engine, EQ_BANDS, EQ_PRESETS } from './engine.js';
import { findLyrics } from './lyrics.js';
import { identify, cleanName, cleanTag, sameName, findOriginal, scoreCandidate, IDENT_VER } from './identify.js';
import { buildTaste, nextWave, artistParts, creditsOf, soloArtists, sameTrack, analyzeAudio, normKey, artistAliases } from './wave.js';
import { fetchSuggestions } from './similar.js';
import { registerSW, artworkFor, keepAwake, needsIosInstallHint } from './pwa.js';
import { openMini, canMini } from './mini.js';
import { setupGestures, setupRowSwipe, setupEdgeBack } from './gestures.js';
import { setLang, defaultLang } from './i18n.js';
import { count, countOf, dashboard, GC } from './counter.js';
import { checkSound, SOUND_V } from './soundcheck.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = t => !isFinite(t) || t <= 0 ? '0:00' : Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
const hash = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 360; };
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return n + ' ' + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); };
const tracksWord = n => plural(n, 'трек', 'трека', 'треков');

// ---------- состояние ----------
const tracks = new Map();   // id -> трек
const virtual = new Map();  // превью похожих треков в Волне: играют, но не лежат в библиотеке
const getT = id => tracks.get(id) || virtual.get(id);
let order = [];             // id, новые сверху
const settings = { cf: 6, trim: true, skipFade: true, vol: 80, shuffle: false, repeat: true, eq: EQ_PRESETS['Ровно'].slice(), eqPreset: 'Ровно', acoustKey: '', auddToken: '', writeChannel: true, sort: 'added-desc', waveSimilar: true, norm: true };
const lib = { likes: new Set(), playlists: [], history: [], listens: [] };
let waveFx = {};            // синхронизируется: d:* «не моё», l:* лайки подборки, listens:<устройство> история других устройств
let deviceId = '', waveSeen = [];
let waveMode = false;
let tgCfg = null;           // {apiId, apiHash, session, chatId, chatTitle, lastSync}
let view = 'all', query = '';
const navStack = []; // откуда пришли: для «назад»
let artistAll = false; // у артиста показаны все треки, а не первые 5
let queue = [], queueBase = [];
let curId = null;

let cloud = null;           // синхронизация через Telegram, создаётся после входа
const saveTrack = t => { if (t.source === 'preview') return Promise.resolve(); const { dlp, ...rest } = t; cloud?.schedule(); return db.put('tracks', t.id, rest); };
let libTimer;
const writeLib = () => { clearTimeout(libTimer); return db.put('kv', 'library', { likes: [...lib.likes], playlists: lib.playlists, history: lib.history, listens: lib.listens, wave: waveFx }); };
const saveLib = () => { clearTimeout(libTimer); cloud?.schedule(); libTimer = setTimeout(writeLib, 300); };
const saveSettings = () => { cloud?.schedule(); return db.put('kv', 'settings', settings); };
const saveTg = () => db.put('kv', 'tg', tgCfg);

// ---------- обложки и цвет ----------
const coverUrls = new Map();
async function coverUrl(id) {
  if (coverUrls.has(id)) return coverUrls.get(id);
  const b = await db.get('covers', id);
  const u = b ? URL.createObjectURL(b) : null;
  coverUrls.set(id, u);
  return u;
}
const thumbUrls = new Map(), thumbReady = new Map();
let thumbChain = Promise.resolve();
function thumbUrl(id) {
  if (thumbUrls.has(id)) return thumbUrls.get(id);
  const p = (async () => {
    let b = await db.get('covers', 'th:' + id);
    if (!b) {
      const full = await db.get('covers', id);
      if (!full) return null;
      // по одной, чтобы при быстрой прокрутке не забить процессор
      b = await (thumbChain = thumbChain.catch(() => {}).then(async () => {
        const bmp = await createImageBitmap(full, { resizeWidth: 112, resizeHeight: 112, resizeQuality: 'medium' });
        const c = document.createElement('canvas'); c.width = c.height = 112;
        c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
        return new Promise(r => c.toBlob(r, 'image/jpeg', .8));
      })).catch(() => full);
      db.put('covers', 'th:' + id, b);
    }
    const u = URL.createObjectURL(b);
    thumbReady.set(id, u);
    return u;
  })();
  thumbUrls.set(id, p);
  return p;
}
async function setCover(t, blob) {
  await db.put('covers', t.id, blob);
  const old = coverUrls.get(t.id); if (old) URL.revokeObjectURL(old);
  coverUrls.delete(t.id);
  thumbUrls.delete(t.id); thumbReady.delete(t.id); db.del('covers', 'th:' + t.id);
  t.cover = true;
  try { t.tone = await toneOf(blob); } catch {}
  await saveTrack(t);
  updateRow(t.id);
  if (t.id === curId) { paintNow(); applyTone(t); }
}
// Самый «живой» цвет обложки — им красится фон и акценты
async function toneOf(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = c.height = 28;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, 28, 28);
  const px = g.getImageData(0, 0, 28, 28).data;
  let x = 0, y = 0, w = 0, sat = 0;
  let col = 0, lum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < .08) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
    h *= 60;
    const wt = s * s * (1 - Math.abs(l - .5) * 1.4);
    x += Math.cos(h * Math.PI / 180) * wt; y += Math.sin(h * Math.PI / 180) * wt; w += wt; sat += s * wt;
  }
  if (!w) return [hash(blob.size + ''), 15];
  return [Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360), Math.round(Math.min(100, sat / w * 110))];
}
const toneFor = t => t?.tone || [t ? hash(t.title + t.artist) : 356, 80];
// Три главных цвета обложки — для цветных шаров на фоне
async function paletteOf(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, 32, 32);
  const px = g.getImageData(0, 0, 32, 32).data, bins = [...Array(12)].map(() => ({ r: 0, g: 0, b: 0, w: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, d = mx - mn;
    lum += l;
    if (d < .12 || l < .12 || l > .9) continue; // серое, чёрное и белое на шары не годится
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = bins[Math.floor(h / 30)], wt = s * s;
    col++; bin.r += px[i] * wt; bin.g += px[i + 1] * wt; bin.b += px[i + 2] * wt; bin.w += wt;
  }
  const top = bins.filter(x => x.w > .5).sort((a, b) => b.w - a.w).slice(0, 3).map(x => [x.r / x.w, x.g / x.w, x.b / x.w].map(Math.round));
  // почти нет цвета (чёрная, белая, серая обложка) — фон тоже делаем чёрно-серым
  if (col < 40) { const m = []; m.mono = lum / 1024; return m; }
  return top;
}
const palCache = new Map();
function setPalette(pal, tone) {
  const [h, s] = tone, r = document.documentElement.style;
  // не хватило ярких цветов — добираем соседними оттенками основного
  const fill = [`hsl(${h} ${Math.max(55, s)}% 58%)`, `hsl(${(h + 40) % 360} ${Math.max(55, s)}% 55%)`, `hsl(${(h + 320) % 360} ${Math.max(50, s)}% 50%)`];
  // цвета обложки часто тёмные и тусклые: на фоне они пропадают, поэтому делаем их ярче и сочнее, сохраняя оттенок
  const vivid = ([R, G, B]) => {
    const r1 = R / 255, g1 = G / 255, b1 = B / 255, mx = Math.max(r1, g1, b1), mn = Math.min(r1, g1, b1), d = mx - mn;
    let hh = !d ? 0 : mx === r1 ? ((g1 - b1) / d) % 6 : mx === g1 ? (b1 - r1) / d + 2 : (r1 - g1) / d + 4;
    hh = Math.round((hh * 60 + 360) % 360);
    const l = (mx + mn) / 2, ss = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return `hsl(${hh} ${Math.round(Math.max(.5, Math.min(.8, ss)) * 100)}% ${Math.round(Math.min(.52, Math.max(.42, l)) * 100)}%)`;
  };
  if (pal.mono != null) { const L = pal.mono > .6 ? [62, 48, 36] : [26, 18, 34]; for (let i = 0; i < 3; i++) r.setProperty('--c' + (i + 1), `hsl(250 6% ${L[i]}%)`); return; }
  for (let i = 0; i < 3; i++) r.setProperty('--c' + (i + 1), pal[i] ? vivid(pal[i]) : fill[i]);
}
// Цвет обложки меняется плавно (1,2 с): анимируем сами, без CSS @property — его Safari на iPhone ломал
let toneNow = null, toneAnim = 0;
function setToneVars(h, s) {
  const r = document.documentElement.style, put = (a, b) => { r.setProperty('--h', a.toFixed(1)); r.setProperty('--s', b.toFixed(1) + '%'); };
  cancelAnimationFrame(toneAnim);
  if (!toneNow || matchMedia('(prefers-reduced-motion: reduce)').matches) { toneNow = [h, s]; put(h, s); return; }
  const [h0, s0] = toneNow, dh = ((h - h0 + 540) % 360) - 180, t0 = performance.now(), D = 1200; // по кругу цветов коротким путём
  const step = now => {
    const k = Math.min(1, (now - t0) / D), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    toneNow = [(h0 + dh * e + 360) % 360, s0 + (s - s0) * e]; put(...toneNow);
    if (k < 1) toneAnim = requestAnimationFrame(step);
  };
  toneAnim = requestAnimationFrame(step);
}
const applyTone = t => setToneVars(...toneFor(t));
function coverHTML(t, cls = 'cov') {
  const ch = toneFor(t)[0], letter = esc((t.artist || t.title || '♪').trim()[0]?.toUpperCase() || '♪');
  if (!t.cover && t.art) return `<img class="${cls}" src="${esc(t.art)}" alt="" decoding="async" style="--ch:${ch}">`;
  const ready = thumbReady.get(t.id);
  return t.cover ? `<img class="${cls}" data-cid="${esc(t.id)}"${ready ? ` src="${ready}"` : ''} alt="" style="--ch:${ch}">`
    : `<span class="${cls}" style="--ch:${ch}">${letter}</span>`;
}
// Подставляем картинки в только что нарисованные строки; большая нужна только в большом плеере
async function hydrate(img, big) {
  const id = img.dataset.cid;
  const u = await (big ? coverUrl(id) : thumbUrl(id));
  if (u && img.dataset.cid === id) img.src = u;
}
function hydrateIn(el, big = false) { for (const img of $$(big ? 'img[data-cid]' : 'img[data-cid]:not([src])', el)) hydrate(img, big); }

// ---------- библиотека ----------
function rebuildOrder() { creditCache = null; order = [...tracks.values()].sort((a, b) => b.addedAt - a.addedAt).map(t => t.id); }

function viewIds() {
  let ids;
  if (view === 'all' || view === 'fix' || view === 'wave' || view === 'wish') ids = order;
  else if (view === 'liked') ids = order.filter(id => lib.likes.has(id));
  else if (view === 'recent') ids = [...new Set(lib.history.map(h => h.id))].filter(id => tracks.has(id));
  else if (view.startsWith('artist:')) { const k = view.slice(7), idx = creditIndex(); ids = order.filter(id => idx.get(id).some(p => p.key === k)); }
  else if (view === 'artists' || view === 'albums') ids = order;
  else if (view.startsWith('album:')) { const k = view.slice(6); ids = order.filter(id => albumKey(tracks.get(id)) === k).sort((x, y) => (tracks.get(x).trackNo || 99) - (tracks.get(y).trackNo || 99)); return ids; }
  else if (view.startsWith('webartist:')) ids = [];
  else if (smartName(view)) ids = smartIds(view);
  else if (view.startsWith('collab:')) ids = order.filter(id => tracks.get(id)?.collab === view.slice(7));
  else if (view === 'news' || view === 'stats' || view === 'dups' || view === 'settings') ids = [];
  else ids = (lib.playlists.find(p => p.id === view)?.ids || []).filter(id => tracks.has(id));
  if (query) {
    const q = query.toLowerCase();
    ids = ids.filter(id => { const t = tracks.get(id); return (t.title + ' ' + t.artist + ' ' + (t.album || '')).toLowerCase().includes(q); });
  }
  return view === 'recent' ? ids : sortIds(ids);
}
const ru = (a, b) => String(a || '').localeCompare(String(b || ''), 'ru', { sensitivity: 'base', numeric: true });
function sortIds(ids) {
  const key = settings.sort;
  // «по дате добавления» в плейлисте значит «как сложено в плейлисте»
  if (key === 'added-desc' && lib.playlists.some(p => p.id === view)) return ids;
  const plays = key === 'plays' ? lib.listens.reduce((m, l) => (m[l.id] = (m[l.id] || 0) + 1, m), {}) : null;
  const known = t => t.released || (key === 'released-old' ? '9' : ''); // без даты выхода — в конец списка
  const cmp = {
    'added-desc': (a, b) => b.addedAt - a.addedAt,
    'added-asc': (a, b) => a.addedAt - b.addedAt,
    title: (a, b) => ru(a.title, b.title),
    artist: (a, b) => ru(a.artist, b.artist) || ru(a.album, b.album) || ru(a.title, b.title),
    album: (a, b) => ru(a.album, b.album) || ru(a.title, b.title),
    'released-new': (a, b) => known(b).localeCompare(known(a)),
    'released-old': (a, b) => known(a).localeCompare(known(b)),
    duration: (a, b) => (b.duration || 0) - (a.duration || 0),
    plays: (a, b) => (plays[b.id] || 0) - (plays[a.id] || 0),
  }[key];
  return cmp ? ids.slice().sort((x, y) => cmp(tracks.get(x), tracks.get(y))) : ids;
}
const badArtist = n => n.length > 40 || /@|https?:|t\.me|\d{4,}/i.test(n) || !/[\p{L}\p{N}]/u.test(n);
// Кому принадлежит трек. «GUF, Slim» — это два автора, а не один новый.
let creditCache = null;
function creditIndex() {
  if (creditCache) return creditCache;
  const rows = [...tracks.values()], solo = soloArtists(rows), whole = {};
  for (const t of rows) { const k = artistParts(t.artist)[0]?.key; if (k) whole[k] = (whole[k] || 0) + 1; }
  creditCache = new Map(rows.map(t => {
    let c = creditsOf(t.artist, solo);
    const parts = artistParts(t.artist);
    // никто из участников не встречается сам по себе: повторяется — значит группа, разово — записываем на первого
    if (c.length === 1 && parts.length > 1 && whole[parts[0].key] < 2) c = [parts[1]];
    const tidy = p => { const name = p.name.replace(/^(?:группа|гр\.)\s+/i, '').trim(); return name === p.name ? p : { key: normKey(name), name }; };
    return [t.id, c.filter(p => !badArtist(p.name)).map(tidy)];
  }));
  // склеиваем клоны: одно имя, записанное по-разному, становится одним автором с самым частым (проверенным) написанием
  const counts = new Map();
  for (const t of rows) for (const p of creditCache.get(t.id)) {
    const c = counts.get(p.key) || counts.set(p.key, { name: p.name, n: 0, sure: 0 }).get(p.key);
    c.n++; if (t.verified || t.conf) c.sure = 1;
  }
  const alias = artistAliases(counts);
  for (const [id, list] of creditCache) {
    const seen = new Set();
    creditCache.set(id, list.map(p => { const k = alias.get(p.key) || p.key; return k === p.key ? p : { key: k, name: counts.get(k).name }; }).filter(p => !seen.has(p.key) && seen.add(p.key)));
  }
  return creditCache;
}
function artistGroups() {
  const m = new Map(), idx = creditIndex();
  // автор появляется в списке, только если он указан первым хотя бы у одного трека
  for (const id of order) {
    const t = tracks.get(id), p = idx.get(id)?.[0];
    if (!p) continue;
    const g = m.get(p.key) || m.set(p.key, { key: p.key, name: p.name, n: 0, cover: null, sample: t, sure: false }).get(p.key);
    if (t.verified && !g.sure) { g.name = p.name; g.sure = true; } // проверенное написание важнее случайного
    g.own = (g.own || 0) + 1;
  }
  // имя из одного нераспознанного файла — скорее мусор, чем автор: прячем до распознавания
  for (const [k, g] of m) if (!g.sure && g.own < 2) m.delete(k);
  // гости считаются у тех авторов, что уже есть
  for (const id of order) {
    const t = tracks.get(id);
    for (const p of idx.get(id) || []) {
      const g = m.get(p.key);
      if (g) { g.n++; if (!g.cover && t.cover) g.cover = t; }
    }
  }
  const q = query.toLowerCase();
  return [...m.values()].filter(g => !q || g.name.toLowerCase().includes(q)).sort((x, y) => ru(x.name, y.name));
}
function renderArtists() {
  const groups = artistGroups(), empty = $('#empty');
  $('#viewTitle').firstChild.textContent = 'Авторы';
  $('#viewSub').textContent = groups.length ? plural(groups.length, 'автор', 'автора', 'авторов') : '';
  empty.hidden = !!groups.length;
  if (!groups.length) empty.innerHTML = query ? `<h2>Никого не нашлось</h2><p>По запросу «${esc(query)}» авторов нет.</p>` : '<h2>Пока нет авторов</h2><p>Они появятся, когда в библиотеке будет музыка.</p>';
  const rows = $('#rows');
  const unsure = order.filter(id => !tracks.get(id).verified).length;
  rows.innerHTML = groups.length ? `<li class="artists">${unsure ? `<button class="artist unsure" data-view="fix"><span class="cov" style="--ch:40">?</span><b>Не распознано</b><small>${tracksWord(unsure)}</small></button>` : ''}${groups.map(g => `<button class="artist" data-view="artist:${esc(g.key)}">${coverHTML(g.cover || g.sample)}<b>${esc(g.name)}</b><small>${tracksWord(g.n)}</small></button>`).join('')}</li>` : '';
  hydrateIn(rows);
}
const norm2 = s => normKey(String(s || '').replace(/\s*[-–—]\s*(single|ep)$/i, ''));
// Альбом: по номеру в каталоге, а если его нет — по автору и названию альбома
const albumKey = t => t.album ? (t.albumId ? 'i' + t.albumId : 'n' + (artistParts(t.artist)[0]?.key || '') + '|' + norm2(t.album)) : null;
function albumGroups() {
  const m = new Map();
  for (const id of order) {
    const t = tracks.get(id), k = albumKey(t);
    if (!k || t.previewOnly) continue;
    const g = m.get(k) || m.set(k, { key: k, name: t.album, artist: t.artist, ids: [], total: 0, cover: null, albumId: t.albumId }).get(k);
    g.ids.push(id); g.total = Math.max(g.total, t.albumTotal || 0);
    if (!g.cover && t.cover) g.cover = t;
    if (t.verified && t.artist.length < g.artist.length) g.artist = t.artist; // без гостей в названии
  }
  const q = query.toLowerCase();
  return [...m.values()].filter(g => g.ids.length > 1 || g.total > 1).filter(g => !q || (g.name + ' ' + g.artist).toLowerCase().includes(q))
    .sort((x, y) => y.ids.length - x.ids.length || ru(x.artist, y.artist));
}
function renderAlbums() {
  const groups = albumGroups(), empty = $('#empty');
  $('#viewTitle').firstChild.textContent = 'Альбомы';
  $('#viewSub').textContent = groups.length ? plural(groups.length, 'альбом', 'альбома', 'альбомов') : '';
  empty.hidden = !!groups.length;
  if (!groups.length) empty.innerHTML = '<h2>Альбомов пока нет</h2><p>Они соберутся сами, когда Mix распознает треки и узнает, с каких они альбомов.</p>';
  const rows = $('#rows');
  rows.innerHTML = groups.length ? `<li class="artists albums">${groups.map(g => `<button class="artist album" data-view="album:${esc(g.key)}">${coverHTML(g.cover || tracks.get(g.ids[0]))}<b>${esc(g.name)}</b><small>${esc(g.artist)}</small><em>${g.total > g.ids.length ? `есть ${g.ids.length} из ${g.total}` : g.total && g.total <= g.ids.length ? 'весь альбом' : tracksWord(g.ids.length)}</em></button>`).join('')}</li>` : '';
  hydrateIn(rows);
}
// Чего не хватает в альбоме: трек-лист из каталога минус то, что есть
async function paintAlbumMissing(g) {
  const box = $('#extra'); box.innerHTML = '';
  if (!g?.albumId || !navigator.onLine) return;
  const songs = await albumTracks(g.albumId).catch(() => []);
  if (view !== 'album:' + g.key) return;
  if (!songs.length) return;
  // Весь альбом одним списком по порядку: свои треки как обычно, недостающие — серые и не играют
  const have = g.ids.map(id => tracks.get(id)), used = new Set();
  const merged = songs.map(s => { const t = have.find(x => !used.has(x) && sameTrack(s, x)); if (t) used.add(t); return { s, t }; });
  const rest = have.filter(t => !used.has(t)); // свои треки, которых нет в трек-листе каталога (бонусы, другие версии)
  albumMissing = merged.filter(m => !m.t).map(m => m.s);
  if (!albumMissing.length && !rest.length) return;
  let k = 0;
  const ghost = (s, n) => `<li class="row ghost" data-mi="${k++}"><span class="idx"><span class="num">${n}</span></span>${s.art ? `<img class="cov" src="${esc(s.art)}" alt="" loading="lazy">` : '<span class="cov"></span>'}
    <span class="ttl"><span class="t">${esc(s.title)}</span><span class="a">${esc(s.artist)} · нет в библиотеке</span></span><span class="alb"></span>
    <button class="ib" data-miss="wish" title="В «Хочу скачать»"><svg><use href="#i-plus"/></svg></button><button class="ib" data-miss="find" title="Найти через бота в Telegram"><svg><use href="#i-tg"/></svg></button>
    <span class="dur">${fmt(s.duration)}</span><span></span></li>`;
  clearList(); listFrom = -2; // список короткий: рисуем целиком, без подгрузки при прокрутке
  const rows = $('#rows');
  rows.innerHTML = merged.map((m, i) => m.t ? rowHTML(m.t, m.s.trackNo || i + 1) : ghost(m.s, m.s.trackNo || i + 1)).join('') + rest.map((t, i) => rowHTML(t, songs.length + i + 1)).join('');
  hydrateIn(rows);
  $('#empty').hidden = true;
  listSub = `есть ${have.length} из ${songs.length}` + (albumMissing.length ? ' · серые можно добавить через «Найти»' : ''); paintSub();
}
function paintWebList(head, note, list, numbered = false) {
  albumMissing = list;
  $('#extra').innerHTML = `<div class="sechead"><div><b>${esc(head)}</b><small>${esc(note)}</small></div></div>
    <ul class="rows">${list.map((s, i) => `<li class="sug" data-mi="${i}"><span class="art-wrap">${s.art ? `<img src="${esc(s.art)}" alt="" loading="lazy">` : ''}${s.preview ? '<button data-wish="play" title="Послушать 30 секунд"><svg><use href="#i-play"/></svg></button>' : ''}</span><span class="ttl"><span class="t">${numbered && s.trackNo ? s.trackNo + '. ' : ''}${esc(s.title)}</span><span class="a">${esc(s.artist)}${s.album && !numbered ? ' — ' + esc(s.album) : ''}</span></span>
    <span class="acts"><button class="ib" data-miss="wish" title="В «Хочу скачать»"><svg><use href="#i-plus"/></svg></button><button class="btn primary wishfind" data-miss="find" title="Открыть бота в Telegram"><svg><use href="#i-tg"/></svg>Найти</button></span></li>`).join('')}</ul>`;
}
// Поиск любой песни: каталоги iTunes и Deezer, ниже своих треков
let webQ = '', webT;
function paintWebSearch() {
  clearTimeout(webT);
  const q = query;
  if (q.length < 3 || !navigator.onLine || !['all', 'wave', 'liked', 'recent', 'artists', 'albums'].includes(view)) return;
  webT = setTimeout(async () => {
    webQ = q;
    $('#extra').innerHTML = '<div class="sechead"><div><b>В интернете</b><small>Ищу…</small></div></div>';
    const [it, dz, ar] = await Promise.all([searchItunes(q, 25, 'RU').catch(() => []), searchDeezer(q, 40).catch(() => []), searchArtists(q).catch(() => [])]);
    if (webQ !== q || query !== q) return;
    const ly = lyricHits(q);
    const lyHTML = ly.length ? `<div class="sechead"><div><b>Найдено по тексту песни</b><small>Среди твоих треков</small></div></div><ol class="toplist">${ly.map(x => { const t = tracks.get(x.id); return `<li data-stat-play="${esc(t.id)}">${coverHTML(t)}<span class="ttl"><span class="t">${esc(t.title)} — ${esc(t.artist || '')}</span><span class="a">…${esc(x.snip)}…</span></span></li>`; }).join('')}</ol>` : '';
    const groups = artistGroups(), qk = normKey(q);
    const arts = ar.filter(x => normKey(x.name).includes(qk) || qk.includes(normKey(x.name))).slice(0, 6);
    const artHTML = arts.length ? `<div class="sechead"><div><b>Авторы</b><small>Нажми — откроется вся дискография</small></div></div><ul class="rows"><li class="artists">${arts.map(x => {
      const mine = groups.find(g => g.key === normKey(x.name));
      return `<button class="artist" data-view="${mine ? 'artist:' + esc(mine.key) : 'webartist:' + esc(encodeURIComponent(x.name))}">${x.pic ? `<img class="cov" src="${esc(x.pic)}" alt="" loading="lazy" style="border-radius:50%">` : '<span class="cov">?</span>'}<b>${esc(x.name)}</b><small>${mine ? tracksWord(mine.n) + ' у тебя' : 'нет в библиотеке'}</small></button>`;
    }).join('')}</li></ul>` : '';
    const seen = new Set(), key = s => normKey(s.artist + ' ' + s.title), mine = [...tracks.values()];
    let list = [...it, ...dz].filter(s => { const k = key(s); if (seen.has(k)) return false; seen.add(k); return true; })
      .filter(s => !mine.some(t => sameTrack(s, t)));
    // выше то, где нашлись все слова запроса (Мияги = Miyagi: сравниваем в транслите)
    const qw = q.split(/s+/).map(normKey).filter(Boolean);
    const fit = s => { const w = (normKey(s.artist) + ' ' + normKey(s.title)); return qw.filter(x => w.includes(x)).length; };
    list.sort((x, y) => fit(y) - fit(x)); list.splice(40);
    if (!list.length) { $('#extra').innerHTML = (lyHTML + artHTML) || '<div class="sechead"><div><b>В интернете</b><small>Ничего не нашлось</small></div></div>'; return; }
    paintWebList('Найдено в интернете', 'Плюс — в «Хочу скачать», «Найти» — открыть бота в Telegram с этим названием', list);
    if (artHTML) $('#extra').insertAdjacentHTML('afterbegin', artHTML);
    if (lyHTML) $('#extra').insertAdjacentHTML('afterbegin', lyHTML);
  }, 500);
}
let albumMissing = [];
// Альбом из дискографии, которого нет в библиотеке
const webAlbums = new Map();
const webAlbum = key => { const w = webAlbums.get(key); return w && { key, name: w.name, artist: w.artist, ids: [], total: w.total, albumId: w.id }; };
// Карточка артиста: все его альбомы (есть X из N) и чего у тебя нет
let catFor = '';
async function paintArtistCatalog() {
  const g = view.startsWith('webartist:') ? { key: 'w' + normKey(decodeURIComponent(view.slice(10))), name: decodeURIComponent(view.slice(10)), web: true } : artistGroups().find(x => x.key === view.slice(7));
  if (!g || !navigator.onLine) return;
  const v = view; catFor = v;
  const box = $('#disc');
  const cache = await db.get('kv', 'cat3:' + g.key);
  if (!cache) box.innerHTML = '<div class="sechead"><div><b>Дискография</b><small>Ищу альбомы…</small></div></div>';
  const cat = cache && Date.now() - cache.at < 7 * 864e5 ? cache.cat : await artistCatalog(g.name, knownFor(g.name)).catch(() => null);
  if (cat && !cache?.cat) db.put('kv', 'cat3:' + g.key, { at: Date.now(), cat });
  if (view !== v || catFor !== v) return;
  if (!cat?.albums.length) { box.innerHTML = '<div class="sechead"><div><b>Дискография</b><small>Не нашлась в каталоге или он сейчас недоступен — открой артиста чуть позже</small></div></div>'; return; }
  const idx = creditIndex(), gk = g.web ? normKey(g.name) : g.key, mine = order.map(id => tracks.get(id)).filter(t => idx.get(t.id)?.some(p => p.key === gk));
  const tile = al => {
    const key = 'i' + al.id;
    webAlbums.set(key, { id: al.id, name: al.name, artist: al.artist, total: al.total });
    const have = mine.filter(t => t.albumId === al.id || (t.album && norm2(t.album) === norm2(al.name))).length;
    const tag = al.total && have >= al.total ? 'весь альбом' : have ? (al.total ? `есть ${have} из ${al.total}` : `есть ${have}`) : al.total ? `${al.total} ${al.total === 1 ? 'трек' : al.total < 5 ? 'трека' : 'треков'}` : 'нет в библиотеке';
    const lib = mine.find(t => t.albumId === al.id && albumKey(t));
    return `<button class="artist album${have ? '' : ' ghost'}" data-view="album:${esc(lib ? albumKey(lib) : key)}">${al.art ? `<img class="cov" src="${esc(al.art)}" alt="" loading="lazy">` : '<span class="cov">?</span>'}<b>${esc(al.name)}</b><small>${al.year}${al.single ? ' · сингл' : al.ep ? ' · EP' : ''}</small><em>${tag}</em></button>`;
  };
  const albums = cat.albums.filter(x => !x.single), singles = cat.albums.filter(x => x.single);
  box.innerHTML = `<div class="arthead">${cat.pic ? `<img src="${esc(cat.pic)}" alt="">` : ''}<div><b>${esc(cat.name)}</b><small>${albums.length} альбомов · ${singles.length} синглов · у тебя ${tracksWord(mine.length)}</small></div></div>
    <div class="sechead"><div><b>Дискография: ${albums.length} ${albums.length === 1 ? 'альбом' : 'альбомов'}${singles.length ? `, ${singles.length} синглов` : ''}</b><small>Нажми на альбом — увидишь, каких песен не хватает</small></div></div>
    <ul class="rows"><li class="artists albums">${albums.map(tile).join('')}</li></ul>
    ${singles.length ? `<div class="sechead"><div><b>Синглы</b></div></div><ul class="rows"><li class="artists albums">${singles.map(tile).join('')}</li></ul>` : ''}
    <div class="sechead"><div><b>Треки у тебя: ${mine.length}</b></div></div>`;
  paintArtistTop(box, cat, mine);
}
// ---------- умные плейлисты: собираются сами из прослушиваний ----------
const SMART = {
  'smart:month': 'Любимое за месяц',
  'smart:often': 'Часто слушаю',
  'smart:forgot': 'Давно не слушал',
  'smart:new': 'Новое в канале',
};
// Настроение — по темпу и громкости, жанры — самые частые в библиотеке
const MOODS = { 'mood:calm': 'Спокойное', 'mood:energy': 'Энергичное' };
function topGenres(n = 4) {
  const c = {};
  for (const t of tracks.values()) if (t.genre && !t.previewOnly) c[t.genre] = (c[t.genre] || 0) + 1;
  return Object.entries(c).filter(([, k]) => k >= 5).sort((a, b) => b[1] - a[1]).slice(0, n).map(([g]) => g);
}
const smartEntries = () => [...Object.entries(SMART), ...Object.entries(MOODS), ...topGenres().map(g => ['genre:' + g, g])];
const smartName = v => SMART[v] || MOODS[v] || (v.startsWith('genre:') ? v.slice(6) : null);
function smartIds(kind) {
  if (kind === 'mood:calm') return order.filter(id => { const t = tracks.get(id); return t.bpm && (t.bpm < 100 || (t.rms != null && t.rms < -16)) && !(t.bpm > 125); });
  if (kind === 'mood:energy') return order.filter(id => { const t = tracks.get(id); return t.bpm && t.bpm >= 118 && (t.rms == null || t.rms > -14); });
  if (kind.startsWith('genre:')) { const g = kind.slice(6); return order.filter(id => tracks.get(id).genre === g); }
  const now = Date.now(), DAY = 864e5, count = (from = 0) => {
    const m = new Map();
    for (const l of lib.listens) if (l.at >= from && tracks.has(l.id) && l.played >= 30) m.set(l.id, (m.get(l.id) || 0) + 1);
    return m;
  };
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (kind === 'smart:new') return order.filter(id => (tracks.get(id).addedAt || 0) > now - 14 * DAY && !tracks.get(id).previewOnly).sort((a, b) => tracks.get(b).addedAt - tracks.get(a).addedAt);
  if (kind === 'smart:month') return top(count(now - 30 * DAY)).slice(0, 50);
  if (kind === 'smart:often') return top(count()).filter(id => count().get(id) >= 3).slice(0, 50);
  if (kind === 'smart:forgot') {
    const all = count(), recent = count(now - 45 * DAY);
    return top(all).filter(id => all.get(id) >= 3 && !recent.has(id)).concat(order.filter(id => lib.likes.has(id) && !recent.has(id) && !all.has(id))).slice(0, 50);
  }
  return [];
}

// ---------- новинки любимых артистов ----------
let news = { at: 0, items: [] };
// названия твоих песен и альбомов этого артиста — по ним отличаем его от однофамильцев
const knownFor = name => { const k = normKey(name); return [...tracks.values()].filter(t => normKey(t.artist || '').includes(k)).flatMap(t => [t.title, t.album]).filter(Boolean).slice(0, 300); };
function favArtists(limit = 25) {
  const idx = creditIndex(), n = new Map();
  for (const id of order) for (const p of idx.get(id) || []) { const g = n.get(p.key) || n.set(p.key, { name: p.name, n: 0 }).get(p.key); g.n++; }
  for (const l of lib.listens) { const p = idx.get(l.id)?.[0]; if (p && n.has(p.key)) n.get(p.key).n += .3; } // слушаю чаще — важнее
  return [...n.values()].filter(x => x.n >= 3).sort((a, b) => b.n - a.n).slice(0, limit);
}
let newsRunning = false;
async function newsHunt(force = false) {
  if (newsRunning || !navigator.onLine) return;
  if (!force && Date.now() - (news.at || 0) < 864e5) return; // раз в сутки
  newsRunning = true;
  try {
    const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10), items = [];
    for (const a of favArtists()) {
      const cat = await artistCatalog(a.name, knownFor(a.name)).catch(() => null);
      if (cat) db.put('kv', 'cat3:' + normKey(a.name), { at: Date.now(), cat });
      for (const al of cat?.albums || []) if (al.date && al.date >= since) items.push({ ...al, who: cat.name });
    }
    const seen = new Set();
    news = { at: Date.now(), items: items.filter(x => { const k = normKey(x.who + ' ' + x.name); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60) };
    db.put('kv', 'news3', news);
    renderNav(); if (view === 'news') render();
  } finally { newsRunning = false; }
}
const newsUnseen = () => news.items.filter(x => x.date > (settings.newsSeen || '')).length;
function renderNews() {
  const empty = $('#empty'), rows = $('#rows'), items = news.items;
  $('#viewTitle').firstChild.textContent = 'Новинки';
  $('#viewSub').textContent = items.length ? 'Новые релизы твоих артистов за 4 месяца' : '';
  empty.hidden = !!items.length;
  if (!items.length) empty.innerHTML = newsRunning || !news.at ? '<h2>Ищу новинки…</h2><p>Mix смотрит дискографии артистов, которых у тебя больше всего. Это займёт пару минут.</p>' : '<h2>Новинок нет</h2><p>За последние 4 месяца у твоих артистов ничего не выходило. Mix проверяет раз в сутки.</p>';
  const seen = settings.newsSeen || '';
  rows.innerHTML = items.length ? `<li class="artists albums">${items.map(al => {
    const key = 'i' + al.id; webAlbums.set(key, { id: al.id, name: al.name, artist: al.who, total: al.total });
    return `<button class="artist album" data-view="album:${esc(key)}">${al.art ? `<img class="cov" src="${esc(al.art)}" alt="" loading="lazy">` : '<span class="cov">?</span>'}<b>${esc(al.name)}</b><small>${esc(al.who)}</small><em>${al.date > seen ? 'новое · ' : ''}${al.date.split('-').reverse().join('.')}${al.single ? ' · сингл' : al.ep ? ' · EP' : ''}</em></button>`;
  }).join('')}</li>` : '';
  if (items.length) { settings.newsSeen = items[0].date; saveSettings(); }
}

// ---------- итоги: что и сколько слушал ----------
let statsPeriod = 'month';
function renderStats() {
  const empty = $('#empty'), rows = $('#rows'), DAY = 864e5, now = Date.now();
  const from = { month: now - 30 * DAY, year: now - 365 * DAY, all: 0 }[statsPeriod];
  const ls = lib.listens.filter(l => l.at >= from);
  $('#viewTitle').firstChild.textContent = 'Итоги';
  $('#viewSub').textContent = '';
  empty.hidden = !!ls.length;
  if (!ls.length) empty.innerHTML = '<h2>Пока нечего считать</h2><p>Слушай музыку, и здесь появятся твои топ-артисты и треки.</p>';
  const idx = creditIndex(), arts = new Map(), trs = new Map();
  let sec = 0;
  for (const l of ls) {
    sec += l.played || 0;
    const t = tracks.get(l.id), p = (t && idx.get(t.id)?.[0]) || { key: normKey(l.artist || ''), name: l.artist || 'Неизвестный артист' };
    const a = arts.get(p.key) || arts.set(p.key, { key: p.key, name: p.name, n: 0, sec: 0, t }).get(p.key); a.n++; a.sec += l.played || 0;
    if (t) { const x = trs.get(t.id) || trs.set(t.id, { t, n: 0 }).get(t.id); x.n++; }
  }
  const ta = [...arts.values()].sort((a, b) => b.sec - a.sec).slice(0, 10), tt = [...trs.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  const chip = (k, n) => `<button class="chip${statsPeriod === k ? ' on' : ''}" data-act="stats:${k}">${n}</button>`;
  const lib2 = artistGroups();
  rows.innerHTML = `<li class="stats">
    <div class="presets">${chip('month', 'Месяц')}${chip('year', 'Год')}${chip('all', 'Всё время')}<button class="chip" data-act="yearCard">Итоги года — картинка</button></div>
    <div class="statnums"><div><b>${Math.round(sec / 60).toLocaleString('ru')}</b><small>минут музыки</small></div><div><b>${ls.length}</b><small>прослушиваний</small></div><div><b>${trs.size}</b><small>разных треков</small></div><div><b>${arts.size}</b><small>артистов</small></div></div>
    ${ta.length ? `<div class="sechead"><div><b>Топ артистов</b></div></div><ol class="toplist">${ta.map((a, i) => `<li${lib2.some(g => g.key === a.key) ? ` data-view="artist:${esc(a.key)}"` : ''}><span class="num">${i + 1}</span>${a.t ? coverHTML(a.t) : '<span class="cov"></span>'}<span class="ttl"><span class="t">${esc(a.name)}</span><span class="a">${Math.round(a.sec / 60)} мин · ${a.n} раз</span></span></li>`).join('')}</ol>` : ''}
    ${tt.length ? `<div class="sechead"><div><b>Топ треков</b></div></div><ol class="toplist">${tt.map((x, i) => `<li data-stat-play="${esc(x.t.id)}"><span class="num">${i + 1}</span>${coverHTML(x.t)}<span class="ttl"><span class="t">${esc(x.t.title)}</span><span class="a">${esc(x.t.artist || '')} · ${x.n} раз</span></span></li>`).join('')}</ol>` : ''}
  </li>`;
  hydrateIn(rows);
}

// ---------- шапка артиста: фото и популярное ----------
let popular = [];
async function paintArtistTop(box, cat, mine) {
  if (!cat.dzId) return;
  const top = await artistTop(cat.dzId).catch(() => []);
  if (!top.length || !box.isConnected) return;
  popular = top.map(s => ({ ...s, own: mine.find(t => sameTrack(s, t))?.id || null }));
  const html = `<div class="sechead"><div><b>Популярное</b><small>Серые — нет в библиотеке: плюс или кнопка Telegram</small></div></div>
    <ul class="rows poplist">${popular.slice(0, 10).map((s, i) => `<li class="sug${s.own ? ' own' : ' ghost'}" data-pi="${i}"><span class="art-wrap">${s.art ? `<img src="${esc(s.art)}" alt="" loading="lazy">` : ''}${s.own || s.preview ? '<button data-pp title="Играть"><svg><use href="#i-play"/></svg></button>' : ''}</span>
    <span class="ttl"><span class="t">${esc(s.title)}</span><span class="a">${esc(s.album || s.artist)}${s.own ? '' : ' · нет в библиотеке'}</span></span>
    <span class="acts">${s.own ? '' : '<button class="ib" data-miss="wish" title="В «Хочу скачать»"><svg><use href="#i-plus"/></svg></button><button class="ib" data-miss="find" title="Найти через бота"><svg><use href="#i-tg"/></svg></button>'}</span></li>`).join('')}</ul>`;
  box.querySelector('.arthead')?.insertAdjacentHTML('afterend', html);
  const rel = await artistRelated(cat.dzId).catch(() => []);
  if (!rel.length || !box.isConnected) return;
  const groups = artistGroups();
  const relHTML = `<div class="sechead"><div><b>Похожие артисты</b><small>Нажми — откроется дискография</small></div></div><ul class="rows"><li class="artists">${rel.map(x => {
    const mine = groups.find(g => g.key === normKey(x.name));
    return `<button class="artist" data-view="${mine ? 'artist:' + esc(mine.key) : 'webartist:' + esc(encodeURIComponent(x.name))}">${x.pic ? `<img class="cov" src="${esc(x.pic)}" alt="" loading="lazy" style="border-radius:50%">` : '<span class="cov">?</span>'}<b>${esc(x.name)}</b><small>${mine ? tracksWord(mine.n) + ' у тебя' : 'нет в библиотеке'}</small></button>`;
  }).join('')}</li></ul>`;
  const last = [...box.querySelectorAll(':scope > .sechead')].at(-1);
  last ? last.insertAdjacentHTML('beforebegin', relHTML) : box.insertAdjacentHTML('beforeend', relHTML);
}

// ---------- импорт плейлиста: Deezer по ссылке, Spotify через локальный сервер, любой список текстом ----------
const SITE = 'https://traaarik1.github.io/mix-player/';
const guideUrl = () => SITE + (settings.lang === 'en' ? 'guide-en.html' : 'guide.html') + (settings.refId ? '?ref=' + settings.refId : '');
// ---------- анонимные счётчики: установки, пользователи, приглашённые ----------
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } }, lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function countUsage() {
  if (!GC) return;
  if (!lsGet('mixInstalled')) { lsSet('mixInstalled', '1'); count('/install'); }
  // пользователь — тот, кто подключил свой канал; засчитываем один раз на человека
  if (tgCfg?.chatId && !settings.counted) {
    settings.counted = true; saveSettings(); count('/user');
    const ref = lsGet('mixRef');
    if (ref && ref !== settings.refId) count('/ref/' + ref);
  }
}
function parseLines(text) {
  return text.split(/\r?\n/).map(s => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean).map(s => {
    const m = s.split(/\s+[-–—]\s+/);
    return m.length > 1 ? { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() } : { artist: '', title: s };
  }).filter(x => x.title && x.title.length < 150);
}
async function readPlaylist(src) {
  src = src.trim();
  const dz = src.match(/deezer\.com\/(?:\w{2}\/)?(playlist|album)\/(\d+)/);
  if (dz) {
    const j = await jsonp(`https://api.deezer.com/${dz[1]}/${dz[2]}?x=1`);
    const more = dz[1] === 'playlist' ? await jsonp(`https://api.deezer.com/playlist/${dz[2]}/tracks?limit=1000`) : null;
    const list = (more?.data || j?.tracks?.data || []).map(x => ({ artist: x.artist?.name || '', title: x.title, album: x.album?.title || j?.title || '', art: x.album?.cover_xl || j?.cover_xl || null, preview: x.preview || null }));
    return { name: j?.title || 'Из Deezer', list };
  }
  const sp = src.match(/open\.spotify\.com\/(?:intl-\w+\/)?(playlist|album)\/([A-Za-z0-9]+)/);
  if (sp) {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) throw new Error('Spotify-ссылки читаются только в Mix на компьютере (через ярлык Mix на рабочем столе). На телефоне вставь список песен текстом.');
    const r = await fetch('/proxy?u=' + encodeURIComponent(`https://open.spotify.com/embed/${sp[1]}/${sp[2]}`));
    if (!r.ok) throw new Error('Spotify не отдал плейлист. Обнови ярлык Mix: перезапусти его');
    const html = await r.text();
    const pairs = [...html.matchAll(/"title":"((?:[^"\\]|\\.)*)","subtitle":"((?:[^"\\]|\\.)*)"/g)].map(m => ({ title: JSON.parse('"' + m[1] + '"'), artist: JSON.parse('"' + m[2] + '"') }));
    const [head, ...list] = pairs;
    return { name: head?.title || 'Из Spotify', list: list.map(x => ({ ...x, artist: x.artist.split(',')[0].trim() })) };
  }
  const am = src.match(/music\.apple\.com\/[a-z]{2}\/(?:playlist|album)\/[^?#\s]+/);
  if (am) {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) throw new Error('Ссылки Apple Music читаются только в Mix на компьютере (через ярлык Mix). На телефоне вставь список песен текстом.');
    const r = await fetch('/proxy?u=' + encodeURIComponent('https://' + am[0]));
    if (!r.ok) throw new Error('Apple Music не отдал плейлист. Перезапусти ярлык Mix');
    const m = (await r.text()).match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/);
    const list = [];
    const walk = o => { if (!o || typeof o !== 'object') return; if (typeof o.title === 'string' && typeof o.artistName === 'string') { list.push({ artist: o.artistName.split(/,| & /)[0].trim(), title: o.title }); return; } for (const k in o) walk(o[k]); };
    try { walk(JSON.parse(m[1])); } catch {}
    return { name: 'Из Apple Music', list };
  }
  if (/^https?:\/\//.test(src)) throw new Error('Такую ссылку Mix пока не читает. Работают Deezer, Spotify и Apple Music; из другого сервиса скопируй список песен и вставь текстом');
  return { name: 'Импорт', list: parseLines(src) };
}
function openImport() {
  const d = modal(`<h2>Импорт плейлиста</h2><p>Вставь ссылку на плейлист <b>Deezer</b> или <b>Spotify</b> или просто список песен, по одной в строке: «Артист - Название». Что у тебя есть, попадёт в новый плейлист, остальное — в «Хочу скачать».</p>
    <form><textarea class="inp" name="src" rows="6" placeholder="https://open.spotify.com/playlist/...&#10;или&#10;kizaru - Дежавю&#10;Скриптонит - Положение" required></textarea>
    <div class="acts"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Разобрать</button></div></form><div id="impRes"></div>`);
  $('[data-x]', d).onclick = closeLayer;
  $('form', d).onsubmit = async e => {
    e.preventDefault();
    const box = $('#impRes', d); box.innerHTML = '<p>Читаю…</p>';
    let pl;
    try { pl = await readPlaylist(e.target.src.value); } catch (err) { box.innerHTML = `<p style="color:#ff9fb0">${esc(err.message)}</p>`; return; }
    if (!pl.list.length) { box.innerHTML = '<p>Не нашёл ни одной песни.</p>'; return; }
    const mine = [...tracks.values()].filter(t => !t.previewOnly);
    const found = [], missing = [];
    for (const s of pl.list) { const t = mine.find(x => sameTrack(s, x)); t ? found.push(t.id) : missing.push(s); }
    box.innerHTML = `<p><b>${esc(pl.name)}</b>: ${pl.list.length} песен. У тебя есть <b>${found.length}</b>, нет <b>${missing.length}</b>.</p>
      <label class="check"><input type="checkbox" class="sw" id="impWish" checked><span>Недостающие — в «Хочу скачать»</span></label>
      <div class="acts"><button class="btn primary" id="impGo">Создать плейлист</button></div>`;
    $('#impGo', d).onclick = () => {
      const p = { id: 'pl' + Date.now().toString(36), name: pl.name, ids: [...new Set(found)] };
      lib.playlists.push(p);
      if ($('#impWish', d).checked) for (const s of missing) addWish(s);
      saveLib(); closeLayer(); view = p.id; render();
      toast(`Плейлист «${pl.name}»: ${tracksWord(p.ids.length)}` + (missing.length && $('#impWish', d)?.checked !== false ? `, в «Хочу скачать» — ${missing.length}` : ''));
    };
  };
}

// ---------- поиск по строчке из песни: тексты своих треков хранятся у себя ----------
let lyIndex = new Map(), lyDirty = 0, lyRunning = false;
const lyNorm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function lyricsHunt() {
  if (lyRunning || !navigator.onLine) return;
  lyRunning = true;
  try {
    for (const id of order) {
      const t = tracks.get(id);
      if (!t || t.previewOnly || lyIndex.has(id) || !t.title || (!t.verified && !t.conf)) continue;
      if (!navigator.onLine) break;
      await new Promise(r => setTimeout(r, 2500));
      let text = '';
      try { const l = await findLyrics({ title: t.title, artist: t.artist, album: t.album, duration: t.duration || t.bounds?.d }); text = l?.plain || (l?.synced || []).map(x => x.text).join('\n'); } catch (e) { if (/429/.test(e.message)) { setTimeout(lyricsHunt, 10 * 60e3); break; } continue; } // LRCLIB просит подождать — пауза 10 минут
      lyIndex.set(id, lyNorm(text));
      if (++lyDirty >= 20) { lyDirty = 0; db.put('kv', 'lyidx', [...lyIndex]); }
    }
  } finally { lyRunning = false; if (lyDirty) { lyDirty = 0; db.put('kv', 'lyidx', [...lyIndex]); } }
}
function lyricHits(q) {
  const n = lyNorm(q); if (n.length < 6 || n.split(' ').length < 2) return [];
  const out = [];
  for (const [id, text] of lyIndex) { const i = text && text.indexOf(n); if (i >= 0 && tracks.has(id)) out.push({ id, snip: text.slice(Math.max(0, i - 30), i + n.length + 40) }); if (out.length >= 10) break; }
  return out;
}

// ---------- дубликаты: один и тот же трек несколько раз ----------
function dupGroups() {
  const m = new Map();
  for (const id of order) {
    const t = tracks.get(id); if (!t || t.previewOnly) continue;
    const k = (artistParts(t.artist)[0]?.key || '') + '|' + normKey(t.title);
    (m.get(k) || m.set(k, []).get(k)).push(t);
  }
  const out = [];
  for (const list of m.values()) {
    if (list.length < 2) continue;
    // разные версии (ремикс, live) обычно длиннее или короче — такие не считаем дублями
    const base = list[0].duration || list[0].bounds?.d || 0;
    const same = list.filter(t => { const d = t.duration || t.bounds?.d || 0; return !base || !d || Math.abs(d - base) <= 4; });
    if (same.length > 1) out.push(same);
  }
  return out;
}
function dropTrack(id, keepId) {
  const t = tracks.get(id); if (!t) return;
  db.del('blobs', id); db.del('covers', id); db.del('tracks', id);
  if (lib.likes.delete(id) && keepId) lib.likes.add(keepId);
  for (const p of lib.playlists) p.ids = [...new Set(p.ids.map(q => q === id ? keepId : q).filter(Boolean))];
  tracks.delete(id);
  queue = queue.filter(q => q !== id); queueBase = queueBase.filter(q => q !== id); userQueue = userQueue.filter(q => q !== id);
  if (t.source === 'tg') { tgCfg.skip = [...(tgCfg.skip || []), id]; saveTg(); }
}
function renderDups() {
  const groups = dupGroups(), empty = $('#empty'), rows = $('#rows');
  $('#viewTitle').firstChild.textContent = 'Дубликаты';
  $('#viewSub').textContent = groups.length ? `${groups.length} повторов` : '';
  empty.hidden = !!groups.length;
  if (!groups.length) empty.innerHTML = '<h2>Дубликатов нет</h2><p>Каждый трек в библиотеке встречается один раз.</p>';
  rows.innerHTML = groups.length ? `<li class="stats"><p class="morenote">Оставь одну копию, остальные уберутся из Mix. Лайки и плейлисты перейдут на оставленную. Посты в канале не трогаются.</p>
    <div class="acts"><button class="btn primary" data-act="dupsAll">Оставить по одной во всех (${groups.length})</button></div>
    ${groups.map((g, gi) => `<div class="sechead"><div><b>${esc(g[0].artist || '')} — ${esc(g[0].title)}</b><small>${g.length} копии</small></div></div><ol class="toplist">${g.map(t => `<li><span class="num"></span>${coverHTML(t)}<span class="ttl"><span class="t">${esc(t.title)}</span><span class="a">${esc(t.fileName || '')} · ${fmt(t.duration || t.bounds?.d || 0)}${t.downloaded ? ' · скачан' : ''}</span></span><button class="btn" data-keep="${esc(t.id)}" data-g="${gi}">Оставить этот</button></li>`).join('')}</ol>`).join('')}</li>` : '';
  hydrateIn(rows);
}
// лучшая копия: скачана, подтверждена, с обложкой
const bestCopy = g => g.slice().sort((a, b) => (b.downloaded - a.downloaded) || ((b.conf ? 1 : 0) - (a.conf ? 1 : 0)) || ((b.cover ? 1 : 0) - (a.cover ? 1 : 0)))[0];

// ---------- пригласить друга: у каждого свой Telegram, свой канал и свои плейлисты ----------
async function openInvite() {
  const d = modal(`<h2>Mix для друга</h2>
    <p>У каждого свой Mix: вход через свой Telegram, своя музыка из своего канала, свои лайки и плейлисты. Твои данные он не увидит, а ты — его.</p>
    <div class="pairqr" id="invQr" style="display:flex;justify-content:center;margin:10px 0"></div>
    <p style="text-align:center"><a href="${guideUrl()}" target="_blank" rel="noopener"><b>Инструкция для друга</b></a> <button class="chip" id="invCopy">Скопировать</button></p>
    <ol><li>Открыть ссылку на телефоне в Safari → «Поделиться» → «На экран Домой».</li>
    <li>Нажать «Подключить Telegram» и войти своим номером.</li>
    <li>Ключи api_id и api_hash — бесплатно на my.telegram.org → API development tools (Mix сам покажет, как).</li>
    <li>Выбрать свой канал с музыкой.</li></ol>
    <p class="morenote">Свои плейлисты и лайки на компьютере и телефоне у тебя уже общие: они синхронизируются через «Избранное» в твоём Telegram на всех устройствах, где ты вошёл.</p>
    <div class="acts"><button class="btn primary" data-x>Готово</button></div>`);
  $('[data-x]', d).onclick = closeLayer;
  $('#invCopy', d).onclick = async () => { try { await navigator.clipboard.writeText(guideUrl()); toast('Ссылка скопирована'); } catch { toast(guideUrl()); } };
  try { await loadQr(); const q = window.qrcode(0, 'M'); q.addData(guideUrl()); q.make(); $('#invQr', d).innerHTML = q.createSvgTag({ cellSize: 5, margin: 2 }); } catch {}
}

// ---------- настройки: всё в одном месте ----------
async function paintCounts() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v == null ? 'нет связи' : v; };
  countOf('/ref/' + settings.refId).then(n => set('invCount', n == null ? null : n === 0 ? 'пока никого — отправь ссылку другу' : plural(n, 'человек', 'человека', 'человек')));
  if (settings.owner) { countOf('/install').then(n => set('stInst', n)); countOf('/user').then(n => set('stUsers', n)); }
}
function renderSettings() {
  setTimeout(paintCounts, 0);
  const empty = $('#empty'), rows = $('#rows');
  empty.hidden = true;
  $('#viewTitle').firstChild.textContent = 'Настройки';
  $('#viewSub').textContent = '';
  const row = (attr, icon, name, note = '') => `<button class="morerow setrow" ${attr}><svg><use href="#i-${icon}"/></svg><span>${esc(name)}${note ? `<small>${esc(note)}</small>` : ''}</span></button>`;
  const sw = (id, on, name, note) => `<label class="check setrow"><input type="checkbox" class="sw" id="${id}"${on ? ' checked' : ''}><span>${esc(name)}<small>${esc(note)}</small></span></label>`;
  rows.innerHTML = `<li class="stats settings">
    <div class="sechead"><div><b>Язык</b></div></div>
    <div class="presets"><button class="chip${settings.lang !== 'en' ? ' on' : ''}" data-act="lang:ru">Русский</button><button class="chip${settings.lang === 'en' ? ' on' : ''}" data-act="lang:en">English</button></div>
    <div class="sechead"><div><b>Воспроизведение</b></div></div>
    ${row('data-act="setMix"', 'wave', 'Переход между треками', 'Плавный переход, срез тишины')}
    ${row('data-act="setEq"', 'eq', 'Эквалайзер', 'Частоты под твои наушники')}
    ${sw('setNorm', settings.norm !== false, 'Ровная громкость', 'Громкие треки чуть тише, тихие — громче, чтобы не крутить звук от песни к песне')}
    ${sw('setLite', !!settings.lite, 'Режим «экономия»', 'Без живого фона и анимаций: меньше памяти и заряда, для слабых телефонов')}
    ${sw('setTrim', !!settings.trim, 'Умный микс', 'Срезать тишину в начале и конце треков, чтобы на стыке не было паузы')}
    <div class="sechead"><div><b>Распознавание</b></div></div>
    ${row('data-act="acoust"', 'wand', 'Ключ AcoustID', 'Ключ AcoustID для распознавания по звуку')}
    ${row('data-act="identAll"', 'wand', 'Найти все треки', 'Заново распознать всё, что не подтверждено по звуку или тобой')}
    ${tgCfg?.chatId ? sw('writeChan', settings.writeChannel, 'Исправлять и в канале', 'Треки распознаются по звуку и по названию файла') : ''}
    <div class="sechead"><div><b>Синхронизация</b><small>Лайки, плейлисты и история общие на всех устройствах, где ты вошёл в тот же Telegram</small></div></div>
    <div class="setrow statline"><span>${!tgCfg?.session ? 'Не работает: на этом устройстве не подключён Telegram' : !cloud ? 'Запускается…' : ({ idle: 'Работает', syncing: 'Синхронизирую…', retry: 'Нет связи, повторю', offline: 'Нет связи', auth: 'Нужно войти в Telegram заново', error: 'Ошибка' })[cloudStatus?.state] || 'Запускается…'}<small>${cloudStatus?.at ? 'Последняя: ' + new Date(cloudStatus.at).toLocaleString('ru') : ''}${cloudStatus?.error ? ' · ' + esc(String(cloudStatus.error).slice(0, 80)) : ''}</small></span></div>
    ${tgCfg?.session ? row('data-act="syncNow"', 'repeat', 'Синхронизировать сейчас', 'Если на компьютере и телефоне разные лайки или плейлисты') : ''}
    <div class="sechead"><div><b>Telegram</b></div></div>
    <div class="tgcard moretg">${$('#tgcard').innerHTML}</div>
    ${tgCfg?.chatId ? row('data-act="relogin"', 'repeat', 'Войти в Telegram заново', 'Если пишет «Нет связи с Telegram», а интернет есть') : ''}
    ${row('data-act="musicBot"', 'tg', 'Музыкальный бот', settings.musicBot ? '@' + settings.musicBot : 'Кнопка «Найти» откроет этого бота с названием трека')}
    <div class="sechead"><div><b>Друзья</b></div></div>
    ${row('data-act="invite"', 'artist', 'Mix для друга', 'Отправь другу — там всё по шагам')}
    ${row('data-act="copyInvite"', 'copy', 'Ссылка-приглашение', guideUrl())}
    ${GC ? `<div class="setrow statline"><span>Ты пригласил<small id="invCount">считаю…</small></span></div>` : ''}
    ${GC && settings.owner ? `<div class="sechead"><div><b>Статистика Mix</b><small>Видно только тебе</small></div></div>
      <div class="statnums"><div><b id="stInst">…</b><small>установок</small></div><div><b id="stUsers">…</b><small>пользователей</small></div></div>
      ${row('data-act="openStats"', 'list', 'Подробная статистика', dashboard())}` : ''}
    <div class="sechead"><div><b>О Mix</b></div></div>
    ${row('data-act="about"', 'list', 'О Mix и поддержка', 'Вопросы, конфиденциальность, условия')}
    <div class="sechead"><div><b>Память</b></div></div>
    <div class="store">${$('#store').innerHTML}</div>
  </li>`;
}
// ---------- скачать для офлайна: плейлист, альбом, «Любимое» целиком ----------
let offlineRun = false;
async function downloadAll(ids) {
  if (offlineRun) return;
  const todo = ids.map(id => getT(id)).filter(t => t && t.source === 'tg' && !t.downloaded);
  if (!todo.length) { toast('Всё уже скачано — играет без интернета'); return; }
  offlineRun = true; let done = 0;
  try {
    for (const t of todo) {
      if (!navigator.onLine) { toast('Нет интернета, докачаю позже'); break; }
      toast(`Скачиваю для офлайна: ${done + 1} из ${todo.length}`);
      try { await downloadTrack(t); done++; } catch (e) { console.warn('offline', t.title, e); }
    }
  } finally { offlineRun = false; }
  toast(`Скачано для офлайна: ${tracksWord(done)}`); render();
}

// ---------- продолжить с того же места ----------
function saveResume() {
  const t = engine.track; if (!t || t.source === 'preview') return;
  db.put('kv', 'resume', { id: t.id, pos: Math.round(engine.position), queue: queue.slice(0, 400), base: queueBase.slice(0, 400), wave: waveMode, at: Date.now() });
}
async function restoreResume() {
  const r = await db.get('kv', 'resume').catch(() => null);
  if (!r || engine.track || Date.now() - r.at > 14 * 864e5) return;
  const t = getT(r.id); if (!t) return;
  queue = (r.queue || []).filter(id => getT(id)); queueBase = (r.base || []).filter(id => getT(id)); waveMode = !!r.wave;
  if (!queue.includes(r.id)) queue.unshift(r.id);
  try { await engine.play(t, { offset: r.pos || 0, keepPaused: true }); } catch {}
}

// ---------- карточки: «Сейчас слушаю» и «Итоги года» ----------
async function loadImg(src) { return new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
function cardBase() {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const g = c.getContext('2d'), css = getComputedStyle(document.documentElement);
  const c1 = css.getPropertyValue('--c1').trim() || '#7a5cff', c2 = css.getPropertyValue('--c2').trim() || '#ff8fb8';
  const bg = g.createLinearGradient(0, 0, 1080, 1920); bg.addColorStop(0, c1); bg.addColorStop(.55, c2); bg.addColorStop(1, '#120c20');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1920);
  g.fillStyle = 'rgba(10,6,20,.35)'; g.fillRect(0, 0, 1080, 1920);
  g.fillStyle = '#fff'; g.font = '800 44px system-ui, sans-serif'; g.fillText('Mix', 90, 1830);
  return { c, g };
}
function wrapText(g, text, x, y, max, lh, lines = 2) {
  const words = String(text).split(' '); let line = '', n = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (g.measureText(test).width > max && line) { g.fillText(n === lines - 1 ? line + '…' : line, x, y); y += lh; line = w; if (++n >= lines) return y; }
    else line = test;
  }
  if (line) { g.fillText(line, x, y); y += lh; }
  return y;
}
async function shareCanvas(c, name) {
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], name + '.png', { type: 'image/png' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch { return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Картинка сохранена');
}
async function shareNowCard() {
  const t = engine.track; if (!t) { toast('Сначала включи трек'); return; }
  const { c, g } = cardBase();
  const src = t.cover ? await coverUrl(t.id).catch(() => null) : t.art;
  const img = await loadImg(src);
  g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 60; g.beginPath(); g.roundRect(140, 300, 800, 800, 48); g.fillStyle = '#222'; g.fill(); g.restore();
  if (img) { g.save(); g.beginPath(); g.roundRect(140, 300, 800, 800, 48); g.clip(); g.drawImage(img, 140, 300, 800, 800); g.restore(); }
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 40px system-ui, sans-serif'; g.fillText('Сейчас слушаю', 140, 230);
  g.fillStyle = '#fff'; g.font = '800 72px system-ui, sans-serif';
  const y = wrapText(g, t.title, 140, 1220, 800, 84);
  g.fillStyle = 'rgba(255,255,255,.8)'; g.font = '600 50px system-ui, sans-serif'; wrapText(g, t.artist || '', 140, y + 10, 800, 60, 1);
  await shareCanvas(c, 'Сейчас слушаю');
}
async function shareYearCard() {
  const from = Date.now() - 365 * 864e5, ls = lib.listens.filter(l => l.at >= from);
  if (!ls.length) { toast('Пока нечего считать'); return; }
  const idx = creditIndex(), arts = new Map(), trs = new Map(); let sec = 0;
  for (const l of ls) {
    sec += l.played || 0; const t = tracks.get(l.id), p = (t && idx.get(t.id)?.[0]) || { key: l.artist, name: l.artist || '—' };
    arts.set(p.key, { name: p.name, sec: (arts.get(p.key)?.sec || 0) + (l.played || 0), t: t || arts.get(p.key)?.t });
    if (t) trs.set(t.id, { t, n: (trs.get(t.id)?.n || 0) + 1 });
  }
  const ta = [...arts.values()].sort((a, b) => b.sec - a.sec), tt = [...trs.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  const { c, g } = cardBase();
  g.fillStyle = '#fff'; g.font = '800 84px system-ui, sans-serif'; g.fillText('Мой год в Mix', 90, 220);
  g.font = '800 200px system-ui, sans-serif'; g.fillText(Math.round(sec / 60).toLocaleString('ru'), 90, 470);
  g.fillStyle = 'rgba(255,255,255,.8)'; g.font = '600 50px system-ui, sans-serif'; g.fillText('минут музыки', 90, 540);
  if (ta[0]) {
    const img = await loadImg(ta[0].t ? (ta[0].t.cover ? await coverUrl(ta[0].t.id).catch(() => null) : ta[0].t.art) : null);
    if (img) { g.save(); g.beginPath(); g.arc(250, 790, 160, 0, Math.PI * 2); g.clip(); g.drawImage(img, 90, 630, 320, 320); g.restore(); }
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 40px system-ui, sans-serif'; g.fillText('Главный артист', 460, 740);
    g.fillStyle = '#fff'; g.font = '800 64px system-ui, sans-serif'; wrapText(g, ta[0].name, 460, 820, 560, 72, 2);
  }
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 44px system-ui, sans-serif'; g.fillText('Топ треков', 90, 1080);
  let y = 1170;
  tt.forEach((x, i) => { g.fillStyle = '#fff'; g.font = '800 48px system-ui, sans-serif'; g.fillText(`${i + 1}.`, 90, y); g.font = '700 46px system-ui, sans-serif'; wrapText(g, `${x.t.title} — ${x.t.artist || ''}`, 160, y, 830, 54, 1); y += 110; });
  await shareCanvas(c, 'Мой год в Mix');
}

const viewName = () => (smartName(view) || (view.startsWith('collab:') ? (settings.collabs || []).find(c => c.id === view.slice(7))?.title : null)) || ({ ...SMART, news: 'Новинки', stats: 'Итоги', dups: 'Дубликаты', settings: 'Настройки', all: 'Вся музыка', liked: 'Любимое', recent: 'Недавние', fix: 'Проверка названий', wave: 'Волна', wish: 'Хочу скачать', albums: 'Альбомы' })[view] || (view.startsWith('webartist:') ? decodeURIComponent(view.slice(10)) : view.startsWith('album:') ? (albumGroups().find(g => g.key === view.slice(6)) || webAlbum(view.slice(6)))?.name : view.startsWith('artist:') ? artistGroups().find(g => g.key === view.slice(7))?.name : lib.playlists.find(p => p.id === view)?.name) || 'Плейлист';

function rowHTML(t, n) {
  const liked = lib.likes.has(t.id);
  const dot = t.downloaded ? '' : `<span class="dl${t.dlp != null ? ' ing' : ''}" title="${t.dlp != null ? 'Скачивается' : 'Ещё не скачан'}"></span>`;
  return `<li class="row${t.id === curId ? ' on' : ''}" data-id="${esc(t.id)}">
    <span class="idx"><span class="num">${n}</span><span class="eqi"><i></i><i></i><i></i></span></span>
    ${coverHTML(t)}
    <span class="ttl"><span class="t">${dot}${esc(t.title)}${t.previewOnly ? '<em class="pvtag">30 с</em>' : ''}</span><span class="a">${esc(t.artist || 'Неизвестный артист')}</span></span>
    <span class="alb">${esc(t.album || '')}</span>
    <button class="like${liked ? ' on' : ''}" data-like title="${liked ? 'Убрать из любимого' : 'В любимое'}"><svg><use href="#i-heart${liked ? '' : '-o'}"/></svg></button>
    <button class="add" data-add title="Добавить в плейлист или альбом"><svg><use href="#i-plus"/></svg></button>
    <span class="dur">${fmt(t.duration)}</span>
    <button class="more" data-more title="Ещё"><svg><use href="#i-more"/></svg></button>
  </li>`;
}

let lastView;
function render() {
  creditCache = null;
  if (lastView !== view) { lastView = view; const m = $('#main'); m.classList.remove('vin'); void m.offsetWidth; m.classList.add('vin'); }
  // шапка плейлиста: мозаика из обложек его треков
  { const pl = lib.playlists.find(p => p.id === view), head = $('.head'); let hc = $('#hcover');
    if (pl) { if (!hc) { hc = document.createElement('div'); hc.id = 'hcover'; head.prepend(hc); }
      const ts = pl.ids.map(id => tracks.get(id)).filter(Boolean).slice(0, 4);
      hc.className = 'hcover n' + ts.length; hc.innerHTML = ts.map(t => coverHTML(t)).join(''); }
    else hc?.remove();
    head.classList.toggle('plview', !!pl); }
  $('.head-tools').hidden = view === 'fix' || view === 'wave' || view === 'wish' || view === 'settings';
  $('.fixbar')?.remove();
  if (view !== 'all') { $('#shelf').hidden = true; $('#shelf').innerHTML = ''; }
  $('#sort').hidden = ['artists', 'recent', 'albums', 'news', 'stats', 'dups', 'settings'].includes(view) || !!smartName(view) || view.startsWith('collab:') || view.startsWith('album:');
  $('#sort').value = settings.sort;
  if (['fix', 'wave', 'wish', 'artists', 'albums'].includes(view)) { clearList(); $('#extra').innerHTML = ''; $('#disc').innerHTML = ''; }
  if (view === 'fix') { renderFix(); renderNav(); return; }
  if (view === 'wave') { renderWave(); renderNav(); return; }
  if (view === 'wish') { renderWish(); renderNav(); return; }
  if (view === 'news' || view === 'stats' || view === 'dups' || view === 'settings') { clearList(); $('#playAll').hidden = true; $('#extra').innerHTML = ''; $('#disc').innerHTML = ''; view === 'news' ? renderNews() : view === 'dups' ? renderDups() : view === 'settings' ? renderSettings() : renderStats(); renderNav(); if (view === 'news') newsHunt(); return; }
  if (view === 'artists') { $('#playAll').hidden = true; $('#extra').innerHTML = ''; renderArtists(); renderNav(); paintWebSearch(); return; }
  if (view === 'albums') { clearList(); $('#playAll').hidden = true; $('#extra').innerHTML = ''; renderAlbums(); renderNav(); paintWebSearch(); return; }
  const ids = viewIds();
  $('#viewTitle').firstChild.textContent = viewName();
  const total = ids.reduce((s, id) => s + (tracks.get(id).duration || 0), 0);
  listSub = ids.length ? tracksWord(ids.length) + (total > 60 ? ', ' + Math.round(total / 60) + ' мин' : '') : '';
  paintSub();
  $('#playAll').hidden = !ids.length;
  const empty = $('#empty');
  empty.hidden = !!ids.length;
  if (!ids.length) empty.innerHTML = emptyHTML();
  const rows = $('#rows');
  const cut = view.startsWith('artist:') && !artistAll && ids.length > 6;
  listIds = cut ? ids.slice(0, 5) : ids; listFrom = -1;
  if (!view.startsWith('artist:') && !view.startsWith('webartist:')) $('#disc').innerHTML = '';
  $('#extra').innerHTML = '';
  paintWebSearch();
  { const pl = lib.playlists.find(p => p.id === view); if (pl && pl.ids.length && tgCfg?.chatId) $('#extra').insertAdjacentHTML('afterbegin', '<button class="btn showall" data-act="sharePl">Поделиться плейлистом с музыкой</button>'); }
  { const left = ids.filter(id => { const t = getT(id); return t && t.source === 'tg' && !t.downloaded; }).length;
    if (left && (view === 'liked' || view.startsWith('pl') || view.startsWith('album:') || view.startsWith('collab:') || smartName(view))) $('#extra').insertAdjacentHTML('afterbegin', `<button class="btn showall" data-act="offline">Скачать для офлайна (${left})</button>`); }
  if (view.startsWith('collab:') && navigator.onLine) { const c = (settings.collabs || []).find(x => x.id === view.slice(7)); if (c && Date.now() - (c.scanned || 0) > 60e3) { c.scanned = Date.now(); scanCollab(c).catch(() => {}); } }
  if (view.startsWith('webartist:')) { paintArtistCatalog(); $('#empty').hidden = true; $('#playAll').hidden = true; }
  if (view.startsWith('artist:')) { paintArtistCatalog(); if (cut) $('#extra').innerHTML = `<button class="btn showall" data-act="artistAll">Показать все треки (${ids.length})</button>`; }
  if (view.startsWith('album:')) { const g = albumGroups().find(x => x.key === view.slice(6)) || webAlbum(view.slice(6)); if (g) { if (g.total > ids.length) { listSub = `есть ${ids.length} из ${g.total}`; paintSub(); } paintAlbumMissing(g); } }
  renderShelf();
  paintList();
  renderNav();
}
// Полка наверху «Всей музыки»: вход в Волну и то, что слушал недавно
function renderShelf() {
  const el = $('#shelf');
  const recent = [...new Set(lib.history.map(h => h.id))].filter(id => tracks.has(id)).slice(0, 10);
  el.hidden = view !== 'all' || !!query || !tracks.size;
  if (el.hidden) { el.innerHTML = ''; return; }
  el.innerHTML = `<button class="tile wavetile" data-view="wave"><span class="tileorb"><svg><use href="#i-wave"/></svg></span><b>Моя волна</b><small>Твоё и похожее</small></button>`
    + recent.map(id => { const t = tracks.get(id); return `<button class="tile" data-play="${esc(id)}">${coverHTML(t)}<b>${esc(t.title)}</b><small>${esc(t.artist || 'Неизвестный артист')}</small></button>`; }).join('');
  hydrateIn(el);
}
// Виртуальный список: при тысячах треков в странице лежат только те строки, что видно на экране
let listIds = [], listFrom = -1, listTo = -1, listTick = false;
const BUFFER = 18;
function clearList() { listIds = []; listFrom = -1; const r = $('#rows'); r.style.paddingTop = r.style.paddingBottom = ''; }
function paintList() {
  const rows = $('#rows'), main = $('#main');
  if (!listIds.length) { rows.style.paddingTop = rows.style.paddingBottom = ''; if (listFrom !== -2) rows.innerHTML = ''; listFrom = -2; return; }
  const rowH = isPhone() ? 66 : 62, full = listFrom < 0;
  const top = rows.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
  const seenFrom = Math.floor((main.scrollTop - top) / rowH), seenTo = Math.ceil((main.scrollTop - top + main.clientHeight) / rowH);
  // пока запас строк не подходит к концу, ничего не трогаем
  if (!full && (seenFrom - 6 >= listFrom || listFrom === 0) && (seenTo + 6 <= listTo || listTo === listIds.length)) return;
  if (seenFrom >= listIds.length) { main.scrollTop = 0; listFrom = -1; paintList(); return; } // список стал короче
  const from = Math.max(0, seenFrom - BUFFER), to = Math.min(listIds.length, seenTo + BUFFER);
  const had = full ? new Map() : new Map([...rows.children].map(el => [el.dataset.id, el]));
  const box = document.createElement('template'), frag = document.createDocumentFragment();
  for (let i = from; i < to; i++) {
    const id = listIds[i];
    let el = had.get(id);
    if (!el) { box.innerHTML = rowHTML(tracks.get(id), i + 1); el = box.content.firstElementChild; }
    frag.append(el);
  }
  listFrom = from; listTo = to;
  rows.style.paddingTop = from * rowH + 'px';
  rows.style.paddingBottom = (listIds.length - to) * rowH + 'px';
  rows.replaceChildren(frag);
  hydrateIn(rows);
}
function emptyHTML() {
  if (query) return `<h2>Ничего не нашлось</h2><p>По запросу «${esc(query)}» треков нет. Попробуй часть названия или имя артиста.</p>`;
  if (view === 'liked') return `<h2>Здесь будет любимое</h2><p>Нажми на сердечко у трека, и он появится в этом списке.</p>`;
  if (view.startsWith('artist:')) return '<h2>Треков этого автора больше нет</h2>';
  if (view.startsWith('collab:')) return '<h2>Плейлист пока пустой</h2><p>Добавляйте треки: «⋯» у трека → «Добавить в плейлист» → этот совместный плейлист. Или просто пересылайте треки в эту группу в Telegram.</p>';
  if (smartName(view)) return '<h2>Пока пусто</h2><p>Подборка соберётся сама, когда ты послушаешь больше музыки.</p>';
  if (view.startsWith('album:')) return '<h2>Из этого альбома у тебя пока ничего нет</h2><p>Ниже весь трек-лист: плюс — в «Хочу скачать», «Найти» — открыть бота.</p>';
  if (view === 'recent') return `<h2>Ты ещё ничего не слушал</h2><p>Включи любой трек, и история появится здесь.</p>`;
  if (view !== 'all') return `<h2>Плейлист пока пустой</h2><p>Нажми «⋯» у любого трека и выбери «Добавить в плейлист».</p>
    <div class="acts"><button class="btn" data-act="delPlaylist">Удалить плейлист</button></div>`;
  return `<h2>Музыка из твоего канала</h2>
    <p>Mix скачает треки из твоего Telegram-канала на это устройство, и слушать их можно будет даже без интернета.</p>
    ${needsIosInstallHint() ? '<p>На iPhone сначала нажми «Поделиться» → «На экран Домой» и открой Mix с этой иконки: у неё своё хранилище, и вход в Telegram нужно делать в ней.</p>' : ''}
    <div class="acts"><button class="btn primary" data-act="tg">Подключить Telegram</button><button class="btn" data-act="files">Добавить файлы</button></div>`;
}
function updateRow(id) {
  const el = $(`.row[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  const n = el.querySelector('.num').textContent;
  el.outerHTML = rowHTML(tracks.get(id), n);
  hydrateIn($(`.row[data-id="${CSS.escape(id)}"]`));
}
function markCurrent() {
  $$('.row.on').forEach(r => r.classList.remove('on'));
  if (curId) $(`.row[data-id="${CSS.escape(curId)}"]`)?.classList.add('on');
}

const isPhone = () => matchMedia('(max-width: 900px)').matches;
function renderTabs() {
  const main = ['wave', 'all', 'artists', 'liked'];
  const on = id => view === id || (id === 'artists' && view.startsWith('artist:'));
  const tab = (id, icon, name) => `<button class="${on(id) ? 'on' : ''}" data-view="${id}"><svg><use href="#i-${icon}"/></svg><span>${name}</span></button>`;
  $('#tabs').innerHTML = tab('wave', 'wave', 'Волна') + tab('all', 'all', 'Музыка') + tab('artists', 'artist', 'Авторы') + tab('liked', 'heart', 'Любимое')
    + `<button class="${main.some(on) ? '' : 'on'}" data-act="more"><svg><use href="#i-more"/></svg><span>Ещё</span>${wishes().length + fixCount() ? '<i class="tabdot"></i>' : ''}</button>`;
}
function openMore() {
  const row = (attr, icon, name, n) => `<button class="morerow" ${attr}><svg><use href="#i-${icon}"/></svg><span>${esc(name)}</span>${n ? `<em>${n}</em>` : ''}</button>`;
  modal(`<div class="grab"></div>
    <div class="morehead">Слушать</div>
    ${row('data-view="news"', 'wave', 'Новинки', newsUnseen())}
    ${row('data-view="stats"', 'clock', 'Итоги')}
    ${smartEntries().map(([k, n]) => row(`data-view="${k}"`, 'list', n)).join('')}
    <div class="morehead">Библиотека</div>
    ${row('data-view="albums"', 'list', 'Альбомы')}
    ${row('data-view="recent"', 'clock', 'Недавние')}
    <div class="morehead">Инструменты</div>
    ${row('data-view="wish"', 'wish', 'Хочу скачать', wishes().length)}
    ${row('data-view="fix"', 'wand', 'Проверка названий', fixCount())}
    ${row('data-act="listen"', 'mic', 'Что играет?')}
    ${row('data-act="import"', 'plus', 'Импорт плейлиста')}
    ${row('data-view="dups"', 'copy', 'Дубликаты')}
    ${row('data-act="invite"', 'artist', 'Mix для друга')}
    ${row('data-view="settings"', 'eq', 'Настройки')}
    <div class="morehead">Плейлисты<button data-act="newPlaylist" title="Новый плейлист"><svg><use href="#i-plus"/></svg></button></div>
    ${lib.playlists.map(p => row(`data-view="${esc(p.id)}"`, 'list', p.name, p.ids.length)).join('') || '<p class="morenote">Пока нет. Нажми плюс, чтобы создать первый.</p>'}
    <div class="tgcard moretg">${$('#tgcard').innerHTML}</div>`);
}
// папки в боковом меню: «Подборки» и «Плейлисты» складываются по нажатию на заголовок
let navFold = {}; try { navFold = JSON.parse(localStorage.getItem('mixFold') || '{}'); } catch {}
const fold = (k, name, extra, body) => `<div class="nav-title navgrp fhead${navFold[k] ? ' shut' : ''}" data-fold="${k}"><span class="fchev"><svg><use href="#i-up"/></svg></span><span class="fname">${name}</span>${extra}</div><div class="fbody${navFold[k] ? ' shut' : ''}"><div>${body}</div></div>`;
$('#nav').addEventListener('click', e => {
  const h = e.target.closest('[data-fold]'); if (!h || e.target.closest('button')) return;
  const k = h.dataset.fold; navFold[k] = !navFold[k]; try { localStorage.setItem('mixFold', JSON.stringify(navFold)); } catch {}
  h.classList.toggle('shut', navFold[k]); h.nextElementSibling.classList.toggle('shut', navFold[k]);
});
function renderNav() {
  renderTabs();
  const item = (id, icon, name, n) => `<button class="${view === id || (id === 'artists' && view.startsWith('artist:')) ? 'on' : ''}" data-view="${esc(id)}"><svg><use href="#i-${icon}"/></svg>${esc(name)}${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
  const head = name => `<div class="nav-title navgrp">${name}</div>`;
  $('#nav').innerHTML = head('Слушать') + item('wave', 'wave', 'Волна')
    + item('news', 'wave', 'Новинки', newsUnseen() || null)
    + item('stats', 'clock', 'Итоги')
    + head('Библиотека') + item('all', 'all', 'Вся музыка', order.length || null)
    + item('artists', 'artist', 'Авторы')
    + item('albums', 'list', 'Альбомы')
    + item('liked', 'heart', 'Любимое', lib.likes.size || null)
    + item('recent', 'clock', 'Недавние')
    + head('Инструменты') + item('wish', 'wish', 'Хочу скачать', wishes().length || null)
    + item('fix', 'wand', 'Проверка названий', fixCount() || null)
    + `<button data-act="listen"><svg><use href="#i-mic"/></svg>Что играет?</button>`
    + `<button data-act="import"><svg><use href="#i-plus"/></svg>Импорт плейлиста</button>`
    + item('dups', 'copy', 'Дубликаты')
    + `<button data-act="invite"><svg><use href="#i-artist"/></svg>Mix для друга</button>`
    + item('settings', 'eq', 'Настройки')
    + fold('sm', 'Подборки', '', smartEntries().map(([k, n]) => item(k, 'list', n)).join(''))
    + fold('pl', 'Плейлисты', `<button data-act="newPlaylist" title="Новый плейлист"><svg><use href="#i-plus"/></svg></button>`,
      (settings.collabs || []).map(c => item('collab:' + c.id, 'artist', '👥 ' + c.title)).join('')
      + lib.playlists.map(p => item(p.id, 'list', p.name, p.ids.length || null)).join('')
      + `<button data-act="collab"><svg><use href="#i-plus"/></svg>Совместный плейлист</button>`);
}

// ---------- очередь и плеер ----------
const engine = new Engine({
  load: loadAudio,
  getNext: t => { const id = neighbour(t.id, 1); return id ? getT(id) : null; },
  onBounds: (t, b) => { t.bounds = b; if (!t.duration) { t.duration = b.d; updateRow(t.id); } saveTrack(t); },
});
engine.cf = settings.cf;

let userQueue = [], queueAnchor = null, fromUser = null;
function neighbour(id, dir) {
  if (dir > 0 && userQueue.length) return userQueue[0];
  let i = id === fromUser ? -1 : queue.indexOf(id);
  if (i < 0) i = queue.indexOf(queueAnchor); // сейчас играет трек из ручной очереди
  if (i < 0 || !queue.length) return null;
  let j = i + dir;
  if (j >= queue.length) { if (!settings.repeat && !waveMode) return null; j = 0; }
  if (j < 0) j = settings.repeat ? queue.length - 1 : 0;
  return queue[j] === id && dir > 0 ? null : queue[j];
}
function shuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Вперемешку, но так, чтобы треки подходили друг к другу. Первые 200 подбираем, остальные случайно: дальше всё равно редко доходят.
function smartShuffle(startId, ids) {
  const rest = ids.filter(id => id !== startId), first = tracks.get(startId);
  const rows = rest.map(id => tracks.get(id)).filter(Boolean);
  const smart = nextWave(rows, currentTaste(), { count: Math.min(200, rows.length), after: first, history: recentIds() }).map(t => t.id);
  const used = new Set(smart);
  return [startId, ...smart, ...shuffled(rest.filter(id => !used.has(id)))];
}
function buildQueue(startId, ids = viewIds()) {
  queueBase = ids.slice();
  queue = settings.shuffle ? smartShuffle(startId, ids) : ids.slice();
}

// Скип и выбор трека — всегда без перехода; плавно только сам конец трека
async function playId(id, fade = 0, quiet = false) {
  const t = getT(id); if (!t) return false;
  try { await engine.play(t, { fade }); return true; }
  catch (e) { if (quiet) { console.warn('skip', t.title, e.message); return false; } toast(t.source === 'preview' ? 'Превью не загрузилось, проверь интернет' : t.downloaded ? 'Не получилось открыть этот файл' : 'Трек ещё не скачан, а Telegram сейчас недоступен'); console.error(e); return false; }
}
function playFromView(id) { waveMode = false; buildQueue(id); playId(id); }
// Трек, который не открывается (не скачан, из другого канала), пропускаем и берём следующий
let skipToken = 0;
async function next() {
  const my = ++skipToken;
  let id = curId && neighbour(curId, 1), first = id;
  for (let i = 0; id && i < 25; i++) {
    if (await playId(id, 0, true)) return; // очередь не пересобираем: она должна оставаться такой, какой её видишь
    if (my !== skipToken) return;
    if (userQueue[0] === id) { userQueue.shift(); saveQueue(); }
    id = neighbour(id, 1);
    if (id === first) break;
  }
  if (my === skipToken && first) toast('Дальше нет треков, которые можно включить');
}
const saveQueue = () => db.put('kv', 'userQueue', userQueue);
function addToQueue(id, first = false) {
  const t = getT(id); if (!t) return;
  if (!engine.track) { waveMode = false; if (!queue.length) queue = queueBase = [id]; playId(id); return; }
  userQueue = userQueue.filter(x => x !== id);
  first ? userQueue.unshift(id) : userQueue.push(id);
  saveQueue(); engine.refreshNext(); paintNext(); paintQueue();
  toast(first ? 'Сыграет следующим' : `В очереди: ${t.title}`);
}
function queueUpcoming() {
  const i = Math.max(0, queue.indexOf(curId !== fromUser && queue.includes(curId) ? curId : queueAnchor));
  return queue.slice(i + 1, i + 101).filter(id => getT(id) && !userQueue.includes(id));
}
const queueRow = (id, kind, n) => {
  const t = getT(id);
  return `<li class="qrow" data-q="${esc(id)}" data-kind="${kind}">${coverHTML(t)}<span class="ttl"><span class="t">${esc(t.title)}</span><span class="a">${esc(t.artist || 'Неизвестный артист')}</span></span>
    ${kind === 'user' && n > 0 ? '<button class="ib" data-qa="up" title="Выше"><svg><use href="#i-up"/></svg></button>' : ''}
    ${kind !== 'now' ? '<span class="qdrag" data-qa="drag" title="Перетащи, чтобы поменять порядок">≡</span>' : ''}
    <button class="ib" data-qa="del" title="Убрать из очереди"><svg><use href="#i-x"/></svg></button></li>`;
};
function queueHTML() {
  const mine = userQueue.filter(getT), next = queueUpcoming();
  return `<h3>Очередь</h3>${engine.track ? `<div class="qhead">Сейчас играет</div><ul class="qlist">${queueRow(engine.track.id, 'now', 0).replace(/<button[\s\S]*<\/button>/, '')}</ul>` : ''}
    ${mine.length ? `<div class="qhead">В очереди<button class="chip" data-qa="clear">Очистить</button></div><ul class="qlist">${mine.map((id, n) => queueRow(id, 'user', n)).join('')}</ul>` : '<p class="qempty">Нажми плюс у трека и выбери «В очередь».</p>'}
    ${next.length ? `<div class="qhead">Дальше по списку</div><ul class="qlist">${next.map(id => queueRow(id, 'base', 0)).join('')}</ul>` : ''}`;
}
function paintQueue() {
  const box = $('.queuepop .qbody'); if (!box) return;
  const top = box.scrollTop;
  box.innerHTML = queueHTML(); hydrateIn(box); box.scrollTop = top;
}
function openQueue() {
  if ($('.queuepop')) { dismissLayer(); return; }
  const el = popup('<div class="qbody"></div>');
  el.classList.add('queuepop');
  paintQueue();
  // перетаскивание за «≡»: меняем порядок в своей очереди или в списке дальше
  el.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-qa=drag]'); if (!h) return;
    e.preventDefault();
    const row = h.closest('.qrow'), kind = row.dataset.kind, id = row.dataset.q;
    row.classList.add('dragging');
    const move = ev => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.qrow');
      if (!over || over === row || over.dataset.kind !== kind) return;
      const r = over.getBoundingClientRect();
      over.parentElement.insertBefore(row, ev.clientY < r.top + r.height / 2 ? over : over.nextSibling);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      row.classList.remove('dragging');
      const order2 = [...row.parentElement.querySelectorAll('.qrow')].map(x => x.dataset.q);
      if (kind === 'user') userQueue = order2;
      else { const i = queue.indexOf(curId !== fromUser && queue.includes(curId) ? curId : queueAnchor); const shown = new Set(order2); queue = [...queue.slice(0, i + 1), ...order2, ...queue.slice(i + 1).filter(q => !shown.has(q))]; }
      saveQueue(); engine.refreshNext(); paintNext(); paintQueue();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-qa]')?.dataset.qa, row = e.target.closest('.qrow'), id = row?.dataset.q;
    if (a === 'drag') return;
    if (a === 'clear') { userQueue = []; }
    else if (a === 'del') {
      if (row.dataset.kind === 'user') userQueue = userQueue.filter(x => x !== id);
      else queue = queueBase = queue.filter(x => x !== id);
    } else if (a === 'up') {
      const i = userQueue.indexOf(id);
      if (i > 0) [userQueue[i - 1], userQueue[i]] = [userQueue[i], userQueue[i - 1]];
    } else if (row && row.dataset.kind !== 'now') { playId(id); return; }
    else return;
    saveQueue(); engine.refreshNext(); paintNext(); paintQueue();
  });
}
const backStack = [];
let goingBack = false;
function prev() {
  if (engine.position > 3) { engine.seek(0); return; }
  const id = backStack.pop() || (curId && neighbour(curId, -1));
  if (!id) { engine.seek(0); return; }
  goingBack = true;
  playId(id);
}
function toggle() {
  if (!engine.track && view === 'wave') { startWave(); return; }
  if (!engine.track) { const ids = viewIds(); if (ids.length) playFromView(ids[0]); return; }
  engine.toggle();
}

engine.addEventListener('track', () => {
  const t = engine.track;
  closeListen();
  if (t) listening = { id: t.id, played: 0 };
  if (curId && !goingBack && curId !== t?.id) { backStack.push(curId); if (backStack.length > 100) backStack.shift(); }
  goingBack = false;
  curId = t?.id || null;
  if (t) {
    const before = userQueue.length;
    userQueue = userQueue.filter(id => id !== t.id);
    if (userQueue.length !== before) { saveQueue(); fromUser = t.id; }
    else { fromUser = null; if (queue.includes(t.id)) queueAnchor = t.id; }
  }
  if (waveMode) refillWave();
  if (previewEl && t) stopPreview();
  paintQueue();
  markCurrent(); paintNow(); applyTone(t); paintOrb();
  if (t?.source === 'preview' && !t.tone && t.art) fetchArt(t.art).then(toneOf).then(v => { t.tone = v; if (engine.track === t) applyTone(t); }).catch(() => {});
  if (t && t.source !== 'preview') { lib.history.unshift({ id: t.id, at: Date.now() }); lib.history.length = Math.min(lib.history.length, 300); saveLib(); }
  mediaMeta(t);
  if (lyricsOn) loadLyrics();
});
engine.addEventListener('state', paintState);
engine.addEventListener('track', () => paintWaveBars());
engine.addEventListener('state', () => paintWaveBars());
// Страховка: если следующий трек не запустился сам (не скачался, не раскодировался), пробуем дальше по очереди
engine.addEventListener('ended', () => { if (curId && neighbour(curId, 1)) setTimeout(() => next(), 300); });
// Mix в фоне или экран погашен — не рисуем живой фон: iOS тогда реже выгружает плеер
document.addEventListener('visibilitychange', () => document.body.classList.toggle('bghidden', document.hidden));
engine.addEventListener('state', () => { if (engine.paused && !document.hidden) setTimeout(soundHunt, 3000); });
engine.addEventListener('ended', paintState);

// ---------- что и сколько слушал: основа вкуса для Волны ----------
let listening = null, lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(now - lastTick, 65000); // таймеры в фоне редкие, но не считаем сон устройства
  lastTick = now;
  if (listening && engine.track && !engine.paused) listening.played += dt / 1000;
}, 1000);
function closeListen() {
  const l = listening; listening = null;
  const t = l && getT(l.id);
  if (!t || l.played < 3) return;
  const d = t.duration || t.bounds?.d || 0;
  lib.listens.push({ id: t.id, artist: t.artist, title: t.title, at: Date.now(), played: Math.round(l.played), playedFraction: d ? Math.min(1, l.played / d) : 0 });
  if (lib.listens.length > 10000) lib.listens.splice(0, lib.listens.length - 10000);
  saveLib();
}

// ---------- Волна ----------
const fxKey = (artist, title) => (artist + '|' + title).toLowerCase();
function currentTaste() {
  const listens = [...lib.listens], likes = [...lib.likes], dismissals = [];
  for (const [k, v] of Object.entries(waveFx)) {
    if (k.startsWith('listens:') && Array.isArray(v)) listens.push(...v);
    else if (k.startsWith('d:')) dismissals.push(v);
    else if (k.startsWith('l:') || k.startsWith('w:')) likes.push(v); // хочет скачать — значит, нравится
  }
  return buildTaste({ listens, likes, dismissals, library: [...tracks.values()] });
}
const recentIds = () => lib.history.slice(0, 40).map(h => h.id).reverse();
// без сети играть можно только уже скачанное
const waveLibrary = () => { const all = [...tracks.values()]; return navigator.onLine ? all : all.filter(t => t.downloaded); };
// Радио: начинаем с выбранного трека, дальше Волна подбирает похожие по звучанию, темпу и жанру
function startRadio(id) {
  const t = getT(id); if (!t) return;
  const picks = nextWave(waveLibrary().filter(x => x.id !== id), currentTaste(), { count: 40, history: recentIds(), after: t });
  waveMode = true;
  queue = queueBase = [id, ...picks.map(x => x.id)];
  injectPreviews();
  playId(id);
  toast(`Радио по треку «${t.title}»`);
}
function startWave() {
  const library = waveLibrary();
  if (!library.length) { toast(tracks.size ? 'Без интернета волне нечего играть: треки ещё не скачаны' : 'Сначала добавь музыку'); return; }
  const picks = nextWave(library, currentTaste(), { count: 40, history: recentIds(), after: engine.track });
  if (!picks.length) { toast('Волне нечего играть: все треки отмечены как «не моё»'); return; }
  waveMode = true;
  queue = queueBase = picks.map(t => t.id);
  injectPreviews();
  playId(queue[0]);
  if (view === 'wave') renderWave();
  if (settings.waveSimilar && !sug.items.length && navigator.onLine) loadSuggestions();
}
// Волна бесконечная: подливаем новые треки, пока очередь не кончилась
function refillWave() {
  const i = queue.indexOf(curId);
  if (i < 0 || queue.length - i > 4) return;
  const keep = queue.slice(Math.max(0, i - 5));
  const more = nextWave(waveLibrary(), currentTaste(), { count: 10, history: [...recentIds(), ...keep], after: getT(keep.at(-1)) }).map(t => t.id).filter(id => !keep.includes(id));
  queue = queueBase = [...keep, ...more];
  injectPreviews();
  engine.refreshNext();
}
// Похожие треки: 30-секундные превью между своими, примерно каждый третий трек
const waveUsed = new Set();
function injectPreviews() {
  if (!settings.waveSimilar || !navigator.onLine) return;
  const fresh = sug.items.filter(s => s.preview && !waveUsed.has(fxKey(s.artist, s.title)) && !waveFx['d:' + fxKey(s.artist, s.title)]);
  if (!fresh.length) return;
  const at = Math.max(0, queue.indexOf(curId));
  const out = queue.slice(0, at + 1);
  let own = 0;
  for (const id of queue.slice(at + 1)) {
    out.push(id);
    if (getT(id)?.source === 'preview') { own = 0; continue; }
    if (++own >= 2 && fresh.length) { out.push(previewTrack(fresh.shift()).id); own = 0; }
  }
  queue = queueBase = out;
}
function previewTrack(s) {
  const key = fxKey(s.artist, s.title), id = 'pv:' + key;
  waveUsed.add(key);
  if (!virtual.has(id)) virtual.set(id, { id, source: 'preview', title: s.title, artist: s.artist, album: s.album || '', art: s.art, previewUrl: s.preview, released: s.released || '', duration: 30, downloaded: true, because: s.because, seed: s.seed, addedAt: Date.now() });
  return virtual.get(id);
}
// Превью понравилось: сохраняем его в библиотеку, чтобы можно было лайкать и класть в плейлисты
async function keepPreview(v) {
  if (v.libId && tracks.has(v.libId)) return tracks.get(v.libId);
  const full = [...tracks.values()].find(x => !x.previewOnly && sameTrack(v, x));
  if (full) { v.libId = full.id; return full; } // полный трек уже есть — превью не нужно
  addWish(v);
  const blob = await (await fetch(v.previewUrl)).blob();
  const id = 'f:' + v.id, t = { id, source: 'file', fileName: `${v.artist} - ${v.title}.m4a`, title: v.title, artist: v.artist, album: v.album, released: v.released, duration: v.bounds?.d || 30, size: blob.size, mime: blob.type, downloaded: true, addedAt: Date.now(), verified: true, previewOnly: true, artChecked: true, ident: { status: 'kept', v: IDENT_VER } };
  await db.put('blobs', id, blob);
  tracks.set(id, t);
  const art = await fetchArt(v.art).catch(() => null);
  if (art) { t.coverOriginal = true; await setCover(t, art); } else await saveTrack(t);
  v.libId = id;
  rebuildOrder(); render();
  return t;
}
// ---------- Хочу скачать: превью ждёт полную версию из канала ----------
const wishes = () => Object.entries(waveFx).filter(([k]) => k.startsWith('w:')).map(([key, w]) => ({ key, ...w })).sort((a, b) => b.at - a.at);
const wishLibId = w => 'f:pv:' + fxKey(w.artist, w.title);
function addWish(s) {
  const key = 'w:' + fxKey(s.artist, s.title);
  if (!waveFx[key]) waveFx[key] = { artist: s.artist, title: s.title, album: s.album || '', art: s.art || null, preview: s.previewUrl || s.preview || null, because: s.because || '', seed: s.seed, at: Date.now() };
  saveLib(); renderNav();
}
async function dropPreviewTrack(id) {
  if (!tracks.has(id)) return;
  await Promise.all([db.del('blobs', id), db.del('covers', id), db.del('tracks', id)]);
  tracks.delete(id);
  coverUrls.delete(id);
  rebuildOrder();
}
async function removeWish(w) {
  delete waveFx[w.key];
  const id = wishLibId(w);
  lib.likes.delete(id);
  for (const p of lib.playlists) p.ids = p.ids.filter(x => x !== id);
  await dropPreviewTrack(id);
  saveLib(); render();
}
// Полная версия появилась: она занимает место превью в лайках и плейлистах, а превью исчезает
async function fulfilWish(t) {
  if (!t || t.previewOnly || !t.title) return;
  const w = wishes().find(x => sameTrack(x, t));
  if (!w) return;
  const old = wishLibId(w);
  delete waveFx[w.key];
  if (lib.likes.delete(old)) lib.likes.add(t.id);
  for (const p of lib.playlists) p.ids = [...new Set(p.ids.map(x => x === old ? t.id : x))];
  queue = queue.map(x => x === old ? t.id : x); queueBase = queueBase.map(x => x === old ? t.id : x); userQueue = userQueue.map(x => x === old ? t.id : x);
  const v = virtual.get('pv:' + fxKey(w.artist, w.title));
  if (v) v.libId = t.id;
  await dropPreviewTrack(old);
  saveLib(); render();
  toast(`Полная версия на месте: ${t.title}`);
}
async function scanWishes() {
  for (const w of wishes()) { const t = [...tracks.values()].find(x => !x.previewOnly && sameTrack(w, x)); if (t) await fulfilWish(t); }
}
const botName = s => String(s || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').replace(/[^\w]/g, '');
// «Найти»: сразу открывает выбранного музыкального бота с названием трека в поле ввода
async function findInTelegram(s) {
  if (!settings.musicBot) { askMusicBot(() => findInTelegram(s)); return; }
  const text = `${s.artist ? s.artist + ' - ' : ''}${s.title}`;
  try { await navigator.clipboard.writeText(text); } catch {} // на всякий случай название ещё и в буфере обмена
  const q = encodeURIComponent(text);
  // на телефоне сразу в приложение Telegram; на компьютере — ссылка t.me в новой вкладке (откроет Telegram Desktop или веб-версию)
  if (matchMedia('(pointer: coarse)').matches) location.href = `tg://resolve?domain=${settings.musicBot}&text=${q}`;
  else window.open(`https://t.me/${settings.musicBot}?text=${q}`, '_blank', 'noopener');
  toast('Отправь название боту, потом перешли трек в свой канал');
}
function askMusicBot(then) {
  const d = modal(`<h2>Бот для поиска музыки</h2><p>Напиши имя бота в Telegram, через которого ты находишь треки. Mix будет открывать его с уже вставленным названием песни.</p>
    <form><input class="inp" name="b" placeholder="@имя_бота" autocomplete="off" value="${settings.musicBot ? '@' + esc(settings.musicBot) : ''}" required>
    <div class="acts"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Сохранить</button></div></form>`);
  $('[data-x]', d).onclick = closeLayer;
  $('form', d).onsubmit = e => {
    e.preventDefault();
    const b = botName(e.target.b.value); if (!b) return;
    settings.musicBot = b; saveSettings(); closeLayer(); then?.();
  };
}
function renderWish() {
  const list = wishes(), empty = $('#empty');
  $('#viewTitle').firstChild.textContent = 'Хочу скачать';
  $('#viewSub').textContent = list.length ? tracksWord(list.length) : '';
  empty.hidden = !!list.length;
  if (!list.length) empty.innerHTML = '<h2>Пока пусто</h2><p>Нажми плюс у похожего трека в Волне. Он попадёт сюда, а когда полная версия появится в твоём канале, сама заменит превью.</p>';
  $('#rows').innerHTML = list.length ? `<li class="sechead"><small>«Найти» откроет ${settings.musicBot ? '@' + esc(settings.musicBot) : 'твоего музыкального бота'} с названием трека. Перешли трек в свой канал, и Mix сам заменит превью полной версией. <button class="chip" data-act="musicBot">${settings.musicBot ? 'Сменить бота' : 'Выбрать бота'}</button></small></li>` + list.map(w => `<li class="sug" data-w="${esc(w.key)}"><span class="art-wrap">${w.art ? `<img src="${esc(w.art)}" alt="" loading="lazy">` : `<span class="cov" style="--ch:${hash(w.artist)}">${esc(w.artist[0] || '?')}</span>`}${w.preview ? '<button data-wish="play" title="Послушать 30 секунд"><svg><use href="#i-play"/></svg></button>' : ''}</span>
    <span class="ttl"><span class="t">${esc(w.title)}</span><span class="a">${esc(w.artist)}${w.album ? ' — ' + esc(w.album) : ''}</span></span>
    <span class="acts"><button class="btn primary wishfind" data-wish="find">Найти</button><button class="ib" data-wish="del" title="Убрать из списка"><svg><use href="#i-x"/></svg></button></span></li>`).join('') : '';
}
// Меню «Добавить» у играющего трека: любимое, альбом или плейлист, моя музыка
const libIdOf = t => t.source === 'preview' ? (t.libId && tracks.has(t.libId) ? t.libId : null) : t.id;
function openAddMenu(btn, t = engine.track) {
  if (!t) return;
  closeLayer();
  const id = libIdOf(t), isPv = t.source === 'preview';
  const liked = id && lib.likes.has(id);
  layer.innerHTML = `<div class="menu addmenu">
    <button data-a="like"><svg><use href="#i-heart${liked ? '' : '-o'}"/></svg>${liked ? 'Убрать из любимого' : 'В любимое'}</button>
    ${t.id !== curId ? '<button data-a="qnext"><svg><use href="#i-next"/></svg>Играть следующим</button><button data-a="qadd"><svg><use href="#i-queue"/></svg>В очередь</button>' : ''}
    ${isPv && !id ? '<button data-a="keep"><svg><use href="#i-plus"/></svg>Во все песни (пока 30 секунд)</button>' : ''}
    ${isPv || t.previewOnly ? '<button data-a="find"><svg><use href="#i-wish"/></svg>Найти полный трек в Telegram</button>' : ''}
    <hr><div class="menuhead">Альбом или плейлист</div>
    ${lib.playlists.map(p => `<button data-p="${esc(p.id)}"><svg><use href="#i-${id && p.ids.includes(id) ? 'check' : 'list'}"/></svg>${esc(p.name)}</button>`).join('')}
    <button data-a="new"><svg><use href="#i-plus"/></svg>Новый альбом или плейлист</button></div>`;
  const m = layer.firstElementChild, r = btn.getBoundingClientRect(), h = m.getBoundingClientRect();
  m.style.left = Math.max(12, Math.min(r.left, innerWidth - h.width - 12)) + 'px';
  m.style.top = Math.max(12, r.top - h.height - 8 > 12 ? r.top - h.height - 8 : r.bottom + 8) + 'px';
  m.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.a, pid = b.dataset.p;
    closeLayer();
    if (a === 'find') { findInTelegram(t); return; }
    if (a === 'qnext' || a === 'qadd') { addToQueue(t.id, a === 'qnext'); return; }
    try {
      if (a === 'keep') { await keepPreview(t); toast('Добавлено. Полная версия заменит превью, когда появится в канале'); return; }
      const real = id ? tracks.get(id) : await keepPreview(t);
      if (a === 'like') {
        if (t.source === 'preview') { const k = 'l:' + fxKey(t.artist, t.title); if (lib.likes.has(real.id)) delete waveFx[k]; else waveFx[k] = { artist: t.artist, title: t.title, at: Date.now(), seed: t.seed }; }
        const had = lib.likes.has(real.id);
        toggleLike(real.id);
        toast(had ? 'Убрано из любимого' : 'Добавлено в любимое');
      } else if (a === 'new') { const p = await newPlaylist(real.id); if (p) toast(`Добавлено в «${p.name}»`); }
      else if (pid) {
        const p = lib.playlists.find(x => x.id === pid);
        const has = p.ids.includes(real.id);
        p.ids = has ? p.ids.filter(x => x !== real.id) : [...p.ids, real.id];
        saveLib(); renderNav(); toast(has ? `Убрано из «${p.name}»` : `Добавлено в «${p.name}»`);
      }
    } catch (err) { console.warn(err); toast('Не получилось, проверь интернет'); }
  };
}

const sug = { items: [], loading: false, at: 0 };
let sugFetching = false;
const SUG_CACHE = { get: k => db.get('kv', k), put: (k, v) => db.put('kv', k, v) };
async function loadSuggestions() {
  if (sug.loading) return;
  sug.loading = true; sugFetching = true; renderIfWave();
  try {
    const items = await fetchSuggestions(currentTaste(), [...tracks.values()], {
      cache: SUG_CACHE, seen: waveSeen, onProgress: it => { sug.items = it; renderIfWave(); },
    });
    // база шире: похожие артисты из Deezer для трёх любимых
    const extra = [];
    for (const f of favArtists(3)) extra.push(...await deezerSimilarTracks(f.name).catch(() => []));
    const mine = [...tracks.values()], seen = new Set(items.map(x => normKey(x.artist + ' ' + x.title)));
    for (const x of extra) { const k = normKey(x.artist + ' ' + x.title); if (seen.has(k) || mine.some(t => sameTrack(x, t))) continue; seen.add(k); items.push(x); }
    for (let i = items.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; if (i >= 6) [items[i], items[j < 6 ? i : j]] = [items[j < 6 ? i : j], items[i]]; } // первые 6 лучших оставляем, остальное перемешиваем
    sug.items = items; sug.at = Date.now();
    if (waveMode) { injectPreviews(); engine.refreshNext(); paintNext(); }
  } finally { sug.loading = false; sugFetching = false; renderIfWave(); }
}
const renderIfWave = () => { if (view === 'wave') renderWave(); };
function sugRow(s, i) {
  const liked = waveFx['l:' + fxKey(s.artist, s.title)];
  const art = s.art ? `<img src="${esc(s.art)}" alt="" loading="lazy">` : `<span class="cov" style="--ch:${hash(s.artist)}">${esc(s.artist[0] || '?')}</span>`;
  return `<li class="sug" data-i="${i}"><span class="art-wrap">${art}${s.preview ? `<button data-sug="play" title="Послушать 30 секунд"><svg><use href="#i-play"/></svg></button>` : ''}</span>
    <span class="ttl"><span class="t">${esc(s.title)}</span><span class="a">${esc(s.artist)}${s.album ? ' — ' + esc(s.album) : ''}</span><span class="why">${esc(s.because || '')}</span></span>
    <span class="acts"><button class="ib" data-sug="add" title="Добавить во все песни или в плейлист"><svg><use href="#i-plus"/></svg></button><button class="ib${liked ? ' liked' : ''}" data-sug="like" title="Нравится: будет больше такого"><svg><use href="#i-heart${liked ? '' : '-o'}"/></svg></button>
    <button class="ib" data-sug="copy" title="Скопировать название, чтобы найти и скачать"><svg><use href="#i-copy"/></svg></button>
    <button class="ib" data-sug="no" title="Не моё"><svg><use href="#i-x"/></svg></button></span></li>`;
}
function renderWave() {
  $('#viewTitle').firstChild.textContent = 'Волна';
  $('#viewSub').textContent = '';
  $('#empty').hidden = true;
  const live = waveMode && engine.track;
  const noTaste = !tracks.size;
  $('#rows').innerHTML = `<li class="wavehero" style="list-style:none">
      <button class="orb${live ? ' live' : ''}" data-act="${live ? 'toggle' : 'waveStart'}" title="${live ? 'Пауза / играть' : 'Запустить мою волну'}"><i></i><i></i><svg><use href="#i-${live && !engine.paused ? 'pause' : 'play'}"/></svg></button>
      <div><h2>Моя волна</h2><p>${noTaste ? 'Появится, когда в библиотеке будет музыка.' : 'Бесконечный поток: твои треки вперемешку с похожими. Пропуски и лайки меняют его на ходу.'}</p>
        <label class="wavesim"><input type="checkbox" class="sw" id="waveSim"${settings.waveSimilar ? ' checked' : ''}>Добавлять похожие (бесплатно доступно только 30 секунд)</label></div></li>`
    + forYouHTML() + `<li class="sechead"><div><b>Новое для тебя</b><small>${sug.loading ? '<span class="spin"></span>Подбираю, первый раз это около 30 секунд' : 'Похоже на то, что ты слушаешь. Нравится трек — скопируй название, найди и кинь в канал'}</small></div>
      <button class="btn" data-act="waveMore"${sug.loading || noTaste ? ' disabled' : ''}>Другая подборка</button></li>`
    + (sug.items.length ? sug.items.map(sugRow).join('')
      : sug.loading ? '<li class="skel"></li>'.repeat(6)
      : !sug.loading ? `<li class="sechead"><small>${noTaste ? 'Подборка строится по твоей музыке. Добавь треки, и она появится.' : navigator.onLine ? 'Пока ничего не нашлось. Послушай ещё немного и обнови подборку.' : 'Для подборки нужен интернет.'}</small></li>` : '');
}
function forYouHTML() {
  const rec = [...new Set(lib.history.map(h => h.id))].filter(id => tracks.has(id)).slice(0, 12);
  if (!rec.length && !lib.playlists.length) return '';
  const tile = id => { const t = tracks.get(id); return `<button class="tile" data-play="${esc(id)}">${coverHTML(t)}<b>${esc(t.title)}</b><small>${esc(t.artist || 'Неизвестный артист')}</small></button>`; };
  const pls = lib.playlists.map(p => { const t = tracks.get(p.ids[0]); return `<button class="tile" data-view="${esc(p.id)}">${t ? coverHTML(t) : '<span class="cov"></span>'}<b>${esc(p.name)}</b><small>${tracksWord(p.ids.length)}</small></button>`; }).join('');
  return `<li class="sechead foryou"><div><b>Для тебя</b></div></li>`
    + (rec[0] ? `<li class="contcard" data-play="${esc(rec[0])}">${coverHTML(tracks.get(rec[0]))}<div><small>Продолжить</small><b>${esc(tracks.get(rec[0]).title)}</b><span>${esc(tracks.get(rec[0]).artist || '')}</span></div><svg><use href="#i-play"/></svg></li>` : '')
    + (rec.length > 1 ? `<li class="fyshelf"><small>Недавние</small><div class="shelf">${rec.slice(1).map(tile).join('')}</div></li>` : '')
    + (pls ? `<li class="fyshelf"><small>Плейлисты</small><div class="shelf">${pls}</div></li>` : '');
}
function paintOrb() {
  const o = $('.orb'); if (!o) return;
  const live = !!(waveMode && engine.track);
  o.classList.toggle('live', live);
  o.dataset.act = live ? 'toggle' : 'waveStart';
  o.querySelector('use').setAttribute('href', live && !engine.paused ? '#i-pause' : '#i-play');
}
function stopPreview() {
  if (!previewEl) return;
  previewEl.pause(); previewEl = null;
  mediaMeta(engine.track); // превью перехватывает экран блокировки — возвращаем текущий трек
}
function openListen() {
  let ac = null;
  const d = modal(`<h2>Что сейчас играет?</h2><div id="lsBody"></div>
    <details class="tokenbox"><summary>Свой ключ AudD (необязательно)</summary>
    <p>Без ключа распознавание работает несколько раз в день. Бесплатный ключ на <a href="https://dashboard.audd.io/" target="_blank" rel="noopener">dashboard.audd.io</a> даёт 300 распознаваний один раз.</p>
    <input class="inp" id="ldToken" autocomplete="off" placeholder="API-токен" value="${esc(settings.auddToken)}"></details>
    <div class="acts"><button class="btn" data-x>Закрыть</button></div>`);
  const body = $('#lsBody', d);
  const idle = (msg = '') => {
    body.innerHTML = `<button class="mic" id="lsGo" title="Слушать 12 секунд"><svg><use href="#i-mic"/></svg></button><p style="text-align:center">${esc(msg) || 'Поднеси телефон к музыке и нажми. Слушаю 12 секунд, плеер на это время встанет на паузу.'}</p>`;
    $('#lsGo', d).onclick = go;
  };
  const go = async () => {
    const { listen } = await import('./listen.js');
    const resume = engine.track && !engine.paused;
    if (resume) await engine.pause();
    ac = new AbortController();
    body.innerHTML = `<div class="mic on"><svg><use href="#i-mic"/></svg></div><p style="text-align:center" id="lsMsg">Слушаю…</p>`;
    try {
      const r = await listen({ token: settings.auddToken, signal: ac.signal, onState: s => { const m = $('#lsMsg', d); if (m && s === 'recognizing') m.textContent = 'Распознаю…'; } });
      if (!d.isConnected) return;
      if (!r) { idle('Не узнал. Попробуй ближе к источнику звука, на более громком месте.'); return; }
      body.innerHTML = `<div class="heard">${r.art ? `<img src="${esc(r.art)}" alt="">` : `<span class="cov" style="--ch:${hash(r.title)};width:88px;height:88px">${esc(r.title[0])}</span>`}
        <div><b>${esc(r.title)}</b><span>${esc(r.artist)}${r.album ? ' — ' + esc(r.album) : ''}</span></div></div>
        <div class="acts" style="justify-content:flex-start;margin:0"><button class="btn primary" id="lsCopy">Скопировать название</button><button class="btn" id="lsAgain">Ещё раз</button></div>`;
      $('#lsCopy', d).onclick = () => copyName(r);
      $('#lsAgain', d).onclick = go;
    } catch (e) {
      if (d.isConnected && e.code !== 'aborted') idle(e.message || 'Не получилось распознать');
    } finally {
      ac = null;
      if (resume) engine.resume();
    }
  };
  $('#ldToken', d).onchange = e => { settings.auddToken = e.target.value.trim(); saveSettings(); };
  $('[data-x]', d).onclick = () => { ac?.abort(); closeLayer(); };
  new MutationObserver((_, o) => { if (!d.isConnected) { ac?.abort(); o.disconnect(); } }).observe(layer, { childList: true });
  idle();
}
async function copyName(s) {
  const text = `${s.artist} - ${s.title}`;
  try { await navigator.clipboard.writeText(text); toast('Скопировано: ' + text); }
  catch { toast(text); }
}

// ---------- синхронизация между устройствами (через «Избранное» в Telegram) ----------
const waveForSync = () => ({ ...waveFx, ['listens:' + deviceId]: lib.listens.slice(-500) });
function getLocal() {
  return { likes: [...lib.likes], playlists: lib.playlists, history: lib.history, tracks: Object.fromEntries(tracks), settings, wave: waveForSync() };
}
function applyMerged(p, ch) {
  if (ch.likes) lib.likes = new Set(p.likes);
  if (ch.playlists) { lib.playlists = p.playlists; if (view.startsWith('pl') && !lib.playlists.some(x => x.id === view)) view = 'all'; }
  if (ch.history) lib.history = p.history;
  if (ch.wave) {
    waveFx = { ...p.wave }; delete waveFx['listens:' + deviceId];
    // другое устройство уже нашло полную версию или убрало трек из списка
    for (const t of [...tracks.values()]) if (t.previewOnly && !waveFx['w:' + fxKey(t.artist, t.title)]) dropPreviewTrack(t.id);
    setTimeout(scanWishes, 0);
  }
  if (ch.settings) {
    Object.assign(settings, p.settings);
    engine.setCrossfade(settings.cf); engine.setTrim(settings.trim); engine.setEq(settings.eq);
  }
  for (const id of ch.tracks || []) {
    const t = tracks.get(id), m = p.tracks[id];
    if (!t || !m || !m.conf) continue;
    Object.assign(t, { conf: true, title: m.title, artist: m.artist, album: m.album, verified: m.verified }, m.verified ? { ident: { status: 'done' } } : {});
    saveTrack(t);
    if (id === curId) { paintNow(); mediaMeta(t); }
  }
  render(); paintLike();
  // sync.js запишет свою копию только после этого: иначе при закрытии страницы старые данные выглядели бы как удаление
  return Promise.all([writeLib(), saveSettings()]);
}
let cloudStatus = null;
async function initCloud() {
  if (cloud || !tgCfg?.session) return;
  const [{ createSync }, tg] = await Promise.all([import('./sync.js'), tgLib()]);
  cloud ??= createSync({ tg, getLocal, applyMerged, debounceMs: 30000, maxWaitMs: 180000, store: { get: () => db.get('kv', 'sync'), set: v => db.put('kv', 'sync', v) }, onStatus: s => { if (s.state === 'idle') s.at = Date.now(); else if (cloudStatus?.at) s.at = cloudStatus.at; cloudStatus = s; updateUsage(); } });
  cloud.push();
}

// ---------- аудио: из памяти устройства или из Telegram ----------
const downloads = new Map();
async function loadAudio(t) {
  if (t.source === 'preview') { const r = await fetch(t.previewUrl); if (!r.ok) throw new Error('preview ' + r.status); return r.blob(); }
  const b = await db.get('blobs', t.id);
  if (b) return b;
  if (t.source === 'tg') { await downloadTrack(t); return db.get('blobs', t.id); }
  throw new Error('нет файла');
}

// ---------- отрисовка плеера ----------
let bdUrl = '', bdFlip = 0;
// смена трека: старые шары разлетаются в стороны и гаснут, новые (уже нового цвета) выплывают с противоположного края
let orbT = 0;
function orbSwap(apply) {
  const os = $$('.orbs span'), rnd = m => ((Math.random() * 2 - 1) * m).toFixed(1);
  if (!os.length || matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return; }
  clearTimeout(orbT);
  const dirs = os.map(() => Math.random() * Math.PI * 2);
  os.forEach((o, i) => { o.style.transition = 'translate .7s cubic-bezier(.5,0,.8,.4), opacity .6s'; o.style.translate = `${(Math.cos(dirs[i]) * 70).toFixed(1)}vmax ${(Math.sin(dirs[i]) * 70).toFixed(1)}vmax`; o.style.opacity = 0; });
  orbT = setTimeout(() => {
    apply();
    os.forEach((o, i) => { o.style.transition = 'none'; o.style.translate = `${(-Math.cos(dirs[i]) * 70).toFixed(1)}vmax ${(-Math.sin(dirs[i]) * 70).toFixed(1)}vmax`; });
    void os[0].offsetWidth;
    os.forEach((o, i) => { o.style.transition = `translate 1.6s cubic-bezier(.2,.8,.2,1) ${i * 70}ms, opacity 1.2s ${i * 70}ms`; o.style.translate = `${rnd(16)}vmax ${rnd(12)}vmax`; o.style.opacity = ''; });
  }, 650);
}
async function paintBackdrop(t) {
  const url = !t ? '' : t.cover ? await coverUrl(t.id).catch(() => '') : (t.art || '');
  if (url === bdUrl) return;
  // цвета шаров
  if (t) {
    let pal = palCache.get(url);
    if (!pal && url) { pal = await fetch(url).then(r => r.blob()).then(paletteOf).catch(() => []); palCache.set(url, pal); }
    if (engine.track?.id === t.id) orbSwap(() => setPalette(pal || [], toneFor(t)));
  }
  bdUrl = url; bdFlip ^= 1;
  // при смене трека шары плавно разъезжаются на новые места
  const rnd = m => ((Math.random() * 2 - 1) * m).toFixed(1);
  for (const box of $$('#backdrop, #fullbg')) {
    const [x, y] = box.children, on = bdFlip ? y : x, off = bdFlip ? x : y;
    if (url) on.style.backgroundImage = `url("${url}")`;
    on.classList.toggle('on', !!url); off.classList.remove('on');
  }
}
async function paintNow() {
  const t = engine.track;
  paintBackdrop(t);
  $('#npTitle').textContent = t ? t.title : 'Ничего не играет';
  $('#npArtist').textContent = t ? (t.artist || 'Неизвестный артист') + (t.source === 'preview' ? ', превью 30 секунд' : '') : 'Выбери трек';
  $('#npLike').hidden = !t; $('#npAdd').hidden = !t;
  paintLike();
  $('#openFull').innerHTML = t ? coverHTML(t) : '';
  hydrateIn($('#openFull'), true);
  $('#fTitle').textContent = t?.title || '';
  // имя артиста ведёт на его страницу
  { const p = t && creditIndex().get(t.id)?.[0], fa = $('#fArtist'); if (p) fa.dataset.view = 'artist:' + p.key; else if (t?.artist) fa.dataset.view = 'webartist:' + encodeURIComponent(t.artist); else delete fa.dataset.view; const na = $('#npArtist'); if (fa.dataset.view) na.dataset.view = fa.dataset.view; else delete na.dataset.view; }
  $('#fArtist').textContent = t ? (t.artist || '') + (t.source === 'preview' ? (t.because ? '. ' + t.because : '') + '. Превью 30 секунд' : '') : '';
  $('#fMix').textContent = settings.cf ? `Микс ${settings.cf} с` : 'Без перехода';
  document.title = t ? `${t.title} — ${t.artist || 'Mix'}` : 'Mix';
  paintStack();
  paintNext();
}
function paintLike() {
  const t = engine.track, id = t && libIdOf(t), on = id && lib.likes.has(id);
  for (const b of $$('#npLike, #fLike')) {
    b.classList.toggle('on', !!on);
    b.innerHTML = `<svg><use href="#i-heart${on ? '' : '-o'}"/></svg>`;
  }
}
function paintState() {
  const playing = !!engine.track && !engine.paused;
  document.body.classList.toggle('playing', playing);
  paintOrb();
  for (const b of $$('.pp[data-act=toggle]')) b.innerHTML = `<svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
  for (const b of $$('[data-act=shuffle]')) b.classList.toggle('on', settings.shuffle);
  for (const b of $$('[data-act=repeat]')) b.classList.toggle('on', settings.repeat);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  paintNext();
}
function paintMixChip() {
  const text = settings.cf ? `Микс ${settings.cf} с` : 'Без перехода';
  if (text === lastChip) return;
  lastChip = text;
  $('#mixChip').textContent = text;
}

let stackKey = '';
function paintStack() {
  const cur = engine.track, key = cur?.id || '';
  if (key === stackKey) return;
  stackKey = key;
  $('#stack').innerHTML = cur ? coverHTML(cur) : '';
  hydrateIn($('#stack'), true);
}
function paintNext() {
  const n = engine.nextTrack || (curId && getT(neighbour(curId, 1)));
  const el = $('#fNext');
  if (!n || n.id === curId) { el.innerHTML = ''; return; }
  el.innerHTML = `${coverHTML(n)}<span>Дальше<b>${esc(n.title)}${n.artist ? ' — ' + esc(n.artist) : ''}</b></span>`;
  hydrateIn(el, true);
}

// Прогресс обновляем четыре раза в секунду и только то, что изменилось
let dragging = null, lastPos = '', lastDur = '', lastPct = -1, lastChip = '';
const posEls = $$('[data-pos]'), durEls = $$('[data-dur]');
const seekEls = $$('[data-seek]').map(tr => [tr.querySelector('.fill'), tr.querySelector('.knob')]);
// волна как у голосовых в Telegram: только в большом плеере, один слой,
// столбики перекрашиваются по одному (не каждый кадр) — бережём слабые телефоны
const waveEl = (() => { const tr = $('.full [data-seek]'); if (!tr) return null; const w = document.createElement('div'); w.className = 'wbars'; tr.prepend(w); return w; })();
let waveFor = null, waveOn = 0;
function paintWaveBars() {
  if (!waveEl) return;
  const p = engine.track?.peaks || '';
  if (p === waveFor) return; waveFor = p; waveOn = 0;
  waveEl.innerHTML = [...p].map(c => `<i style="height:${8 + c * 10.2}%"></i>`).join('');
  waveEl.parentElement.classList.toggle('wv', !!p);
}
function paintWaveOn(pct) {
  if (!waveEl || !waveFor) return;
  const bars = waveEl.children, k = Math.round(pct / 100 * bars.length);
  if (k === waveOn) return;
  for (let i = Math.min(k, waveOn); i < Math.max(k, waveOn); i++) bars[i]?.classList.toggle('on', i < k);
  waveOn = k;
}
function paintProgress() {
  const pos = dragging ? dragging.pos : engine.position, dur = engine.duration;
  const a = fmt(pos), b = fmt(dur), pct = dur ? Math.round(pos / dur * 1000) / 10 : 0;
  if (a !== lastPos) { lastPos = a; for (const el of posEls) el.textContent = a; }
  if (b !== lastDur) { lastDur = b; for (const el of durEls) el.textContent = b; }
  if (pct !== lastPct) {
    lastPct = pct;
    for (const [fill, knob] of seekEls) { fill.style.transform = `scaleX(${pct / 100})`; knob.style.left = pct + '%'; }
    paintWaveOn(pct);
  }
  return pos;
}
function frame() {
  if (document.hidden) return;
  const pos = paintProgress();
  paintMixChip();
  tickLyrics(pos);
}

// перемотка перетаскиванием
for (const tr of $$('[data-seek]')) {
  const at = e => { const r = tr.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * engine.duration; };
  tr.addEventListener('pointerdown', e => { if (!engine.track) return; tr.setPointerCapture(e.pointerId); tr.classList.add('drag'); dragging = { pos: at(e) }; });
  tr.addEventListener('pointermove', e => { if (dragging) { dragging.pos = at(e); paintProgress(); } });
  tr.addEventListener('pointerup', () => { if (!dragging) return; tr.classList.remove('drag'); engine.seek(dragging.pos); dragging = null; });
  tr.addEventListener('pointercancel', () => { tr.classList.remove('drag'); dragging = null; });
}

// ---------- всплывающие панели ----------
const layer = $('#layer');
function closeLayer() { layer.innerHTML = ''; }
function dismissLayer() {
  const el = layer.firstElementChild; if (!el) return;
  el.classList.add('closing');
  setTimeout(() => { if (layer.firstElementChild === el) closeLayer(); }, 170);
}
function popup(html, anchorRight = true) {
  closeLayer();
  layer.innerHTML = `<div class="pop">${html}</div>`; // закрывается тапом мимо окна, свайпом или Esc
  return layer.firstElementChild;
}
document.addEventListener('pointerdown', e => {
  if (e.target === layer) { dismissLayer(); return; }
  if (layer.firstElementChild && !layer.contains(e.target) && !e.target.closest('#queueBtn, #fQueue, #mixChip, #eqBtn, #fMix, #fEq, #npAdd, #fAdd, [data-add], [data-sug=add], [data-more], .modal')) closeLayer();
});

function mixCurvePath(cf) {
  const W = 320, H = 50, w = Math.max(8, cf / 12 * 200), x0 = (W - w) / 2;
  const pts = (f) => Array.from({ length: 33 }, (_, i) => { const x = i / 32; return `${(x0 + x * w).toFixed(1)},${(H - 4 - f(x) * (H - 10)).toFixed(1)}`; }).join(' L');
  const out = `M0,6 L${x0},6 L${pts(x => Math.cos(x * Math.PI / 2))} L${W},${H - 4}`;
  const inn = `M0,${H - 4} L${x0},${H - 4} L${pts(x => Math.sin(x * Math.PI / 2))} L${W},6`;
  return { out, inn };
}
function openMix() {
  const el = popup(`<h3>Переход между треками</h3>
    <svg class="mixviz" viewBox="0 0 320 50" preserveAspectRatio="none"><path id="cOut" stroke="var(--accent)"/><path id="cIn" stroke="var(--amber)"/></svg>
    <div class="field"><span>Длина перехода</span><input type="range" id="cf" min="0" max="12" step="1"><output id="cfOut"></output></div>
    <label class="check"><input type="checkbox" class="sw" id="trim"><span>Умный микс<small>Срезать тишину в начале и конце треков, чтобы на стыке не было паузы</small></span></label>
    <label class="check"><input type="checkbox" class="sw" id="norm"><span>Ровная громкость<small>Громкие треки чуть тише, тихие — громче, чтобы не крутить звук от песни к песне</small></span></label>
    <div class="field"><span>Скорость</span></div>
    <div class="presets speeds">${[[.85, 'Slowed'], [1, 'Обычная'], [1.15, 'Speed up'], [1.3, 'Быстрее']].map(([r, n]) => `<button class="chip${(settings.speed || 1) === r ? ' on' : ''}" data-act="speed:${r}">${n}</button>`).join('')}</div>`);
  const sync = () => {
    $('#cf', el).value = settings.cf; $('#cf', el).style.setProperty('--p', settings.cf / 12 * 100 + '%');
    $('#cfOut', el).textContent = settings.cf ? settings.cf + ' с' : 'выкл';
    const c = mixCurvePath(settings.cf); $('#cOut', el).setAttribute('d', c.out); $('#cIn', el).setAttribute('d', c.inn);
  };
  sync();
  $('#trim', el).checked = settings.trim; $('#norm', el).checked = settings.norm;
  $('#norm', el).onchange = e => { settings.norm = e.target.checked; engine.setNorm(settings.norm); saveSettings(); };
  $('#cf', el).oninput = e => { settings.cf = +e.target.value; sync(); saveSettings(); engine.setCrossfade(settings.cf); };
  $('#trim', el).onchange = e => { settings.trim = e.target.checked; engine.setTrim(settings.trim); saveSettings(); engine.refreshNext(); };
}

function openEq() {
  engine.init();
  const el = popup(`<h3 class="eqhead">Эквалайзер<button class="chip" data-preset="Ровно" data-reset>Сбросить</button></h3>
    <svg class="eqgraph" id="eqg" viewBox="0 0 320 110" preserveAspectRatio="none"></svg>
    <div class="eqsl">${EQ_BANDS.map((f, i) => `<label><input type="range" min="-12" max="12" step="1" data-band="${i}">${f >= 1000 ? f / 1000 + 'к' : f}</label>`).join('')}</div>
    <div class="presets">${Object.keys(EQ_PRESETS).filter(n => n !== 'Ровно').map(n => `<button class="chip" data-preset="${n}">${n}</button>`).join('')}</div>`);
  const freqs = Float32Array.from({ length: 120 }, (_, i) => 20 * Math.pow(1000, i / 119));
  const draw = () => {
    const r = engine.eqResponse(freqs);
    const y = db => 55 - db / 14 * 50;
    const d = Array.from(r, (v, i) => `${i ? 'L' : 'M'}${(i / 119 * 320).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    $('#eqg', el).innerHTML = `<line x1="0" x2="320" y1="55" y2="55" stroke="rgb(255 255 255 / .12)"/>
      <path d="${d} L320,110 L0,110 Z" fill="hsl(var(--h) var(--s) 70% / .18)"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`;
    for (const s of $$('[data-band]', el)) { s.value = settings.eq[s.dataset.band]; s.style.setProperty('--p', (+s.value + 12) / 24 * 100 + '%'); }
    for (const c of $$('.presets [data-preset]', el)) c.classList.toggle('on', c.dataset.preset === settings.eqPreset);
  };
  // кривая обновляется после того, как фильтры применили новое значение
  const apply = () => { engine.setEq(settings.eq); saveSettings(); setTimeout(draw, 160); draw(); };
  el.addEventListener('input', e => { const b = e.target.dataset.band; if (b == null) return; settings.eq[b] = +e.target.value; settings.eqPreset = ''; apply(); });
  el.addEventListener('click', e => { const p = e.target.dataset.preset; if (!p) return; settings.eq = EQ_PRESETS[p].slice(); settings.eqPreset = p; apply(); });
  draw();
}

function openMenu(id, x, y) {
  const t = tracks.get(id); if (!t) return;
  closeLayer();
  const inPl = lib.playlists.find(p => p.id === view);
  layer.innerHTML = `<div class="menu">
    <button data-m="playNext">Играть следующим</button>
    <button data-m="qadd">В очередь</button>
    <button data-m="toPl">Добавить в плейлист</button>
    <button data-m="radio">Радио по этому треку</button>
    <button data-m="card">Поделиться «Сейчас слушаю»</button>
    <button data-m="rename">Изменить название</button>
    ${inPl ? '<button data-m="fromPl">Убрать из плейлиста</button>' : ''}
    <hr>
    ${t.orig ? `<button data-m="orig">Вернуть исходное название: ${esc(t.orig.artist ? t.orig.artist + ' — ' : '')}${esc(t.orig.title)}</button>` : ''}
    ${t.source === 'tg' && t.downloaded ? '<button data-m="free">Удалить файл с устройства</button>' : ''}
    <button data-m="del" class="danger">Удалить из библиотеки</button></div>`;
  const m = layer.firstElementChild;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 12) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 12) + 'px';
  m.onclick = async e => {
    const a = e.target.dataset.m; if (!a) return;
    closeLayer();
    if (a === 'playNext' || a === 'qadd') {
      addToQueue(id, a === 'playNext');
    } else if (a === 'toPl') pickPlaylist(id);
    else if (a === 'rename') openFind(t);
    else if (a === 'radio') startRadio(id);
    else if (a === 'card') { if (engine.track?.id !== id) await playId(id); shareNowCard(); }
    else if (a === 'fromPl') { inPl.ids = inPl.ids.filter(q => q !== id); saveLib(); render(); }
    else if (a === 'orig') {
      // Mix ошибся: возвращаем как было и больше этот трек сам не трогаем
      t.title = t.orig.title; t.artist = t.orig.artist || ''; delete t.orig;
      for (const k of ['album', 'albumId', 'albumTotal', 'trackNo', 'genre', 'released']) delete t[k];
      if (t.coverOriginal) { t.coverOriginal = false; t.cover = false; db.del('covers', t.id); db.del('covers', 'th:' + t.id); coverUrls.delete(t.id); thumbUrls.delete(t.id); thumbReady.delete(t.id); }
      t.verified = true; t.conf = true; t.fixedBy = 'manual'; t.ident = { status: 'kept' }; t.album = '';
      if (settings.writeChannel && inCurrentChat(t)) { t.chanPending = true; t.artChecked = true; }
      await saveTrack(t); updateRow(t.id); if (t.id === curId) { paintNow(); mediaMeta(t); }
      if (t.chanPending) chanQueue();
      toast('Название возвращено');
    }
    else if (a === 'free') { await db.del('blobs', id); t.downloaded = false; saveTrack(t); updateRow(id); toast('Файл удалён, трек скачается снова при прослушивании'); }
    else if (a === 'del') {
      if (!confirm(`Удалить «${t.title}» из библиотеки?`)) return;
      await Promise.all([db.del('blobs', id), db.del('covers', id), db.del('tracks', id)]);
      if (t.previewOnly) delete waveFx['w:' + fxKey(t.artist, t.title)];
      tracks.delete(id); lib.likes.delete(id); for (const p of lib.playlists) p.ids = p.ids.filter(q => q !== id);
      queue = queue.filter(q => q !== id); queueBase = queueBase.filter(q => q !== id); userQueue = userQueue.filter(q => q !== id); saveQueue(); engine.refreshNext();
      if (t.source === 'tg') { tgCfg.skip = [...(tgCfg.skip || []), id]; saveTg(); }
      saveLib(); rebuildOrder(); render();
    }
  };
}

function modal(html) {
  closeLayer();
  layer.innerHTML = `<div class="modal"><div class="dialog">${html}</div></div>`;
  const m = layer.firstElementChild;
  m.addEventListener('pointerdown', e => { if (e.target === m) dismissLayer(); });
  return m.firstElementChild;
}
function askName(title, value = '') {
  return new Promise(res => {
    const d = modal(`<h2>${esc(title)}</h2><form><input class="inp" name="n" maxlength="60" placeholder="Например, «В дорогу»" value="${esc(value)}" required>
      <div class="acts"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Сохранить</button></div></form>`);
    $('input', d).focus();
    $('[data-x]', d).onclick = () => { closeLayer(); res(null); };
    $('form', d).onsubmit = e => { e.preventDefault(); const v = $('input', d).value.trim(); closeLayer(); res(v || null); };
  });
}
async function newPlaylist(withId) {
  const name = await askName('Новый плейлист'); if (!name) return null;
  const p = { id: 'pl' + Date.now().toString(36), name, ids: withId ? [withId] : [] };
  lib.playlists.push(p); saveLib(); renderNav();
  return p;
}
// Совместный плейлист = группа (или канал) в Telegram, где вы оба. Треки в ней — это и есть плейлист.
async function scanCollab(c) {
  const tg = await ensureTg(), ent = await tg.peer(c.id);
  if (!ent) throw new Error('Группа не найдена: возможно, ты из неё вышел');
  let n = 0;
  for await (const it of tg.audioMessages(ent)) {
    const id = `tg:${c.id}:m${it.msgId}`;
    tgItems.set(id, it);
    if (tracks.has(id)) continue;
    const p = parseFileName(it.fileName || 'Без названия');
    const t = { id, source: 'tg', msgId: it.msgId, ext: { chat: c.id }, collab: c.id, from: 'collab', fileName: it.fileName, title: cleanTag(it.title) || cleanTag(p.title) || p.title, artist: cleanTag(it.artist) || cleanTag(p.artist), album: '', duration: it.duration, size: it.size, mime: it.mime, downloaded: false, addedAt: it.date * 1000 };
    tracks.set(id, t); await saveTrack(t); n++;
  }
  if (n) { rebuildOrder(); if (view === 'collab:' + c.id) render(); }
  return n;
}
async function openCollab() {
  if (!tgCfg?.session) { toast('Сначала подключи Telegram'); return; }
  const d = modal(`<h2>Совместный плейлист</h2><p>Это группа в Telegram, где состоите ты и друг. Всё, что любой из вас перешлёт туда, появится в плейлисте у обоих. Создай группу в Telegram, добавь друга и выбери её здесь. Друг в своём Mix делает то же самое.</p><ul class="chats" id="colList"><li style="color:var(--mist)">Загружаю список чатов…</li></ul>`);
  try {
    const tg = await ensureTg(), list = (await tg.chats()).filter(c => !c.entity?.self && c.id !== tgCfg.chatId);
    $('#colList', d).innerHTML = list.map(c => `<li><button data-c="${esc(c.id)}"><span class="ava" style="--ch:${hash(c.title)}">${esc((c.title || '?')[0])}</span><span>${esc(c.title)}</span></button></li>`).join('') || '<li>Нет групп. Создай группу в Telegram и добавь туда друга.</li>';
    d.onclick = async e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const c = list.find(x => x.id === b.dataset.c), col = { id: c.id, title: c.title };
      settings.collabs = [...(settings.collabs || []).filter(x => x.id !== c.id), col]; saveSettings();
      closeLayer(); view = 'collab:' + c.id; renderNav(); render();
      toast('Загружаю треки группы…');
      scanCollab(col).then(n => toast(n ? `В плейлисте: ${tracksWord(n)}` : 'Пока пусто — перешлите туда треки')).catch(err => toast(err.message));
    };
  } catch { $('#colList', d).innerHTML = '<li>Не удалось получить список чатов. Проверь интернет и попробуй ещё раз</li>'; }
}
async function addToCollab(c, id) {
  const t = getT(id); if (!t || t.source !== 'tg') { toast('В совместный плейлист можно добавить только трек из Telegram'); return; }
  try {
    const tg = await ensureTg();
    const from = t.ext ? await tg.peer(t.ext.peer || t.ext.chat) : await resolveChat(tg);
    await tg.forward(from, [t.msgId], await tg.peer(c.id));
    toast(`Добавлено в «${c.title}»`); scanCollab(c).catch(() => {});
  } catch { toast('Не получилось добавить: проверь интернет'); }
}
function pickPlaylist(id) {
  const cols = settings.collabs || [];
  const d = modal(`<h2>Добавить в плейлист</h2><ul class="chats">${cols.map(c => `<li><button data-col="${esc(c.id)}"><span class="ava" style="--ch:${hash(c.title)}">👥</span><span>${esc(c.title)}<small>совместный</small></span></button></li>`).join('')}${lib.playlists.map(p => `<li><button data-p="${esc(p.id)}"><span class="ava" style="--ch:${hash(p.name)}">${esc(p.name[0].toUpperCase())}</span><span>${esc(p.name)}<small>${tracksWord(p.ids.length)}</small></span></button></li>`).join('')}
    <li><button data-p="new"><span class="ava" style="--ch:40">+</span><span>Новый плейлист</span></button></li></ul>`);
  d.onclick = async e => {
    const cb = e.target.closest('[data-col]');
    if (cb) { closeLayer(); addToCollab(cols.find(c => c.id === cb.dataset.col), id); return; }
    const b = e.target.closest('[data-p]'); if (!b) return;
    if (b.dataset.p === 'new') { const p = await newPlaylist(id); if (p) toast(`Добавлено в «${p.name}»`); return; }
    const p = lib.playlists.find(x => x.id === b.dataset.p);
    if (!p.ids.includes(id)) p.ids.push(id);
    saveLib(); closeLayer(); renderNav(); toast(`Добавлено в «${p.name}»`);
  };
}

let toastT;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t);
    Object.assign(t.style, { position: 'fixed', left: '50%', bottom: 'calc(var(--bar-h) + 20px)', transform: 'translateX(-50%)', zIndex: 30, background: 'var(--velvet-2)',
      border: '1px solid var(--line)', padding: '11px 18px', borderRadius: '12px', fontWeight: 600, boxShadow: '0 14px 40px rgb(0 0 0 / .45)', transition: 'opacity .25s', maxWidth: '90vw', pointerEvents: 'none' }); } // невидимое уведомление не должно перехватывать нажатия
  t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = 0, 2600);
}

// ---------- свои файлы ----------
async function enrich(t, blob, tgItem) {
  let tags = {};
  try { tags = await readTags(blob); } catch {}
  // проверенные названия не трогаем: в файле может оставаться старый неверный тег
  if (!t.verified) {
    if (tags.title && (!t.title || t.title === t.fileTitle || cleanTag(t.fileTitle) === t.title)) t.title = cleanTag(tags.title) || t.title;
    if (tags.artist && !t.artist) t.artist = cleanTag(tags.artist);
    if (tags.album && !t.album) t.album = tags.album;
  }
  if (tags.released && !t.released) t.released = tags.released;
  // у проверенного трека верна обложка из поста, а в самом файле мог остаться старый тег
  const thumb = tgItem?.hasThumb && (t.verified || !tags.cover) ? await (await import('./tg.js')).downloadThumb(tgItem) : null;
  const cover = t.verified ? thumb || tags.cover : tags.cover || thumb;
  if (cover && cover.size > 500) await setCover(t, cover);
  else await saveTrack(t);
}
async function addFiles(files) {
  const list = [...files].filter(f => AUDIO_RE.test(f.name));
  if (!list.length) { toast('Это не аудиофайлы'); return; }
  let added = 0;
  for (const [i, f] of list.entries()) {
    const id = 'f:' + f.name + '|' + f.size;
    if (tracks.has(id)) continue;
    const p = parseFileName(f.name);
    const t = { id, source: 'file', fileName: f.name, title: p.title, fileTitle: p.title, artist: p.artist, album: '', duration: 0, size: f.size, mime: f.type, downloaded: true, addedAt: Date.now() + list.length - i };
    await db.put('blobs', id, f);
    tracks.set(id, t);
    await enrich(t, f);
    await fulfilWish(t);
    added++;
  }
  rebuildOrder(); render();
  toast(added ? 'Добавлено: ' + tracksWord(added) : 'Эти треки уже есть');
  if (added && tgCfg?.chatId) askUpload();
  identHunt();
}

// ---------- обложки из интернета ----------
let hunting = false;
async function coverHunt() {
  if (hunting || !navigator.onLine) return;
  hunting = true;
  try {
    for (;;) {
      // оригинальную обложку ищем только для проверенных названий
      const t = order.map(id => tracks.get(id)).find(x => x && !x.artChecked && x.title && x.verified && x.ident?.status !== 'kept')
        || order.map(id => tracks.get(id)).find(x => x && !x.verified && !x.cover && !x.artGuess && x.title && !x.previewOnly);
      if (!t || !navigator.onLine) break;
      if (!t.verified) {
        // ещё не проверен по звуку: обложку ищем в интернете по названию, но только при точном совпадении названия и артиста.
        // Название и альбом не трогаем, в канал не пишем; после проверки по звуку обложка заменится оригинальной.
        t.artGuess = true;
        try {
          const it = await findOriginal(t.artist, t.title, t.duration);
          const b = it?.art && !t.cover && scoreCandidate(`${t.artist} - ${t.title}`, it) >= .9 ? await fetchArt(it.art).catch(() => null) : null;
          if (b) await setCover(t, b); else await saveTrack(t);
        } catch { await saveTrack(t); }
        continue;
      }
      try {
        const it = await findOriginal(t.artist, t.title, t.duration);
        t.artChecked = true;
        // название из LRCLIB заменяем оригинальным написанием из каталога
        if (it?.album && t.nameFrom === 'lrclib' && scoreCandidate(`${t.artist} - ${t.title}`, it) >= .9) { t.title = it.title; t.artist = it.artist; delete t.nameFrom; updateRow(t.id); if (t.id === curId) { paintNow(); mediaMeta(t); } }
        t.metaV = 2;
        if (it?.genre) t.genre = it.genre;
        if (it?.albumId && (!t.album || norm2(it.album) === norm2(t.album))) { t.albumId = it.albumId; t.albumTotal = it.albumTotal; t.trackNo = it.trackNo; if (!t.album) t.album = it.album; }
        if (it?.released && !t.released) t.released = it.released;
        if (it?.album && !t.album) t.album = it.album;
        // уже стоящую оригинальную обложку не трогаем: пост в канале второй раз не перезаливаем
        const b = it?.art && !t.coverOriginal ? await fetchArt(it.art).catch(() => null) : null;
        if (b) {
          t.coverOriginal = true;
          if (settings.writeChannel && inCurrentChat(t) && t.conf) t.chanPending = true;
          await setCover(t, b);
        } else await saveTrack(t);
        if (t.chanPending) chanQueue();
      } catch { break; }
    }
  } finally { hunting = false; }
}

// ---------- распознавание по звуку через AudD: без ключа всего несколько раз в день, часть оставляем микрофону ----------
const AUDD_AUTO_FREE = 5;
let auddUsed = 0;
const auddCalls = () => auddUsed;
function auddAllowed() {
  if ((settings.auddOffUntil || 0) > Date.now()) return false;
  const today = new Date().toDateString();
  if (settings.auddDay !== today) { settings.auddDay = today; settings.auddCount = 0; }
  return !!settings.auddToken || settings.auddCount < AUDD_AUTO_FREE;
}
async function auddFor(blob) {
  if (!auddAllowed()) return null;
  settings.auddCount++; auddUsed++; saveSettings();
  try { return await (await import('./listen.js')).recognizeTrack(blob, { token: settings.auddToken }); }
  catch (e) {
    if (['no-token', 'quota', 'bad-token'].includes(e.code)) { settings.auddOffUntil = Date.now() + 6 * 36e5; saveSettings(); }
    console.warn('audd', e.code || e); return null;
  }
}

let tempoRunning = false;
async function tempoHunt() {
  if (tempoRunning || isPhone()) return;
  tempoRunning = true;
  try {
    for (;;) {
      const t = order.map(id => tracks.get(id)).find(x => x?.downloaded && x.bpm === undefined);
      if (!t) break;
      await new Promise(r => setTimeout(r, engine.paused ? 300 : 1500));
      try {
        const blob = await db.get('blobs', t.id);
        const buf = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(await blob.arrayBuffer());
        const a = analyzeAudio(buf.getChannelData(0), buf.sampleRate);
        t.bpm = a.bpm; t.rms = a.rms;
      } catch { t.bpm = null; t.rms = null; }
      await saveTrack(t);
    }
  } finally { tempoRunning = false; }
}

// ---------- распознавание треков ----------
let identRunning = false, identPaint = 0;
const identState = { done: 0, total: 0 };
const fixCount = () => { let n = 0; for (const t of tracks.values()) if (t.ident?.status === 'found' && !t.verified) n++; return n; };

async function identHunt() {
  if (identRunning || !navigator.onLine) return;
  identRunning = true;
  try {
    for (;;) {
      while (sugFetching) await new Promise(r => setTimeout(r, 1000)); // у iTunes общий лимит запросов с подборкой Волны
      await new Promise(r => setTimeout(r, engine.paused ? 50 : 250)); // пока играет музыка, чуть медленнее
      const todo = order.map(id => tracks.get(id)).filter(t => t && !t.verified && !t.ident && !t.resetName); // старое название вернётся из канала — тогда и распознаем
      identState.total = identState.done + todo.length;
      if (!todo.length) {
        // Что не узнали раньше, пробуем по звуку, когда снова доступен дневной лимит AudD
        for (const t of order.map(id => tracks.get(id))) {
          if (!auddAllowed()) break;
          if (t?.verified || t?.ident?.status !== 'none' || t.ident.auddTried || !t.downloaded) continue;
          const blob = await db.get('blobs', t.id);
          const r = blob ? await auddFor(blob) : null;
          t.ident.auddTried = true;
          if (r) { await acceptFix(t, { title: r.title, artist: r.artist, album: r.album || '', art: r.art || null, source: 'sound', score: .95 }); identState.fixed = (identState.fixed || 0) + 1; }
          else await saveTrack(t);
        }
        break;
      }
      const t = todo[0];
      try {
        // на телефоне распознавание по звуку ждёт паузы: раскодировать трек во время игры — риск, что iOS выгрузит плеер
        const blob = t.downloaded && heavyOk() ? await db.get('blobs', t.id) : null; // на телефоне — только по названию
        const used = auddCalls();
        let cand = await identify(t, blob, settings.acoustKey, { audd: auddFor });
        if (cand && t.soundBad && sameName(cand, t.soundBad) && cand.source !== 'sound') cand = null; // по звуку уже выяснили, что это не она
        if (cand?.from === 'acoustid' && blob) {
          const { rawPrint } = await import('./audiokey.js');
          const r = await checkSound({ ...t, artist: cand.artist, title: cand.title, fileName: '' }, blob, { rawPrint, maxPreviews: 6 }).catch(() => ({ st: 'unknown' }));
          t.sound = { v: SOUND_V, st: r.st === 'ok' ? 'ok' : 'unknown', s: r.s ? +r.s.toFixed(2) : undefined };
          if (r.st === 'ok') cand = { ...r.cand, source: 'sound', score: r.s, auto: true }; // каталог подтвердил звук — берём его точное название и обложку
          else cand = { ...cand, auto: false }; // не подтвердилось — только подсказка в «Проверке названий»
        }
        if (!cand) t.ident = { status: 'none', v: IDENT_VER, auddTried: auddCalls() > used, at: Date.now() };
        // уверены или название и так совпало — сразу ставим оригинальные название и обложку
        else if (cand.auto || sameName(cand, t)) { await acceptFix(t, cand); identState.fixed = (identState.fixed || 0) + 1; coverHunt(); }
        else t.ident = { status: 'found', cand, v: IDENT_VER };
      } catch (e) {
        if (e.code === 4) { settings.acoustKey = ''; saveSettings(); toast('AcoustID не принял ключ. Проверь его в «Проверке названий»'); continue; }
        // сбой сервиса — не приговор треку: ничего не сохраняем и продолжим через минуту
        console.warn('identify', t.title, e);
        setTimeout(identHunt, 60000);
        break;
      }
      await saveTrack(t);
      identState.done++;
      if (view === 'fix') renderFix();
      else if (Date.now() - identPaint > 1500) { identPaint = Date.now(); renderNav(); paintSub(); }
    }
  } finally {
    identRunning = false;
    if (view === 'fix') renderFix(); else { renderNav(); paintSub(); }
    coverHunt();
    soundHunt();
  }
}

// Название, угаданное только по похожему тексту, откатываем: возвращаем то, что в канале или в файле
function undoGuess(t) {
  if (t.previewOnly || t.conf || t.ident?.status === 'kept' || ['ok', 'audd'].includes(t.sound?.st)) { if (['ok', 'audd'].includes(t.sound?.st) && !t.conf) { t.conf = true; saveTrack(t); } return false; }
  if (!t.verified && !t.ident) return false;
  if (t.orig) { t.title = t.orig.title; t.artist = t.orig.artist; delete t.orig; }
  else if (t.source === 'tg' && tgCfg?.chatId && tgCfg?.session) t.resetName = true;
  else if (t.fileName) { const p = parseFileName(t.fileName); t.title = cleanTag(p.title) || p.title || t.title; t.artist = cleanTag(p.artist) || ''; } // настоящее название возьмём из поста при следующем просмотре канала
  else if (t.fileTitle) { const p = parseFileName(t.fileName || ''); t.title = cleanTag(t.fileTitle) || t.fileTitle; t.artist = cleanTag(p.artist) || t.artist; }
  if (t.coverOriginal) { t.coverOriginal = false; t.cover = false; db.del('covers', t.id); db.del('covers', 'th:' + t.id); }
  for (const k of ['album', 'albumId', 'albumTotal', 'trackNo', 'genre', 'released', 'nameFrom', 'metaV', 'sound', 'soundBad', 'chanWait']) delete t[k];
  t.album = ''; t.verified = false; t.artChecked = false; t.chanPending = false; delete t.ident;
  saveTrack(t);
  return true;
}

// ---------- сверка по звуку: та ли это песня, что написана в названии ----------
let soundRunning = false;
const soundSkip = new Set();
const soundState = { done: 0, renamed: 0, bad: 0 };
const needsSound = t => t && t.downloaded && !t.previewOnly && t.source !== 'preview' && t.sound?.v !== SOUND_V && !['ok', 'audd'].includes(t.sound?.st) && t.ident?.status !== 'kept' && !t.conf;
// Телефон: распознавание по звуку не запускаем — раскодирование целых треков переполняет память iPhone. Это делает компьютер, названия приходят через синхронизацию
const heavyOk = () => !matchMedia('(pointer: coarse)').matches;
async function soundHunt() {
  if (soundRunning || identRunning || !navigator.onLine || !heavyOk()) return;
  soundRunning = true; soundSkip.clear();
  try {
    const { rawPrint } = await import('./audiokey.js');
    for (;;) {
      if (identRunning || !navigator.onLine) break;
      // на телефоне памяти мало: пока играет музыка, не раскодируем целые треки, иначе iOS выгружает плеер
      if (matchMedia('(pointer: coarse)').matches && (!engine.paused || document.hidden)) break;
      while (sugFetching) await new Promise(r => setTimeout(r, 1000));
      const t = order.map(id => tracks.get(id)).find(x => needsSound(x) && !soundSkip.has(x.id));
      if (!t) break;
      const blob = await db.get('blobs', t.id);
      if (!blob) { soundSkip.add(t.id); continue; } // файла сейчас нет на устройстве — сверим, когда скачается
      let r = { st: 'unknown' };
      await new Promise(r => setTimeout(r, engine.paused ? 200 : 1500)); // пока играет музыка — потише, чтобы не подтормаживало
      { try { r = await checkSound(t, blob, { rawPrint }); } catch (e) { console.warn('sound', t.title, e); r = { st: 'unknown' }; } }
      t.sound = { v: SOUND_V, st: r.st, s: r.s ? +r.s.toFixed(2) : undefined };
      if (r.st === 'ok') {
        const c = { ...r.cand, source: 'sound', score: r.s };
        const renamed = !sameName(c, t);
        if (renamed || !t.coverOriginal) { await acceptFix(t, c); if (renamed) soundState.renamed++; }
        else { t.verified = true; t.conf = true; t.ident = { status: 'done', v: IDENT_VER }; delete t.soundBad; updateRow(t.id); }
        if (t.chanWait) { delete t.chanWait; if (settings.writeChannel && inCurrentChat(t)) { t.chanPending = true; chanQueue(); } }
        await saveTrack(t);
      } else if (r.st === 'mismatch') {
        // название не подтвердилось: пробуем «Шазам», иначе — в «Проверку названий»
        const ac = settings.acoustKey ? await identify({ ...t, title: '', artist: '', fileName: '' }, blob, settings.acoustKey).catch(() => null) : null;
        const ok = ac?.source === 'sound' && ac.auto ? await checkSound({ ...t, artist: ac.artist, title: ac.title, fileName: '' }, blob, { rawPrint, maxPreviews: 6 }).catch(() => null) : null;
        if (ok?.st === 'ok') { await acceptFix(t, { ...ok.cand, source: 'sound', score: ok.s }); t.sound.st = 'ok'; await saveTrack(t); soundState.renamed++; } // AcoustID и каталог сошлись
        else { const au = auddAllowed() ? await auddFor(blob).catch(() => null) : null;
        if (au) { await acceptFix(t, { title: au.title, artist: au.artist, album: au.album || '', art: au.art || null, source: 'sound', score: .95 }); t.sound.st = 'audd'; await saveTrack(t); soundState.renamed++; }
        else { delete t.chanWait; t.soundBad = { title: t.title, artist: t.artist }; t.verified = false; t.ident = { status: 'none', v: IDENT_VER, at: Date.now(), soundBad: true }; soundState.bad++; await saveTrack(t); updateRow(t.id); } }
      } else await saveTrack(t);
      soundState.done++;
      if (view === 'fix') renderFix();
      else if (Date.now() - identPaint > 3000) { identPaint = Date.now(); renderNav(); }
    }
  } finally { soundRunning = false; }
}

function fixRowHTML(t) {
  const c = t.ident.cand;
  const was = `${coverHTML(t)}<span class="was"><span>${esc(t.title)}</span><span>${esc(t.artist || 'Без артиста')}</span></span><svg><use href="#i-arrow"/></svg>`;
  if (!c) return `<li class="fix" data-id="${esc(t.id)}">${was}<span class="cov new" style="--ch:${hash(t.id)}">?</span>
    <span class="is none"><span>${t.soundBad ? 'Звук не совпадает с названием' : 'Не распознан'}</span><span>Найди вручную или попробуй распознать ещё раз</span></span>
    <span class="acts"><button class="btn primary" data-fix="find">Найти</button><button class="btn" data-fix="audd" title="Точнее, но бесплатно только несколько раз в день">Как Шазам</button><button class="btn" data-fix="keep">Оставить</button></span></li>`;
  const art = c.art ? `<img class="cov new" src="${esc(c.art)}" alt="">` : `<span class="cov new" style="--ch:${hash(c.title)}">${esc(c.title[0] || '?')}</span>`;
  const tag = c.source === 'sound' ? 'По звуку' : c.source === 'manual' ? 'Выбрано вручную' : 'По названию файла';
  return `<li class="fix" data-id="${esc(t.id)}">${was}${art}
    <span class="is"><span>${esc(c.title)}</span><span>${esc(c.artist)}${c.album ? ' — ' + esc(c.album) : ''}</span><em class="tag ${c.source}">${tag}, совпадение ${Math.round(c.score * 100)}%</em></span>
    <span class="acts"><button class="btn primary" data-fix="ok">Принять</button><button class="btn" data-fix="find">Другой</button><button class="btn" data-fix="keep">Оставить</button></span></li>`;
}

// Сколько треков ещё не проверено — видно прямо над списком
let listSub = '';
function paintSub() {
  if (['fix', 'wave', 'wish', 'artists'].includes(view)) return;
  const left = identRunning ? identState.total - identState.done : 0;
  $('#viewSub').textContent = listSub + (left > 0 ? `. Распознаю названия: осталось ${left}` : '');
}
function renderFix() {
  $('#viewTitle').firstChild.textContent = 'Проверка названий';
  const list = order.map(id => tracks.get(id)).filter(t => t && !t.verified);
  const found = list.filter(t => t.ident?.status === 'found'), none = list.filter(t => t.ident?.status === 'none');
  const auto = identState.fixed ? `Исправлено само: ${identState.fixed}. ` : '';
  const snd = [...tracks.values()], sLeft = snd.filter(needsSound).length, sOk = snd.filter(t => t.sound?.st === 'ok').length, notDl = snd.filter(t => !t.downloaded && !t.previewOnly).length;
  $('#viewSub').textContent = auto + (identRunning ? `Распознаю треки: ${identState.done} из ${identState.total}` : found.length ? `Проверь сомнительные: ${found.length}` : '')
    + ` Сверено по звуку: ${sOk}${sLeft ? `, осталось ${sLeft}` : ''}${notDl ? `. Не скачано: ${notDl}, проверятся после скачивания` : ''}.`;
  $('#playAll').hidden = true;
  let bar = $('.fixbar');
  if (!bar) { bar = document.createElement('div'); bar.className = 'fixbar'; $('#rows').before(bar); }
  const key = settings.acoustKey;
  bar.innerHTML = `<span class="note">${key ? 'Треки распознаются по звуку и по названию файла.' : 'Сейчас треки ищутся только по названию файла. По звуку получится точнее.'}</span>
    <button class="btn" data-act="acoust">${key ? 'Ключ AcoustID' : 'Включить распознавание по звуку'}</button>
    ${tgCfg?.chatId ? `<label><input type="checkbox" class="sw" id="writeChan"${settings.writeChannel ? ' checked' : ''}>Исправлять и в канале</label>` : ''}
    <button class="btn" data-act="identAll" title="Заново распознать всё, что не подтверждено по звуку или тобой">Найти все треки</button>
    ${found.length ? `<button class="btn primary" data-act="acceptAll">Принять все (${found.length})</button>` : ''}`;
  const empty = $('#empty');
  empty.hidden = !!(found.length || none.length || identRunning);
  if (!empty.hidden) empty.innerHTML = tracks.size
    ? `<h2>Все названия в порядке</h2><p>Новые треки из канала будут проверяться сами, как только скачаются.</p>`
    : `<h2>Пока нечего проверять</h2><p>Подключи Telegram-канал, и Mix проверит названия всех треков.</p>`;
  $('#rows').innerHTML = found.map(fixRowHTML).join('')
    + (none.length ? `<li class="fixhead">Не распознаны: ${none.length}</li>` + none.map(fixRowHTML).join('') : '');
  hydrateIn($('#rows'));
}

async function acceptFix(t, c) {
  const renamed = t.title !== c.title || t.artist !== c.artist;
  if (renamed && !t.orig) t.orig = { title: t.title, artist: t.artist }; // чтобы можно было вернуть
  if (c.source === 'sound' || c.source === 'manual') t.conf = true; else delete t.conf;
  if (c.source === 'manual') t.fixedBy = 'manual'; else delete t.fixedBy;
  t.title = c.title; t.artist = c.artist; if (c.album) t.album = c.album; if (c.released) t.released = c.released; if (c.genre) t.genre = c.genre;
  if (c.albumId) { t.albumId = c.albumId; t.albumTotal = c.albumTotal; t.trackNo = c.trackNo; t.metaV = 2; }
  t.verified = true; t.ident = { status: 'done', v: IDENT_VER };
  if (c.from === 'lrclib') t.nameFrom = 'lrclib'; else delete t.nameFrom;
  // обложка всегда оригинальная, даже если в файле уже была какая-то картинка
  const b = c.art ? await fetchArt(c.art).catch(() => null) : null;
  if (b) { t.coverOriginal = true; t.artChecked = true; await setCover(t, b); }
  // В канал пишем только то, что подтверждено по звуку: название в посте может быть чужим
  if ((renamed || b) && settings.writeChannel && inCurrentChat(t)) { if (c.source === 'sound' || c.source === 'manual') { t.chanPending = true; delete t.chanWait; } else t.chanWait = true; }
  await saveTrack(t);
  updateRow(t.id);
  if (t.id === curId) { paintNow(); mediaMeta(t); if (lyricsOn) loadLyrics(true); }
  if (t.chanPending) chanQueue();
  fulfilWish(t);
}

function openAcoust() {
  const d = modal(`<h2>Распознавание по звуку</h2>
    <p>Mix снимает с трека звуковой «отпечаток» и ищет его в открытой базе AcoustID. Так находится даже файл с названием вроде track_123.mp3. Нужен бесплатный ключ.</p>
    <ol><li>Открой <a href="https://acoustid.org/new-application" target="_blank" rel="noopener">acoustid.org/new-application</a> и войди через MusicBrainz или Google.</li>
    <li>Создай приложение: название <b>Mix</b>, версия <b>1.0</b>.</li><li>Скопируй сюда <b>API key</b>.</li></ol>
    <form><label>API key</label><input class="inp" name="k" required autocomplete="off" value="${esc(settings.acoustKey)}">
    <div class="acts"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Сохранить</button></div></form>`);
  $('[data-x]', d).onclick = closeLayer;
  $('form', d).onsubmit = e => {
    e.preventDefault();
    settings.acoustKey = e.target.k.value.trim(); saveSettings(); closeLayer();
    for (const t of tracks.values()) if (t.ident?.status === 'none' && !t.verified) delete t.ident; // попробуем ещё раз, уже по звуку
    renderFix(); identHunt();
  };
}

let previewEl;
function openFind(t) {
  const d = modal(`<h2>Какой это трек?</h2><p>Сейчас: <b>${esc(t.title)}</b>${t.artist ? ' — ' + esc(t.artist) : ''}</p>
    <form id="fq"><input class="inp" name="q" value="${esc(cleanName(t.fileName || '') || cleanName(t.artist + ' ' + t.title))}" placeholder="Артист и название"></form>
    <ul class="results" id="fr"><li style="color:var(--mist)">Ищу…</li></ul>
    <label>Или впиши сам</label><form id="fm" style="display:flex;gap:8px;flex-wrap:wrap"><input class="inp" name="a" placeholder="Артист" style="flex:1 1 140px" value="${esc(t.artist)}">
    <input class="inp" name="t" placeholder="Название" style="flex:1 1 160px" value="${esc(t.title)}" required><button class="btn">Сохранить</button></form>`);
  let res = [];
  const search = async q => {
    $('#fr', d).innerHTML = '<li style="color:var(--mist)">Ищу…</li>';
    try { res = await searchItunes(q, 15); } catch { $('#fr', d).innerHTML = '<li class="err">Поиск не ответил. Проверь интернет.</li>'; return; }
    $('#fr', d).innerHTML = res.length ? res.map((r, i) => `<li><img src="${esc(r.art || '')}" alt=""><span><b>${esc(r.title)}</b><small>${esc(r.artist)}${r.album ? ' — ' + esc(r.album) : ''}, ${fmt(r.duration)}</small></span>
      ${r.preview ? `<button class="ib" data-pv="${i}" title="Послушать 30 секунд"><svg><use href="#i-play"/></svg></button>` : '<span></span>'}<button class="btn" data-pick="${i}">Это он</button></li>`).join('')
      : '<li style="color:var(--mist)">Ничего не нашлось. Попробуй короче: только артист или только название.</li>';
  };
  $('#fq', d).onsubmit = e => { e.preventDefault(); search(e.target.q.value.trim()); };
  $('#fm', d).onsubmit = async e => {
    e.preventDefault(); stopPreview(); closeLayer();
    await acceptFix(t, { title: e.target.t.value.trim(), artist: e.target.a.value.trim(), album: '', art: null, source: 'manual', score: 1 });
    render(); toast('Сохранено');
  };
  $('#fr', d).onclick = async e => {
    const pv = e.target.closest('[data-pv]'), pk = e.target.closest('[data-pick]');
    if (pv) {
      const r = res[pv.dataset.pv], playing = previewEl && !previewEl.paused && previewEl.dataset.i === pv.dataset.pv;
      stopPreview(); $$('[data-pv]', d).forEach(b => b.innerHTML = '<svg><use href="#i-play"/></svg>');
      if (!playing) { previewEl = new Audio(r.preview); previewEl.dataset.i = pv.dataset.pv; previewEl.volume = .7; previewEl.play().catch(() => {}); pv.innerHTML = '<svg><use href="#i-pause"/></svg>'; }
    } else if (pk) {
      stopPreview(); closeLayer();
      await acceptFix(t, { ...res[pk.dataset.pick], source: 'manual', score: 1 });
      render(); toast('Сохранено');
    }
  };
  new MutationObserver((_, o) => { if (!d.isConnected) { stopPreview(); o.disconnect(); } }).observe(layer, { childList: true });
  search($('#fq input', d).value);
}

// ---------- запись исправлений в канал ----------
const chan = { running: false, done: 0, total: 0, error: '' };
async function makeThumb(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = c.height = 320;
  const s = Math.min(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 320, 320);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .86));
}
async function chanQueue() {
  if (chan.running || !tgCfg?.chatId) return;
  if (!settings.chanVerified && settings.chanCanary) { renderTgCard(); return; }
  Object.assign(chan, { running: true, error: '' });
  renderTgCard();
  try {
    const tg = await ensureTg(), entity = await resolveChat(tg);
    const later = new Set(); // эти посты в этот раз не получились — не мешаем остальным
    for (;;) {
      // только посты выбранного сейчас канала: номера сообщений в разных каналах совпадают
      const pending = [...tracks.values()].filter(x => x.chanPending && x.conf && x.artChecked && inCurrentChat(x) && !later.has(x.id));
      chan.total = chan.done + pending.length;
      const t = pending[0]; if (!t) break;
      renderTgCard();
      try {
        const blob = await db.get('blobs', t.id);
        if (!blob) { later.add(t.id); continue; } // файл ещё не скачан: исправление остаётся в очереди
        const cover = t.cover ? await db.get('covers', t.id) : null;
        const ext = t.fileName?.match(/\.\w{2,4}$/)?.[0] || (/mp4|m4a|aac/.test(t.mime || '') ? '.m4a' : '.mp3');
        const fileName = `${t.artist ? t.artist + ' - ' : ''}${t.title}${ext}`.replace(/[\\/:*?"<>|]/g, '');
        const thumb = cover ? await makeThumb(cover).catch(() => null) : null;
        await tg.editAudio(entity, t.msgId, { blob, fileName, mime: t.mime || blob.type || 'audio/mpeg', title: t.title, performer: t.artist, duration: t.duration || t.bounds?.d, thumb });
        t.fileName = fileName; tgItems.delete(t.id);
        t.chanPending = false; await saveTrack(t);
        chan.done++;
        // Самый первый пост — проба: человек смотрит на него в канале, и только потом идут остальные
        if (!settings.chanVerified) { settings.chanCanary = t.title; saveSettings(); break; }
      } catch (e) {
        const m = e.errorMessage || e.message || '';
        console.warn('channel edit', t.title, m);
        if (/MESSAGE_NOT_MODIFIED/.test(m)) { t.chanPending = false; await saveTrack(t); continue; }
        if (/ADMIN_REQUIRED|WRITE_FORBIDDEN|EDIT_FORBIDDEN/.test(m)) {
          chan.error = 'Нет прав редактировать посты в этом канале. Исправления сохранены только в Mix';
          for (const x of tracks.values()) if (x.chanPending && inCurrentChat(x)) { x.chanPending = false; saveTrack(x); }
          break;
        }
        if (/NOT_EDITABLE_POST|AUTHOR_REQUIRED|MESSAGE_ID_INVALID|EDIT_TIME_EXPIRED/.test(m)) {
          // этот пост нельзя править (пересланный, чужой, удалён); название останется исправленным только в Mix
          t.chanPending = false; await saveTrack(t);
          chan.skipped = (chan.skipped || 0) + 1;
          chan.error = `Постов, которые нельзя исправить в канале: ${chan.skipped}. В Mix названия верные`;
          continue;
        }
        if (e instanceof TypeError || /FLOOD|disconnect|Not connected|TIMEOUT/i.test(m) || !navigator.onLine) { chan.error = 'Telegram просит подождать, продолжу позже'; break; }
        later.add(t.id);
        chan.error = 'Часть постов обновить не вышло, попробую при следующем запуске';
      }
    }
  } catch { chan.error = 'Нет связи с Telegram, канал обновлю позже'; }
  finally { chan.running = false; renderTgCard(); }
}

// ---------- текст песни ----------
let lyricsOn = false, lyr = null, lyrFor = null, lyrLine = -1, lyrTouched = 0;
async function loadLyrics(force) {
  const t = engine.track; if (!t) return;
  if (!force && lyrFor === t.id) return;
  lyrFor = t.id; lyr = null; paintLyrics('loading');
  const key = 'ly:' + t.id, sig = t.title + '|' + t.artist;
  let data = await db.get('kv', key);
  if (!data || data.sig !== sig) {
    if (!navigator.onLine) { if (lyrFor === t.id) paintLyrics('offline'); return; }
    try { data = { sig, ...await findLyrics({ title: t.title, artist: t.artist, album: t.album, duration: t.duration || t.bounds?.d }) }; await db.put('kv', key, data); }
    catch { if (lyrFor === t.id) paintLyrics('error'); return; }
  }
  if (lyrFor !== t.id) return;
  lyr = data; paintLyrics();
}
function paintLyrics(state) {
  const el = $('#lyrics'), msg = s => `<div class="msg">${s}</div>`;
  el.classList.remove('plain'); lyrLine = -1;
  if (state === 'loading') el.innerHTML = msg('Ищу текст…');
  else if (state === 'offline') el.innerHTML = msg('Текст загрузится, когда появится интернет.');
  else if (state === 'error') el.innerHTML = msg('Сервис текстов сейчас не отвечает. Попробуй чуть позже.');
  else if (!lyr || lyr.none) el.innerHTML = msg('Текста этой песни пока нет в базе.');
  else if (lyr.instrumental) el.innerHTML = msg('Это инструментальный трек, слов нет.');
  else if (lyr.synced) el.innerHTML = lyr.synced.map((l, i) => `<p data-t="${l.t}"${l.text ? '' : ' class="gap"'}>${l.text ? esc(l.text) : '•••'}</p>`).join('') + '<div class="src">Текст: LRCLIB</div>';
  else { el.classList.add('plain'); el.innerHTML = lyr.plain.split('\n').map(s => `<p>${esc(s) || '&nbsp;'}</p>`).join('') + '<div class="src">Текст без привязки ко времени. Источник: LRCLIB</div>'; }
  el.scrollTop = 0;
}
function tickLyrics(pos) {
  if (!lyricsOn || !lyr?.synced) return;
  const lines = lyr.synced;
  let i = -1; for (let k = 0; k < lines.length && lines[k].t <= pos + .25; k++) i = k;
  if (i === lyrLine) return;
  lyrLine = i;
  const el = $('#lyrics'), ps = el.querySelectorAll('p');
  ps.forEach((p, k) => { p.classList.toggle('now', k === i); p.classList.toggle('past', k < i); });
  if (i >= 0 && Date.now() - lyrTouched > 3500) el.scrollTo({ top: ps[i].offsetTop - el.clientHeight * .38, behavior: 'smooth' });
}
function setLyrics(on) {
  lyricsOn = on;
  $('#full').classList.toggle('ly', on);
  $('#lyrics').hidden = !on;
  for (const b of $$('[data-act=lyrics]')) b.classList.toggle('on', on);
  if (on) { $('#full').classList.add('open'); loadLyrics(); }
}
$('#lyrics').addEventListener('click', e => { const p = e.target.closest('p[data-t]'); if (p) { engine.seek(+p.dataset.t); lyrTouched = 0; } });
for (const ev of ['wheel', 'touchmove']) $('#lyrics').addEventListener(ev, () => lyrTouched = Date.now(), { passive: true });

// ---------- подключить телефон: ключи и канал передаются QR-кодом, вход в Telegram каждый раз свой ----------
const SITE_URL = 'https://traaarik1.github.io/mix-player/';
// Сессию не передаём: одна сессия на двух устройствах ломается, и такой код равнялся бы доступу к аккаунту.
// После # адрес на сервер не уходит, так что ключи остаются только у тебя.
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const pairCode = () => 'MIX1.' + b64(JSON.stringify({ i: tgCfg.apiId, h: tgCfg.apiHash, c: tgCfg.chatId, t: tgCfg.chatTitle }));
function parsePair(text) {
  const m = String(text || '').match(/(?:MIX1\.|pair=)([\w-]+)/);
  if (!m) return null;
  try {
    const p = JSON.parse(unb64(m[1]));
    return /^\d+$/.test(p.i) && /^[0-9a-f]{32}$/i.test(p.h) ? p : null;
  } catch { return null; }
}
let pendingPair = null;
function loadQr() {
  return window.qrcode ? Promise.resolve() : new Promise((res, rej) => {
    const el = document.createElement('script'); el.src = 'vendor/qrcode/qrcode.js'; el.onload = res; el.onerror = rej; document.head.append(el);
  });
}
async function openPair() {
  const code = pairCode(), url = SITE_URL + '#pair=' + code.slice(5);
  const d = modal(`<h2>Подключить телефон</h2><div class="qrbox" id="qr"></div>
    <ol><li>Наведи камеру iPhone на код и открой ссылку.</li><li>Следуй подсказкам на телефоне: иконка на экран «Домой», затем вход.</li><li>Telegram спросит только номер и код. Лайки, плейлисты и исправленные названия приедут сами, а музыка скачается из канала.</li></ol>
    <p class="warn">В этом коде твои ключи Telegram. Сам по себе он не даёт войти в аккаунт, но никому его не показывай.</p>
    <div class="acts"><button class="btn" id="pairCopy">Скопировать код</button><button class="btn primary" data-x>Готово</button></div>`);
  $('[data-x]', d).onclick = closeLayer;
  $('#pairCopy', d).onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Код скопирован'); } catch { toast('Не получилось скопировать'); } };
  try {
    await loadQr();
    const q = window.qrcode(0, 'M'); q.addData(url); q.make();
    $('#qr', d).innerHTML = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  } catch { $('#qr', d).textContent = 'QR-код не загрузился, воспользуйся кнопкой «Скопировать код»'; }
}
// Ссылка из QR-кода открылась на устройстве
function handlePairLink() {
  const p = parsePair(location.hash);
  if (!location.hash.startsWith('#pair=')) return;
  const code = location.hash.slice(6);
  history.replaceState(null, '', location.pathname);
  if (!p || tgCfg?.session) { if (tgCfg?.session) toast('Это устройство уже подключено'); return; }
  if (!needsIosInstallHint()) { pendingPair = p; openTg(); return; }
  const d = modal(`<h2>Почти готово</h2><p>На iPhone у приложения с иконки своё хранилище, поэтому код нужно перенести туда.</p>
    <ol><li><button class="btn primary" id="pairCopy">Скопировать код</button></li>
    <li>Нажми «Поделиться», затем <b>«На экран “Домой”»</b> и «Добавить».</li>
    <li>Открой <b>Mix с новой иконки</b>, нажми «Подключить Telegram» и вставь код.</li>
    <li>Введи номер и код из Telegram. Всё остальное подтянется само.</li></ol>
    <div class="acts"><button class="btn" data-x>Закрыть</button></div>`);
  $('[data-x]', d).onclick = closeLayer;
  $('#pairCopy', d).onclick = async e => {
    try { await navigator.clipboard.writeText('MIX1.' + code); e.target.textContent = 'Скопировано'; }
    catch { e.target.textContent = 'MIX1.' + code; e.target.style.cssText = 'white-space:normal;word-break:break-all;user-select:all;font-size:12px'; }
  };
}

// ---------- свои файлы → канал: так они появляются на телефоне ----------
const localFiles = () => [...tracks.values()].filter(t => t.source === 'file' && !t.previewOnly);
function askUpload() {
  const n = localFiles().length; if (!n || !tgCfg?.chatId) return;
  const d = modal(`<h2>Отправить в канал?</h2><p>${tracksWord(n)} есть только на этом компьютере. Если отправить их в «${esc(tgCfg.chatTitle)}», они появятся на телефоне и останутся в канале навсегда.</p>
    <div class="acts"><button class="btn" data-x>Не сейчас</button><button class="btn primary" id="upGo">Отправить</button></div>`);
  $('[data-x]', d).onclick = closeLayer;
  $('#upGo', d).onclick = () => { closeLayer(); uploadLocal(); };
}
let uploading = false;
async function uploadLocal() {
  if (uploading) return; uploading = true;
  let done = 0, failed = 0;
  try {
    const tg = await ensureTg(), entity = await resolveChat(tg);
    for (const t of localFiles()) {
      toast(`Отправляю в канал: ${done + 1} из ${localFiles().length + done}`);
      try {
        const blob = await db.get('blobs', t.id); if (!blob) continue;
        const cover = t.cover ? await db.get('covers', t.id) : null;
        const ext = t.fileName?.match(/\.\w{2,4}$/)?.[0] || '.mp3';
        const fileName = `${t.artist ? t.artist + ' - ' : ''}${t.title}${ext}`.replace(/[\\/:*?"<>|]/g, '');
        const msgId = await tg.sendAudio(entity, { blob, fileName, mime: t.mime || blob.type || 'audio/mpeg', title: t.title, performer: t.artist, duration: t.duration || t.bounds?.d, thumb: cover ? await makeThumb(cover).catch(() => null) : null });
        await moveTrack(t, { ...t, id: `tg:${tgCfg.chatId}:m${msgId}`, source: 'tg', msgId, fileName, downloaded: true });
        done++;
      } catch (e) { failed++; console.warn('upload', t.title, e); }
    }
  } catch { toast('Нет связи с Telegram, отправлю позже'); }
  finally { uploading = false; }
  if (done || failed) toast(failed ? `Отправлено ${done}, не вышло ${failed}` : `Готово: ${tracksWord(done)} теперь и на телефоне`);
}
// Трек меняет id: переносим файл, обложку, лайки, плейлисты и очередь
async function moveTrack(t, nt) {
  const [blob, cover] = await Promise.all([db.get('blobs', t.id), db.get('covers', t.id)]);
  if (blob) await db.put('blobs', nt.id, blob);
  if (cover) await db.put('covers', nt.id, cover);
  tracks.delete(t.id); tracks.set(nt.id, nt); await saveTrack(nt);
  await Promise.all([db.del('blobs', t.id), db.del('covers', t.id), db.del('tracks', t.id)]);
  const swap = x => x === t.id ? nt.id : x;
  if (lib.likes.delete(t.id)) lib.likes.add(nt.id);
  for (const p of lib.playlists) p.ids = p.ids.map(swap);
  lib.history = lib.history.map(h => ({ ...h, id: swap(h.id) }));
  queue = queue.map(swap); queueBase = queueBase.map(swap); userQueue = userQueue.map(swap);
  if (curId === t.id) curId = nt.id;
  coverUrls.delete(t.id); thumbUrls.delete(t.id); thumbReady.delete(t.id);
  saveLib(); saveQueue(); rebuildOrder(); render();
}

// ---------- Telegram ----------
let tgMod = null, tgReady = null;
const tgItems = new Map();
const sync = { running: false, stop: false, done: 0, total: 0, scanned: 0, error: '' };
const tgLib = async () => tgMod ??= await import('./tg.js');

let tgConnecting = false;
// Только одна вкладка Mix держит связь с Telegram: две вкладки с одним ключом Telegram считает взломом и отключает вход
let tgLock = null;
function holdTgLock() {
  if (tgLock) return tgLock;
  tgLock = new Promise(res => {
    if (!navigator.locks) return res(true);
    navigator.locks.request('mix-telegram', { ifAvailable: true }, lock => { res(!!lock); return lock ? new Promise(() => {}) : undefined; });
  }).then(ok => { if (!ok) tgLock = null; return ok; });
  return tgLock;
}
function ensureTg() {
  if (tgReady) return tgReady;
  tgConnecting = true;
  tgReady = (async () => {
    if (!await holdTgLock()) throw new Error('busy');
    const tg = await tgLib();
    await tg.connect(tgCfg);
    if (!await tg.authorized()) throw new Error('auth');
    return tg;
  })();
  tgReady.catch(() => { tgReady = null; }).finally(() => { tgConnecting = false; });
  return tgReady;
}
// Трек из канала друга: { peer: @имя или номер канала }
async function friendItem(t) {
  const tg = await ensureTg();
  const ent = await tg.peer(t.ext.peer || t.ext.chat).catch(() => null);
  if (!ent) throw new Error('Канал друга закрытый: попроси его добавить тебя в канал или сделать канал публичным');
  const it = await tg.message(ent, t.msgId); if (!it) throw new Error('Сообщение удалено из канала');
  return it;
}
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
async function sharePlaylist(p) {
  const own = p.ids.map(id => getT(id)).filter(t => t && t.source === 'tg' && inCurrentChat(t));
  if (!own.length) { toast('В плейлисте нет треков из твоего канала'); return; }
  let uname = null;
  try { const ent = await resolveChat(await ensureTg()); uname = ent?.username || null; } catch {}
  const data = { n: p.name, u: uname, c: tgCfg.chatId, m: own.map(t => t.msgId), t: own.map(t => [t.artist || '', t.title]) };
  const url = SITE + '?pl=' + b64u(JSON.stringify(data));
  const d = modal(`<h2>Поделиться «${esc(p.name)}»</h2>
    <p>Друг откроет ссылку в своём Mix и будет слушать полные треки прямо из твоего канала — без 30-секундных отрывков. ${tracksWord(own.length)}.</p>
    ${uname ? '' : '<p class="morenote">Твой канал закрытый: друг услышит треки, только если подписан на него. Чтобы слушали все, у кого есть ссылка: настройки канала → «Тип канала» → «Публичный».</p>'}
    <div class="acts"><button class="btn" data-x>Закрыть</button><button class="btn primary" id="plShare">Отправить ссылку</button></div>`);
  $('[data-x]', d).onclick = closeLayer;
  $('#plShare', d).onclick = async () => {
    try { if (navigator.share) { await navigator.share({ title: p.name, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch { toast(url); }
  };
}
function importShared(raw) {
  let d; try { d = JSON.parse(unb64u(raw)); } catch { toast('Ссылка на плейлист повреждена'); return; }
  if (!d?.m?.length) return;
  const m = modal(`<h2>Плейлист «${esc(d.n)}»</h2><p>${tracksWord(d.m.length)} из канала ${d.u ? '@' + esc(d.u) : 'друга'}. Добавить в твой Mix? Полные треки будут играть из канала друга${tgCfg?.session ? '' : ' — для этого подключи свой Telegram'}.</p>
    ${tgCfg?.chatId ? '<label class="check"><input type="checkbox" class="sw" id="plCopy" checked><span>Сохранить треки в мой канал<small>Mix перешлёт их из канала друга к тебе: будут на всех твоих устройствах и не пропадут, даже если друг удалит канал</small></span></label>' : ''}
    <div class="acts"><button class="btn" data-x>Не сейчас</button><button class="btn primary" id="plAdd">Добавить</button></div>`);
  $('[data-x]', m).onclick = closeLayer;
  $('#plAdd', m).onclick = async () => {
    const copy = !!$('#plCopy', m)?.checked;
    const mine = [...tracks.values()], ids = [];
    for (let i = 0; i < d.m.length; i++) {
      const [artist, title] = d.t?.[i] || ['', 'Трек ' + (i + 1)];
      const have = mine.find(t => !t.previewOnly && sameTrack({ artist, title }, t));
      if (have) { ids.push(have.id); continue; }
      const id = `tg:${d.c}:m${d.m[i]}`;
      if (!tracks.has(id)) { const nt = { id, source: 'tg', msgId: d.m[i], ext: { peer: d.u, chat: d.c }, from: 'friend', title, artist, album: '', duration: 0, downloaded: false, verified: true, conf: true, ident: { status: 'kept' }, addedAt: Date.now() - i }; tracks.set(id, nt); await saveTrack(nt); }
      ids.push(id);
    }
    const p = { id: 'pl' + Date.now().toString(36), name: d.n, ids };
    lib.playlists.push(p); saveLib(); rebuildOrder(); closeLayer(); view = p.id; render();
    toast(`Плейлист «${d.n}» добавлен`);
    if (copy) copyShared(d).catch(err => toast(err.message || 'Не получилось переслать треки'));
  };
}
// Пересылаем треки из канала друга в свой канал и превращаем их в обычные свои треки
async function copyShared(d) {
  const tg = await ensureTg();
  const from = await tg.peer(d.u || d.c).catch(() => null);
  if (!from) throw new Error('Канал друга закрытый: попроси добавить тебя в канал или сделать его публичным');
  const to = await resolveChat(tg);
  const todo = d.m.filter(id => tracks.get(`tg:${d.c}:m${id}`)?.ext); // то, чего у тебя ещё нет
  let done = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const part = todo.slice(i, i + 50);
    toast(`Сохраняю в твой канал: ${done} из ${todo.length}`);
    const got = await tg.forward(from, part, to);
    for (let j = 0; j < part.length; j++) {
      const old = tracks.get(`tg:${d.c}:m${part[j]}`), nid = got[j];
      if (!old || !nid) continue;
      const nt = { ...old, id: `tg:${tgCfg.chatId}:m${nid}`, msgId: nid, from: 'friend' }; delete nt.ext;
      await moveTrack(old, nt); done++;
    }
  }
  toast(done ? `Сохранено в твой канал: ${tracksWord(done)}` : 'Ничего не переслалось');
}
const inCurrentChat = t => t.source === 'tg' && !!tgCfg?.chatId && t.id.startsWith(`tg:${tgCfg.chatId}:`);
let chatEntity = null;
async function resolveChat(tg) {
  if (chatEntity) return chatEntity;
  const c = (await tg.chats()).find(c => c.id === tgCfg.chatId);
  if (!c) throw new Error('Канал не найден. Возможно, ты из него вышел');
  return chatEntity = c.entity;
}
// id по номеру сообщения: после исправления названия файл в посте меняется, а пост остаётся тем же
const tgId = it => `tg:${tgCfg.chatId}:m${it.msgId}`;
function tgByMsg() {
  const m = new Map(), pre = `tg:${tgCfg.chatId}:`;
  for (const t of tracks.values()) if (t.source === 'tg' && t.id.startsWith(pre)) m.set(t.msgId, t);
  return m;
}

async function downloadTrack(t) {
  if (downloads.has(t.id)) return downloads.get(t.id);
  const p = (async () => {
    if (!inCurrentChat(t) && !t.ext) throw new Error('Трек из другого канала');
    const tg = await ensureTg();
    let it = tgItems.get(t.id);
    if (!it && t.ext) { it = await friendItem(t); tgItems.set(t.id, it); }
    if (!it) { it = await tg.message(await resolveChat(tg), t.msgId); if (!it) throw new Error('Сообщение удалено из канала'); tgItems.set(t.id, it); }
    t.dlp = 0; updateRow(t.id);
    let last = 0;
    const blob = await tg.download(it, p => { t.dlp = p; if (Date.now() - last > 700) { last = Date.now(); renderTgCard(); } });
    await db.put('blobs', t.id, blob);
    t.downloaded = true; t.size = blob.size; delete t.dlp;
    await enrich(t, blob, it);
    updateRow(t.id);
    fulfilWish(t);
    if (t.ident?.status === 'none' && settings.acoustKey) delete t.ident;
    identHunt();
  })();
  downloads.set(t.id, p);
  try { await p; } finally { downloads.delete(t.id); delete t.dlp; }
}

async function startSync() {
  if (sync.running || !tgCfg?.chatId) return;
  Object.assign(sync, { running: true, stop: false, done: 0, total: 0, scanned: 0, error: '' });
  renderTgCard(); keepAwake(true);
  try {
    const tg = await ensureTg();
    initCloud().catch(e => console.warn('sync', e));
    const chat = await resolveChat(tg);
    const skip = new Set(tgCfg.skip || []);
    const needThumb = [];
    const known = tgByMsg();
    let lastPaint = 0;
    for await (const it of tg.audioMessages(chat)) {
      if (sync.stop) break;
      const old = known.get(it.msgId);
      if (old) {
        tgItems.set(old.id, it); sync.scanned++;
        if (it.caption && old.caption !== it.caption) { old.caption = it.caption; if (!old.verified && old.ident?.status === 'none') delete old.ident; saveTrack(old); } // подпись появилась — попробуем распознать заново
        if (!old.cover && it.hasThumb) needThumb.push([old, it]);
        if (old.resetName) { // вернуть название как в посте
          const p = parseFileName(it.fileName || '');
          old.title = cleanTag(it.title) || cleanTag(p.title) || p.title || old.title; old.artist = cleanTag(it.artist) || cleanTag(p.artist) || '';
          delete old.resetName; await saveTrack(old); updateRow(old.id);
        }
        continue;
      }
      const id = tgId(it);
      tgItems.set(id, it);
      sync.scanned++;
      if (skip.has(id) || tracks.has(id)) continue;
      const p = parseFileName(it.fileName || 'Без названия');
      const t = { id, source: 'tg', msgId: it.msgId, fileName: it.fileName, caption: it.caption || undefined, title: cleanTag(it.title) || cleanTag(p.title) || p.title, fileTitle: p.title, artist: cleanTag(it.artist) || cleanTag(p.artist), album: '',
        duration: it.duration, size: it.size, mime: it.mime, downloaded: false, addedAt: it.date * 1000 + (it.msgId % 1000) };
      // другое устройство уже могло исправить название этого трека
      const meta = cloud?.trackMeta(id);
      if (meta?.conf) Object.assign(t, { conf: true, title: meta.title, artist: meta.artist, album: meta.album, verified: meta.verified }, meta.verified ? { ident: { status: 'done' } } : {});
      tracks.set(id, t); await saveTrack(t);
      if (Date.now() - lastPaint > 4000) { lastPaint = Date.now(); rebuildOrder(); if (view === 'all') render(); renderTgCard(); }
    }
    // картинки постов — маленькие, качаем по одной в фоне; сначала ищем в интернете, картинка поста — запасной вариант
    (async () => { for (const [t, it] of needThumb) { if (t.cover || (!t.artGuess && !t.verified)) continue; const b = await tg.downloadThumb(it).catch(() => null); if (b) await setCover(t, b); } })();
    if (!sync.stop) for (const t of tracks.values()) if (t.resetName && inCurrentChat(t)) {
      const p = parseFileName(t.fileName || ''); t.title = cleanTag(p.title) || p.title || t.title; t.artist = cleanTag(p.artist) || '';
      delete t.resetName; saveTrack(t);
    }
    rebuildOrder(); render(); identHunt();
    const todo = order.map(id => tracks.get(id)).filter(t => t.source === 'tg' && !t.downloaded);
    sync.total = todo.length;
    for (const t of todo) {
      if (sync.stop) break;
      try { await downloadTrack(t); } catch (e) { console.warn('download', t.title, e); }
      sync.done++; renderTgCard();
    }
    tgCfg.lastSync = Date.now(); saveTg();
  } catch (e) {
    const why = String(e.errorMessage || e.message || '');
    // ключ отклонён самим Telegram (две вкладки, завершённый сеанс) — это не «нет связи», а нужен новый вход
    if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/.test(why)) e = new Error('auth');
    sync.error = e.message === 'auth' ? 'Нужно войти в Telegram заново' : e.message?.startsWith('Канал') ? e.message : 'Нет связи с Telegram' + (why && why !== 'auth' ? ': ' + why.slice(0, 80) : '');
    if (e.message === 'busy') sync.error = 'Mix открыт в другой вкладке или окне — Telegram работает там. Закрой лишнюю вкладку';
    if (e.message === 'auth') { tgCfg.session = ''; saveTg(); }
    console.warn(e);
  } finally {
    sync.running = false; keepAwake(false); renderTgCard(); updateUsage(); coverHunt();
  }
}

function renderTgCard() {
  const c = $('#tgcard');
  if (!tgCfg?.session || !tgCfg.chatId) {
    c.innerHTML = `<b>Telegram</b><p>${tgCfg?.session ? 'Выбери канал с музыкой' : 'Подключи свой канал с музыкой'}</p><button class="btn primary" data-act="tg">${tgCfg?.session ? 'Выбрать канал' : 'Подключить'}</button>`;
    return;
  }
  const count = order.filter(id => tracks.get(id).source === 'tg').length;
  if (!settings.chanVerified && settings.chanCanary && !chan.running) {
    c.innerHTML = `<b>Проверь канал</b><p>Исправлен первый пост: «${esc(settings.chanCanary)}». Посмотри, что название, обложка и подпись в порядке.</p>
      <button class="btn primary" data-act="chanGo">Всё верно, дальше</button>
      <button class="btn" data-act="chanOff" style="margin-top:6px">Не трогать канал</button>`;
    return;
  }
  if (chan.running && !sync.running) {
    c.innerHTML = `<b>${esc(tgCfg.chatTitle)}</b><p>Исправляю посты в канале: ${chan.done} из ${chan.total}</p><div class="tgprog"><i style="width:${chan.total ? chan.done / chan.total * 100 : 0}%"></i></div>`;
    return;
  }
  if (sync.running) {
    const dl = sync.total ? `Скачано ${sync.done} из ${sync.total}` : `Просмотрено ${sync.scanned} сообщений`;
    const cur = [...tracks.values()].find(t => t.dlp != null);
    const pct = sync.total ? (sync.done + (cur?.dlp || 0)) / sync.total * 100 : 0;
    c.innerHTML = `<b>${esc(tgCfg.chatTitle)}</b><p>${dl}</p><div class="tgprog"><i style="width:${pct}%"></i></div><button class="btn" data-act="tgStop">Остановить</button>`;
    return;
  }
  const when = tgCfg.lastSync ? new Date(tgCfg.lastSync).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  c.innerHTML = `<b>${esc(tgCfg.chatTitle)}</b><p>${sync.error ? esc(sync.error) : chan.error ? esc(chan.error) : tracksWord(count) + (when ? ', обновлено ' + when : '')}</p>
    <button class="btn" data-act="${sync.error.includes('войти') ? 'tg' : 'tgSync'}">${sync.error.includes('войти') ? 'Войти' : 'Обновить'}</button>
    ${matchMedia('(pointer: fine)').matches ? '<button class="btn pairbtn" data-act="pair">Подключить телефон</button>' : ''}
    ${localFiles().length ? `<button class="btn pairbtn" data-act="upload">Отправить в канал файлы с компьютера (${localFiles().length})</button>` : ''}`;
}

// Пошаговое подключение: ключи → телефон → код → (пароль) → выбор канала
async function openTg() {
  const step = (html) => modal(html);
  const keysStep = () => new Promise(res => {
    const d = step(`<h2>Подключаем Telegram</h2>
      <div class="pairin"><b>Уже подключал Mix на компьютере?</b><span>Нажми там «Подключить телефон» и вставь код сюда.</span>
        <div class="pairrow"><input class="inp" id="pairCode" placeholder="Код с компьютера" autocomplete="off"><button type="button" class="btn" id="pairPaste">Вставить</button></div></div>
      <p>Первый раз? Mix заходит в Telegram от твоего имени, как обычное приложение. Для этого нужен бесплатный ключ разработчика, он делается один раз за пару минут.</p>
      <ol><li>Открой <a href="https://my.telegram.org/apps" target="_blank" rel="noopener">my.telegram.org</a> и войди по номеру телефона.</li>
      <li>Открой <b>API development tools</b> и создай приложение: название любое, например Mix, платформа <b>Web</b>.</li>
      <li>Скопируй сюда <b>App api_id</b> и <b>App api_hash</b>.</li></ol>
      <form><label>api_id</label><input class="inp" name="id" inputmode="numeric" pattern="[0-9]+" required value="${esc(tgCfg?.apiId || '')}">
      <label>api_hash</label><input class="inp" name="hash" pattern="[0-9a-fA-F]{32}" required value="${esc(tgCfg?.apiHash || '')}" autocomplete="off">
      <div class="err"></div>
      <div class="acts"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Дальше</button></div></form>`);
    $('[data-x]', d).onclick = () => { closeLayer(); res(null); };
    $('form', d).onsubmit = e => { e.preventDefault(); res({ apiId: e.target.id.value.trim(), apiHash: e.target.hash.value.trim(), d }); };
    const usePair = p => {
      pairChat = p;
      const f = $('form', d); f.id.value = p.i; f.hash.value = p.h;
      f.requestSubmit();
    };
    const tryCode = text => { const p = parsePair(text); if (p) usePair(p); else if (text.trim()) $('.err', d).textContent = 'Код не подошёл. Скопируй его на компьютере ещё раз.'; };
    $('#pairCode', d).oninput = e => tryCode(e.target.value);
    $('#pairPaste', d).onclick = async () => {
      try { tryCode(await navigator.clipboard.readText()); }
      catch { $('#pairCode', d).focus(); $('.err', d).textContent = 'Нажми на поле и вставь код вручную.'; }
    };
    if (pendingPair) { const p = pendingPair; pendingPair = null; usePair(p); }
  });
  const ask = (title, text, label, type = 'text') => () => new Promise((res, rej) => {
    const d = step(`<h2>${title}</h2><p>${text}</p><form><label>${label}</label><input class="inp" name="v" type="${type}" required autocomplete="off">
      <div class="err">${esc(lastErr)}</div><div class="acts"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Дальше</button></div></form>`);
    lastErr = '';
    $('input', d).focus();
    $('[data-x]', d).onclick = () => { cancelled = true; closeLayer(); rej(new Error('cancel')); };
    $('form', d).onsubmit = e => { e.preventDefault(); $('button.primary', d).disabled = true; $('button.primary', d).textContent = 'Проверяю…'; res(e.target.v.value.trim()); };
  });
  let lastErr = '', cancelled = false, fatal = '', pairChat = null;

  if (!tgCfg?.session) {
    const k = await keysStep(); if (!k) return;
    $('button.primary', k.d).textContent = 'Подключаюсь…';
    try {
      const tg = await tgLib();
      await tg.connect({ apiId: k.apiId, apiHash: k.apiHash });
      await tg.login({
        phone: ask('Твой номер', 'Telegram пришлёт код для входа, как при входе в новое приложение.', 'Номер телефона в формате +7…', 'tel'),
        code: ask('Код из Telegram', 'Код пришёл в чат «Telegram» в приложении.', 'Код'),
        password: ask('Облачный пароль', 'У тебя включена двухэтапная проверка. Введи облачный пароль Telegram.', 'Пароль', 'password'),
        // true останавливает вход; иначе библиотека спрашивает номер снова и снова
        onError: e => {
          const m = e.errorMessage || e.message || '';
          if (cancelled) return true;
          if (/API_ID|API_HASH/.test(m)) { fatal = 'Telegram не принял api_id или api_hash. Скопируй их с my.telegram.org ещё раз.'; return true; }
          if (/PHONE_NUMBER_BANNED|FLOOD/.test(m)) { fatal = 'Telegram временно не даёт войти: слишком много попыток. Попробуй позже.'; return true; }
          lastErr = /PHONE_CODE_INVALID/.test(m) ? 'Код не подошёл, проверь и введи снова' : /PHONE_CODE_EXPIRED/.test(m) ? 'Код устарел, введи номер заново' : /PASSWORD_HASH_INVALID/.test(m) ? 'Пароль не подошёл' : /PHONE_NUMBER_INVALID/.test(m) ? 'Номер не подошёл, введи в формате +7…' : m;
          return false;
        },
      });
      tgCfg = { ...(tgCfg || {}), apiId: k.apiId, apiHash: k.apiHash, session: tg.session() };
      await saveTg();
      tgReady = Promise.resolve(tg);
      // канал уже выбран на компьютере
      if (pairChat?.c) {
        tgCfg.chatId = pairChat.c; tgCfg.chatTitle = pairChat.t; await saveTg();
        closeLayer(); renderTgCard(); toast('Telegram подключён. Подтягиваю музыку и настройки');
        startSync();
        return;
      }
    } catch (e) {
      if (cancelled) return;
      const d = step(`<h2>Не получилось подключиться</h2><p>${esc(fatal || e.message)}</p><div class="acts"><button class="btn primary" data-x>Понятно</button></div>`);
      $('[data-x]', d).onclick = closeLayer;
      return;
    }
  }

  // выбор канала
  const d = step(`<h2>Откуда брать музыку?</h2><p>Выбери свой канал. Mix скачает из него все аудиофайлы и будет подтягивать новые.</p>
    <input class="inp" placeholder="Найти канал" id="chq"><ul class="chats" id="chl"><li style="color:var(--mist);padding:10px">Загружаю список чатов…</li></ul>`);
  let list = [];
  try { const tg = await ensureTg(); list = await tg.chats(); }
  catch { $('#chl', d).innerHTML = '<li class="err" style="padding:10px">Не удалось получить список чатов. Проверь интернет и попробуй ещё раз.</li>'; return; }
  const draw = q => $('#chl', d).innerHTML = list.filter(c => !q || c.title.toLowerCase().includes(q.toLowerCase())).map(c =>
    `<li><button data-c="${esc(c.id)}"><span class="ava" style="--ch:${hash(c.title)}">${esc(c.title[0]?.toUpperCase() || '?')}</span><span>${esc(c.title)}<small>${c.isChannel ? 'Канал' : c.title === 'Избранное' ? 'Твои сохранённые сообщения' : 'Группа'}</small></span></button></li>`).join('');
  draw('');
  $('#chq', d).oninput = e => draw(e.target.value);
  $('#chl', d).onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (sync.running) { sync.stop = true; toast('Сначала останавливаю текущую загрузку, выбери канал ещё раз через пару секунд'); return; }
    const c = list.find(x => x.id === b.dataset.c);
    tgCfg.chatId = c.id; tgCfg.chatTitle = c.title; chatEntity = c.entity; saveTg();
    closeLayer(); renderTgCard(); startSync();
  };
}

async function updateUsage() {
  const u = await db.usage();
  const size = u?.usage ? `На устройстве: ${(u.usage / 1073741824).toFixed(u.usage > 1e10 ? 0 : 1).replace('.', ',')} ГБ` : '';
  const s = cloudStatus?.state;
  const line = !cloud ? '' : s === 'syncing' ? 'Синхронизирую…' : s === 'offline' || s === 'retry' ? 'Синхронизация позже: нет связи' : s === 'auth' ? 'Синхронизация: нужно войти в Telegram' : s === 'error' ? 'Синхронизация: обнови плеер на этом устройстве' : 'Устройства синхронизированы';
  $('#store').textContent = [size, line].filter(Boolean).join('. ');
}

// ---------- системный плеер (экран блокировки, кнопки наушников) ----------
async function mediaMeta(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const artwork = await artworkFor(t.cover ? await db.get('covers', t.id) : t.art ? await fetchArt(t.art).catch(() => null) : null);
  if (engine.track !== t) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const h = { play: () => engine.track ? engine.resume() : toggle(), pause: () => engine.pause(), nexttrack: next, previoustrack: prev, seekto: e => engine.seek(e.seekTime) };
  // iOS иногда забывает обработчики, поэтому ставим их заново при смене трека
  const bind = () => { for (const [k, f] of Object.entries(h)) try { ms.setActionHandler(k, f); } catch {} };
  bind();
  engine.addEventListener('track', bind);
  setInterval(() => { if (engine.track && engine.duration) try { ms.setPositionState({ duration: engine.duration, position: Math.min(engine.position, engine.duration), playbackRate: 1 }); } catch {} }, 2000);
}

// ---------- события ----------
// Зажатие кнопок, как в плеере Telegram: «вперёд» играет ускоренно и разгоняется, «назад» перематывает рывками
const HOLD_MS = 350, HOLD_RATES = [2, 3, 4];
let hold = null, skipClick = false;
function holdStart(btn) {
  if (!engine.track || engine.paused) return;
  const dir = btn.dataset.act;
  hold = { btn, dir, active: false, timer: setTimeout(() => {
    if (dir === 'next' && !engine.holdStart(HOLD_RATES[0])) { hold = null; return; }
    hold.active = true; hold.at = Date.now();
    btn.classList.add('holding');
    hold.tick = setInterval(holdTick, 100);
  }, HOLD_MS) };
}
// шары фона крутятся быстрее, пока зажато «вперёд»
function orbSpeed(k) { for (const el of document.querySelectorAll('.orbs, .orbs span')) for (const a of el.getAnimations()) a.playbackRate = k; }
function holdTick() {
  const t = (Date.now() - hold.at) / 1000;
  if (hold.dir === 'next') {
    const rate = HOLD_RATES[Math.min(HOLD_RATES.length - 1, Math.floor(t / 1.5))];
    if (rate !== hold.rate) { hold.rate = rate; engine.setRate(rate); orbSpeed(rate * 2); }
    paintProgress();
    // дошли до конца трека — следующий начинается обычным образом
    if (engine.position >= engine.duration - 1.5) { const h = hold; holdStop(true); h && next(); }
  } else if (Date.now() - (hold.step || 0) > 400) {
    hold.step = Date.now();
    engine.seek(Math.max(0, engine.position - (t > 3 ? 12 : 6)));
  }
}
function holdStop(ended) {
  orbSpeed(1);
  const h = hold; hold = null;
  if (!h) return;
  clearTimeout(h.timer); clearInterval(h.tick);
  h.btn.classList.remove('holding');
  if (!h.active) return;
  skipClick = true; // отпускание не должно ещё и переключить трек
  setTimeout(() => { skipClick = false; }, 400);
  if (h.dir === 'next' && !ended) engine.holdEnd();
  paintProgress();
}
for (const btn of $$('[data-act=next], [data-act=prev]')) {
  btn.addEventListener('pointerdown', () => holdStart(btn));
  btn.addEventListener('contextmenu', e => e.preventDefault()); // долгое нажатие на телефоне
}
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => holdStop());
document.addEventListener('click', e => { if (skipClick && e.target.closest('[data-act=next], [data-act=prev]')) { skipClick = false; e.stopImmediatePropagation(); } }, true);
document.addEventListener('click', async e => {
  const pl = e.target.closest('[data-play]')?.dataset.play;
  if (pl) { waveMode = false; buildQueue(pl, order); playId(pl); return; }
  if (e.target.closest('.dialog [data-view]')) closeLayer();
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'toggle') toggle();
  else if (a === 'next') next();
  else if (a === 'prev') prev();
  else if (a === 'shuffle') {
    settings.shuffle = !settings.shuffle; saveSettings();
    if (curId && !waveMode) queue = settings.shuffle ? smartShuffle(curId, queueBase.length ? queueBase : queue) : queueBase.slice();
    engine.refreshNext(); paintState();
  } else if (a === 'repeat') { settings.repeat = !settings.repeat; saveSettings(); engine.refreshNext(); paintState(); }
  else if (a === 'waveStart') startWave();
  else if (a === 'waveMore') {
    waveSeen = [...waveSeen, ...sug.items.map(s => ({ artist: s.artist, title: s.title }))].slice(-400);
    db.put('kv', 'waveSeen', waveSeen);
    sug.items = []; loadSuggestions();
  }
  else if (a === 'listen') openListen();
  else if (a === 'import') openImport();
  else if (a === 'setMix') openMix();
  else if (a === 'offline') downloadAll(viewIds());
  else if (a === 'nowCard') shareNowCard();
  else if (a === 'yearCard') shareYearCard();
  else if (a?.startsWith('speed:')) { settings.speed = +a.slice(6); engine.setSpeed(settings.speed); saveSettings(); toast(settings.speed === 1 ? 'Обычная скорость' : settings.speed > 1 ? 'Speed up' : 'Slowed'); layer.querySelectorAll('[data-act^="speed:"]').forEach(b => b.classList.toggle('on', +b.dataset.act.slice(6) === settings.speed)); paintMixChip?.(); }
  else if (a === 'syncNow') { cloud ? cloud.push().then(r => { toast(r?.ok === false ? 'Синхронизация не удалась: ' + (r.error || 'нет связи') : 'Синхронизировано'); if (view === 'settings') render(); }) : (initCloud().then(() => cloud?.push()).catch(() => toast('Сначала подключи Telegram'))); }
  else if (a === 'collab') openCollab();
  else if (a === 'sharePl') { const pl = lib.playlists.find(p => p.id === view); if (pl) sharePlaylist(pl); }
  else if (a === 'openStats') window.open(dashboard(), '_blank', 'noopener');
  else if (a === 'setEq') openEq();
  else if (a === 'about') window.open('about.html?lang=' + (document.documentElement.lang === 'en' ? 'en' : 'ru'), '_blank', 'noopener');
  else if (a === 'copyInvite') { try { await navigator.clipboard.writeText(guideUrl()); toast('Ссылка скопирована'); } catch { toast(guideUrl()); } }
  else if (a?.startsWith('lang:')) { settings.lang = a.slice(5); await saveSettings(); location.reload(); }
  else if (a === 'invite') openInvite();
  else if (a === 'dupsAll') { for (const g of dupGroups()) { const k = bestCopy(g); for (const t of g) if (t !== k) dropTrack(t.id, k.id); } saveLib(); saveQueue(); rebuildOrder(); render(); toast('Лишние копии убраны'); }
  else if (a === 'lyrics') { if (engine.track) setLyrics(!lyricsOn); }
  else if (a === 'acoust') openAcoust();
  else if (a === 'identAll') {
    let n = 0;
    for (const t of tracks.values()) {
      if (t.previewOnly || t.conf || t.fixedBy === 'manual' || t.ident?.status === 'kept') continue;
      if (t.verified && ['ok', 'audd'].includes(t.sound?.st)) continue;
      delete t.ident; delete t.sound; t.verified = false; n++; saveTrack(t);
    }
    soundSkip.clear(); identState.done = 0; identState.total = n;
    toast(n ? `Ищу заново: ${tracksWord(n)}. Это идёт в фоне` : 'Все треки уже подтверждены');
    renderFix(); identHunt(); setTimeout(soundHunt, 2000);
  }
  else if (a === 'acceptAll') {
    const list = [...tracks.values()].filter(t => t.ident?.status === 'found' && !t.verified);
    e.target.closest('button').disabled = true;
    for (const t of list) await acceptFix(t, t.ident.cand);
    render(); toast('Исправлено: ' + tracksWord(list.length));
  }
  else if (a === 'more') openMore();
  else if (a === 'pair') openPair();
  else if (a === 'upload') askUpload();
  else if (a === 'musicBot') askMusicBot(() => render());
  else if (a === 'artistAll') { artistAll = true; render(); }
  else if (a?.startsWith('stats:')) { statsPeriod = a.slice(6); render(); }
  else if (a === 'tg') openTg();
  else if (a === 'relogin') { if (confirm('Войти в Telegram заново? Канал, музыка, лайки и плейлисты останутся.')) { try { (await tgLib()).logout?.(); } catch {} tgReady = null; tgCfg.session = ''; saveTg(); renderTgCard(); openTg(); } }
  else if (a === 'tgSync') startSync();
  else if (a === 'tgStop') { sync.stop = true; }
  else if (a === 'chanGo') { settings.chanVerified = true; saveSettings(); chanQueue(); }
  else if (a === 'chanOff') {
    settings.writeChannel = false; settings.chanVerified = false; settings.chanCanary = ''; saveSettings();
    for (const t of tracks.values()) if (t.chanPending) { t.chanPending = false; saveTrack(t); }
    renderTgCard(); toast('Канал больше не меняем. Названия исправляются только в Mix');
  }
  else if (a === 'files') $('#fileInput').click();
  else if (a === 'newPlaylist') { const p = await newPlaylist(); if (p) { view = p.id; render(); } }
  else if (a === 'delPlaylist') {
    const p = lib.playlists.find(x => x.id === view);
    if (p && confirm(`Удалить плейлист «${p.name}»? Треки останутся в библиотеке.`)) { lib.playlists = lib.playlists.filter(x => x !== p); view = 'all'; saveLib(); render(); }
  }
  const v = e.target.closest('[data-view]')?.dataset.view;
  if (v) {
    if (v !== view) { navStack.push({ v: view, top: $('#main').scrollTop }); if (navStack.length > 50) navStack.shift(); history.pushState({ mix: navStack.length }, ''); }
    artistAll = false;
    view = v; $('#main').scrollTop = 0; render();
    const mainEl = $('#main'); mainEl.classList.remove('fadein'); void mainEl.offsetWidth; mainEl.classList.add('fadein');
    if (v === 'wave' && !sug.items.length && tracks.size && navigator.onLine) loadSuggestions();
  }
});
$('#disc').addEventListener('click', e => {
  const li = e.target.closest('[data-pi]'); if (!li) return;
  const s = popular[+li.dataset.pi]; if (!s) return;
  const b = e.target.closest('[data-miss]');
  if (b) { if (b.dataset.miss === 'find') findInTelegram(s); else { addWish(s); toast('Добавлено в «Хочу скачать»'); b.disabled = true; } return; }
  if (s.own) { waveMode = false; queue = queueBase = popular.filter(x => x.own).map(x => x.own); playId(s.own); }
  else if (s.preview) { waveMode = false; const v = previewTrack(s); queue = queueBase = [v.id]; playId(v.id); }
});
$('#rows').addEventListener('click', e => {
  const k = e.target.closest('[data-keep]');
  if (k) { const g = dupGroups()[+k.dataset.g]; if (g) { for (const t of g) if (t.id !== k.dataset.keep) dropTrack(t.id, k.dataset.keep); saveLib(); saveQueue(); rebuildOrder(); render(); toast('Оставлена одна копия'); } return; }
  const p = e.target.closest('[data-stat-play]'); if (!p) return;
  const ids = [...$('#rows').querySelectorAll('[data-stat-play]')].map(x => x.dataset.statPlay);
  waveMode = false; queue = queueBase = ids; playId(p.dataset.statPlay);
});
$('#extra').addEventListener('click', e => {
  const sp = e.target.closest('[data-stat-play]');
  if (sp) { waveMode = false; queue = queueBase = [...$('#extra').querySelectorAll('[data-stat-play]')].map(x => x.dataset.statPlay); playId(sp.dataset.statPlay); return; }
  const b = e.target.closest('[data-miss]'), li = e.target.closest('[data-mi]');
  const sng = li && albumMissing[+li.dataset.mi]; if (!sng) return;
  if (!b) { if (sng.preview) { waveMode = false; const v = previewTrack(sng); queue = queueBase = [v.id]; playId(v.id); } else findInTelegram(sng); return; }
  if (b.dataset.miss === 'find') findInTelegram(sng);
  else { addWish(sng); toast('Добавлено в «Хочу скачать»'); b.disabled = true; }
});
$('#main').addEventListener('change', e => {
  if (e.target.id === 'writeChan') { settings.writeChannel = e.target.checked; saveSettings(); }
  if (e.target.id === 'setLite') { settings.lite = e.target.checked; document.body.classList.toggle('lite', settings.lite); saveSettings(); }
  if (e.target.id === 'setNorm') { settings.norm = e.target.checked; engine.setNorm(settings.norm); saveSettings(); }
  if (e.target.id === 'setTrim') { settings.trim = e.target.checked; engine.setTrim(settings.trim); saveSettings(); engine.refreshNext(); }
  if (e.target.id === 'waveSim') {
    settings.waveSimilar = e.target.checked; saveSettings();
    if (!settings.waveSimilar && waveMode) { queue = queueBase = queue.filter(id => id === curId || getT(id)?.source !== 'preview'); engine.refreshNext(); paintNext(); }
    else if (waveMode) { injectPreviews(); engine.refreshNext(); paintNext(); }
  }
});
$('#rows').addEventListener('click', async e => {
  if ($('#rows').dataset.noclick) return;
  const gh = e.target.closest('.row.ghost');
  if (gh) {
    const sng = albumMissing[+gh.dataset.mi], b = e.target.closest('[data-miss]'); if (!sng) return;
    if (!b) toast('Этого трека у тебя нет. Нажми плюс или кнопку Telegram');
    else if (b.dataset.miss === 'find') findInTelegram(sng);
    else { addWish(sng); toast('Добавлено в «Хочу скачать»'); b.disabled = true; }
    return;
  }
  const fx = e.target.closest('[data-fix]');
  if (fx) {
    const t = tracks.get(fx.closest('.fix').dataset.id);
    if (fx.dataset.fix === 'ok') { fx.disabled = true; await acceptFix(t, { ...t.ident.cand, source: t.ident.cand.source === 'sound' ? 'sound' : 'manual' }); renderFix(); }
    else if (fx.dataset.fix === 'audd') {
      fx.disabled = true; fx.textContent = 'Слушаю…';
      try {
        const { recognizeTrack } = await import('./listen.js');
        const r = await recognizeTrack(await loadAudio(t), { token: settings.auddToken });
        if (r) { t.ident = { status: 'found', cand: { title: r.title, artist: r.artist, album: r.album || '', art: r.art || null, source: 'sound', score: .9 } }; await saveTrack(t); }
        else toast('Сервис тоже не узнал этот трек');
      } catch (err) { toast(err.message || 'Не получилось распознать'); }
      renderFix();
    }
    else if (fx.dataset.fix === 'keep') { t.verified = true; t.ident = { status: 'kept' }; await saveTrack(t); renderFix(); coverHunt(); }
    else openFind(t);
    return;
  }
  const wb = e.target.closest('[data-wish]');
  if (wb) {
    const w = wishes().find(x => x.key === wb.closest('.sug').dataset.w); if (!w) return;
    if (wb.dataset.wish === 'find') findInTelegram(w);
    else if (wb.dataset.wish === 'del') removeWish(w);
    else {
      waveMode = false;
      const ids = wishes().filter(x => x.preview).map(x => previewTrack(x).id);
      queue = queueBase = ids;
      playId(previewTrack(w).id);
    }
    return;
  }
  const sb = e.target.closest('[data-sug]');
  if (sb) {
    const s = sug.items[+sb.closest('.sug').dataset.i]; if (!s) return;
    const a = sb.dataset.sug, key = fxKey(s.artist, s.title);
    if (a === 'play') {
      const same = previewEl && !previewEl.paused && previewEl.src === s.preview;
      stopPreview();
      $$('[data-sug=play]').forEach(b => { b.classList.remove('on'); b.innerHTML = '<svg><use href="#i-play"/></svg>'; });
      if (!same) {
        if (engine.track && !engine.paused) engine.pause();
        previewEl = new Audio(s.preview); previewEl.volume = .8; previewEl.play().catch(() => {});
        sb.classList.add('on'); sb.innerHTML = '<svg><use href="#i-pause"/></svg>';
        previewEl.onended = () => { sb.classList.remove('on'); sb.innerHTML = '<svg><use href="#i-play"/></svg>'; };
      }
    } else if (a === 'add') openAddMenu(sb, previewTrack(s));
    else if (a === 'copy') copyName(s);
    else if (a === 'like') {
      if (waveFx['l:' + key]) delete waveFx['l:' + key];
      else waveFx['l:' + key] = { artist: s.artist, title: s.title, at: Date.now(), seed: s.seed };
      saveLib(); renderWave();
    } else if (a === 'no') {
      stopPreview();
      waveFx['d:' + key] = { artist: s.artist, title: s.title, at: Date.now(), seed: s.seed };
      delete waveFx['l:' + key];
      sug.items = sug.items.filter(x => x !== s);
      saveLib(); renderWave();
    }
    return;
  }
  const row = e.target.closest('.row'); if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('[data-like]')) { toggleLike(id); return; }
  if (e.target.closest('[data-add]')) { openAddMenu(e.target.closest('[data-add]'), tracks.get(id)); return; }
  if (e.target.closest('[data-more]')) { const r = e.target.closest('[data-more]').getBoundingClientRect(); openMenu(id, r.left - 180, r.bottom + 6); return; }
  playFromView(id);
});
$('#rows').addEventListener('contextmenu', e => { const row = e.target.closest('.row'); if (!row) return; e.preventDefault(); openMenu(row.dataset.id, e.clientX, e.clientY); });
function toggleLike(id) {
  lib.likes.has(id) ? lib.likes.delete(id) : lib.likes.add(id);
  saveLib(); updateRow(id); paintLike(); renderNav();
  if (view === 'liked') render();
}
$('#npLike').onclick = $('#fLike').onclick = async () => {
  const t = engine.track; if (!t) return;
  try {
    const real = libIdOf(t) ? tracks.get(libIdOf(t)) : await keepPreview(t);
    if (t.source === 'preview') { const k = 'l:' + fxKey(t.artist, t.title); if (lib.likes.has(real.id)) delete waveFx[k]; else waveFx[k] = { artist: t.artist, title: t.title, at: Date.now(), seed: t.seed }; }
    toggleLike(real.id);
  } catch { toast('Не получилось, проверь интернет'); }
};
$('#miniBtn').hidden = !canMini();
$('#miniBtn').onclick = () => openMini(engine, { toggle, next, prev }, async t => t.cover ? coverUrl(t.id) : t.art || null).then(ok => { if (ok === false) toast('Браузер заблокировал окно мини-плеера. Разреши всплывающие окна для этой страницы'); });
$('#npAdd').onclick = e => openAddMenu(e.currentTarget);
$('#fAdd').onclick = e => openAddMenu(e.currentTarget);
$('#sort').onchange = e => { settings.sort = e.target.value; saveSettings(); render(); };
$('#playAll').onclick = () => {
  const ids = viewIds(); if (!ids.length) return;
  settings.shuffle = true; saveSettings(); waveMode = false;
  const first = ids[Math.random() * ids.length | 0];
  buildQueue(first, ids); playId(first); paintState();
};
$('#addFiles').onclick = () => $('#fileInput').click();
$('#main').addEventListener('scroll', e => {
  if (listTick) return;
  listTick = true;
  requestAnimationFrame(() => { listTick = false; $('.head').classList.toggle('stuck', e.target.scrollTop > 8); if (listIds.length) paintList(); });
}, { passive: true });
addEventListener('resize', () => { listFrom = -1; if (listIds.length) paintList(); });
$('#fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
let qT; $('#search').oninput = e => { clearTimeout(qT); qT = setTimeout(() => { query = e.target.value.trim(); render(); }, 120); };
$('#mixChip').onclick = () => layer.querySelector('.mixviz') ? closeLayer() : openMix();
$('#eqBtn').onclick = $('#fEq').onclick = () => layer.querySelector('.eqgraph') ? closeLayer() : openEq();
$('#queueBtn').onclick = $('#fQueue').onclick = openQueue;
$('#fMix').onclick = () => layer.querySelector('.mixviz') ? closeLayer() : openMix();
const openFull = () => { if (engine.track) $('#full').classList.add('open'); };
const closeFull = () => { $('#full').classList.remove('open'); setLyrics(false); };
$('#fArtist').addEventListener('click', () => { if ($('#fArtist').dataset.view) closeFull(); });
$('#npArtist').addEventListener('click', () => { if ($('#npArtist').dataset.view) setTimeout(closeFull, 0); });
$('.np').addEventListener('click', e => { if (isPhone() && !e.target.closest('button:not(#openFull)')) openFull(); });
setupRowSwipe($('#rows'), id => addToQueue(id), id => pickPlaylist(id));
setupGestures({ full: $('#full'), stack: $('#stack'), mini: $('#bar'), onClose: closeFull, onOpen: openFull, onNext: next, onPrev: prev });
$('#vol').oninput = e => { settings.vol = +e.target.value; e.target.style.setProperty('--p', settings.vol + '%'); engine.setVolume(settings.vol / 100); saveSettings(); };
$('#openFull').onclick = () => { if (engine.track) $('#full').classList.add('open'); };
$('#closeFull').onclick = () => { $('#full').classList.remove('open'); setLyrics(false); };
$('.fullgrab').onclick = closeFull; // на телефоне кнопки «Свернуть» нет: тап по полоске тоже сворачивает
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
addEventListener('online', () => { if (tgCfg?.chatId && !sync.running) { startSync(); chanQueue(); } identHunt(); cloud?.push(); });
addEventListener('pagehide', () => { closeListen(); writeLib(); cloud?.flush(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { writeLib(); cloud?.flush(); return; }
  if (!tgCfg?.session || !navigator.onLine || tgConnecting) return;
  // после сна телефона соединение с Telegram обычно мёртвое; поднимаем то же, загрузки не прерываем
  ensureTg().then(tg => tg.reconnect()).then(() => cloud?.pull()).catch(e => console.warn('reconnect', e));
});
document.addEventListener('keydown', e => {
  if (e.target.matches?.('input:not([type=range]), textarea')) return;
  if (e.code === 'MediaPlayPause') { e.preventDefault(); toggle(); return; }
  if (e.code === 'MediaTrackNext') { e.preventDefault(); next(); return; }
  if (e.code === 'MediaTrackPrevious') { e.preventDefault(); prev(); return; }
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'ArrowRight' && (e.ctrlKey || e.metaKey)) next();
  else if (e.code === 'ArrowLeft' && (e.ctrlKey || e.metaKey)) prev();
  else if (e.code === 'ArrowRight' && engine.track) engine.seek(Math.min(engine.duration - 1, engine.position + 10));
  else if (e.code === 'ArrowLeft' && engine.track) engine.seek(Math.max(0, engine.position - 10));
  else if (e.code === 'Escape') { if (layer.firstElementChild) closeLayer(); else closeFull(); }
});

// ---------- запуск ----------
window.__mixReady = true;
setInterval(frame, 250);
setInterval(() => soundHunt(), 5 * 60e3);
setTimeout(countUsage, 5000); setInterval(countUsage, 60e3);
setTimeout(() => { if (tgCfg?.session) initCloud().then(() => cloud?.pull?.()).catch(e => console.warn('sync', e)); }, 4000);
setTimeout(restoreResume, 1200);
setInterval(() => { if (engine.track && !engine.paused) saveResume(); }, 5000);
addEventListener('pagehide', saveResume);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); });
setTimeout(async () => { news = await db.get('kv', 'news3').catch(() => null) || news; renderNav(); setTimeout(newsHunt, 20000); }, 1500);
setInterval(() => newsHunt(), 3 * 36e5);
setTimeout(async () => { const l = await db.get('kv', 'lyidx').catch(() => null); if (l) lyIndex = new Map(l); setTimeout(lyricsHunt, 30000); }, 2000);
setInterval(() => lyricsHunt(), 30 * 60e3);
function goBack() {
  const p = navStack.pop(); if (!p) return false;
  if ($('#full').classList.contains('open')) closeFull();
  artistAll = false; view = p.v; render(); $('#main').scrollTop = p.top || 0;
  return true;
}
addEventListener('popstate', () => { if (layer.firstElementChild) { closeLayer(); return; } goBack(); });
setupEdgeBack($('#main'), { canBack: () => navStack.length > 0 && !$('#full').classList.contains('open'), onBack: () => history.back() }); // скачались новые треки — сверим и их
async function boot() {
  // сначала рисуем интерфейс, потом читаем сохранённое — чтобы кнопки работали сразу
  render(); renderTgCard(); paintState(); paintMixChip();
  registerSW({ onUpdate: () => toast('Новая версия включится при следующем запуске') });
  try {
    Object.assign(settings, await db.get('kv', 'settings') || {});
    if (!settings.lang) { settings.lang = defaultLang(); saveSettings(); }
    document.body.classList.toggle('lite', !!settings.lite);
    if (settings.speed && settings.speed !== 1) engine.baseRate = settings.speed;
    if (!settings.refId) { settings.refId = Math.random().toString(36).slice(2, 10); saveSettings(); }
    { const ref = new URLSearchParams(location.search).get('ref'); if (ref && /^[a-z0-9]{4,16}$/.test(ref) && !lsGet('mixRef')) lsSet('mixRef', ref); }
    if (new URLSearchParams(location.search).has('owner')) { settings.owner = true; saveSettings(); }
    { const pl = new URLSearchParams(location.search).get('pl'); if (pl) setTimeout(() => { importShared(pl); history.replaceState(null, '', location.pathname); }, 1500); }
    setLang(settings.lang);
    const l = await db.get('kv', 'library');
    if (l) { lib.likes = new Set(l.likes); lib.playlists = l.playlists || []; lib.history = l.history || []; lib.listens = l.listens || []; waveFx = l.wave || {}; }
    waveSeen = await db.get('kv', 'waveSeen') || [];
    userQueue = (await db.get('kv', 'userQueue') || []).filter(id => tracks.has(id) || String(id).startsWith('tg:') || String(id).startsWith('f:'));
    deviceId = await db.get('kv', 'deviceId') || Math.random().toString(36).slice(2, 10);
    db.put('kv', 'deviceId', deviceId);
    tgCfg = await db.get('kv', 'tg') || null;
    const resetFix = settings.fixReset !== 1;
    // AcoustID иногда подписывает отпечаток чужой песней: то, что подтвердил только он, сверим ещё раз с фрагментами каталогов
    const recheck = settings.acoustRecheck !== 3;
    for (const t of await db.all('tracks')) {
      if (resetFix) undoGuess(t);
      // слабое «совпало» старой сверки (меньше 0,9) тоже под сомнением: похожий бит у разных песен давал 0,75
      const weak = (t.sound?.st === 'ok' && (t.sound.v || 1) < 2 && !(t.sound.s >= .9))
        || (t.sound?.st === 'ok' && t.orig && normKey(t.orig.title) === normKey(t.title) && normKey(t.orig.artist || '') !== normKey(t.artist || '') && t.orig.artist); // сменился только артист — перепроверим
      if (recheck && t.fixedBy !== 'manual' && t.ident?.status !== 'kept' && ((t.conf && !['ok', 'audd'].includes(t.sound?.st)) || weak)) { delete t.conf; delete t.sound; saveTrack(t); }
      // старый поиск часто не находил русские треки: проверяем их заново
      if (!t.verified && t.ident && t.ident.v !== IDENT_VER) delete t.ident;
      // каталоги пополняются: не найденное пробуем снова раз в две недели
      else if (!t.verified && t.ident?.status === 'none' && Date.now() - (t.ident.at || 0) > 14 * 864e5) delete t.ident;
      if (t.verified && t.artChecked && t.metaV !== 2 && !t.previewOnly && t.ident?.status !== 'kept') t.artChecked = false; // дозаполним жанр и альбом
      const title = cleanTag(t.title) || t.title, artist = cleanTag(t.artist);
      if (title !== t.title || artist !== t.artist) { t.title = title; t.artist = artist; saveTrack(t); }
      tracks.set(t.id, t);
    }
    if (resetFix) { settings.fixReset = 1; saveSettings(); }
    if (recheck) { settings.acoustRecheck = 3; saveSettings(); }
  } catch (e) {
    window.__mixErr?.('Не открывается хранилище: ' + e.message + '. Без него плеер не сможет сохранять музыку.');
      return;
  }
  rebuildOrder();
  handlePairLink();
  engine.cf = settings.cf; engine.trim = settings.trim; engine.norm = settings.norm !== false; engine.eqGains = settings.eq.slice(); engine.volume = settings.vol / 100;
  $('#vol').value = settings.vol; $('#vol').style.setProperty('--p', settings.vol + '%');
  render(); renderTgCard(); paintState(); paintNow(); updateUsage();
  db.persist();
  if (tgCfg?.session && tgCfg.chatId && navigator.onLine) { startSync(); if ([...tracks.values()].some(t => t.chanPending)) chanQueue(); }
  identHunt();
  tempoHunt();
}
boot();

// ---------- 3D-обложка: наклон за курсором (ПК) и за наклоном телефона ----------
{
  const full = $('#full'), stack = $('#stack');
  let rx = 0, ry = 0, raf = 0, live = 0;
  const apply = () => { raf = 0; stack.style.setProperty('--rx', rx.toFixed(2) + 'deg'); stack.style.setProperty('--ry', ry.toFixed(2) + 'deg'); stack.style.setProperty('--gx', (50 + ry * 3) + '%'); stack.style.setProperty('--gy', (50 - rx * 3) + '%'); };
  // плавно догоняем цель (сглаживание), а не прыгаем к ней
  let tx = 0, ty = 0;
  const step = () => { rx += (tx - rx) * .045; ry += (ty - ry) * .045; apply(); if (Math.abs(tx - rx) + Math.abs(ty - ry) > .02) raf = requestAnimationFrame(step); };
  const set = (x, y) => { tx = Math.max(-14, Math.min(14, x)); ty = Math.max(-14, Math.min(14, y)); live = Date.now(); full.classList.add('tilting'); if (!raf) raf = requestAnimationFrame(step); };
  full.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !full.classList.contains('open')) return;
    const r = stack.getBoundingClientRect();
    set(-((e.clientY - r.top) / r.height - .5) * 24, ((e.clientX - r.left) / r.width - .5) * 24);
  });
  full.addEventListener('pointerleave', () => { set(0, 0); setTimeout(() => { if (Date.now() - live > 500) full.classList.remove('tilting'); }, 600); });
  // телефон: обложка сама медленно крутится в 3D (CSS coverSpin)

}

// смена трека: короткая анимация названия и обложки
engine.addEventListener('track', () => { const f = $('#full'); f.classList.remove('newtrk'); void f.offsetWidth; f.classList.add('newtrk'); });
