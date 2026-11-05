// Тексты песен из LRCLIB (бесплатно, без ключа). Синхронный текст приходит в формате LRC.
const API = 'https://lrclib.net/api';

// LRCLIB под нагрузкой иногда отвечает 503 — пробуем ещё пару раз
async function get(url) {
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if ((r.status !== 503 && r.status !== 429) || i === 3) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

export function parseLRC(lrc) {
  const out = [];
  for (const line of lrc.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) out.push({ t: +s[1] * 60 + parseFloat(s[2].replace(':', '.')), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function shape(x) {
  if (!x) return null;
  if (x.instrumental) return { instrumental: true };
  const synced = x.syncedLyrics ? parseLRC(x.syncedLyrics) : null;
  return synced?.length || x.plainLyrics ? { synced: synced?.length ? synced : null, plain: x.plainLyrics || '' } : null;
}

export async function findLyrics({ title, artist, album, duration }) {
  const p = new URLSearchParams({ track_name: title, artist_name: artist || '' });
  if (album) p.set('album_name', album);
  if (duration) p.set('duration', Math.round(duration));
  const r = await get(`${API}/get?${p}`);
  if (r.ok) { const s = shape(await r.json()); if (s) return s; }
  else if (r.status !== 404) throw new Error('lrclib ' + r.status);
  // приписки вроде «(Radio Edit)» или «[Remastered]» в базе обычно не пишут
  const bare = title.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || title;
  const tries = [{ track_name: bare, artist_name: artist || '' }, { q: `${artist || ''} ${bare}`.trim() }];
  for (const params of tries) {
    const r = await get(`${API}/search?${new URLSearchParams(params)}`);
    if (!r.ok) throw new Error('lrclib ' + r.status);
    const list = await r.json();
    if (!Array.isArray(list)) continue;
    const near = list.filter(x => !duration || Math.abs(x.duration - duration) < 6);
    const pick = shape(near.find(x => x.syncedLyrics) || near.find(x => x.plainLyrics));
    if (pick) return pick;
  }
  return { none: true };
}
