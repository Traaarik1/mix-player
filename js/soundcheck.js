// Сверка по звуку без ключей: отпечаток своего файла сравниваем с 30-секундным превью из каталога iTunes.
// Совпало — значит, это действительно та песня, и можно брать её название и оригинальную обложку.
import { searchItunes, norm } from './covers.js';
import { scoreCandidate, cleanName } from './identify.js';

export const SOUND_V = 1;
export const MATCH = .7; // доля совпавших бит; у разных песен около .5

const pop = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };

// Превью — кусок из середины песни: двигаем его по всему треку и берём лучшее наложение
export function similarity(track, part) {
  if (!track?.length || !part?.length) return 0;
  const need = Math.min(part.length, 80); // хотя бы ~10 секунд общего звука
  let best = 0;
  for (let off = need - part.length; off <= track.length - need; off++) {
    let bits = 0, n = 0;
    for (let j = Math.max(0, -off), end = Math.min(part.length, track.length - off); j < end; j++) { bits += pop(track[j + off] ^ part[j]); n++; }
    if (n >= need) { const s = 1 - bits / (n * 32); if (s > best) best = s; }
  }
  return best;
}

// t — трек, blob — его файл. Возвращает { st: 'ok', cand, s } | { st: 'mismatch' } | { st: 'unknown' }
export async function checkSound(t, blob, { rawPrint, maxPreviews = 16 } = {}) {
  const mine = await rawPrint(blob, 420);
  if (!mine?.length) return { st: 'unknown' };
  const tried = new Set();
  let catalogKnows = false;
  async function tryList(query, list, take) {
    const ranked = list.filter(c => c.preview).map(c => ({ c, n: scoreCandidate(query, c, t.duration || 0) })).sort((a, b) => b.n - a.n);
    for (const { c, n } of ranked.slice(0, take)) {
      if (tried.has(c.preview) || tried.size >= maxPreviews) continue;
      tried.add(c.preview);
      if (n >= .78) catalogKnows = true;
      const pb = await fetch(c.preview).then(r => r.ok ? r.blob() : null).catch(() => null);
      const pf = pb ? await rawPrint(pb, 40).catch(() => null) : null;
      const s = pf ? similarity(mine, pf) : 0;
      if (s >= MATCH) return { c, s };
    }
    return null;
  }
  const queries = [t.artist && t.title ? `${t.artist} ${t.title}` : '', cleanName(t.fileName || ''), t.title, t.artist].filter(Boolean);
  for (const q of [...new Set(queries)]) {
    // по названию хватит пары лучших версий; по одному артисту перебираем больше его песен
    const take = q === t.artist ? 8 : 3;
    for (const country of ['RU', 'US']) {
      let list = await searchItunes(q, q === t.artist ? 50 : 10, country).catch(() => []);
      if (q === t.artist) list = list.filter(c => norm(c.artist).includes(norm(t.artist))); // только песни этого артиста
      const hit = await tryList(q, list, take);
      if (hit) return { st: 'ok', cand: hit.c, s: hit.s };
      if (list.length || tried.size >= maxPreviews) break; // в русском каталоге нашлось — американский не нужен
    }
    if (tried.size >= maxPreviews) break;
  }
  // В каталоге есть песня с таким названием, но звучит она иначе — название у файла, скорее всего, неверное
  return { st: catalogKnows ? 'mismatch' : 'unknown' };
}
