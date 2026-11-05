// Визуал, который слышит музыку: спектр на холстах и пульс баса в CSS-переменной --beat.
// Звук тут не обрабатывается, только читается. Когда страница скрыта, requestAnimationFrame сам останавливается.
const LOG_POINTS = 56;

function fit(cv) {
  const dpr = Math.min(devicePixelRatio || 1, 1.5), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  return [cv.width, cv.height];
}

// Плавная гора спектра: частоты в логарифме, как их слышит ухо; середина выше краёв и зеркало по центру
function drawSpectrum(cv, levels, hue, sat, alpha) {
  const [w, h] = fit(cv); if (!w || !h) return;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const n = levels.length, pts = [];
  for (let i = 0; i < n * 2 - 1; i++) {
    const v = levels[i < n ? n - 1 - i : i - n + 1];
    pts.push([i / (n * 2 - 2) * w, h - v * h * .92]);
  }
  const path = () => {
    g.beginPath(); g.moveTo(0, h); g.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2, my = (pts[i - 1][1] + pts[i][1]) / 2;
      g.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
    }
    g.lineTo(w, pts.at(-1)[1]); g.lineTo(w, h); g.closePath();
  };
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `hsla(${hue} ${sat}% 72% / ${alpha})`);
  grad.addColorStop(1, `hsla(${hue + 40} ${sat}% 50% / 0)`);
  path(); g.fillStyle = grad; g.fill();
}

export function startVisual(engine) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const full = document.getElementById('full'), vizFull = document.getElementById('vizFull'), vizBar = document.getElementById('vizBar');
  const targets = [full, document.getElementById('bar'), document.querySelector('.ambient'), document.querySelector('.logo-mark')];
  const root = document.documentElement.style;
  let data = null, beat = 0, wasIdle = false;
  const levels = new Float32Array(LOG_POINTS);

  function frame() {
    requestAnimationFrame(frame);
    const an = engine.analyser, live = an && !engine.paused && engine.track;
    if (live) {
      data ??= new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const top = data.length * .7;
      for (let i = 0; i < LOG_POINTS; i++) {
        const a = Math.floor(Math.pow(top, i / LOG_POINTS)), b = Math.max(a + 1, Math.floor(Math.pow(top, (i + 1) / LOG_POINTS)));
        let s = 0; for (let k = a; k < b; k++) s += data[k];
        const v = Math.pow(s / (b - a) / 255, 1.6);
        levels[i] += (v - levels[i]) * (v > levels[i] ? .55 : .14); // быстро вверх, медленно вниз
      }
      let low = 0; const lows = Math.max(2, Math.floor(data.length * .012));
      for (let i = 0; i < lows; i++) low += data[i];
      low = Math.pow(low / lows / 255, 2.2);
      beat = low > beat ? beat + (low - beat) * .6 : beat * .93;
    } else {
      beat *= .9;
      for (let i = 0; i < LOG_POINTS; i++) levels[i] *= .9;
    }
    const idle = !live && beat < .004;
    if (idle && wasIdle) return; // тишина: не тратим батарею
    wasIdle = idle;
    const b = beat.toFixed(3);
    for (const el of targets) el?.style.setProperty('--beat', b);
    document.querySelector('.orb')?.style.setProperty('--beat', b);
    const hue = parseFloat(root.getPropertyValue('--h')) || 258, sat = parseFloat(root.getPropertyValue('--s')) || 80;
    if (vizBar) drawSpectrum(vizBar, levels, hue, sat, .38);
    if (vizFull && full.classList.contains('open')) drawSpectrum(vizFull, levels, hue, sat, .5);
  }
  requestAnimationFrame(frame);

  // Обложка наклоняется за курсором, как настоящая пластинка
  const stack = document.getElementById('stack');
  full.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const r = stack.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / innerWidth, y = (e.clientY - (r.top + r.height / 2)) / innerHeight;
    stack.style.setProperty('--ry', (x * 16).toFixed(2) + 'deg');
    stack.style.setProperty('--rx', (-y * 16).toFixed(2) + 'deg');
  });
  full.addEventListener('pointerleave', () => { stack.style.setProperty('--ry', '0deg'); stack.style.setProperty('--rx', '0deg'); });
}
