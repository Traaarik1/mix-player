// Язык страницы «О Mix»: ?lang=ru|en, затем сохранённый выбор, затем язык браузера
(function () {
  var q = new URLSearchParams(location.search).get('lang'), saved = null;
  try { saved = localStorage.getItem('mixAboutLang'); } catch (e) {}
  var lang = q || saved || (/^ru|^uk|^be|^kk/i.test(navigator.language || '') ? 'ru' : 'en');
  var btn = document.getElementById('lang');
  function set(l) {
    document.documentElement.lang = l;
    btn.textContent = l === 'ru' ? 'EN' : 'RU';
    try { localStorage.setItem('mixAboutLang', l); } catch (e) {}
  }
  btn.addEventListener('click', function () { set(document.documentElement.lang === 'ru' ? 'en' : 'ru'); });
  set(lang === 'ru' ? 'ru' : 'en');
})();
