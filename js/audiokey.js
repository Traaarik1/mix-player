// Звуковой отпечаток трека (Chromaprint, тот же алгоритм, что у fpcalc) для поиска в AcoustID.
// WASM-сборка лежит в vendor/chromaprint (MIT, @unimusic/chromaprint 0.1.4).
import createModule from '../vendor/chromaprint/chromaprint.js';

let M;
const SR = 11025; // Chromaprint сам работает на этой частоте — декодируем сразу в неё, так меньше памяти

export async function fingerprint(blob) {
  M ??= await createModule();
  let oc;
  try { oc = new OfflineAudioContext(1, 1, SR); } catch { oc = new OfflineAudioContext(1, 1, 44100); } // старый Safari не принимает 11025
  const buf = await oc.decodeAudioData(await blob.arrayBuffer());
  const sr = buf.sampleRate;
  const ch = Math.min(2, buf.numberOfChannels), n = Math.min(buf.length, sr * 120);
  const pcm = new Int16Array(n * ch);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i * ch + c] = Math.max(-1, Math.min(1, d[i])) * 32767;
  }
  const ctx = M._chromaprint_new(1);
  if (!ctx) throw new Error('chromaprint');
  const ptr = M._malloc(pcm.length * 2);
  try {
    M.HEAP16.set(pcm, ptr / 2);
    if (!M._chromaprint_start(ctx, sr, ch) || !M._chromaprint_feed(ctx, ptr, pcm.length) || !M._chromaprint_finish(ctx)) throw new Error('chromaprint');
    const out = M._malloc(4);
    try {
      if (!M._chromaprint_get_fingerprint(ctx, out)) throw new Error('chromaprint');
      const str = M.HEAP32[out / 4];
      const fp = M.UTF8ToString(str);
      M._free(str);
      return { fp, duration: buf.duration };
    } finally { M._free(out); }
  } finally {
    M._free(ptr);
    M._chromaprint_free(ctx);
  }
}
