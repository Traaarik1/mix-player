// Считает звуковой отпечаток в отдельном потоке, чтобы интерфейс и музыка не подвисали.
import createModule from '../vendor/chromaprint/chromaprint.js';

let M;
self.onmessage = async ({ data: { id, pcm, sr, ch } }) => {
  try {
    M ??= await createModule();
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
        self.postMessage({ id, fp });
      } finally { M._free(out); }
    } finally {
      M._free(ptr);
      M._chromaprint_free(ctx);
    }
  } catch (e) { self.postMessage({ id, error: String(e) }); }
};
