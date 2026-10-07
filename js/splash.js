/* Заставка при запуске программы: поле разматывается и подматывается, название появляется по буквам.
   Показывается один раз на окно (при обновлении страницы не повторяется). Щелчок закрывает её сразу.
   Адрес с ?splash показывает заставку принудительно. */
const Splash = (() => {
  const el = document.getElementById('splash');
  const forced = /[?&]splash\b/.test(location.search);
  let seen = false;
  try { seen = sessionStorage.getItem('splash') === '1'; } catch (err) { /* показываем */ }
  if (!el || (!forced && (seen || navigator.webdriver))) {      // повторный показ и автоматические проверки - без заставки
    if (el) el.remove();
    return {step() {}, title() {}, done() {}};
  }
  try { sessionStorage.setItem('splash', '1'); } catch (err) { /* не критично */ }

  /* Рисунок: профили поля. Оранжевая бригада разматывает линию за линией, синяя следом подматывает. */
  const LINES = 11, W = 560, H = 272;
  let svg = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><g transform="rotate(-8 ${W / 2} ${H / 2})">`;
  for (let i = 0; i < LINES; i++) {
    const y = 51 + i * 17, x0 = 54 + (i % 3) * 10 + i * 3, x1 = W - 70 + (i % 2) * 14 - (LINES - i) * 2, len = x1 - x0;
    const d = `animation-delay:${(i * 0.11).toFixed(2)}s`;
    svg += `<line class="sp-base" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>` +
      `<line class="sp-laid" pathLength="100" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" style="${d}"/>` +
      `<circle class="sp-razm" cx="${x0}" cy="${y}" r="4.6" style="--len:${len};${d}"/>` +
      `<circle class="sp-podm" cx="${x0}" cy="${y}" r="4.6" style="--len:${len};${d}"/>`;
  }
  document.getElementById('spArt').innerHTML = svg + '</g></svg>';

  const started = Date.now(), MIN = 1500, STEP = 300, queue = [];     // быстрая загрузка: не дольше 1,5 с
  let closed = false, timer = 0;
  const next = () => {
    const item = queue.shift();
    if (!item || closed) { clearInterval(timer); timer = 0; return; }
    document.getElementById('spStatus').textContent = item[0];
    document.getElementById('spBar').style.width = Math.round(item[1] * 100) + '%';
  };
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 340);
  };
  el.addEventListener('click', close);

  return {
    /* Название по буквам; номер партии выделен цветом */
    title(brand, sp, sub) {
      const t = document.getElementById('spTitle');
      if (!t || closed) return;
      let n = 0;
      const word = (w, cls) => `<span class="sp-word${cls ? ' ' + cls : ''}">` +
        [...w].map(ch => `<i style="animation-delay:${(n++ * 0.042).toFixed(3)}s">${ch.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]))}</i>`).join('') + '</span>';
      t.innerHTML = String(brand).split(/\s+/).filter(Boolean).map(w => word(w)).join(' ') + ' ' + word(String(sp), 'sp');
      t.setAttribute('aria-label', brand + ' ' + sp);
      if (sub) document.getElementById('spSub').textContent = sub;
    },
    /* Шаги загрузки показываются по очереди, каждый не меньше STEP мс: иначе они мелькают незаметно */
    step(text, part) {
      queue.push([text, part]);
      if (!timer) { next(); timer = setInterval(next, STEP); }
    },
    /* Программа готова: заставка уходит, когда показаны все шаги и прошло не меньше MIN мс */
    done() {
      const wait = () => (queue.length ? setTimeout(wait, 120) : setTimeout(close, Math.max(350, MIN - (Date.now() - started))));
      wait();
    },
  };
})();
