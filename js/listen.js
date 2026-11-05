// «Шазам» через микрофон: запись 8–12 с и распознавание в AudD (CORS открыт, работает прямо из браузера).
// Без токена AudD даёт небольшой лимит запросов; бесплатный токен — ещё 300 разовых. Подробности: docs/sync-and-listen.md
import { norm } from './covers.js';

const AUDD = 'https://api.audd.io/', ITUNES = 'https://itunes.apple.com/search';
const MIMES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/aac'];
const MESSAGES = {
  unsupported: 'Этот браузер не умеет записывать звук. Нужен Safari, Chrome или Firefox и адрес https.',
  permission: 'Нет доступа к микрофону. Разреши его в настройках браузера.',
  'no-mic': 'Микрофон не найден или занят другим приложением.',
  recorder: 'Запись оборвалась. Попробуй ещё раз.',
  aborted: 'Отменено.',
  'no-token': 'Бесплатные запросы без токена на сегодня кончились. Подожди до завтра или введи токен AudD в настройках.',
  'bad-token': 'AudD не принял токен: он неверный или его пробный период закончился.',
  quota: 'Лимит запросов AudD исчерпан.',
  network: 'Нет связи с сервисом распознавания.',
  'bad-audio': 'Сервис не смог разобрать запись. Попробуй ещё раз, ближе к источнику звука.',
  'too-large': 'Файл слишком большой для распознавания (больше 10 МБ).',
  provider: 'Сервис распознавания вернул ошибку.',
};
export class ListenError extends Error {
  constructor(code, detail) { super(MESSAGES[code] || code); this.name = 'ListenError'; this.code = code; this.detail = detail; }
}

export function pickMime(isSupported = t => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  for (const t of MIMES) { try { if (isSupported(t)) return t; } catch {} }
  return ''; // пусть браузер выберет сам
}
const extFor = type => (/mp4|aac|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : /wav/.test(type) ? 'wav' : /mpeg|mp3/.test(type) ? 'mp3' : 'webm');
function micError(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return new ListenError('permission', e.message);
  if (['NotFoundError', 'OverconstrainedError', 'NotReadableError', 'AbortError'].includes(e?.name)) return new ListenError('no-mic', e.message);
  return new ListenError('unsupported', e?.message);
}

// Запись с микрофона. Дорожки освобождаются при любом исходе. Шумодав и АРУ выключены: они калечат музыку.
export async function record({
  seconds = 12, signal, onProgress,
  mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder, audioSession = globalThis.navigator?.audioSession,
} = {}) {
  if (signal?.aborted) throw new ListenError('aborted');
  if (!mediaDevices?.getUserMedia || !Recorder) throw new ListenError('unsupported');
  // На iPhone в режиме 'playback' страница не получит микрофон
  const prevSession = audioSession?.type;
  try { if (audioSession) audioSession.type = 'play-and-record'; } catch {}
  let stream;
  try {
    try {
      stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    } catch (e) { throw micError(e); }
    if (signal?.aborted) throw new ListenError('aborted');
    const mimeType = pickMime(t => Recorder.isTypeSupported?.(t));
    let rec;
    try { rec = new Recorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined); } catch (e) { throw new ListenError('recorder', e?.message); }
    return await new Promise((resolve, reject) => {
      const chunks = [], t0 = Date.now();
      let aborted = false;
      const stop = () => { try { if (rec.state !== 'inactive') rec.stop(); } catch {} };
      const onAbort = () => { aborted = true; stop(); };
      const tick = setInterval(() => onProgress?.(Math.min(1, (Date.now() - t0) / (seconds * 1000))), 200);
      const timer = setTimeout(stop, seconds * 1000);
      const guard = setTimeout(() => done(new ListenError('recorder', 'stop timeout')), seconds * 1000 + 4000); // Safari иногда не присылает stop
      function done(err, blob) {
        clearInterval(tick); clearTimeout(timer); clearTimeout(guard);
        signal?.removeEventListener?.('abort', onAbort);
        err ? reject(err) : resolve(blob);
      }
      signal?.addEventListener?.('abort', onAbort);
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      rec.onerror = e => { stop(); done(new ListenError('recorder', e?.error?.message)); };
      rec.onstop = () => {
        if (aborted) return done(new ListenError('aborted'));
        const blob = new Blob(chunks, { type: (rec.mimeType || mimeType || 'audio/webm').split(';')[0] });
        blob.size ? done(null, blob) : done(new ListenError('recorder', 'empty'));
      };
      try { rec.start(1000); } catch (e) { done(new ListenError('recorder', e?.message)); }
    });
  } finally {
    stream?.getTracks().forEach(t => { try { t.stop(); } catch {} });
    try { if (audioSession) audioSession.type = prevSession; } catch {}
  }
}

// Разбор ответа AudD: {артист, название…} | null (не распознано) | исключение с кодом
export function parseAudd(j, httpStatus = 200) {
  if (httpStatus === 429) throw new ListenError('quota', 'http 429');
  if (j?.status === 'success') {
    const r = Array.isArray(j.result) ? j.result[0] : j.result;
    if (!r || !r.title) return null;
    const am = r.apple_music, art = am?.artwork?.url?.replace('{w}x{h}', '600x600') || r.spotify?.album?.images?.[0]?.url || null;
    return { title: r.title, artist: r.artist || '', album: r.album || am?.albumName || '', art, preview: am?.previews?.[0]?.url || null, link: r.song_link || null, timecode: r.timecode || null };
  }
  const code = j?.error?.error_code, msg = j?.error?.error_message || '';
  if (code === 901) throw new ListenError('no-token', msg);
  if (code === 900) throw new ListenError('bad-token', msg);
  if (code === 400) throw new ListenError('too-large', msg);
  if (code === 300 || code === 500 || code === 700) throw new ListenError('bad-audio', msg);
  if (/limit|quota|exceed/i.test(msg)) throw new ListenError('quota', msg);
  throw new ListenError('provider', code ? `${code}: ${msg}` : 'bad response');
}

// Бесплатный iTunes даёт обложку и 30-секундное превью, если сам AudD их не прислал (без токена не присылает)
async function enrichFromItunes(res, fetchFn) {
  try {
    const r = await fetchFn(`${ITUNES}?term=${encodeURIComponent(res.artist + ' ' + res.title)}&entity=song&limit=8`);
    if (!r.ok) return res;
    const { results = [] } = await r.json();
    const a = norm(res.artist), t = norm(res.title);
    const hit = results.find(x => norm(x.trackName).startsWith(t.slice(0, 12)) && (norm(x.artistName).includes(a.split(' ')[0]) || a.includes(norm(x.artistName))));
    if (!hit) return res;
    return { ...res, album: hit.collectionName || res.album, art: res.art || hit.artworkUrl100?.replace('100x100bb', '600x600bb') || null, preview: res.preview || hit.previewUrl || null };
  } catch { return res; }
}

// Распознать готовый короткий клип (до 10 МБ, лучше 8–15 с). → {title, artist, album, art, preview, link, timecode} или null
export async function recognizeBlob(blob, { token = '', fetch: fetchFn = globalThis.fetch?.bind(globalThis), signal, timeoutMs = 45000, enrich = true } = {}) {
  if (!blob?.size) throw new ListenError('bad-audio', 'empty');
  const body = new FormData();
  body.append('file', blob, 'clip.' + extFor(blob.type || ''));
  if (token) { body.append('api_token', token); body.append('return', 'apple_music,spotify'); }
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener?.('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let status, json;
  try {
    const r = await fetchFn(AUDD, { method: 'POST', body, signal: ctl.signal });
    status = r.status;
    json = await r.json().catch(() => null);
  } catch (e) {
    throw signal?.aborted ? new ListenError('aborted') : new ListenError('network', e?.message);
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
  if (!json && status >= 500) throw new ListenError('network', 'http ' + status);
  const res = parseAudd(json, status);
  return res && enrich ? enrichFromItunes(res, fetchFn) : res;
}

// WebM от MediaRecorder не содержит длительности, и у AudD такой клип однажды дал «не распознано»,
// поэтому отправляем обычный WAV. Браузер не смог разобрать запись — отправляем как есть.
async function toUploadClip(blob, decode) {
  try {
    const a = await decode(await blob.arrayBuffer());
    return a.length ? encodeWav(a.getChannelData(0), a.sampleRate) : blob;
  } catch { return blob; }
}

// Главная функция: слушает микрофон и распознаёт. onState('recording'|'recognizing').
// Плеер перед вызовом лучше поставить на паузу, иначе в запись попадёт он сам.
export async function listen({ seconds = 12, token = '', fetch: fetchFn, signal, onState, onProgress, mediaDevices, Recorder, audioSession, decode = defaultDecode } = {}) {
  const deps = {};
  if (mediaDevices !== undefined) deps.mediaDevices = mediaDevices;
  if (Recorder !== undefined) deps.Recorder = Recorder;
  if (audioSession !== undefined) deps.audioSession = audioSession;
  onState?.('recording');
  const blob = await record({ seconds: Math.max(3, Math.min(20, seconds)), signal, onProgress, ...deps });
  onState?.('recognizing');
  const opts = { token, signal };
  if (fetchFn) opts.fetch = fetchFn;
  return recognizeBlob(await toUploadClip(blob, decode), opts);
}

// PCM → WAV 16 бит. Такой формат понимает любой сервис, и кусок не зависит от контейнера исходника.
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}
const SNIPPET_SR = 22050;
const defaultDecode = async ab => new OfflineAudioContext(1, 1, SNIPPET_SR).decodeAudioData(ab);

// Кусок из середины трека → AudD. Для файлов, которых нет в AcoustID. opts как у recognizeBlob + decode для тестов.
export async function recognizeTrack(blob, { seconds = 12, at = 0.3, decode = defaultDecode, ...opts } = {}) {
  let audio;
  try { audio = await decode(await blob.arrayBuffer()); } catch (e) { throw new ListenError('bad-audio', e?.message); }
  const sr = audio.sampleRate, n = Math.min(audio.length, Math.round(seconds * sr));
  const start = Math.max(0, Math.min(audio.length - n, Math.round(audio.length * at)));
  return recognizeBlob(encodeWav(audio.getChannelData(0).subarray(start, start + n), sr), opts);
}
