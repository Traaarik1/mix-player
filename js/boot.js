// Ловец ошибок запуска: если плеер не стартовал, показываем причину на странице.
// Отдельный файл, а не встроенный скрипт, — чтобы CSP могла запретить встроенные скрипты.
// Если плеер не запустился, показываем причину прямо на странице
(function () {
  var errs = [];
  function show(msg) {
    var b = document.getElementById('bootErr');
    if (!b) {
      b = document.createElement('div'); b.id = 'bootErr';
      b.style.cssText = 'position:fixed;left:16px;right:16px;top:16px;z-index:99;background:#3a1020;color:#ffd7de;border:1px solid #ff8f9f;border-radius:14px;padding:14px 18px;font:14px/1.5 system-ui;white-space:pre-wrap';
      b.title = 'Нажми, чтобы скрыть';
      b.onclick = function () { b.remove(); errs = []; };
      document.body.appendChild(b);
    }
    errs.push(msg); console.error('MIXERR ' + msg);
    b.textContent = 'Плеер сломался. Сделай скриншот этого сообщения и пришли его.\n\n' + errs.join('\n') + '\n\nБраузер: ' + navigator.userAgent;
  }
  window.__mixErr = show;
  // Журнал ошибок на устройстве: последние 80 записей, видно в Настройках. Длинные строки, похожие на ключи, вырезаем.
  function log(kind, msg) {
    try {
      var a = JSON.parse(localStorage.getItem('mixLog') || '[]');
      msg = String(msg).replace(/[A-Za-z0-9+/=_-]{60,}/g, '[скрыто]').slice(0, 600);
      var last = a[a.length - 1];
      if (last && last.m === msg) { last.n = (last.n || 1) + 1; last.at = Date.now(); }
      else a.push({ at: Date.now(), k: kind, m: msg });
      localStorage.setItem('mixLog', JSON.stringify(a.slice(-80)));
    } catch (e) {}
  }
  window.__mixLog = log;
  var warn = console.warn;
  console.warn = function () { try { log('warn', [].map.call(arguments, function (x) { return x && x.message ? x.message : typeof x === 'object' ? JSON.stringify(x) : x; }).join(' ')); } catch (e) {} return warn.apply(console, arguments); };
  addEventListener('error', function (e) {
    var el = e.target;
    if (el && el !== window && (el.src || el.href)) {
      // шрифты и картинки не критичны; ломает плеер только скрипт
      if (el.tagName === 'SCRIPT') show('Не загрузился код плеера: ' + el.src + '. Если стоит блокировщик рекламы, отключи его для этой страницы.');
      return;
    }
    // «Script error.» без файла — чужой скрипт, например расширение браузера: плеер от него не ломается
    if (e.message === 'Script error.' && !e.filename) { console.warn(e.message); return; }
    log('error', e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
    show(e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  }, true);
  addEventListener('unhandledrejection', function (e) {
    var n = e.reason && e.reason.name;
    if (n === 'AbortError' || n === 'NotAllowedError' || n === 'NotSupportedError') return; // браузер прервал звук — это не поломка
    log('error', String(e.reason && (e.reason.stack || e.reason.message) || e.reason));
    show(String(e.reason && (e.reason.stack || e.reason.message) || e.reason));
  });
  setTimeout(function () {
    if (window.__mixReady) return;
    // Обычно это обновление пришло наполовину (часть файлов новые, часть старые): один раз перезагружаемся сами
    var last = 0; try { last = +sessionStorage.getItem('mixRetry') || 0; } catch (e) {}
    if (Date.now() - last > 60000 && location.protocol !== 'file:') { try { sessionStorage.setItem('mixRetry', Date.now()); } catch (e) {} location.reload(); return; }
    show('Код плеера не загрузился за 8 секунд.' + (location.protocol === 'file:' ? ' Страница открыта как файл, открой http://localhost:5173' : '')); }, 8000);
})();
