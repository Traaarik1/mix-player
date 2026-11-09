// Звуковой отпечаток трека (Chromaprint, тот же алгоритм, что у fpcalc) для поиска в AcoustID.
// WASM-сборка лежит в vendor/chromaprint (MIT, @unimusic/chromaprint 0.1.4), считает её отдельный поток.
const SR = 11025; // Chromaprint сам работает на этой частоте — декодируем сразу в неё, так меньше памяти

let worker, seq = 0;
const waiting = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./audiokey-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const w = waiting.get(data.id); waiting.delete(data.id);
    if (data.error) w?.rej(new Error(data.error)); else w?.res(data.fp);
  };
  worker.onerror = e => { for (const w of waiting.values()) w.rej(new Error(e.message || 'worker')); waiting.clear(); worker = null; };
  return worker;
}

// Сырой отпечаток (числа), моно, до maxSec секунд — для сверки с превью
export async function rawPrint(blob, maxSec = 420) {
  let oc;
  try { oc = new OfflineAudioContext(1, 1, SR); } catch { oc = new OfflineAudioContext(1, 1, 44100); }
  const buf = await oc.decodeAudioData(await blob.arrayBuffer());
  const sr = buf.sampleRate, ch = buf.numberOfChannels, n = Math.min(buf.length, Math.round(sr * maxSec));
  const pcm = new Int16Array(n), chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) { let v = 0; for (const d of chans) v += d[i]; pcm[i] = Math.max(-1, Math.min(1, v / ch)) * 32767; }
  const id = ++seq;
  return new Promise((res, rej) => {
    waiting.set(id, { res, rej });
    getWorker().postMessage({ id, pcm, sr, ch: 1, raw: true }, [pcm.buffer]);
  });
}

export async function fingerprint(blob) {
  let oc;
  try { oc = new OfflineAudioContext(1, 1, SR); } catch { oc = new OfflineAudioContext(1, 1, 44100); } // старый Safari не принимает 11025
  const buf = await oc.decodeAudioData(await blob.arrayBuffer());
  const sr = buf.sampleRate, ch = Math.min(2, buf.numberOfChannels), n = Math.min(buf.length, sr * 120);
  const pcm = new Int16Array(n * ch);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i * ch + c] = Math.max(-1, Math.min(1, d[i])) * 32767;
  }
  const id = ++seq;
  const fp = await new Promise((res, rej) => {
    waiting.set(id, { res, rej });
    getWorker().postMessage({ id, pcm, sr, ch }, [pcm.buffer]);
  });
  return { fp, duration: buf.duration };
}
