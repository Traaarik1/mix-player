// Свайпы на телефоне: большой плеер закрывается вниз, обложка листает треки, мини-плеер открывается вверх.
const IGNORE = 'button, input, select, a, .track, .lyrics, .menu, .pop';

function drag(el, { onMove, onEnd, ignore = IGNORE }) {
  let s = null;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || e.target.closest(ignore)) return;
    s = { x: e.clientX, y: e.clientY, t: Date.now(), axis: null };
  });
  el.addEventListener('pointermove', e => {
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    // направление решаем один раз, когда палец сдвинулся заметно
    if (!s.axis) { if (Math.hypot(dx, dy) < 10) return; s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
    onMove?.(s.axis, dx, dy);
  });
  const finish = (e, cancelled) => {
    if (!s) return;
    const a = s, dx = e.clientX - a.x, dy = e.clientY - a.y, dt = Math.max(1, Date.now() - a.t);
    s = null;
    if (a.axis) onEnd(a.axis, cancelled ? 0 : dx, cancelled ? 0 : dy, Math.abs(a.axis === 'x' ? dx : dy) / dt);
  };
  el.addEventListener('pointerup', e => finish(e, false));
  el.addEventListener('pointercancel', e => finish(e, true));
}

export function setupGestures({ full, stack, mini, onClose, onOpen, onNext, onPrev }) {
  drag(full, {
    onMove: (axis, dx, dy) => {
      if (axis === 'y' && dy > 0) { full.style.transition = 'none'; full.style.transform = `translateY(${dy}px)`; full.style.borderRadius = '24px 24px 0 0'; }
      if (axis === 'x') { stack.style.transition = 'none'; stack.style.translate = `${dx}px 0`; stack.style.opacity = Math.max(.4, 1 - Math.abs(dx) / 500); }
    },
    onEnd: (axis, dx, dy, speed) => {
      if (axis === 'y') {
        full.style.transition = ''; full.style.borderRadius = '';
        if (dy > 130 || (dy > 40 && speed > .7)) { full.style.transform = ''; onClose(); }
        else full.style.transform = '';
        return;
      }
      const go = Math.abs(dx) > 70 || (Math.abs(dx) > 25 && speed > .6);
      stack.style.transition = 'translate .28s cubic-bezier(.2,.8,.2,1), opacity .28s';
      if (go) {
        stack.style.translate = `${dx < 0 ? -110 : 110}% 0`; stack.style.opacity = 0;
        setTimeout(() => {
          (dx < 0 ? onNext : onPrev)();
          stack.style.transition = 'none'; stack.style.translate = `${dx < 0 ? 40 : -40}% 0`;
          requestAnimationFrame(() => requestAnimationFrame(() => { stack.style.transition = 'translate .35s cubic-bezier(.2,.8,.2,1), opacity .35s'; stack.style.translate = ''; stack.style.opacity = ''; }));
        }, 220);
      } else { stack.style.translate = ''; stack.style.opacity = ''; }
    },
  });
  drag(mini, {
    ignore: 'button, input, .track',
    onMove: (axis, dx) => { if (axis === 'x') { mini.querySelector('.np').style.transition = 'none'; mini.querySelector('.np').style.translate = `${dx * .5}px 0`; } },
    onEnd: (axis, dx, dy) => {
      const np = mini.querySelector('.np');
      np.style.transition = 'translate .25s'; np.style.translate = '';
      if (axis === 'y' && dy < -30) onOpen();
      if (axis === 'x' && Math.abs(dx) > 60) (dx < 0 ? onNext : onPrev)();
    },
  });
}

// Свайп строки вправо: в очередь
// Как в приложениях iPhone: ведёшь пальцем от левого края вправо — экран уезжает, и открывается предыдущий
const EDGE = 26;
export function setupEdgeBack(el, { canBack, onBack }) {
  let s = null;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || e.clientX > EDGE || !canBack()) return;
    s = { x: e.clientX, y: e.clientY, t: Date.now(), on: false };
  });
  el.addEventListener('pointermove', e => {
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) { if (Math.abs(dy) > 14 && Math.abs(dy) > dx) { s = null; return; } if (dx < 12) return; s.on = true; el.style.transition = 'none'; }
    el.style.transform = `translateX(${Math.max(0, dx)}px)`;
  });
  const end = (e, cancel) => {
    if (!s) return;
    const a = s; s = null; if (!a.on) return;
    const dx = cancel ? 0 : e.clientX - a.x, fast = dx / Math.max(1, Date.now() - a.t) > .5;
    el.style.transition = 'transform .2s ease-out';
    if (dx > innerWidth * .33 || (dx > 50 && fast)) {
      el.style.transform = 'translateX(100%)';
      setTimeout(() => { onBack(); el.style.transition = 'none'; el.style.transform = 'translateX(-24px)'; requestAnimationFrame(() => { el.style.transition = 'transform .18s ease-out'; el.style.transform = ''; }); }, 180);
    } else el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; }, 420);
  };
  el.addEventListener('pointerup', e => end(e, false));
  el.addEventListener('pointercancel', e => end(e, true));
}

export function setupRowSwipe(list, onQueue) {
  let s = null;
  const reset = el => { el.style.transition = 'transform .18s ease-out'; el.style.transform = ''; setTimeout(() => { el.style.transition = ''; el.classList.remove('swiping', 'armed'); }, 190); };
  list.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || e.target.closest('button') || e.clientX < EDGE) return; // от края — это «назад», а не очередь
    const el = e.target.closest('.row'); if (el) s = { el, x: e.clientX, y: e.clientY, on: false };
  });
  list.addEventListener('pointermove', e => {
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }
      if (dx < 12) return;
      s.on = true; s.el.classList.add('swiping'); try { s.el.setPointerCapture(e.pointerId); } catch {}
    }
    const x = Math.max(0, Math.min(120, dx));
    s.el.style.transform = 'translateX(' + x + 'px)';
    s.el.classList.toggle('armed', x >= 80);
  });
  const end = cancel => e => {
    if (!s) return;
    const a = s; s = null;
    if (!a.on) return;
    if (!cancel && e.clientX - a.x >= 80) { onQueue(a.el.dataset.id); list.dataset.noclick = '1'; setTimeout(() => delete list.dataset.noclick, 300); }
    else if (!cancel) { list.dataset.noclick = '1'; setTimeout(() => delete list.dataset.noclick, 300); }
    reset(a.el);
  };
  list.addEventListener('pointerup', end(false));
  list.addEventListener('pointercancel', end(true));
}
