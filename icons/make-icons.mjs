// Генератор иконок Mix: node icons/make-icons.mjs (только встроенные модули Node).
// Знак как у логотипа в index.html: круг с переливом сиреневый → янтарный и три полоски эквалайзера.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
const BG = hex('#1C1530'), LILAC = hex('#B69CFF'), PINK = hex('#FF8FB8'), AMBER = hex('#FFC56B'), WHITE = hex('#FFFFFF');

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(buf) { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgb) { // RGB, 8 бит, без прозрачности: iOS заливает прозрачное чёрным
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) { rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = v => Math.max(0, Math.min(1, v));
// Перелив по диагонали: сиреневый → розовый → янтарный
const grad = t => t < .5 ? mix(LILAC, PINK, t * 2) : mix(PINK, AMBER, (t - .5) * 2);

// Полоски в координатах знака 0..1 (как в SVG логотипа): x центра, высота
const BARS = [[.34, .34], [.5, .52], [.66, .26]];
function draw(size, scale) {
  const d = size * scale, r = d / 2, c = size / 2, bw = d * .1;
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + .5, py = y + .5;
    const inCircle = clamp(r - Math.hypot(px - c, py - c) + .5);
    const u = (px - (c - r)) / d, v = (py - (c - r)) / d; // 0..1 внутри знака
    let col = mix(BG, grad(clamp((u + v) / 2)), inCircle);
    // скруглённые полоски
    let bar = 0;
    for (const [bx, bh] of BARS) {
      const cx = (c - r) + bx * d, half = bh * d / 2 - bw / 2;
      const dy = Math.max(0, Math.abs(py - c) - half), dist = Math.hypot(px - cx, dy);
      bar = Math.max(bar, clamp(bw / 2 - dist + .5));
    }
    col = mix(col, WHITE, bar * inCircle);
    for (let i = 0; i < 3; i++) rgb[(y * size + x) * 3 + i] = Math.round(col[i] * 255);
  }
  return png(size, rgb);
}

const out = new URL('./', import.meta.url);
const icons = { 'icon-192.png': [192, .74], 'icon-512.png': [512, .74], 'maskable-192.png': [192, .6], 'maskable-512.png': [512, .6], 'apple-touch-180.png': [180, .7] };
for (const [name, [size, scale]] of Object.entries(icons)) writeFileSync(new URL(name, out), draw(size, scale));
console.log('готово:', Object.keys(icons).join(', '));
