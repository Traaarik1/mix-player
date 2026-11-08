// Волна: профиль вкуса, бесконечная волна из своей библиотеки, ранжирование новых треков.
// Только чистые функции: ни DOM, ни сети. С одним и тем же rng результат всегда один и тот же.
// Формулы и смысл констант — в docs/wave-algorithm.md.
export const WAVE = {
  // вкус
  HALF_LIFE_DAYS: 30, LIKE_HALF_LIFE_DAYS: 120, DISMISS_HALF_LIFE_DAYS: 180,
  COMPLETE_FRACTION: .8, SKIP_SECONDS: 30, SKIP_FRACTION: .15,
  SKIP_SIGNAL: -.5, LIKE_SIGNAL: 3, DISMISS_SIGNAL: -4, SEED_FEEDBACK: .25,
  ARTIST_BAN_DISMISSALS: 3, AFFINITY_K: 2,
  COLD_LISTENS: 15, LIB_PRIOR: .3, LIB_PRIOR_FLOOR: .2,
  // локальная волна
  TASTE_ARTIST: 1.5, TASTE_TRACK: 1, FRESH_TAU_HOURS: 48, UNPLAYED_BONUS: .25,
  RECENT_TRACKS: 50, RECENT_SHARE: .5, ARTIST_GAP: 3, MAX_PER_ARTIST: 2,
  EXPLORE: .15, EXPLORE_COLD: .35,
  // новые треки
  W_SIM: 1, W_SEED: .6, W_NOVEL: .5, W_POP: .25, W_FEEDBACK: 1, W_SEEN: .3, W_JUNK: 1,
  // какой трек после какого
  FLOW_GENRE_SAME: 1.6, FLOW_GENRE_OTHER: .75, FLOW_ERA_NEAR: 1.15, FLOW_ERA_FAR: .85, FLOW_TEMPO_NEAR: 1.25, FLOW_TEMPO_FAR: .85,
  FLOW_LOUD_NEAR: 1.1, FLOW_LOUD_FAR: .85, FLOW_HABIT: .6, FLOW_MIN: .4, HABIT_GAP_MIN: 30,
  W_JITTER: .15, KNOWN_NOVELTY: .3, ARTIST_DROP: -.5, MAX_SHARE_PER_SEED: .4, COLLAB_SIM: .7,
};

const DAY = 864e5, HOUR = 36e5;
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const FEAT = /\s+(?:feat\.?|ft\.?|featuring|при\s+уч\S*)\s+/i;
const SEP = /\s*(?:,|;|\/|&|\+|\sx\s|\svs\.?\s|\swith\s)\s*/i;
const UNKNOWN = /^(?:unknown(?: artist)?|<unknown>|неизвестн\S*(?: артист| исполнитель)?|various artists?|va|сборник)$/i;
const JUNK = /karaoke|караоке|instrumental|инструментал|tribute|nightcore|sped[ -]up|slowed|минус/i;

// Ключ для сравнения: без регистра и диакритики (ё = е, й = и), скобок, feat., приписок вроде «- Remastered»,
// кириллица в латинице, чтобы «Кино» и «Kino» совпадали.
export function normKey(s) {
  const low = String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const clean = x => x.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/[а-я]/g, c => TR[c] ?? c).replace(/\s+/g, ' ').trim();
  const bare = low.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s(?:feat\.?|ft\.?|featuring|при\s+уч\S*)\s.*$/, ' ')
    .replace(/\s[-–—]\s.*(?:remaster|live|version|edit|mix|single|версия|ремикс).*$/, ' ');
  return clean(bare) || clean(low);
}

const isUnknown = a => !String(a ?? '').trim() || UNKNOWN.test(String(a).trim());
const uniqBy = (arr, f) => { const m = new Map(); for (const x of arr) if (!m.has(f(x))) m.set(f(x), x); return [...m.values()]; };

function splitCredit(artist) {
  const [main, ...feat] = String(artist ?? '').split(FEAT);
  return { main: main.trim(), parts: main.split(SEP).map(x => x.trim()).filter(Boolean), feat: feat.flatMap(f => f.split(SEP)).map(x => x.trim()).filter(Boolean) };
}

// Все варианты артиста из строки: целиком и по частям (для сравнения «тот же ли артист»)
export function artistParts(artist) {
  if (isUnknown(artist)) return [];
  const { main, parts, feat } = splitCredit(artist);
  return uniqBy([main, ...parts, ...feat].map(name => ({ key: normKey(name), name })).filter(x => x.key), x => x.key);
}

// Кому засчитать трек. «A & B» делим, только если кто-то из них встречается и сам по себе,
// иначе это одна группа («HammAli & Navai», «Earth, Wind & Fire»).
export function creditsOf(artist, solo = null) {
  if (isUnknown(artist)) return [];
  const { main, parts, feat } = splitCredit(artist);
  const split = parts.length > 1 && (!solo || parts.some(p => solo[normKey(p)]));
  return uniqBy((split ? [...parts, ...feat] : [main, ...feat]).map(name => ({ key: normKey(name), name })).filter(x => x.key), x => x.key);
}

export function soloArtists(rows) {
  const solo = {};
  for (const r of rows) {
    if (isUnknown(r?.artist)) continue;
    const { main, parts } = splitCredit(r.artist);
    if (parts.length === 1) solo[normKey(main)] = 1;
  }
  return solo;
}

export const trackKey = (artist, title) => `${artistParts(artist)[0]?.key || ''}|${normKey(title)}`;

// Индекс «что уже есть»: совпадает название и хотя бы один артист; трек без артиста — по названию.
export function trackIndex(rows = []) {
  const byTitle = new Map(), full = new Set();
  for (const r of rows) {
    const t = normKey(r?.title);
    if (!t) continue;
    if (!byTitle.has(t)) byTitle.set(t, { any: false, artists: new Set() });
    const e = byTitle.get(t), parts = artistParts(r.artist);
    if (!parts.length) e.any = true;
    for (const p of parts) e.artists.add(p.key);
    full.add(normKey(`${r.artist || ''} ${r.title}`));
  }
  return { byTitle, full };
}
export function inIndex(idx, artist, title) {
  const t = normKey(title);
  if (!t) return false;
  const parts = artistParts(artist);
  if (parts.some(p => idx.full.has(normKey(`${p.name} ${title}`))) || idx.full.has(t)) return true; // «Кино - Группа крови» в названии файла
  const e = idx.byTitle.get(t);
  return !!e && (e.any || parts.some(p => e.artists.has(p.key)));
}
export const sameTrack = (a, b) => inIndex(trackIndex([a]), b.artist, b.title);

const decay = (at, now, days) => at ? Math.pow(2, -Math.max(0, now - at) / (days * DAY)) : 1;
const affinity = w => w / (Math.abs(w) + WAVE.AFFINITY_K);
const clamp01 = x => Math.max(0, Math.min(1, x));

// Сила сигнала одного прослушивания: +1 дослушал, минус — ушёл раньше ~30 с, иначе пропорционально доле.
export function listenSignal(e, duration = 0) {
  const W = WAVE, f = clamp01(e.playedFraction ?? 0), secs = e.played ?? (duration ? f * duration : null);
  if (f >= W.COMPLETE_FRACTION) return 1;
  if (secs != null ? secs < W.SKIP_SECONDS : f < W.SKIP_FRACTION) return W.SKIP_SIGNAL;
  return f;
}

// listens: [{id, artist, title, at, playedFraction, played?}]
// likes: id, либо {id, artist, title, at, seed?} (массив или Set)
// dismissals: {id?, artist, title?, at, seed?}; без title — «не предлагать этого артиста вообще»
export function buildTaste({ listens = [], likes = [], dismissals = [], library = [], now = Date.now() } = {}) {
  const W = WAVE, byId = new Map(library.map(t => [t.id, t]));
  const likeRows = [...likes].map(x => typeof x === 'object' && x ? { ...byId.get(x.id), ...x } : { id: x, ...byId.get(x) });
  const solo = soloArtists([...library, ...listens, ...likeRows]);
  const artists = {}, tracks = {};
  const entry = c => artists[c.key] ??= { key: c.key, name: c.name, weight: 0, plays: 0, skips: 0, likes: 0, dismissed: 0, tracks: 0 };
  const credit = (artist, v, field) => {
    const cs = creditsOf(artist, solo), part = v / Math.sqrt(cs.length || 1);
    for (const c of cs) { const a = entry(c); a.weight += part; if (field) a[field]++; }
  };
  const trackEntry = id => tracks[id] ??= { weight: 0, plays: 0, skips: 0, lastAt: 0 };

  for (const e of listens) {
    const t = byId.get(e.id), artist = t?.artist ?? e.artist, sig = listenSignal(e, t?.duration || t?.bounds?.d || e.duration);
    const v = sig * decay(e.at, now, W.HALF_LIFE_DAYS);
    credit(artist, v, sig === W.SKIP_SIGNAL ? 'skips' : 'plays');
    if (e.id != null) {
      const s = trackEntry(e.id);
      if (sig === W.SKIP_SIGNAL) s.lastSkipAt = Math.max(s.lastSkipAt || 0, e.at || 0);
      s.weight += v; s[sig === W.SKIP_SIGNAL ? 'skips' : 'plays']++; s.lastAt = Math.max(s.lastAt, e.at || 0);
    }
  }
  for (const l of likeRows) {
    const v = W.LIKE_SIGNAL * decay(l.at, now, W.LIKE_HALF_LIFE_DAYS);
    credit(l.artist, v, 'likes');
    if (l.id != null) trackEntry(l.id).weight += v;
    if (l.seed) credit(l.seed, v * W.SEED_FEEDBACK);
  }
  const banned = { tracks: [], ids: {}, artists: {} };
  for (const d of dismissals) {
    const v = W.DISMISS_SIGNAL * decay(d.at, now, W.DISMISS_HALF_LIFE_DAYS);
    const known = byId.get(d.id), artist = d.artist ?? known?.artist, title = d.title ?? known?.title;
    credit(artist, title ? v : v * 2, 'dismissed');
    if (d.seed) credit(d.seed, v * W.SEED_FEEDBACK);
    if (d.id != null) banned.ids[d.id] = 1;
    if (title) banned.tracks.push({ artist, title });
    else for (const c of creditsOf(artist, solo)) banned.artists[c.key] = 1;
  }
  for (const a of Object.values(artists)) if (a.dismissed >= W.ARTIST_BAN_DISMISSALS) banned.artists[a.key] = 1;

  // Привычки: после какого артиста какого ты дослушиваешь, а какого пропускаешь
  const trans = {};
  const ordered = listens.filter(e => e.at).sort((a, b) => a.at - b.at);
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    if (b.at - a.at > W.HABIT_GAP_MIN * 60000) continue;
    const ka = creditsOf(byId.get(a.id)?.artist ?? a.artist, solo)[0]?.key, kb = creditsOf(byId.get(b.id)?.artist ?? b.artist, solo)[0]?.key;
    if (!ka || !kb || ka === kb) continue;
    const t = byId.get(b.id), v = listenSignal(b, t?.duration || t?.bounds?.d || b.duration) * decay(b.at, now, W.HALF_LIFE_DAYS);
    (trans[ka] ??= {})[kb] = (trans[ka][kb] || 0) + v;
  }

  // Априорный вес за треки в библиотеке: почти всё решает при холодном старте, потом угасает
  const cold = clamp01(1 - listens.length / W.COLD_LISTENS), counts = {};
  for (const t of library) for (const c of creditsOf(t.artist, solo)) { entry(c).tracks++; counts[c.key] = (counts[c.key] || 0) + 1; }
  const prior = W.LIB_PRIOR * (W.LIB_PRIOR_FLOOR + (1 - W.LIB_PRIOR_FLOOR) * cold);
  for (const [k, n] of Object.entries(counts)) artists[k].weight += prior * Math.log2(1 + n);
  for (const a of Object.values(artists)) a.affinity = affinity(a.weight);

  return { artists, tracks, banned, solo, trans, listenCount: listens.length, cold: listens.length < W.COLD_LISTENS, now };
}

// Насколько трек b подходит сразу после a. 1 — нейтрально; неизвестные данные ничего не меняют.
export function flowScore(a, b, trans = {}, solo = null) {
  const W = WAVE;
  if (!a || !b) return 1;
  let k = 1;
  if (a.album && a.album === b.album && a.artist === b.artist) k *= .6; // целый альбом подряд — это уже не волна
  if (a.genre && b.genre) k *= a.genre === b.genre ? W.FLOW_GENRE_SAME : W.FLOW_GENRE_OTHER;
  const ya = parseInt(a.released, 10), yb = parseInt(b.released, 10);
  if (ya && yb) { const d = Math.abs(ya - yb); k *= d <= 5 ? W.FLOW_ERA_NEAR : d > 20 ? W.FLOW_ERA_FAR : 1; }
  if (a.bpm && b.bpm) {
    const r = Math.max(a.bpm, b.bpm) / Math.min(a.bpm, b.bpm); // двойной темп на слух тот же
    k *= r < 1.06 || Math.abs(r - 2) < .12 ? W.FLOW_TEMPO_NEAR : r > 1.25 ? W.FLOW_TEMPO_FAR : 1;
  }
  if (a.rms != null && b.rms != null) { const d = Math.abs(a.rms - b.rms); k *= d <= 3 ? W.FLOW_LOUD_NEAR : d >= 10 ? W.FLOW_LOUD_FAR : 1; }
  const ka = creditsOf(a.artist, solo)[0]?.key, kb = creditsOf(b.artist, solo)[0]?.key;
  const h = ka && kb ? trans[ka]?.[kb] : 0;
  if (h) k *= 1 + W.FLOW_HABIT * Math.tanh(h / 2);
  return Math.max(W.FLOW_MIN, k);
}

// Темп и громкость трека по звуку. samples — один канал, sr — его частота.
export function analyzeAudio(samples, sr) {
  const hop = Math.max(1, Math.round(sr / 100)), n = samples.length;
  const start = Math.floor(n * .15), end = Math.min(n, start + sr * 90);
  const env = [];
  let sum = 0, count = 0;
  for (let i = start; i + hop <= end; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j += 2) e += samples[j] * samples[j];
    sum += e; count += Math.ceil(hop / 2);
    env.push(Math.sqrt(e / Math.ceil(hop / 2)));
  }
  const rms = count && sum ? Math.round(10 * Math.log10(sum / count) * 10) / 10 : null;
  if (env.length < 500) return { rms, bpm: null };
  const onset = env.map((v, i) => i ? Math.max(0, v - env[i - 1]) : 0);
  const mean = onset.reduce((a, b) => a + b, 0) / onset.length;
  let best = 0, bestLag = 0, total = 0, seen = 0;
  for (let lag = 33; lag <= 100; lag++) { // 60–180 ударов в минуту при 100 замерах в секунду
    let c = 0;
    for (let i = lag; i < onset.length; i++) c += (onset[i] - mean) * (onset[i - lag] - mean);
    total += Math.max(0, c); seen++;
    if (c > best) { best = c; bestLag = lag; }
  }
  if (!bestLag || !total || best < total / seen * 1.4) return { rms, bpm: null }; // ритм не выражен
  let bpm = 6000 / bestLag;
  while (bpm < 75) bpm *= 2;
  while (bpm > 165) bpm /= 2;
  return { rms, bpm: Math.round(bpm) };
}

function pickIndex(ws, rng) {
  const sum = ws.reduce((s, w) => s + w, 0);
  if (!(sum > 0)) return -1;
  let r = rng() * sum, last = -1;
  for (let i = 0; i < ws.length; i++) {
    if (ws[i] <= 0) continue;
    last = i; r -= ws[i];
    if (r < 0) return i;
  }
  return last;
}

function isBanned(t, taste, bannedIdx) {
  return !!taste.banned.ids[t.id] || (t.title && inIndex(bannedIdx, t.artist, t.title));
}

// Следующие count треков волны из своей библиотеки. history — id недавно сыгранных и уже поставленных
// в очередь (последние в конце). Вернёт пусто, только если библиотека пуста или вся забанена.
export function nextWave(library, taste, { count = 10, history = [], after = null, rng = Math.random, now = taste.now } = {}) {
  const W = WAVE, bannedIdx = trackIndex(taste.banned.tracks);
  const rows = library.filter(t => !isBanned(t, taste, bannedIdx)).map(t => {
    const keys = creditsOf(t.artist, taste.solo).map(c => c.key);
    return { t, keys, blocked: keys.some(k => taste.artists[k] && taste.banned.artists[k]), s: taste.tracks[t.id] };
  }).filter(r => !r.blocked);
  if (!rows.length) return [];
  const byId = new Map(rows.map(r => [r.t.id, r]));
  const played = Object.entries(taste.tracks).filter(([, s]) => s.lastAt).sort((a, b) => a[1].lastAt - b[1].lastAt).map(([id]) => id);
  const seq = [...played, ...history.map(String)];
  const recentN = Math.min(W.RECENT_TRACKS, Math.floor(rows.length * W.RECENT_SHARE));
  const recent = new Set(recentN ? seq.slice(-recentN) : []);
  const lastArtists = seq.map(id => byId.get(id) || byId.get(Number(id))).filter(Boolean).slice(-W.ARTIST_GAP).map(r => r.keys);
  const inBatch = {}, picked = new Set(), out = [];
  let prev = after || [...seq].reverse().map(id => byId.get(id)?.t).find(Boolean) || null;

  const score = r => {
    const aff = r.keys.length ? Math.max(...r.keys.map(k => taste.artists[k]?.affinity ?? 0)) : 0;
    const base = Math.max(.05, 1 + W.TASTE_ARTIST * aff + W.TASTE_TRACK * affinity(r.s?.weight || 0));
    const hrs = r.s?.lastAt ? Math.max(0, now - r.s.lastAt) / HOUR : Infinity;
    const cool = r.s?.lastSkipAt && now - r.s.lastSkipAt < DAY ? .15 : 1; // пропустил за последние сутки — пока не надо
    const fresh = cool * (hrs === Infinity ? 1 + W.UNPLAYED_BONUS : 1 - Math.exp(-hrs / W.FRESH_TAU_HOURS));
    return { w: base * base * fresh * flowScore(prev, r.t, taste.trans, taste.solo), fresh, aff };
  };
  const explore = taste.cold ? W.EXPLORE_COLD : W.EXPLORE;

  while (out.length < count) {
    const free = rows.filter(r => !picked.has(r.t.id));
    if (!free.length) break;
    const gapped = new Set(lastArtists.slice(-W.ARTIST_GAP).flat());
    const strict = free.filter(r => !recent.has(String(r.t.id)) && !r.keys.some(k => gapped.has(k) || (inBatch[k] || 0) >= W.MAX_PER_ARTIST));
    const noRepeat = free.filter(r => !recent.has(String(r.t.id)));
    const pool = strict.length ? strict : noRepeat.length ? noRepeat : free; // ограничения ослабляем, но волна не прерывается
    const scored = pool.map(score), roam = rng() < explore;
    // Разведка: забываем про вкус, берём равномерно всё, что не явно нелюбимое
    const ws = scored.map(x => roam ? (x.aff > -.3 ? Math.max(x.fresh, .01) : 0) : Math.max(x.w, 1e-6));
    let i = pickIndex(ws, rng);
    if (i < 0) i = pickIndex(scored.map(x => Math.max(x.w, 1e-6)), rng);
    const r = pool[i];
    picked.add(r.t.id); out.push(r.t); prev = r.t;
    lastArtists.push(r.keys);
    for (const k of r.keys) inBatch[k] = (inBatch[k] || 0) + 1;
  }
  return out;
}

// Артисты-семена для поиска нового. Случайный взвешенный выбор: от обновления к обновлению разные.
export function pickSeeds(taste, { count = 5, rng = Math.random } = {}) {
  const pool = Object.values(taste.artists).filter(a => a.affinity > 0 && !taste.banned.artists[a.key]);
  const out = [];
  while (out.length < count && pool.length) {
    const i = pickIndex(pool.map(a => a.affinity * a.affinity), rng);
    if (i < 0) break;
    out.push(pool.splice(i, 1)[0]);
  }
  return out.map(a => ({ key: a.key, name: a.name, affinity: a.affinity }));
}

// Сводит списки похожих по семенам в одного кандидата на артиста.
// similarBySeed: [{seed: {key, name, affinity}, similar: [{name, score, via?}]}]
export function mergeSimilar(similarBySeed, taste, { limit = 12, rng = Math.random } = {}) {
  const W = WAVE, seedKeys = new Set(similarBySeed.map(s => s.seed.key)), m = new Map();
  for (const { seed, similar } of similarBySeed) {
    const top = Math.max(0, ...similar.map(s => s.score || 0)) || 1;
    for (const s of similar) {
      const k = normKey(s.name), a = taste.artists[k];
      if (!k || k === seed.key || seedKeys.has(k) || taste.banned.artists[k] || (a?.affinity ?? 0) <= W.ARTIST_DROP) continue;
      const sim = clamp01((s.score || 0) / top) * (s.via === 'collab' ? W.COLLAB_SIM : 1), gain = seed.affinity * sim;
      const c = m.get(k) || { key: k, name: s.name, similarity: 0, total: 0, seeds: [], best: 0, via: s.via || 'similar' };
      c.total += gain; c.similarity = Math.max(c.similarity, sim); c.seeds.push({ name: seed.name, gain });
      if (gain > c.best) { c.best = gain; c.seed = seed.name; c.seedKey = seed.key; c.via = s.via || 'similar'; }
      m.set(k, c);
    }
  }
  const pool = [...m.values()].map(c => {
    const a = taste.artists[c.key], known = (a?.tracks || 0) + (a?.plays || 0) > 0;
    return { ...c, seeds: c.seeds.sort((x, y) => y.gain - x.gain).map(s => s.name), novelty: known ? W.KNOWN_NOVELTY : 1, order: c.total * (1 + W.W_FEEDBACK * (a?.affinity ?? 0)) * (known ? .6 : 1) };
  });
  const out = [];
  while (out.length < limit && pool.length) {
    const i = pickIndex(pool.map(c => Math.pow(Math.max(c.order, 1e-6), 2)), rng);
    out.push(pool.splice(i, 1)[0]);
  }
  // По кругу между семенами: иначе бюджет запросов целиком съедает самый любимый артист
  const groups = new Map();
  for (const c of out.sort((a, b) => b.order - a.order)) groups.set(c.seedKey, [...(groups.get(c.seedKey) || []), c]);
  const fair = [];
  while (groups.size) for (const [k, g] of groups) { fair.push(g.shift()); if (!g.length) groups.delete(k); }
  return fair;
}

export function becauseOf(c) {
  if (c.via === 'self') return `Ещё от ${c.seed}`;
  if (c.via === 'collab') return `Соавтор: ${c.seed}`;
  const seeds = c.seeds?.length ? c.seeds.slice(0, 2) : c.seed ? [c.seed] : [];
  return seeds.length ? `Похоже на ${seeds.join(' и ')}` : 'Может понравиться';
}

// Новые треки: убирает то, что уже есть или отвергнуто, считает балл, ограничивает повторы артиста и семени.
// cands: [{title, artist, album, art, preview, duration, similarity, seed, seeds?, via?, novelty?, pop?}]
// seen: {artist, title} — что уже показывали и не взяли (каждый повтор снижает балл)
export function rankCandidates(cands, taste, library = [], { limit = 20, maxPerArtist = 2, maxPerSeed, seen = [], rng = null } = {}) {
  const W = WAVE, libIdx = trackIndex(library), banIdx = trackIndex(taste.banned.tracks);
  const seenCount = new Map();
  for (const s of seen) { const k = trackKey(s.artist, s.title); seenCount.set(k, (seenCount.get(k) || 0) + 1); }
  const perSeedMax = maxPerSeed ?? Math.max(maxPerArtist, Math.ceil(limit * W.MAX_SHARE_PER_SEED));

  const scored = [];
  for (const c of uniqBy(cands.filter(c => c?.title), c => trackKey(c.artist, c.title))) {
    if (inIndex(libIdx, c.artist, c.title) || inIndex(banIdx, c.artist, c.title)) continue;
    const parts = artistParts(c.artist);
    if (parts.some(p => taste.banned.artists[p.key] || (taste.artists[p.key]?.affinity ?? 0) <= W.ARTIST_DROP)) continue;
    const entries = parts.map(p => taste.artists[p.key]).filter(Boolean);
    const aff = entries.length ? Math.max(...entries.map(a => a.affinity)) : 0;
    const known = entries.some(a => a.tracks + a.plays > 0);
    const seedAff = Math.max(0, taste.artists[normKey(c.seed)]?.affinity ?? 0);
    const score = W.W_SIM * (c.similarity ?? 0) + W.W_SEED * seedAff + W.W_NOVEL * (c.novelty ?? (known ? W.KNOWN_NOVELTY : 1))
      + W.W_POP * (c.pop ?? .5) + W.W_FEEDBACK * aff
      - W.W_SEEN * (seenCount.get(trackKey(c.artist, c.title)) || 0)
      - (JUNK.test(`${c.title} ${c.album || ''}`) ? W.W_JUNK : 0)
      + (rng ? W.W_JITTER * rng() : 0);
    scored.push({ c, parts, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const perArtist = {}, perSeed = {}, out = [];
  for (const { c, parts, score } of scored) {
    if (out.length >= limit) break;
    if (parts.some(p => (perArtist[p.key] || 0) >= maxPerArtist)) continue;
    const sk = normKey(c.seed);
    if (sk && (perSeed[sk] || 0) >= perSeedMax) continue;
    for (const p of parts) perArtist[p.key] = (perArtist[p.key] || 0) + 1;
    if (sk) perSeed[sk] = (perSeed[sk] || 0) + 1;
    out.push({ title: c.title, artist: c.artist, album: c.album || '', art: c.art || null, preview: c.preview || null, duration: c.duration || 0, because: c.because || becauseOf(c), seed: c.seed || null, score });
  }
  return out;
}
