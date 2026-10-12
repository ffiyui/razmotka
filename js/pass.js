/* Пароль входа GeoLink. Пароль лежит в файле password.txt в корне сайта (репозитория): поменяйте в нём строку.
   - Первый запуск: приложение спрашивает пароль. Верный пароль запоминается на телефоне, дальше не спрашивается.
   - При каждом запуске с интернетом приложение читает password.txt; если пароль в файле поменяли - спрашивает снова.
   - Без интернета пароль не спрашивается (кроме самого первого запуска, если файл не прочитать - тогда пароль 1234). */
(() => {
  'use strict';
  const KEY = 'gl_pass', DEFAULT = '1234';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  /* В приложении Android страница лежит внутри самого приложения: свежий пароль берётся с сайта (GitHub Pages) */
  const NATIVE_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const SITE = 'https://ffiyui.github.io/razmotka/password.txt';
  const read = () => fetch((NATIVE_APP ? SITE : 'password.txt') + '?t=' + Date.now(), {cache: 'no-store'})
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status)))).then(t => t.split(/\r?\n/)[0].trim());

  function gate(want, again) {
    const el = document.createElement('div');
    el.className = 'pass-veil'; el.id = 'passGate';
    el.innerHTML = `<form class="pass-box" autocomplete="off">` +
      `<img class="pass-logo" src="icons/icon-192.png" width="72" height="72" alt="">` +
      `<h2>GeoLink</h2><p>${again ? 'Пароль изменился. Введите новый пароль.' : 'Введите пароль, чтобы начать работу.'}</p>` +
      `<input type="password" id="passIn" inputmode="numeric" autocomplete="off" aria-label="Пароль" placeholder="Пароль">` +
      `<div class="pass-err" id="passErr"></div><button type="submit" class="btn main">Войти</button></form>`;
    document.body.appendChild(el);
    document.documentElement.classList.add('locked');
    const inp = el.querySelector('#passIn');
    setTimeout(() => inp.focus(), 60);
    el.querySelector('form').onsubmit = e => {
      e.preventDefault();
      if (inp.value.trim() === want) {
        try { localStorage.setItem(KEY, want); } catch (err) { /* без памяти браузера спросит снова */ }
        el.remove(); document.documentElement.classList.remove('locked');
        return;
      }
      el.querySelector('#passErr').textContent = 'Неверный пароль';
      el.querySelector('.pass-box').classList.remove('shake'); void el.offsetWidth; el.querySelector('.pass-box').classList.add('shake');
      inp.select();
    };
  }
  window.PASS = {
    ready: (async () => {
      let cur = null;
      if (navigator.onLine !== false) { try { cur = await read(); } catch (e) { cur = null; } }
      if (cur === null && saved === null && NATIVE_APP) {                  // приложение без сети при первом запуске: пароль из самого приложения
        try { cur = (await (await fetch('password.txt')).text()).split(/\r?\n/)[0].trim(); } catch (e) { cur = null; }
      }
      if (saved === null) { if (!document.body) await new Promise(r => document.addEventListener('DOMContentLoaded', r, {once: true})); gate(cur || DEFAULT, false); }
      else if (cur && cur !== saved) { if (!document.body) await new Promise(r => document.addEventListener('DOMContentLoaded', r, {once: true})); gate(cur, true); }
    })(),
  };
})();
