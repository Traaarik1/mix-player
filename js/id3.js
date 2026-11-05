// Чтение ID3v2-тегов (название, артист, альбом, обложка) прямо из mp3-файла.
const be32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
const syncsafe = (b, o) => (b[o] & 127) << 21 | (b[o + 1] & 127) << 14 | (b[o + 2] & 127) << 7 | (b[o + 3] & 127);

function text(b, enc) {
  // кодировка 0 по стандарту latin1, но в русских файлах там почти всегда cp1251
  let label = ['windows-1251', 'utf-16le', 'utf-16be', 'utf-8'][enc] || 'utf-8';
  if (enc === 1 && b[0] === 0xFE && b[1] === 0xFF) label = 'utf-16be';
  return new TextDecoder(label).decode(b).replace(/^﻿/, '').split('\0')[0].trim();
}

function picture(b) {
  const enc = b[0];
  const mimeEnd = b.indexOf(0, 1);
  let mime = new TextDecoder().decode(b.subarray(1, mimeEnd)).toLowerCase() || 'image/jpeg';
  if (!mime.includes('/')) mime = 'image/' + (mime === 'jpg' ? 'jpeg' : mime);
  let p = mimeEnd + 2; // пропускаем тип картинки
  if (enc === 1 || enc === 2) { while (p + 1 < b.length && (b[p] || b[p + 1])) p += 2; p += 2; }
  else { while (p < b.length && b[p]) p++; p++; }
  return new Blob([b.slice(p)], { type: mime });
}

export async function readTags(blob) {
  const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
  const ver = head[3];
  if (ver < 3) return {};
  const size = syncsafe(head, 6);
  const b = new Uint8Array(await blob.slice(10, 10 + Math.min(size, 6e6)).arrayBuffer());
  let p = 0;
  if (head[5] & 0x40) p = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4;
  const out = {};
  while (p + 10 <= b.length) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fs = ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
    const body = b.subarray(p + 10, p + 10 + fs);
    p += 10 + fs;
    try {
      if (id === 'TIT2') out.title = text(body.subarray(1), body[0]);
      else if (id === 'TPE1') out.artist = text(body.subarray(1), body[0]);
      else if (id === 'TALB') out.album = text(body.subarray(1), body[0]);
      else if ((id === 'TDRC' || id === 'TYER') && !out.released) out.released = text(body.subarray(1), body[0]).slice(0, 10);
      else if (id === 'APIC' && !out.cover) out.cover = picture(body);
    } catch {}
  }
  return out;
}

// «Artist - Title.mp3» → {artist, title}
export function parseFileName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = base.split(/\s[-–—]\s/);
  return parts.length > 1 ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() } : { artist: '', title: base };
}
