// Сеть волны: кто похож (MusicBrainz + ListenBrainz, по желанию Last.fm) и что послушать (iTunes, превью 30 с).
// Только fetch без своих заголовков: так нет preflight-запроса. Никакого JSONP. Ошибки не наружу, а частичный результат.
import { normKey, artistParts, creditsOf, pickSeeds, mergeSimilar, rankCandidates } from './wave.js';

const LB_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const GAPS = { mb: 1100, lb: 300, lastfm: 300, itunes: 3200 }; // пауза между запросами к источнику, мс
const TTL = { mbid: 90, similar: 30, similarEmpty: 7, tracks: 14, tracksEmpty: 3 }; // дни
const ATTEMPTS = { mb: 3, lb: 2, lastfm: 2, itunes: 2 };
const BUSY = new Set([429, 503, 403]); // 503 у MusicBrainz, 403 у iTunes — это «слишком часто»
const FAILS_TO_GIVE_UP = 2, DAY = 864e5, REQUEST_TIMEOUT = 15000;
const EX_USSR = new Set(['RU', 'BY', 'UA', 'KZ', 'SU', 'XU']);
const cyr = s => /[а-яё]/i.test(s || '');

const nextSlot = new Map(); // расписание на источник: общее для всех вызовов на странице

function makeCtx(o = {}) {
  return {
    fetch: o.fetch || ((...a) => globalThis.fetch(...a)),
    sleep: o.sleep || (ms => new Promise(r => setTimeout(r, ms))),
    now: o.now || (() => Date.now()),
    cache: o.cache || null, gaps: { ...GAPS, ...o.gaps }, signal: o.signal || null,
    timeout: o.requestTimeout || REQUEST_TIMEOUT, onError: o.onError || (() => {}),
    stores: o.stores || ['RU', 'US'], slots: o.slots || nextSlot, fails: {}, down: {},
  };
}

async function gate(ctx, src) {
  const now = ctx.now(), at = Math.max(now, ctx.slots.get(src) || 0);
  ctx.slots.set(src, at + ctx.gaps[src]);
  if (at > now) await ctx.sleep(at - now);
}

async function getJson(ctx, src, url) {
  if (ctx.down[src]) throw new Error(src + ' отключён до следующего раза');
  let err;
  for (let i = 0; i < ATTEMPTS[src]; i++) {
    if (ctx.signal?.aborted) throw new Error('отменено');
    if (i) await ctx.sleep(ctx.gaps[src] * 2 ** i);
    await gate(ctx, src);
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ctx.timeout);
    const stop = () => ac.abort();
    ctx.signal?.addEventListener('abort', stop);
    try {
      const r = await ctx.fetch(url, { signal: ac.signal });
      if (r.ok) { ctx.fails[src] = 0; return await r.json(); }
      err = new Error(`${src} ${r.status}`);
      if (!BUSY.has(r.status)) break;
    } catch (e) { err = e; }
    finally { clearTimeout(t); ctx.signal?.removeEventListener('abort', stop); }
  }
  ctx.fails[src] = (ctx.fails[src] || 0) + 1;
  if (ctx.fails[src] >= FAILS_TO_GIVE_UP) ctx.down[src] = true; // источник лежит: дальше не тратим время
  throw err;
}

async function cached(ctx, key, ttlOf, load) {
  try {
    const hit = await ctx.cache?.get(key);
    if (hit && ctx.now() - hit.at < ttlOf(hit.v) * DAY) return hit.v;
  } catch {}
  const v = await load();
  try { await ctx.cache?.put(key, { at: ctx.now(), v }); } catch {}
  return v;
}

// Идентификаторы артиста в MusicBrainz: точное имя или псевдоним («Zemfira» → Земфира)
async function artistIds(ctx, name, preferRu) {
  const q = name.replace(/["\\]/g, ' ');
  return cached(ctx, 'wave:mb:' + normKey(name), () => TTL.mbid, async () => {
    const j = await getJson(ctx, 'mb', `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${q}" OR alias:"${q}"`)}&fmt=json&limit=8`);
    const key = normKey(name);
    const hits = (j.artists || []).filter(a => normKey(a.name) === key || (a.aliases || []).some(x => normKey(x.name) === key));
    // Тёзки: при русской библиотеке сначала артисты из бывшего СССР
    const rank = a => preferRu && EX_USSR.has(a.country) ? 0 : 1;
    return hits.map((a, i) => [rank(a), i, a.id]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).slice(0, 2).map(x => x[2]);
  });
}

async function listenBrainzSimilar(ctx, name, preferRu) {
  return cached(ctx, 'wave:sim:' + normKey(name), v => v.length ? TTL.similar : TTL.similarEmpty, async () => {
    for (const id of await artistIds(ctx, name, preferRu)) {
      const j = await getJson(ctx, 'lb', `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${id}&algorithm=${LB_ALGO}`);
      const rows = (Array.isArray(j) ? j : []).flatMap(x => x.data || [x]).filter(x => x.name);
      if (rows.length) return rows.slice(0, 60).map(x => ({ name: x.name, score: x.score || 0 }));
    }
    return [];
  });
}

async function lastfmSimilar(ctx, name, key) {
  return cached(ctx, 'wave:lf:' + normKey(name), v => v.length ? TTL.similar : TTL.similarEmpty, async () => {
    const j = await getJson(ctx, 'lastfm', `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(name)}&autocorrect=1&limit=50&api_key=${encodeURIComponent(key)}&format=json`);
    return (j.similarartists?.artist || []).filter(a => a.name).map(a => ({ name: a.name, score: +a.match || 0 }));
  });
}

// Песни артиста в iTunes. Русский магазин отдаёт имена кириллицей и находит больше, американский транслитерирует.
async function artistTracks(ctx, name) {
  return cached(ctx, 'wave:it:' + normKey(name), v => v.length ? TTL.tracks : TTL.tracksEmpty, async () => {
    const key = normKey(name);
    let lastErr = null;
    for (const country of ctx.stores) {
      let results;
      try {
        const j = await getJson(ctx, 'itunes', `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=song&attribute=artistTerm&limit=25&country=${country}`);
        results = (j.results || []).filter(x => x.trackName && x.previewUrl && x.artistName);
      } catch (e) { lastErr = e; continue; }
      lastErr = null;
      let rows = results.filter(x => artistParts(x.artistName).some(p => p.key === key));
      if (!rows.length && results.length) { // другое написание: верим, если почти все результаты — один артист
        const counts = {}; for (const x of results) counts[x.artistName] = (counts[x.artistName] || 0) + 1;
        const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (n / results.length >= .6) rows = results.filter(x => x.artistName === top);
      }
      if (rows.length) return rows.map((x, i) => ({
        title: x.trackName, artist: x.artistName, album: x.collectionName || '',
        art: x.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
        preview: x.previewUrl, duration: (x.trackTimeMillis || 0) / 1000, pop: 1 - i / rows.length,
      }));
    }
    if (lastErr) throw lastErr; // сбой не кэшируем, в отличие от честного «ничего нет»
    return [];
  });
}

// С кем артист записывался: запасной вариант, когда данных о похожести нет
function collaborators(tracks, name) {
  const key = normKey(name), n = {};
  for (const t of tracks) {
    const parts = creditsOf(t.artist);
    if (parts.some(p => p.key === key)) for (const p of parts) if (p.key !== key) n[p.name] = (n[p.name] || 0) + 1;
  }
  return Object.entries(n).map(([name, score]) => ({ name, score, via: 'collab' }));
}

// Вернёт новые треки [{title, artist, album, art, preview, duration, because, seed, score}], лучшие первыми.
// taste — из buildTaste, library — треки с artist и title.
// opts: fetch, cache {get, put}, rng, limit (20), seeds (5), itunesBudget (10 запросов на вызов), budgetMs (90 с),
//   maxPerArtist (2), seen, lastfmKey, stores, signal, onProgress(items), onError(source, err), gaps, sleep, now
export async function fetchSuggestions(taste, library = [], opts = {}) {
  const ctx = makeCtx(opts), rng = opts.rng || Math.random;
  const limit = opts.limit ?? 20, deadline = ctx.now() + (opts.budgetMs ?? 90000);
  const rankOpts = { limit, maxPerArtist: opts.maxPerArtist ?? 2, seen: opts.seen || [], rng };
  const seeds = pickSeeds(taste, { count: opts.seeds ?? 5, rng });
  if (!seeds.length) return [];
  const artistKeys = Object.keys(taste.artists), preferRu = artistKeys.length > 0
    && Object.values(taste.artists).filter(a => cyr(a.name)).length / artistKeys.length >= .3;
  const stop = () => ctx.signal?.aborted || ctx.now() > deadline;
  const report = (src, e) => { try { ctx.onError(src, e); } catch {} };

  let itunesLeft = opts.itunesBudget ?? 10;
  const pool = [];
  const track = async name => { // песни артиста; из кэша — бесплатно, иначе тратит бюджет
    if (ctx.down.itunes) return [];
    try { return await artistTracks(ctx, name); }
    catch (e) { report('itunes', e); return []; }
  };
  const hasCached = async name => {
    try { const h = await ctx.cache?.get('wave:it:' + normKey(name)); return !!h && ctx.now() - h.at < (h.v.length ? TTL.tracks : TTL.tracksEmpty) * DAY; }
    catch { return false; }
  };
  const tracksWithBudget = async name => {
    const free = await hasCached(name);
    if (!free && itunesLeft <= 0) return [];
    if (!free) itunesLeft--;
    return track(name);
  };
  const progress = () => {
    if (!opts.onProgress) return;
    try { opts.onProgress(rankCandidates(pool, taste, library, { ...rankOpts, rng: null })); } catch (e) { report('progress', e); }
  };
  const add = (c, rows) => { for (const t of rows) pool.push({ ...t, similarity: c.similarity, novelty: c.novelty, seed: c.seed, seeds: c.seeds, via: c.via }); };

  // 1. Похожие на каждое семя
  const bySeed = [], bare = [];
  for (const seed of seeds) {
    if (stop()) break;
    let similar = [];
    try { similar = await listenBrainzSimilar(ctx, seed.name, preferRu || cyr(seed.name)); }
    catch (e) { report('listenbrainz', e); }
    if (!similar.length && opts.lastfmKey) {
      try { similar = await lastfmSimilar(ctx, seed.name, opts.lastfmKey); }
      catch (e) { report('lastfm', e); }
    }
    if (similar.length) bySeed.push({ seed, similar });
    else bare.push(seed);
  }
  // 2. Для семян без данных — соавторы и новые треки самого артиста
  for (const seed of bare) {
    if (stop()) break;
    const rows = await tracksWithBudget(seed.name);
    add({ similarity: .35, novelty: .3, seed: seed.name, seeds: [seed.name], via: 'self' }, rows.slice(0, 6));
    const co = collaborators(rows, seed.name);
    if (co.length) bySeed.push({ seed, similar: co });
  }
  progress();

  // 3. Песни кандидатов
  const artists = mergeSimilar(bySeed, taste, { limit: Math.max(12, (opts.itunesBudget ?? 10) * 2), rng });
  for (const c of artists) {
    if (stop() || ctx.down.itunes) break;
    if (rankCandidates(pool, taste, library, { ...rankOpts, rng: null }).length >= limit) break; // хватает: лишние запросы не тратим
    add(c, await tracksWithBudget(c.name));
    progress();
  }

  // 4. Источники пусты или молчат: хотя бы новые треки своих артистов
  if (rankCandidates(pool, taste, library, rankOpts).length < limit / 2) {
    for (const seed of seeds) {
      if (stop()) break;
      if (bare.includes(seed)) continue;
      add({ similarity: .35, novelty: .3, seed: seed.name, seeds: [seed.name], via: 'self' }, (await tracksWithBudget(seed.name)).slice(0, 6));
    }
    progress();
  }
  return rankCandidates(pool, taste, library, rankOpts);
}
