// Офлайн-рендер лава-лампы в видео (оттенки серого). Приложение потом окрашивает его в цвета обложки.
// Запуск: node tools/lava-render.mjs <seed> <секунд> <out.mp4>
// Яркость кодирует материал: 0–0,30 — жидкость (тёмная вверху, светлее у лампочки), 0,52–1 — воск (тень → свет → блик).
import { spawn } from 'node:child_process';

const [seed = 1, secs = 180, out = 'lava.mp4'] = process.argv.slice(2);
const W = 640, H = 360, FPS = 24, STEPS = 60, R = H; // физика — 60 шагов в секунду, кадры — 24 в секунду
let s = +seed * 2654435761 >>> 0;
const rnd = () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---------- физика ----------
const pb = H * .085, pt = H * .055; // уровни нижней и верхней лужи
let mb = 0, mx = W / 2, mt = 0, mtx = W / 2, mound = null, sim = 0;
const balls = [];
const born = () => {
  const top = rnd() < .28 && balls.length > 1;
  mound = { top, x: W * (.1 + rnd() * .8), r: R * (.045 + rnd() ** 1.6 * .085), t: 0, sp: .0028 + rnd() * .0018 };
};
const newBall = (x, y, r, heat) => ({ x, y, vx: 0, vy: 0, r, heat, hr: .0014 + rnd() * .0022, ph: rnd() * 6.3, so: rnd() * 6.3, neck: 0, ax: x, ay: y, wob: .04 + rnd() * .05 });
for (let i = 0; i < 5; i++) balls.push(newBall(W * (.1 + i * .2 + rnd() * .05), H * (.25 + rnd() * .5), R * (.05 + rnd() * .07), i % 2 ? .95 : .05));

function step() {
  sim += 1 / STEPS;
  if (!mound && balls.length < 7 && rnd() < (balls.length < 3 ? .03 : .008)) born();
  if (mound) {
    mound.t += mound.sp;
    const k = Math.min(1, mound.t), amp = mound.r * 1.6 * Math.sin(k * Math.PI / 2);
    if (mound.top) { mt = Math.max(mt * .99, amp); mtx = mound.x; } else { mb = Math.max(mb * .99, amp); mx = mound.x; }
    if (k >= 1) {
      const b = newBall(mound.x, mound.top ? pt + mound.r * .7 : H - pb - mound.r * .7, mound.r, mound.top ? 0 : 1);
      b.neck = 1; b.ax = mound.x; b.ay = mound.top ? pt * .6 : H - pb * .6; // шея тянется от лужи к капле, пока не порвётся
      b.vy = mound.top ? H * .0004 : -H * .0004;
      balls.push(b); mound = null;
    }
  }
  if (!mound) { mb *= .992; mt *= .992; }
  for (let i = balls.length - 1; i >= 0; i--) {
    const p = balls[i], depth = p.y / H;
    p.heat += ((depth > .78 ? 1 : depth < .22 ? 0 : p.heat) - p.heat) * (depth > .78 || depth < .22 ? p.hr * 1.6 : .0003);
    p.vy += H * (.00004 - p.heat * .00008) * (1 + .3 * Math.sin(p.so + sim * .3));
    p.ph += .0045; p.vx += Math.sin(p.ph + p.so) * W * .0000045;
    p.vx *= .982; p.vy *= .982;
    p.x += p.vx; p.y += p.vy;
    if (p.neck > 0) { // шея истончается по мере удаления и рвётся
      const d = Math.abs(p.y - p.ay); p.neck = Math.max(0, 1 - d / (p.r * 3.2));
      if (p.neck < .2) p.neck = Math.max(0, p.neck - .02);
    }
    if (p.x < p.r * .8) { p.x = p.r * .8; p.vx = Math.abs(p.vx) * .3; }
    if (p.x > W - p.r * .8) { p.x = W - p.r * .8; p.vx = -Math.abs(p.vx) * .3; }
    const atTop = p.y <= pt + p.r * .5 && p.heat < .3 && rnd() < .004, atBot = p.y >= H - pb - p.r * .5 && p.heat > .7 && rnd() < .004;
    if ((atTop || atBot) && p.neck === 0 && sim > 2) {
      if (atTop) { mt = Math.max(mt, p.r * 1.3); mtx = p.x; } else { mb = Math.max(mb, p.r * 1.3); mx = p.x; }
      balls.splice(i, 1); continue;
    }
    // у поверхности лужи капля не тонет в ней, а лежит под ней, пока не остынет/не нагреется
    const top0 = pt + p.r * .45, bot0 = H - pb - p.r * .45;
    if (p.y < top0) { p.y = top0; p.vy = Math.max(p.vy, 0) * .5; } if (p.y > bot0) { p.y = bot0; p.vy = Math.min(p.vy, 0) * .5; }
  }
  // слияние: глубоко вошедшие друг в друга капли становятся одной (площадь сохраняется)
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
    const p = balls[i], q = balls[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (d < (p.r + q.r) * .42 && p.r + q.r < R * .2) {
      const a = p.r * p.r, b = q.r * q.r, t = a + b;
      p.x = (p.x * a + q.x * b) / t; p.y = (p.y * a + q.y * b) / t; p.vx = (p.vx * a + q.vx * b) / t; p.vy = (p.vy * a + q.vy * b) / t;
      p.heat = (p.heat * a + q.heat * b) / t; p.r = Math.sqrt(t); balls.splice(j, 1); j--; continue;
    }
    const m = (p.r + q.r) * .7;
    if (d < m) { const f = (m - d) / d * .0015; p.vx -= dx * f; p.vy -= dy * f; q.vx += dx * f; q.vy += dy * f; }
  }
  // большая быстрая капля иногда делится на две
  for (const p of [...balls]) if (p.r > R * .13 && Math.abs(p.vy) > H * .0012 && rnd() < .0015 && balls.length < 7) {
    const r2 = p.r / Math.SQRT2; p.r = r2; const q = newBall(p.x + r2 * .3, p.y - Math.sign(p.vy) * r2 * 1.1, r2, p.heat); q.vy = p.vy * .7; balls.push(q);
  }
}

// ---------- кадр ----------
const prims = new Float32Array(64 * 5); let np = 0;
const put = (x, y, r, sx, sy) => { const o = np * 5; prims[o] = x; prims[o + 1] = y; prims[o + 2] = r * r; prims[o + 3] = 1 / sx; prims[o + 4] = 1 / sy; np++; };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const L0 = Math.hypot(0, .7, .7), LX = 0, LY = .7 / L0, LZ = .7 / L0; // свет снизу
const S0 = Math.hypot(-.35, -.75, .6), SX = -.35 / S0, SY = -.75 / S0, SZ = .6 / S0; // блик сверху-слева
const frame = Buffer.alloc(W * H);
function render() {
  np = 0;
  for (const p of balls) {
    const v = Math.min(1, Math.abs(p.vy) / (H * .0018)), wob = p.wob * Math.sin(p.ph * 1.7 + p.so);
    const flat = p.heat < .3 && p.y < H * .3 ? .14 : 0;
    const sy = 1 + v * .3 + wob - flat, sx = 1 / Math.sqrt(1 + v * .3 + wob) + flat + wob * .3;
    put(p.x, p.y, p.r, sx, sy);
    if (v > .05) { const dir = Math.sign(p.vy) || 1; put(p.x + Math.sin(p.ph) * p.r * .1, p.y - dir * p.r * (.95 + v * .35), p.r * (.3 + .2 * v), .8, 1.25); }
    if (p.neck > 0) for (let k = 1; k <= 4; k++) { const t = k / 5; put(p.ax + (p.x - p.ax) * t, p.ay + (p.y - p.ay) * t, p.r * (.18 + .22 * p.neck) * (1 - Math.abs(t - .5) * .5), 1, 1.3); }
  }
  const t = sim, R0 = H * .035;
  for (let y = 0; y < H; y++) {
    const k = y / H, db = Math.max(H - y, 1), dt = Math.max(y, 1);
    for (let x = 0; x < W; x++) {
      let f = 0, gx = 0, gy = 0;
      for (let i = 0; i < np; i++) {
        const o = i * 5, dx = (x - prims[o]) * prims[o + 3], dy = (y - prims[o + 1]) * prims[o + 4], den = dx * dx + dy * dy + 1, c = prims[o + 2] / den;
        f += c; const g2 = -2 * c / den; gx += g2 * dx * prims[o + 3]; gy += g2 * dy * prims[o + 4];
      }
      const wb = pb * (1 + .06 * Math.sin(x * .011 + t * .25) + .04 * Math.sin(x * .023 - t * .18)) + mb * Math.exp(-(((x - mx) / (H * .1)) ** 2));
      const wt = pt * (1 + .07 * Math.sin(x * .015 - t * .2)) + mt * Math.exp(-(((x - mtx) / (H * .09)) ** 2));
      f += wb * wb / (db * db) + wt * wt / (dt * dt);
      gy += 2 * wb * wb / (db * db * db) - 2 * wt * wt / (dt * dt * dt);
      // жидкость: свет лампочки снизу, конусом от центра
      const cone = Math.exp(-(((x - W / 2) / (W * .38)) ** 2));
      const inside = sm(.94, 1.06, f), halo = sm(.45, .98, f) * (1 - inside);
      const liq = .03 + .12 * k * k + .07 * cone * k + halo * .08; // не выше 0,30
      let L = liq;
      if (f > .9) {
        const edge = 1 - sm(1.1, 2.6, f), sc = R0 / (f + .6) * edge;
        let nx = -gx * sc, ny = -gy * sc, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const diff = .55 + .45 * Math.max(nx * LX + ny * LY + nz * LZ, 0);
        const thick = sm(1, 4.5, f);
        let sh = (.55 + .5 * thick) * diff * (.75 + .5 * k) / 1.35 + .2 * thick * k;
        const dd = 2 * (nx * SX + ny * SY + nz * SZ), rz = dd * nz - SZ; // отражение для блика
        const spec = Math.max(rz, 0) ** 24 * .55;
        const rim = sm(.94, 1.02, f) * (1 - sm(1.02, 1.35, f));
        sh *= 1 - .3 * rim;
        const wax = Math.min(1, .52 + .4 * Math.min(1, sh) + spec); // не ниже 0,52 — с жидкостью не путается
        L = liq + (wax - liq) * inside;
      }
      frame[y * W + x] = Math.max(0, Math.min(255, L * 255 + (rnd() - .5) * 1.5)); // лёгкий дизер против полос
    }
  }
}

// ---------- запись ----------
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-g', String(FPS * 4), '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'inherit', 'inherit'] });
for (let i = 0; i < 40 * STEPS; i++) step(); // разогрев: лампа уже «работает» с первого кадра
const frames = secs * FPS; let acc = 0;
for (let fr = 0; fr < frames; fr++) {
  acc += STEPS / FPS; while (acc >= 1) { step(); acc--; }
  render();
  if (!ff.stdin.write(frame)) await new Promise(r => ff.stdin.once('drain', r));
  if (fr % (FPS * 30) === 0) process.stderr.write(`${out}: ${Math.round(fr / frames * 100)}%\n`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
console.log('done', out);
