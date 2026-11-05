// Мини-плеер как виджет на ПК. В Chrome и Edge окно всегда поверх остальных (Document Picture-in-Picture),
// в остальных браузерах это маленькое отдельное окно. Звук остаётся в главной вкладке, её нельзя закрывать.
const W = 340, H = 112;
const CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; overflow: hidden; }
  body { font: 14px/1.3 system-ui, "Segoe UI", sans-serif; color: #F4EFFA; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; padding: 12px;
    background: linear-gradient(120deg, hsl(var(--h) var(--s) 24%), #1C1530 70%); transition: background .8s; user-select: none; }
  #art { width: 88px; height: 88px; border-radius: 10px; object-fit: cover; background: hsl(var(--h) var(--s) 40%); box-shadow: 0 6px 18px rgb(0 0 0 / .45); }
  #meta { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  #t, #a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #t { font-weight: 700; } #a { color: #B9B0CA; font-size: 12.5px; }
  #bar { height: 4px; border-radius: 4px; background: rgb(255 255 255 / .16); overflow: hidden; }
  #fill { height: 100%; width: 0; background: hsl(var(--h) var(--s) 76%); }
  #btns { display: flex; align-items: center; gap: 8px; }
  button { border: 0; background: none; color: #F4EFFA; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; transition: transform .15s; }
  button:hover { transform: scale(1.12); } button:active { transform: scale(.92); }
  #pp { background: #F4EFFA; color: #1C1530; width: 34px; height: 34px; }
  svg { width: 18px; height: 18px; fill: currentColor; }`;
const ICON = {
  prev: '<path d="M19 6.200v11.600a1 1 0 0 1-1.600.8l-8-5.800a1 1 0 0 1 0-1.600l8-5.800a1 1 0 0 1 1.600.8ZM5 5h2.500v14H5z"/>',
  next: '<path d="M5 6.200v11.600a1 1 0 0 0 1.600.8l8-5.800a1 1 0 0 0 0-1.600l-8-5.800A1 1 0 0 0 5 6.200ZM16.500 5H19v14h-2.500z"/>',
  play: '<path d="M8 5.100v13.800a1 1 0 0 0 1.500.9l10.800-6.900a1 1 0 0 0 0-1.700L9.500 4.200A1 1 0 0 0 8 5.100Z"/>',
  pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
};
const svg = n => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;
let win = null;

export const canMini = () => matchMedia('(pointer: fine)').matches;

// actions: {toggle, next, prev}; artOf(track) → адрес картинки или null
export async function openMini(engine, actions, artOf) {
  if (win && !win.closed) { win.focus(); return; }
  if (window.documentPictureInPicture) win = await documentPictureInPicture.requestWindow({ width: W, height: H }).catch(() => null);
  win ??= window.open('', 'mix-mini', `popup,width=${W},height=${H + 30}`);
  if (!win) return false;
  const d = win.document;
  d.title = 'Mix';
  d.head.innerHTML = `<meta charset="utf-8"><style>${CSS}</style>`;
  d.body.innerHTML = `<img id="art" alt=""><div id="meta"><div id="t"></div><div id="a"></div><div id="bar"><div id="fill"></div></div>
    <div id="btns"><button id="pv" title="Назад">${svg('prev')}</button><button id="pp" title="Играть / пауза">${svg('play')}</button><button id="nx" title="Дальше">${svg('next')}</button></div></div>`;
  const $ = id => d.getElementById(id);
  $('pv').onclick = actions.prev; $('pp').onclick = actions.toggle; $('nx').onclick = actions.next;

  const root = document.documentElement.style;
  let artFor = null;
  const paint = async () => {
    if (win.closed) return;
    d.documentElement.style.setProperty('--h', root.getPropertyValue('--h') || 258);
    d.documentElement.style.setProperty('--s', root.getPropertyValue('--s') || '80%');
    const t = engine.track;
    $('t').textContent = t ? t.title : 'Ничего не играет';
    $('a').textContent = t ? t.artist || '' : 'Выбери трек в Mix';
    $('pp').innerHTML = svg(t && !engine.paused ? 'pause' : 'play');
    if (t !== artFor) { artFor = t; const u = t ? await artOf(t) : null; if (u) $('art').src = u; else $('art').removeAttribute('src'); }
  };
  const tick = () => { if (!win.closed) $('fill').style.width = (engine.duration ? engine.position / engine.duration * 100 : 0) + '%'; };
  const timer = setInterval(tick, 500);
  engine.addEventListener('track', paint); engine.addEventListener('state', paint);
  win.addEventListener('pagehide', () => {
    clearInterval(timer);
    engine.removeEventListener('track', paint); engine.removeEventListener('state', paint);
    win = null;
  });
  paint(); tick();
  return true;
}
