// Инструкция обновляется сама: возможности берутся из features.json, «Что нового» — из истории изменений на GitHub.
(function () {
  var lang = document.documentElement.lang === 'en' ? 'en' : 'ru';

  // кто пригласил: код из ссылки запоминаем, Mix засчитает приглашение, когда друг подключит Telegram
  var ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[a-z0-9]{4,16}$/.test(ref)) {
    try { if (!localStorage.getItem('mixRef')) localStorage.setItem('mixRef', ref); } catch (e) {}
    document.querySelectorAll('a[href="./"]').forEach(function (a) { a.href = './?ref=' + ref; });
  }

  // вкладки платформ: открываем ту, с которой зашли
  var tabs = document.getElementById('ptabs');
  if (tabs) {
    var show = function (p) {
      tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.p === p); });
      document.querySelectorAll('.ppane').forEach(function (d) { d.hidden = d.dataset.p !== p; });
    };
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) show(b.dataset.p); });
    var ua = navigator.userAgent, h = location.hash.slice(1);
    var map = { iphone: 'iphone', android: 'android', mac: 'mac', shortcut: 'pc', pc: 'pc' };
    addEventListener('hashchange', function () { var p = map[location.hash.slice(1)]; if (p) show(p); });
    show(map[h] || (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iphone' : /Android/.test(ua) ? 'android' : /Mac/.test(ua) ? 'mac' : 'pc'));
  }

  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fresh = function (d) { return Date.now() - new Date(d).getTime() < 7 * 864e5; };

  // Что умеет Mix — из features.json (если не загрузилось, остаётся список, вшитый в страницу)
  fetch('features.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (list) {
    var ul = document.getElementById('featList'); if (!list || !ul) return;
    list.sort(function (a, b) { return (b.added || '').localeCompare(a.added || ''); });
    ul.innerHTML = list.map(function (f) {
      return '<li>' + (f[lang] || f.ru) + (fresh(f.added) ? ' <span class="new">' + (lang === 'en' ? 'new' : 'новое') + '</span>' : '') + '</li>';
    }).join('');
  }).catch(function () {});

  // Что нового — последние обновления прямо из истории изменений
  var box = document.getElementById('newsList');
  if (box) fetch('https://api.github.com/repos/Traaarik1/mix-player/commits?per_page=12').then(function (r) { return r.ok ? r.json() : null; }).then(function (cs) {
    if (!Array.isArray(cs)) return;
    var seen = {}, items = [];
    cs.forEach(function (c) {
      var msg = c.commit.message.split('\n')[0], d = c.commit.author.date.slice(0, 10);
      if (/кэш|cache|merge|версия кэша/i.test(msg) || seen[msg]) return; seen[msg] = 1;
      items.push('<li><span class="date">' + d.split('-').reverse().join('.') + '</span> ' + esc(msg) + '</li>');
    });
    if (items.length) { box.innerHTML = items.slice(0, 8).join(''); box.parentElement.hidden = false; }
  }).catch(function () {});
})();
