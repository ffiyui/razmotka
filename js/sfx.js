/* Звуки интерфейса - набор UI SFX (https://uisfx.com, звуки CC0, папка sounds/): стиль «mechanical» (щелчки
   переключателей, как в терминале) или «minimal» (почти незаметные). Вызов как в UI SFX: ui.play('checkpoint').
   Где звучит: вход в зону пикета - checkpoint, «Снять пикет здесь» - snap, начало работы - start, пауза и
   продолжение - pause / play, завершение - complete, ошибка - error.
   Настройки - «Настройки» → «Звуки»: включить или выключить, выбрать стиль. */
(() => {
  'use strict';
  const NAMES = ['checkpoint', 'snap', 'start', 'complete', 'pause', 'play', 'error', 'warning', 'success', 'press', 'toggle-on', 'toggle-off', 'select', 'open', 'close'];
  const ALIAS = {click: 'press', tap: 'press'};
  const U = {log: [], ctx: null, buf: new Map(), loading: new Map()};
  const on = () => typeof PREFS === 'undefined' || !PREFS || PREFS.sound !== false;
  const style = () => (typeof PREFS !== 'undefined' && PREFS && PREFS.sound_style === 'minimal' ? 'minimal' : 'mechanical');
  const url = (st, n) => `sounds/${st}/${n}.mp3`;

  function context() {
    if (U.ctx) return U.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { U.ctx = new AC(); } catch (e) { U.ctx = null; }
    return U.ctx;
  }
  /* iPhone пускает звук только после касания: при первом касании звук «разблокируется» */
  const unlock = () => {
    const c = context();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    if (c) { try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); } catch (e) { /* не критично */ } }
    preload();
  };
  ['touchend', 'pointerup', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, {passive: true, once: false}));

  function load(st, n) {
    const key = st + '/' + n;
    if (U.buf.has(key)) return Promise.resolve(U.buf.get(key));
    if (U.loading.has(key)) return U.loading.get(key);
    const c = context();
    if (!c) return Promise.resolve(null);
    const p = fetch(url(st, n)).then(r => r.arrayBuffer())
      .then(a => new Promise((res, rej) => { const q = c.decodeAudioData(a, res, rej); if (q && q.then) q.then(res, rej); }))
      .then(b => { U.buf.set(key, b); return b; }).catch(() => null);
    U.loading.set(key, p);
    return p;
  }
  function preload() { const st = style(); for (const n of ['checkpoint', 'snap', 'start', 'complete', 'pause', 'play', 'error', 'press']) load(st, n); }

  /* Сыграть звук. force - даже если звуки выключены (кнопка «Проверить») */
  U.play = (name, force) => {
    const n = ALIAS[name] || name;
    if (!NAMES.includes(n) || (!force && !on())) return false;
    U.log.push(n); if (U.log.length > 200) U.log.shift();
    const c = context(), st = style();
    if (!c) { try { new Audio(url(st, n)).play().catch(() => {}); } catch (e) { /* без звука */ } return true; }
    if (c.state === 'suspended') c.resume().catch(() => {});
    load(st, n).then(b => {
      if (!b) return;
      try { const s = c.createBufferSource(), g = c.createGain(); g.gain.value = .9; s.buffer = b; s.connect(g); g.connect(c.destination); s.start(0); } catch (e) { /* без звука */ }
    });
    return true;
  };
  window.ui = U;

  // ---------------------------------------------------------------- настройки
  const $ = id => document.getElementById(id);
  async function init() {
    try { if (typeof colorsReady !== 'undefined') await colorsReady; } catch (e) { /* без настроек */ }
    const box = $('sndOn'), sel = $('sndStyle');
    if (!box) return;
    box.checked = on(); sel.value = style(); sel.disabled = !on();
    box.onchange = () => { PREFS.sound = box.checked; sel.disabled = !box.checked; post('/api/prefs', {sound: PREFS.sound}).catch(() => {}); if (box.checked) U.play('toggle-on'); };
    sel.onchange = () => { PREFS.sound_style = sel.value; post('/api/prefs', {sound_style: PREFS.sound_style}).catch(() => {}); preload(); U.play('checkpoint', true); };
    $('sndTest').onclick = () => U.play('checkpoint', true);
  }
  init();
})();
