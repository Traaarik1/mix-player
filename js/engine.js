import { analyzeAudio } from './wave.js';
// Аудиодвижок Mix.
// Главная идея: переход на следующий трек заранее ставится в расписание звукового потока
// (AudioBufferSourceNode.start(when) + кривые громкости). Звуковой поток не зависит от таймеров JS,
// поэтому переход отыграет точно, даже когда iOS притормаживает страницу при заблокированном экране.

export const EQ_BANDS = [60, 150, 400, 1000, 2400, 6000, 15000];
export const EQ_PRESETS = {
  'Ровно': [0, 0, 0, 0, 0, 0, 0],
  'Басы': [6, 4, 1, 0, 0, 1, 2],
  'Вокал': [-2, -1, 1, 3, 3, 1, 0],
  'Ярко': [-1, 0, 0, 1, 3, 5, 6],
  'Ночь': [2, 1, 0, -1, -2, -4, -6],
  'Рок': [5, 3, -1, -1, 1, 4, 5],
  'Поп': [-1, 1, 3, 3, 1, -1, -1],
  'Рэп': [7, 5, 1, -1, 1, 2, 3],
  'Электро': [5, 3, 0, -2, 1, 4, 4],
  'Джаз': [3, 2, -1, 1, -1, 2, 3],
  'Классика': [3, 1, 0, 0, -1, 2, 3],
  'Акустика': [3, 1, 1, 2, 2, 2, 2],
  'Подкаст': [-4, -2, 1, 4, 4, 1, -2],
};

const N = 256;
const FADE_IN = Float32Array.from({ length: N }, (_, i) => Math.sin(i / (N - 1) * Math.PI / 2));
const FADE_OUT = Float32Array.from({ length: N }, (_, i) => Math.cos(i / (N - 1) * Math.PI / 2));
const scaled = (curve, k) => k === 1 ? curve : curve.map(v => v * k);
const noop = () => {};

// Секунда тишины в WAV для медиа-элемента
function silence() {
  const sr = 48000, buf = new ArrayBuffer(44 + sr * 2), v = new DataView(buf);
  [...'RIFF'].forEach((c, i) => v.setUint8(i, c.charCodeAt(0))); v.setUint32(4, 36 + sr * 2, true);
  [...'WAVEfmt '].forEach((c, i) => v.setUint8(8 + i, c.charCodeAt(0))); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  [...'data'].forEach((c, i) => v.setUint8(36 + i, c.charCodeAt(0))); v.setUint32(40, sr * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Декодированный трек занимает ≈23 МБ в минуту (48 кГц, стерео, float32), а iOS без предупреждения
// убивает вкладку при нехватке памяти. На телефонах держим меньше, а очень длинное декодируем с меньшей частотой.
const SMALL = isIOS || /Android/.test(navigator.userAgent) || navigator.deviceMemory <= 4;
const MEM = SMALL ? { total: 500e6, one: 400e6 } : { total: 2e9, one: 4e9 };
const KEEP = 4;            // сколько треков держать декодированными, если хватает памяти
const MAX_SKIP = 8;        // сколько недоступных треков подряд можно пропустить
const DECODE_TIMEOUT = 120e3;
const RESUME_WINDOW = 10 * 60e3; // после прерывания (звонок) доигрываем сами, если прошло меньше 10 минут

// Маршрут звука. direct — обычный выход AudioContext: с audioSession 'playback' WebKit разрешает ему играть
// в фоне и показывает плеер на экране блокировки (webkit.org/b/261554, 275558@main, iOS 17.4+).
// stream — через <audio>: запасной путь для iOS без audioSession. Проверка на устройстве: ?route=stream|direct|auto
const ROUTE_KEY = 'mix-audio-route';
export function setAudioRoute(r) { try { r === 'auto' ? localStorage.removeItem(ROUTE_KEY) : localStorage.setItem(ROUTE_KEY, r); } catch {} }
function audioRoute() {
  let r = null;
  try {
    r = new URLSearchParams(location.search).get('route');
    if (r) setAudioRoute(r);
    r = localStorage.getItem(ROUTE_KEY);
  } catch {}
  if (r === 'stream' || r === 'direct') return r;
  return isIOS && !navigator.audioSession ? 'stream' : 'direct';
}

// Тишина в начале и конце трека (≈ −45 дБ), чтобы переход не проваливался в паузу
function silenceBounds(buf) {
  const thr = 0.0056, sr = buf.sampleRate, n = buf.length, d = n / sr;
  const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const loud = i => { for (const c of chs) if (c[i] > thr || c[i] < -thr) return true; return false; };
  let s = 0; while (s < n && !loud(s)) s++;
  if (s >= n) return { s: 0, e: d, d };
  let e = n - 1; while (e > s && !loud(e)) e--;
  return { s: Math.min(15, Math.max(0, s / sr - 0.05)), e: Math.min(d, e / sr + 0.15), d };
}

// Длительность для оценки памяти: у новых файлов она ещё неизвестна, прикидываем по размеру
function estSeconds(track, blob) {
  if (track.duration || track.bounds?.d) return track.duration || track.bounds.d;
  return blob.size * 8 / (/flac|wav|alac/i.test((blob.type || '') + (track.fileName || '')) ? 800e3 : 192e3);
}

export class Engine extends EventTarget {
  constructor({ load, getNext, onBounds }) {
    super();
    this.load = load;         // track -> Promise<Blob>
    this.getNext = getNext;   // track -> следующий трек или null
    this.onBounds = onBounds; // (track, {s, e, d}) — сохранить анализ
    this.ctx = null;
    this.cur = null; this.nxt = null; this.fade = null;
    this.tails = new Set();   // ушедшие деки, которые ещё доигрывают хвост перехода
    this.paused = true;
    this.hold = false;        // пауза от человека (или конец очереди): система не должна нас будить
    this.resumeAfter = 0;     // когда случилось прерывание, после которого надо доиграть
    this.unlocked = false;
    this.cf = 6; this.trim = true; this.skipFade = 1.5;
    this.cache = new Map(); this.sizes = new Map();
    this.decodeQ = Promise.resolve();
    this.token = 0; this.nextToken = 0; this.nextLoading = -1;
    this.lastNow = 0; this.stall = 0; this.lastKick = 0; this.kicking = false;
    this.eqGains = EQ_PRESETS['Ровно'].slice();
    this.volume = 0.8; this.fadeToken = 0;
  }

  init() {
    if (this.ctx) return;
    // тип сессии ставим до создания контекста: иначе iOS глушит звук беззвучным режимом и при блокировке
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    const ctx = this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.bus = ctx.createGain();
    this.filters = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f; b.Q.value = 1.1; b.gain.value = this.eqGains[i];
      return b;
    });
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * this.volume;
    let node = this.bus;
    for (const f of this.filters) { node.connect(f); node = f; }
    node.connect(this.master);
    this.route = audioRoute();
    if (this.route === 'stream') {
      const out = ctx.createMediaStreamDestination();
      this.master.connect(out);
      this.outEl = new Audio(); this.outEl.srcObject = out.stream; this.outEl.play().catch(noop);
      // система остановила <audio> (звонок, другое приложение)
      this.outEl.addEventListener('pause', () => { if (!this.paused) this.interrupted(); });
    } else {
      this.master.connect(ctx.destination);
      // Кнопки экрана блокировки и клавиатуры браузер привязывает к настоящему медиа-элементу,
      // а звук Web Audio им не считается. Поэтому рядом всегда идёт зацикленная тишина.
      if (this.route !== 'plain') { this.outEl = new Audio(silence()); this.outEl.loop = true; this.outEl.play().catch(noop); }
    }
    ctx.onstatechange = () => this.onCtxState();
    navigator.audioSession?.addEventListener?.('statechange', () => { if (navigator.audioSession.state !== 'interrupted') this.recover(); });
    const wake = () => { this.tick(); this.recover(); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    addEventListener('pageshow', wake);
    addEventListener('focus', wake);
    // Если iOS отказал в возобновлении без жеста, любое касание вернёт звук
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, () => this.recover(), { capture: true, passive: true });
    setInterval(() => this.tick(), 250);
  }

  // Safari: состояние 'interrupted' (звонок, Siri, чужое приложение) есть и в новых Chrome. suspend() в нём может бросить ошибку.
  onCtxState() {
    const s = this.ctx.state;
    if (this.kicking) return;
    if (s === 'running') {
      if (this.hold) { this.ctx.suspend().catch(noop); return; } // система разбудила, а человек жал паузу
      if (this.resumeAfter) {
        this.resumeAfter = 0; this.paused = false;
        this.outEl?.play().catch(noop);
        this.emit('state');
      }
    } else if (!this.paused && s !== 'closed') this.interrupted();
  }
  interrupted() {
    this.paused = true; this.resumeAfter = Date.now();
    this.emit('state'); this.emit('interrupted');
  }
  // Попробовать доиграть после прерывания. Таймером не повторяем: иначе отберём звук у чужого приложения.
  recover() {
    if (!this.resumeAfter || !this.ctx) return;
    if (Date.now() - this.resumeAfter > RESUME_WINDOW) { this.resumeAfter = 0; return; }
    if (this.ctx.state === 'running') { this.onCtxState(); return; }
    this.ctx.resume().catch(noop);
    this.outEl?.play().catch(noop);
  }

  decode(track) {
    let p = this.cache.get(track.id);
    if (p) { this.cache.delete(track.id); this.cache.set(track.id, p); return p; } // свежий — в конец очереди на вытеснение
    p = this.decodeNew(track);
    p.catch(() => { if (this.cache.get(track.id) === p) { this.cache.delete(track.id); this.sizes.delete(track.id); } });
    this.cache.set(track.id, p);
    return p;
  }

  async decodeNew(track) {
    let blob = await this.load(track), ab;
    // WebKit иногда не читает blob из IndexedDB после сна страницы: один раз берём его заново
    try { ab = await blob.arrayBuffer(); }
    catch { blob = await this.load(track); ab = await blob.arrayBuffer(); }
    // качество снижаем только если длина трека точно известна: оценка по размеру файла сильно ошибается на FLAC
    const sec = track.duration || track.bounds?.d || Math.min(estSeconds(track, blob), 900), rate = [this.ctx.sampleRate, 22050, 11025].find(r => sec * r * 8 <= MEM.one);
    if (!rate) throw Object.assign(new Error('трек слишком длинный для памяти устройства'), { code: 'too-long' });
    this.sizes.set(track.id, sec * rate * 8);
    this.evict(track.id);
    let target = this.ctx;
    if (rate !== this.ctx.sampleRate) try { target = new OfflineAudioContext(2, 1, rate); } catch {}
    // По одному: параллельное декодирование роняет вкладку на iOS (webkit.org/b/227636)
    const run = this.decodeQ.then(() => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('декодирование зависло')), DECODE_TIMEOUT);
      target.decodeAudioData(ab).then(res, rej).finally(() => clearTimeout(t));
    }));
    this.decodeQ = run.catch(noop);
    const buf = await run;
    this.sizes.set(track.id, buf.length * buf.numberOfChannels * 4);
    if (!track.bounds || track.bpm === undefined) {
      track.bounds ||= silenceBounds(buf);
      if (track.bpm === undefined) { const a = analyzeAudio(buf.getChannelData(0), buf.sampleRate); track.bpm = a.bpm; track.rms = a.rms; }
      this.onBounds?.(track, track.bounds);
    }
    this.evict(track.id);
    return buf;
  }

  // Текущий, следующий и только что запрошенный остаются всегда; остальные — пока хватает лимитов
  evict(keepId) {
    let total = 0; for (const v of this.sizes.values()) total += v;
    for (const id of [...this.cache.keys()]) {
      if (this.cache.size <= KEEP && total <= MEM.total) break;
      if (id === this.cur?.track.id || id === this.nxt?.deck.track.id || id === keepId) continue;
      this.cache.delete(id);
      total -= this.sizes.get(id) || 0; this.sizes.delete(id);
    }
  }

  deck(track, buf) {
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = buf; src.connect(gain).connect(this.bus);
    const b = track.bounds || { s: 0, e: buf.duration };
    this.live ??= new Set();
    const d = { track, buf, src, gain, startCtx: 0, offset: 0, fadeEnd: 0, ended: false,
      end: this.trim ? Math.min(b.e, buf.duration) : buf.duration, head: this.trim ? b.s : 0 };
    src.onended = () => {
      try { gain.disconnect(); src.disconnect(); } catch {}
      this.live.delete(d);
      this.tails.delete(d);
      if (this.cur !== d) return;
      d.ended = true;
      if (this.nxt) { this.promote(); return; }
      if (this.nextLoading === this.nextToken) return; // следующий ещё качается: заиграет сам
      this.finish();
    };
    return d;
  }

  // Очередь кончилась. Контекст ставим на паузу, чтобы перемотка не запустила звук при кнопке «пауза» на экране.
  finish() {
    this.paused = true; this.hold = true;
    this.outEl?.pause();
    this.ctx.suspend().catch(noop);
    this.emit('ended'); this.emit('state');
  }

  // iOS пускает звук только внутри жеста, а до resume() в play() идёт долгий await: будим контекст сразу.
  // Если контекст уже будили, ждём конца декодирования, иначе на паузе снова зазвучит старый трек.
  unlock() {
    this.hold = false;
    if (!this.unlocked || this.ctx.state === 'interrupted') { this.unlocked = true; this.ctx.resume().catch(noop); }
    this.outEl?.play().catch(noop);
  }

  // Начать трек сейчас (по клику, «вперёд», перемотка)
  async play(track, { offset = null, fade = 0, keepPaused = false } = {}) {
    this.init();
    this.softPos = null; clearTimeout(this.softTimer);
    if (!keepPaused) this.unlock();
    const my = ++this.token;
    const buf = await this.decode(track);
    if (my !== this.token) return;
    this.cancelNext();
    const ctx = this.ctx, d = this.deck(track, buf), old = this.cur;
    const now = ctx.currentTime, t0 = now + 0.05;
    d.offset = Math.max(0, Math.min(offset ?? d.head, buf.duration - 0.1));
    d.startCtx = t0;
    this.live.add(d);
    d.src.start(t0, d.offset);
    const canFade = fade > 0.05 && old && !old.ended && !this.paused;
    if (canFade) {
      d.gain.gain.setValueAtTime(0, 0);
      d.gain.gain.setValueCurveAtTime(FADE_IN, t0, fade);
      d.fadeEnd = t0 + fade;
      const g = old.gain.gain, k = this.gainNow(old, now);
      g.cancelScheduledValues(now); g.setValueAtTime(k, now); g.setValueAtTime(k, t0);
      try { g.setValueCurveAtTime(scaled(FADE_OUT, k), t0, fade); } catch { g.linearRampToValueAtTime(0, t0 + fade); }
      try { old.src.stop(t0 + fade + 0.1); } catch {}
      this.tails.add(old);
      this.fade = { from: old.track, to: track, t0, dur: fade };
    } else {
      d.gain.gain.value = 1;
      // резкая смена: всё прежнее глушим сразу, иначе при быстрых скипах треки наложатся друг на друга.
      // 20 мс на затухание только чтобы не было щелчка.
      // резкая смена: глушим вообще всё, что сейчас звучит, а не только известные хвосты
      for (const t of new Set([old, ...this.tails, ...this.live])) {
        if (t === d) continue;
        if (!t) continue;
        const g = t.gain.gain;
        try {
          g.cancelScheduledValues(now); g.setValueAtTime(this.gainNow(t, now), now); g.linearRampToValueAtTime(0, now + 0.02);
          t.src.stop(now + 0.025);
        } catch {}
      }
      this.fade = null;
    }
    this.cur = d;
    this.evict(track.id);
    if (!keepPaused) this.resume();
    // перемотка того же трека — не новый трек (иначе история и экран обновляются на каждую перемотку)
    if (old?.track !== track) this.emit('track');
    this.emit('state');
    this.scheduleNext();
  }

  // Сколько сейчас громкости у деки. AudioParam.value в Firefox не отражает автоматизацию, поэтому считаем сами.
  gainNow(deck, now) {
    const f = this.fade;
    if (!f || f.to !== deck.track || now >= deck.fadeEnd) return 1;
    return Math.sin(Math.max(0, Math.min(1, (now - f.t0) / f.dur)) * Math.PI / 2);
  }

  // Заранее поставить следующий трек в расписание
  async scheduleNext() {
    const cur = this.cur; if (!cur) return;
    const my = ++this.nextToken;
    this.nextLoading = my;
    let next = cur.track, buf = null;
    // трек, который не открылся (нет сети, битый файл), пропускаем, а не обрываем очередь
    for (let i = 0; i < MAX_SKIP && !buf; i++) {
      next = this.getNext(next);
      if (!next || next.id === cur.track.id) break;
      try { buf = await this.decode(next); }
      catch (e) { console.warn('next track', next.title, e); }
      if (my !== this.nextToken) return;
    }
    this.nextLoading = -1;
    if (this.cur !== cur || this.nxt) return;
    if (!buf) { if (cur.ended) this.finish(); return; }
    const ctx = this.ctx, d = this.deck(next, buf), now = ctx.currentTime;
    const curEnd = cur.startCtx + cur.end - cur.offset; // когда в расписании кончится текущий
    let cf = Math.max(0, Math.min(this.cf, (cur.end - cur.head) / 3, (d.end - d.head) / 3));
    // не раньше конца ручного перехода: две кривые на одном параметре браузер не примет
    const at = Math.max(now + 0.1, cur.fadeEnd + 0.01, curEnd - cf);
    cf = Math.max(0, Math.min(cf, curEnd - at)); // после перемотки к концу на полный переход может не хватить
    d.offset = d.head; d.startCtx = at;
    this.live.add(d);
    d.src.start(at, d.head);
    try {
      if (cf > 0.05) {
        d.gain.gain.setValueAtTime(0, 0);
        d.gain.gain.setValueCurveAtTime(FADE_IN, at, cf);
        cur.gain.gain.setValueCurveAtTime(FADE_OUT, at, cf);
      } else {
        d.gain.gain.setValueAtTime(0, 0); d.gain.gain.setValueAtTime(1, at);
        cur.gain.gain.setValueAtTime(0, at);
      }
    } catch { // пересеклось с ещё идущим ручным переходом — ставим жёсткую склейку
      d.gain.gain.cancelScheduledValues(0); d.gain.gain.setValueAtTime(0, 0); d.gain.gain.setValueAtTime(1, at);
      cur.gain.gain.cancelScheduledValues(at); cur.gain.gain.setValueAtTime(0, at);
      cf = 0;
    }
    d.fadeEnd = at + cf;
    this.nxt = { deck: d, at, dur: cf };
    this.emit('state');
  }

  cancelNext() {
    this.nextToken++;
    const n = this.nxt; if (!n) return;
    if (this.ctx.currentTime >= n.at) { this.promote(true); return; }
    this.nxt = null;
    try { n.deck.src.stop(); } catch {}
    try { n.deck.src.disconnect(); n.deck.gain.disconnect(); } catch {}
    this.cur.gain.gain.cancelScheduledValues(n.at);
  }

  // Расписанный переход начался — следующий трек становится текущим.
  // quiet: вызывающий сам сразу сменит трек, событие и новое расписание не нужны.
  promote(quiet = false) {
    const n = this.nxt; if (!n) return;
    const old = this.cur;
    this.nxt = null; this.cur = n.deck;
    if (old && !old.ended) this.tails.add(old);
    this.fade = n.dur > 0.05 ? { from: old?.track, to: n.deck.track, t0: n.at, dur: n.dur } : null;
    if (quiet) return;
    this.emit('track'); this.emit('state');
    this.scheduleNext();
  }

  tick() {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime;
    if (this.nxt && now >= this.nxt.at) this.promote();
    if (this.fade && now > this.fade.t0 + this.fade.dur + 0.1) { this.fade = null; this.emit('state'); }
    if (!this.paused && this.cur && !this.cur.ended) {
      if (this.outEl?.paused) this.outEl.play().catch(noop);
      // iOS иногда оставляет 'running', но время стоит (после прерывания): встряхиваем контекст
      if (ctx.state === 'running' && now === this.lastNow) {
        if (++this.stall >= 8 && Date.now() - this.lastKick > 10e3) {
          this.stall = 0; this.lastKick = Date.now(); this.kicking = true;
          ctx.suspend().then(() => ctx.resume()).catch(noop).finally(() => { this.kicking = false; });
        }
      } else this.stall = 0;
    }
    this.lastNow = now;
  }

  // Пересчитать следующий трек (поменялась очередь или настройки)
  refreshNext() {
    if (!this.cur) return;
    if (this.nxt && this.ctx.currentTime >= this.nxt.at) return; // переход уже идёт
    this.cancelNext(); this.scheduleNext();
  }
  setCrossfade(sec) { this.cf = sec; this.refreshNext(); }
  setTrim(on) { this.trim = on; }

  async resume() {
    this.init();
    this.hold = false; this.resumeAfter = 0;
    if (this.softPos != null && this.cur) { // трек сняли при паузе: ставим с того же места
      const pos = this.softPos; this.softPos = null; clearTimeout(this.softTimer);
      return this.play(this.cur.track, { offset: pos });
    }
    // очередь закончилась: «играть» запускает трек сначала, иначе контекст пошёл бы вхолостую
    if (this.cur?.ended && !this.nxt && this.nextLoading !== this.nextToken) return this.play(this.cur.track);
    this.paused = false; this.unlocked = true;
    this.fadeToken = (this.fadeToken || 0) + 1;
    {
      const g = this.master.gain, now = this.ctx.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(0, now); g.linearRampToValueAtTime(this.volume * this.volume, now + .06);
    }
    this.outEl?.play().catch(noop);
    this.emit('state');
    const ctx = this.ctx;
    if (ctx.state === 'running') return;
    // resume() на iOS и в браузерах с запретом автозапуска может не завершиться никогда: не ждём вечно
    await Promise.race([ctx.resume().catch(noop), new Promise(r => setTimeout(r, 1500))]);
    if (!this.paused && ctx.state !== 'running') this.interrupted();
  }
  async pause() {
    if (!this.ctx) return;
    this.token++; // трек, который ещё загружается, не должен заиграть после паузы
    this.hold = true; this.resumeAfter = 0;
    this.paused = true; this.emit('state');
    // резкая остановка потока на iOS слышна как писк: сначала быстро убираем громкость
    const my = ++this.fadeToken, g = this.master.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(this.volume * this.volume, now); g.linearRampToValueAtTime(0, now + .06);
    await new Promise(r => setTimeout(r, 80));
    if (my !== this.fadeToken || !this.paused) return;
    if (this.softMode()) {
      // iOS не даёт заблокированному сайту снова запустить остановленный поток, поэтому поток не останавливаем:
      // снимаем трек и запоминаем позицию. Долгая пауза всё же выключает его ради батареи.
      this.softPos = this.position;
      this.hold = false;
      this.cancelNext();
      for (const t of new Set([this.cur, ...this.tails, ...this.live])) { if (!t) continue; this.live.delete(t); t.src.onended = null; try { t.src.stop(); } catch {} }
      this.tails.clear(); this.fade = null;
      this.outEl?.pause();
      clearTimeout(this.softTimer);
      this.softTimer = setTimeout(() => { if (this.paused && this.softPos != null) { this.hold = true; this.ctx.suspend().catch(noop); } }, 600000);
      return;
    }
    this.outEl?.pause();
    try { await this.ctx.suspend(); } catch {}
  }
  toggle() { return this.paused ? this.resume() : this.pause(); }

  // Ускоренное проигрывание при зажатой кнопке. Переход на следующий трек на это время снимается с расписания,
  // иначе он заиграл бы не вовремя.
  setRate(rate) {
    const c = this.cur; if (!c || !this.ctx) return;
    const now = this.ctx.currentTime;
    c.offset = this.position; c.startCtx = now; c.rate = rate;
    c.src.playbackRate.setValueAtTime(rate, now);
  }
  holdStart(rate) {
    if (!this.cur || this.paused) return false;
    if (this.nxt && this.ctx.currentTime >= this.nxt.at) return false; // переход уже идёт
    this.cancelNext();
    this.setRate(rate);
    return true;
  }
  holdEnd() {
    if (!this.cur) return;
    this.setRate(1);
    this.scheduleNext();
  }

  softMode() { return isIOS || /[?&]softpause/.test(location.search); }
  seek(pos) {
    if (this.softPos != null) { this.softPos = pos; this.emit('state'); return; }
    if (!this.cur) return;
    return this.play(this.cur.track, { offset: pos, keepPaused: this.paused });
  }

  get position() {
    if (this.softPos != null) return this.softPos;
    const c = this.cur; if (!c) return 0;
    return Math.max(0, Math.min(c.buf.duration, c.offset + Math.max(0, (this.ctx.currentTime - c.startCtx) * (c.rate || 1))));
  }
  get duration() { return this.cur?.buf.duration || 0; }
  get track() { return this.cur?.track || null; }
  // Где на полосе прогресса начнётся переход (секунды трека)
  get mixAt() { const n = this.nxt, c = this.cur; return n && c ? c.offset + (n.at - c.startCtx) : null; }
  get nextTrack() { return this.nxt?.deck.track || null; }
  // 0..1 — насколько далеко зашёл текущий переход (для визуала)
  get mix() {
    const f = this.fade; if (!f || !this.ctx) return null;
    const p = (this.ctx.currentTime - f.t0) / f.dur;
    return p < 0 || p > 1 ? null : { ...f, p, k: Math.sin(p * Math.PI / 2) };
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.03); }
  setEq(gains) {
    this.eqGains = gains.slice();
    this.filters?.forEach((f, i) => f.gain.setTargetAtTime(gains[i], this.ctx.currentTime, 0.05));
  }
  // АЧХ эквалайзера для рисования кривой
  eqResponse(freqs) {
    const out = new Float32Array(freqs.length);
    if (!this.filters) return out.map((_, i) => 0);
    const mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
    for (const f of this.filters) { f.getFrequencyResponse(freqs, mag, ph); for (let i = 0; i < out.length; i++) out[i] += 20 * Math.log10(mag[i]); }
    return out;
  }

  // Для проверки на телефоне
  diag() {
    let mem = 0; for (const v of this.sizes.values()) mem += v;
    return { route: this.route, state: this.ctx?.state, session: navigator.audioSession?.state, sessionType: navigator.audioSession?.type,
      sampleRate: this.ctx?.sampleRate, decodedMB: Math.round(mem / 1e6), paused: this.paused, resumeAfter: this.resumeAfter };
  }

  emit(type) { this.dispatchEvent(new Event(type)); }
}
