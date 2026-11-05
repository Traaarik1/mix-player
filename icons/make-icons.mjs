// Генератор иконок Mix: node icons/make-icons.mjs (только встроенные модули Node).
// Два круга как у логотипа в css/app.css: сиреневый и янтарный внахлёст, смешивание screen.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
const BG = hex('#1C1530'), LILAC = hex('#B69CFF'), AMBER = hex('#FFC56B');

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

// Круг диаметром d; сдвиг как в логотипе: ±4 px на круг 30 px. scale — доля стороны иконки на всю пару кругов.
function draw(size, scale) {
  const width = size * scale, d = width / (1 + 8 / 30), r = d / 2, shift = d * 4 / 30, c = size / 2;
  const cover = (x, y, cx) => Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - c) + 0.5)); // сглаживание края
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = cover(x + .5, y + .5, c - shift), b = cover(x + .5, y + .5, c + shift) * .85;
    for (let i = 0; i < 3; i++) {
      let v = BG[i];
      v = 1 - (1 - v) * (1 - LILAC[i] * a);
      v = 1 - (1 - v) * (1 - AMBER[i] * b);
      rgb[(y * size + x) * 3 + i] = Math.round(v * 255);
    }
  }
  return png(size, rgb);
}

const out = new URL('./', import.meta.url);
const icons = { 'icon-192.png': [192, .66], 'icon-512.png': [512, .66], 'maskable-192.png': [192, .54], 'maskable-512.png': [512, .54], 'apple-touch-180.png': [180, .62] };
for (const [name, [size, scale]] of Object.entries(icons)) writeFileSync(new URL(name, out), draw(size, scale));
console.log('готово:', Object.keys(icons).join(', '));
