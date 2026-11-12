// Синхронизация между устройствами без сервера: один JSON-документ в «Избранном» Telegram.
// Приложение отдаёт обычное состояние (без отметок времени), отметки и «надгробия» ставит stamp():
// он сравнивает состояние с прошлым документом. Поэтому app.js может и дальше просто менять Set и массивы.
export const FORMAT = 1, FILE_NAME = 'mix-sync.json', HISTORY_CAP = 300;
const APP = 'mix-sync', MAX_DOC_BYTES = 8e6, MAX_REMOTES = 5;
const IMPORT_T = 1;          // данные, что были на устройстве до первой синхронизации: любая настоящая правка их перебивает
const MAX_FUTURE = 864e5;    // часы другого устройства могут спешить; отметке дальше суток вперёд не верим
const KNOWN = new Set(['app', 'v', 'clock', 'savedAt', 'likes', 'playlists', 'history', 'tracks', 'settings', 'wave', 'extra']);
const SECTIONS = ['likes', 'playlists', 'history', 'tracks', 'settings', 'wave'];
const isNum = v => typeof v === 'number' && Number.isFinite(v), isBool = v => typeof v === 'boolean';
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const SETTINGS = {
  cf: v => isNum(v) && v >= 0 && v <= 12, trim: isBool, norm: isBool, skipFade: isBool, eqPreset: v => typeof v === 'string' && v.length < 100,
  eq: v => Array.isArray(v) && v.length <= 32 && v.every(x => isNum(x) && Math.abs(x) <= 40),
};
const TRACK_FIELDS = ['title', 'artist', 'album', 'verified', 'conf'];
// Ключи не уходят в документ, даже если случайно окажутся в «непрозрачных» данных волны
const SECRET = new Set(['apiid', 'apihash', 'session', 'acoustkey', 'auddtoken', 'token', 'api_token', 'password', 'phone', 'secret']);
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (!isObj(v)) return v;
  const o = {};
  for (const k of Object.keys(v)) if (!SECRET.has(k.toLowerCase()) && k !== '__proto__') o[k] = scrub(v[k]);
  return o;
}

// ---------- чистые функции ----------
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}
function hash53(s) { // cyrb53: хватает, чтобы заметить изменение; не криптография
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
const content = d => { const o = {}; for (const k of SECTIONS) o[k] = d[k]; o.extra = d.extra; return o; };
export const contentHash = doc => hash53(canon(content(doc)));
export const emptyDoc = () => ({ app: APP, v: FORMAT, clock: 0, likes: {}, playlists: {}, history: [], tracks: {}, settings: {}, wave: {}, extra: {} });

// Последняя запись побеждает; при равном времени выбор детерминированный, поэтому устройства сходятся
function lww(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.t !== b.t) return a.t > b.t ? a : b;
  return canon(a) >= canon(b) ? a : b;
}
function mergeMap(a, b, fn = lww) {
  const o = {};
  for (const k of Object.keys(a)) o[k] = k in b ? fn(a[k], b[k]) : a[k];
  for (const k of Object.keys(b)) if (!(k in a)) o[k] = b[k];
  return o;
}
function mergePlaylist(a, b) {
  const c = Math.min(a.c, b.c), del = Math.max(a.del || 0, b.del || 0);
  // Удаление окончательное: id плейлистов уникальны, вернуть удалённый из интерфейса нельзя
  if (del) return { c, del };
  return { c, name: lww(a.name, b.name), items: mergeMap(a.items, b.items) };
}
const historyKey = h => h.at + '|' + h.id;
function mergeHistory(a, b) {
  const seen = new Map();
  for (const h of [...a, ...b]) seen.set(historyKey(h), { id: h.id, at: h.at });
  return [...seen.values()].sort((x, y) => y.at - x.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).slice(0, HISTORY_CAP);
}

// Приводит чужие данные к форме документа: плохое выбрасывает, хорошее сохраняет. Не падает ни на чём.
export function sanitize(raw, now = Date.now()) {
  const d = emptyDoc();
  if (!isObj(raw)) return d;
  const limit = now + MAX_FUTURE;
  let top = isNum(raw.clock) && raw.clock <= limit ? raw.clock : 0;
  // Отметка из далёкого будущего становится самой слабой. Обрезать до limit нельзя: limit растёт со временем,
  // и такая запись вечно перебивала бы настоящие правки.
  const T = t => { if (t > limit) return IMPORT_T; if (t > top) top = t; return t; };
  const goodT = t => isNum(t) && t >= 0;
  const entries = o => (isObj(o) ? Object.entries(o).filter(([k]) => k !== '__proto__' && k.length <= 300) : []);
  for (const [id, it] of entries(raw.likes)) if (isObj(it) && goodT(it.t) && isBool(it.on)) d.likes[id] = { ...it, t: T(it.t) };
  for (const [id, it] of entries(raw.tracks)) if (isObj(it) && goodT(it.t)) d.tracks[id] = { ...it, t: T(it.t) };
  for (const [k, it] of entries(raw.settings)) if (isObj(it) && goodT(it.t) && (!SETTINGS[k] || SETTINGS[k](it.v))) d.settings[k] = { ...it, t: T(it.t) };
  for (const [k, it] of entries(raw.wave)) if (isObj(it) && goodT(it.t)) d.wave[k] = { ...it, t: T(it.t) };
  for (const [id, p] of entries(raw.playlists)) {
    if (!isObj(p) || !goodT(p.c)) continue;
    if (goodT(p.del)) { d.playlists[id] = { c: T(p.c), del: T(p.del) }; continue; }
    const items = {};
    for (const [tid, it] of entries(p.items)) if (isObj(it) && goodT(it.t) && isBool(it.on) && isNum(it.k)) items[tid] = { t: T(it.t), on: it.on, k: it.k };
    const name = isObj(p.name) && goodT(p.name.t) && typeof p.name.v === 'string' ? { t: T(p.name.t), v: p.name.v } : { t: 0, v: 'Плейлист' };
    d.playlists[id] = { c: T(p.c), name, items };
  }
  if (Array.isArray(raw.history)) d.history = mergeHistory(raw.history.filter(h => isObj(h) && typeof h.id === 'string' && isNum(h.at)), []);
  // Неизвестное этой версии поле верхнего уровня не теряем
  for (const [k, v] of entries(raw.extra)) if (!KNOWN.has(k)) d.extra[k] = v;
  for (const [k, v] of Object.entries(raw)) if (!KNOWN.has(k) && k !== '__proto__') d.extra[k] = v;
  d.clock = top;
  return d;
}

export function merge(a, b, { now = Date.now() } = {}) {
  const x = sanitize(a, now), y = sanitize(b, now), d = emptyDoc();
  d.clock = Math.max(x.clock, y.clock);
  d.likes = mergeMap(x.likes, y.likes);
  d.tracks = mergeMap(x.tracks, y.tracks);
  d.settings = mergeMap(x.settings, y.settings);
  d.wave = mergeMap(x.wave, y.wave);
  d.playlists = mergeMap(x.playlists, y.playlists, mergePlaylist);
  d.history = mergeHistory(x.history, y.history);
  d.extra = mergeMap(x.extra, y.extra, (p, q) => (canon(p) >= canon(q) ? p : q));
  return d;
}

// Индексы длиннейшей возрастающей подпоследовательности: столько элементов можно не трогать при перестановке
function lis(a) {
  const tails = [], prev = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[tails[m]] < a[i]) lo = m + 1; else hi = m; }
    prev[i] = lo ? tails[lo - 1] : -1; tails[lo] = i;
  }
  const out = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(i);
  return out;
}
const byKey = items => (p, q) => items[p].k - items[q].k || (p < q ? -1 : p > q ? 1 : 0);
function stampItems(rec, ids, T) {
  const items = rec.items, want = [...new Set(ids)], wanted = new Set(want);
  for (const id of Object.keys(items)) if (items[id].on && !wanted.has(id)) items[id] = { ...items[id], on: false, t: T() };
  const present = want.filter(id => items[id]?.on);
  const rank = new Map([...present].sort(byKey(items)).map((id, i) => [id, i]));
  const keepIdx = lis(present.map(id => rank.get(id)));
  const kept = new Set(present.filter((_, i) => keepIdx.has(i)));
  for (let i = 0; i < want.length; i++) {
    const id = want[i];
    if (kept.has(id)) continue;
    const prev = i ? items[want[i - 1]].k : undefined;
    let next; for (let j = i + 1; j < want.length; j++) if (kept.has(want[j])) { next = items[want[j]].k; break; }
    if (prev !== undefined && next !== undefined && !(next - prev > 1e-9)) { // места между соседями не осталось
      want.forEach((w, n) => { items[w] = { t: T(), on: true, k: n + 1 }; });
      return;
    }
    const k = prev === undefined ? (next === undefined ? 1 : next - 1) : next === undefined ? prev + 1 : (prev + next) / 2;
    items[id] = { t: T(), on: true, k };
  }
}

// Новый документ = старый + отличия обычного состояния. Отсутствующий раздел значит «не менялся», а не «всё удалено».
export function stamp(doc, plain = {}, now = Date.now()) {
  const d = structuredClone(doc), importing = !d.clock;
  let t0;
  const T = () => (t0 ??= importing ? IMPORT_T : (d.clock = Math.max(now, d.clock + 1)));
  if (plain.likes) {
    const on = new Set(plain.likes);
    for (const id of on) if (!d.likes[id]?.on) d.likes[id] = { t: T(), on: true };
    for (const id of Object.keys(d.likes)) if (d.likes[id].on && !on.has(id)) d.likes[id] = { t: T(), on: false };
  }
  if (plain.playlists) {
    const seen = new Set();
    plain.playlists.forEach((p, i) => {
      seen.add(p.id);
      let rec = d.playlists[p.id];
      if (rec?.del) return;
      if (!rec) rec = d.playlists[p.id] = { c: importing ? i + 1 : T(), name: { t: T(), v: p.name }, items: {} };
      else if (rec.name.v !== p.name) rec.name = { t: T(), v: p.name };
      stampItems(rec, p.ids || [], T);
    });
    for (const id of Object.keys(d.playlists)) if (!seen.has(id) && !d.playlists[id].del) d.playlists[id] = { c: d.playlists[id].c, del: T() };
  }
  if (plain.history) d.history = mergeHistory(d.history, plain.history.filter(h => h && typeof h.id === 'string' && isNum(h.at)));
  if (plain.tracks) {
    for (const [id, t] of Object.entries(plain.tracks)) {
      if (!t?.verified || !t.conf) continue; // только подтверждённое по звуку или вручную: догадка не должна разойтись по устройствам
      const val = {}; for (const f of TRACK_FIELDS) if (t[f] !== undefined) val[f] = t[f];
      const { t: _, ...old } = d.tracks[id] || {};
      if (canon(old) !== canon(val)) d.tracks[id] = { t: T(), ...val };
    }
  }
  if (plain.settings) for (const k of Object.keys(SETTINGS)) {
    const v = plain.settings[k];
    if (v !== undefined && SETTINGS[k](v) && canon(d.settings[k]?.v) !== canon(v)) d.settings[k] = { t: T(), v: structuredClone(v) };
  }
  if (plain.wave !== undefined) {
    const w = scrub(isObj(plain.wave) ? plain.wave : { $: plain.wave });
    for (const [k, v] of Object.entries(w)) if (d.wave[k]?.del || canon(d.wave[k]?.v) !== canon(v)) d.wave[k] = { t: T(), v };
    for (const k of Object.keys(d.wave)) if (!(k in w) && !d.wave[k].del) d.wave[k] = { t: T(), del: true };
  }
  d.clock = Math.max(d.clock, IMPORT_T);
  return d;
}

// Документ → обычное состояние для приложения
export function project(doc) {
  const d = sanitize(doc, Infinity);
  const tracks = {};
  for (const [id, t] of Object.entries(d.tracks)) { const { t: _, ...rest } = t; tracks[id] = rest; }
  const settings = {};
  for (const [k, s] of Object.entries(d.settings)) if (SETTINGS[k]) settings[k] = s.v;
  let wave = {};
  for (const [k, w] of Object.entries(d.wave)) if (!w.del) wave[k] = w.v;
  if ('$' in wave) wave = wave.$;
  const pls = Object.entries(d.playlists).filter(([, p]) => !p.del).sort(([i, p], [j, q]) => p.c - q.c || (i < j ? -1 : 1));
  return {
    likes: Object.keys(d.likes).filter(id => d.likes[id].on).sort(),
    playlists: pls.map(([id, p]) => ({ id, name: p.name.v, ids: Object.keys(p.items).filter(t => p.items[t].on).sort(byKey(p.items)) })),
    history: d.history, tracks, settings, wave,
  };
}

export function encode(doc, now = Date.now()) {
  const { extra, ...known } = doc;
  return JSON.stringify({ ...extra, ...known, savedAt: now });
}
// {status:'ok', doc} | {status:'newer', v} — формат новее нашего, такой файл нельзя перезаписывать | {status:'corrupt'}
export function decode(text, now = Date.now()) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { status: 'corrupt' }; }
  if (!isObj(raw) || raw.app !== APP || !Number.isInteger(raw.v) || raw.v < 1) return { status: 'corrupt' };
  if (raw.v > FORMAT) return { status: 'newer', v: raw.v };
  return { status: 'ok', doc: sanitize(raw, now) };
}
function changesBetween(a, b) {
  const p = project(a), q = project(b), c = {};
  for (const k of ['likes', 'playlists', 'history', 'settings', 'wave']) c[k] = canon(p[k]) !== canon(q[k]);
  c.tracks = Object.keys(q.tracks).filter(id => canon(p.tracks[id]) !== canon(q.tracks[id]));
  return c;
}
const isEmptyDoc = d => !Object.keys(d.likes).length && !Object.keys(d.playlists).length && !d.history.length && !Object.keys(d.tracks).length && !Object.keys(d.settings).length && !Object.keys(d.wave).length;
const AUTH_ERR = /AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|UNAUTHORIZED/i;

// ---------- движок ----------
export function createSync({
  tg, getLocal, applyMerged, now = Date.now, onStatus = () => {},
  store = { v: null, get() { return this.v; }, set(x) { this.v = x; } },
  debounceMs = 8000, maxWaitMs = 60000, stampMs = 1000, baseRetryMs = 5000, maxRetryMs = 9e5,
  isOnline = () => globalThis.navigator?.onLine !== false, random = Math.random, fileName = FILE_NAME,
}) {
  let st, stopped = false, applying = false, running = null, again = null, attempts = 0;
  let stampTimer, debounceTimer, retryTimer, firstAt = 0, last = { state: 'idle' };
  const status = s => { last = { ...s, at: now() }; try { onStatus(last); } catch {} };
  const clearAll = () => { clearTimeout(stampTimer); clearTimeout(debounceTimer); clearTimeout(retryTimer); stampTimer = debounceTimer = retryTimer = null; firstAt = 0; };

  async function load() {
    if (st) return st;
    let saved = null;
    try { saved = await store.get(); } catch {}
    st ??= { doc: isObj(saved?.doc) ? sanitize(saved.doc, now()) : emptyDoc(), pushedHash: saved?.pushedHash || null, msgId: saved?.msgId || null, docId: saved?.docId || null, synced: !!saved?.synced, bad: Array.isArray(saved?.bad) ? saved.bad : [] };
    return st;
  }
  const persist = async () => { try { await store.set(st); } catch {} };
  // Отметка времени ставится сразу после правки, даже без сети: иначе офлайн-правка выглядела бы более новой, чем была
  const stampLocal = () => { if (!applying) st.doc = stamp(st.doc, getLocal(), now()); };

  async function cycle(upload) {
    await load();
    stampLocal();
    await persist();
    if (!isOnline() || tg.syncReady?.() === false) { status({ state: 'offline' }); return { ok: false, offline: true }; }
    status({ state: 'syncing' });
    const found = await tg.findSyncDocs({ name: fileName, hintId: st.msgId });
    const remotes = [];
    let target = null, corrupt = 0, sameAsPushed = null;
    for (const it of found.slice(0, MAX_REMOTES)) {
      if (st.bad.includes(it.docId)) { corrupt++; continue; }
      if (it.docId && it.docId === st.docId) { // этот файл уже учтён в нашем документе — не качаем заново
        target ??= it; sameAsPushed ??= it; remotes.push({ it, known: true });
        continue;
      }
      const dec = it.size > MAX_DOC_BYTES ? { status: 'corrupt' } : decode(await tg.downloadSyncDoc(it), now());
      if (dec.status === 'newer') {
        status({ state: 'error', code: 'remote-newer', error: `Файл синхронизации новее этой версии Mix (формат ${dec.v}). Обнови страницу.` });
        return { ok: false, code: 'remote-newer' };
      }
      if (dec.status === 'corrupt') { corrupt++; st.bad.push(it.docId); continue; } // не трогаем: вдруг его ещё можно спасти вручную
      target ??= it; remotes.push({ it, doc: dec.doc });
    }
    // Здесь сеть позади: всё до applyMerged идёт синхронно, так что правка, сделанная во время загрузки, не потеряется
    stampLocal();
    const before = st.doc;
    let base = before;
    const fetched = remotes.filter(r => r.doc);
    if (!st.synced && fetched.length) { // новое устройство не перебивает настройки своими значениями по умолчанию
      base = structuredClone(before);
      for (const sec of ['settings', 'wave']) for (const k of Object.keys(base[sec])) if (base[sec][k].t === IMPORT_T && fetched.some(r => r.doc[sec][k])) delete base[sec][k];
    }
    let merged = base;
    for (const r of fetched) merged = merge(merged, r.doc, { now: now() });
    if (!fetched.length) merged = sanitize(merged, now());

    const changed = changesBetween(before, merged);
    const differs = changed.tracks.length || changed.likes || changed.playlists || changed.history || changed.settings || changed.wave;
    if (differs) {
      applying = true;
      try { await applyMerged(project(merged), changed); } finally { applying = false; }
    }
    st.doc = merged; st.synced = true;
    await persist();

    const h = contentHash(merged);
    const newest = remotes.find(r => r.it === target);
    const remoteH = newest ? (newest.doc ? contentHash(newest.doc) : st.pushedHash) : null;
    const obsolete = remotes.filter(r => r.it !== target).map(r => r.it.msgId);
    let pushed = false;
    if (upload && h !== remoteH && !isEmptyDoc(merged)) {
      const r = await tg.uploadSyncDoc(encode(merged, now()), { name: fileName, replaceMsgId: target?.msgId ?? null });
      st.msgId = r.msgId; st.docId = r.docId; st.pushedHash = h; pushed = true;
    } else if (target) { st.msgId = target.msgId; st.docId = target.docId; st.pushedHash = remoteH; }
    await persist();
    // Лишние копии (два устройства создали файл одновременно) убираем, только когда их содержимое уже в основном
    if (obsolete.length && (pushed || h === remoteH)) { try { await tg.deleteSyncDocs(obsolete, { name: fileName }); } catch {} }
    attempts = 0;
    status({ state: 'idle', pushed, pulled: !!differs, corrupt, synced: true });
    if (!upload && h !== st.pushedHash && !isEmptyDoc(merged)) schedule();
    return { ok: true, pushed, pulled: !!differs, corrupt, changed };
  }

  function planRetry(e, upload) {
    const msg = String(e?.errorMessage || e?.message || e);
    if (AUTH_ERR.test(msg)) { status({ state: 'auth', error: msg }); return { ok: false, code: 'auth', error: msg }; }
    attempts++;
    let delay = Math.min(maxRetryMs, baseRetryMs * 2 ** (attempts - 1)) * (0.75 + 0.5 * random());
    if (e?.seconds > 0) delay = Math.max(delay, e.seconds * 1000 + 500); // FLOOD_WAIT от Telegram
    status({ state: 'retry', attempt: attempts, retryAt: now() + delay, error: msg });
    clearTimeout(retryTimer);
    if (!stopped) retryTimer = setTimeout(() => { retryTimer = null; run(upload); }, delay);
    return { ok: false, error: msg, retry: true };
  }

  // Одновременно идёт один цикл; всё, что запросили за это время, выполняется одним следующим
  function run(upload) {
    if (stopped) return Promise.resolve({ ok: false, stopped: true });
    if (running) { again = !!(again || upload); return running; }
    clearTimeout(retryTimer); retryTimer = null;
    running = (async () => {
      try { return await cycle(upload); } catch (e) { return planRetry(e, upload); }
    })().finally(() => {
      running = null;
      if (again !== null) { const u = again; again = null; run(u); }
    });
    return running;
  }

  async function fireDebounced() {
    debounceTimer = null; firstAt = 0;
    await load();
    stampLocal();
    // Ничего не поменялось (например, это эхо от applyMerged) — в сеть не идём
    if (contentHash(st.doc) === st.pushedHash || (isEmptyDoc(st.doc) && !st.pushedHash)) { await persist(); return; }
    return run(true);
  }
  function schedule() {
    if (stopped) return;
    stampTimer ??= setTimeout(async () => { stampTimer = null; await load(); stampLocal(); await persist(); }, stampMs);
    if (retryTimer) return; // уже ждём повтора после ошибки, он заберёт и эту правку
    firstAt ||= now();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fireDebounced, Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now())));
  }
  const cancelPending = () => { clearTimeout(debounceTimer); debounceTimer = null; firstAt = 0; };
  return {
    pull: () => run(false),                                   // скачать и применить, без выгрузки (если есть своё — выгрузит отложенно)
    push: () => { cancelPending(); return run(true); },       // полный цикл: скачать, объединить, выгрузить при отличии
    schedule,                                                 // вызывать после каждого сохранения
    flush: async () => { if (debounceTimer) { clearTimeout(debounceTimer); return fireDebounced(); } },
    stop: () => { stopped = true; clearAll(); },
    status: () => last,
    trackMeta: id => { const t = st?.doc.tracks[id]; if (!t) return null; const { t: _, ...rest } = t; return rest; },
    ready: () => load().then(() => {}),
  };
}
