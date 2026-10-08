/* iPhone и iPad: признаки устройства, видимая область над клавиатурой, панель над клавиатурой при правке ячейки,
   офлайн-оболочка (service worker) и сообщение «Доступна новая версия».
   Подключается после js/geo.js и перед js/app.js. Жесты карты - в js/map.js, таблицы - в js/grid.js, меню - в js/nav.js. */
(() => {
  const body = document.body, root = document.documentElement;

  /* ---------- признаки: сенсорный экран и запуск «с экрана Домой» ---------- */
  const coarse = matchMedia('(pointer:coarse)');
  const markTouch = () => body.classList.toggle('touch', coarse.matches);
  markTouch();
  if (coarse.addEventListener) coarse.addEventListener('change', markTouch);
  const app = matchMedia('(display-mode: standalone)');
  const markApp = () => body.classList.toggle('standalone', app.matches || navigator.standalone === true);
  markApp();
  if (app.addEventListener) app.addEventListener('change', markApp);

  /* ---------- видимая область: клавиатура iOS закрывает низ окна, но не меняет размер страницы ----------
     --vvh: высота видимой области, --vvtop: её смещение, --kb: высота клавиатуры (от неё поднимается панель и сообщения) */
  const vv = window.visualViewport;
  let raf = 0, kbWas = 0;
  const measure = () => {
    raf = 0;
    let h = window.innerHeight, top = 0, kb = 0;
    if (vv && Math.abs(vv.scale - 1) < .01) { h = vv.height; top = vv.offsetTop; kb = Math.max(0, window.innerHeight - vv.offsetTop - vv.height); }
    root.style.setProperty('--vvh', Math.round(h) + 'px');
    root.style.setProperty('--vvtop', Math.round(top) + 'px');
    root.style.setProperty('--kb', Math.round(kb) + 'px');
    body.classList.toggle('kbd', kb > 100);
    if (kbWas > 100 && kb <= 100) window.scrollTo(0, 0);        // клавиатура ушла: iOS мог оставить страницу сдвинутой
    kbWas = kb;
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(measure); };
  measure();
  if (vv) { vv.addEventListener('resize', later); vv.addEventListener('scroll', later); }
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', () => setTimeout(later, 200));

  /* ---------- панель над клавиатурой: ‹ › ▲ ▼ и «Готово» (в index.html #gxAcc) ---------- */
  const acc = document.getElementById('gxAcc'), accT = document.getElementById('gxAccT');
  let accGrid = null, lastTouch = 0;
  document.addEventListener('gx-edit', e => {
    const d = e.detail;
    if (!matchMedia('(pointer:coarse)').matches) return;       // с мышью панель не нужна
    if (d.on) { accGrid = d.grid; accT.textContent = d.title; body.classList.add('accbar'); }
    else if (accGrid === d.grid) { accGrid = null; body.classList.remove('accbar'); }
  });
  const press = e => {
    const b = e.target.closest('button');
    if (!b || !accGrid) return;
    if (b.dataset.k === 'done') accGrid.commitEdit(); else accGrid.touchStep(b.dataset.k);
  };
  // Поле ввода не должно терять фокус, иначе клавиатура спрячется: перехватываем нажатие и действуем по отпусканию пальца
  acc.addEventListener('pointerdown', e => e.preventDefault());
  acc.addEventListener('mousedown', e => e.preventDefault());
  acc.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') { lastTouch = Date.now(); press(e); } });
  acc.addEventListener('click', e => { if (Date.now() - lastTouch > 600) press(e); });

  /* ---------- всплывающая палитра: касание вне её закрывает (iOS не всегда присылает mousedown по пустому месту) ---------- */
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const p = document.querySelector('.palette');
    if (p && !p.contains(e.target)) p.remove();
  }, true);

  /* ---------- офлайн-оболочка и обновление ---------- */
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const remote = /[?&]remote\b/.test(location.search);           // ?remote: проверка на настоящем сервере, без кэша
  if ('serviceWorker' in navigator && !remote && !window.NATIVE && (location.protocol === 'https:' || (location.protocol === 'http:' && local))) {
    const bar = document.getElementById('updBar');
    // Перед перезагрузкой дописываем на сервер всё, что ещё не сохранено
    const settle = async () => {
      try { await Promise.all(Object.values(window.Sheets ? Sheets.pages : {}).map(p => p.flush && p.flush())); } catch (err) { /* не мешаем обновлению */ }
    };
    navigator.serviceWorker.register('sw.js').then(reg => {
      const offer = () => {
        if (!navigator.serviceWorker.controller) return;       // первая установка: предлагать нечего
        bar.classList.add('on');
        document.getElementById('updX').onclick = () => bar.classList.remove('on');
        document.getElementById('updGo').onclick = async () => {
          const w = reg.waiting;
          await settle();
          if (!w) return location.reload();
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once: true});
          w.postMessage({type: 'SKIP_WAITING'});
        };
      };
      if (reg.waiting) offer();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(); });
      });
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 3600e3);
    }).catch(() => { /* без офлайн-режима программа работает как обычно */ });
  }
})();
