/* Барабан выбора: список крутится пальцем вверх и вниз, строка по центру выбрана и крупнее остальных.
   openWheel({title, items: [{v, label}], value}) -> Promise: выбранное значение, null - «Все» (сбросить), undefined - закрыли.
   Касание заголовка столбца в таблице открывает барабан со значениями столбца: так фильтруется таблица (js/sheet.js). */
function openWheel({title, items, value}) {
  return new Promise(res => {
    const ROW = 44;
    const veil = document.createElement('div');
    veil.className = 'wheel-veil';
    veil.innerHTML = `<div class="wheel" role="dialog" aria-label="${esc(title)}">` +
      `<div class="wheel-head"><button type="button" class="btn wh-all">Все</button><b>${esc(title)}</b><button type="button" class="btn main wh-ok">Готово</button></div>` +
      `<div class="wheel-box"><div class="wheel-band"></div><div class="wheel-list" tabindex="0">` +
      items.map((it, i) => `<div class="wh-i" data-i="${i}">${esc(it.label)}</div>`).join('') +
      `</div></div><div class="wheel-note">${items.length ? 'Крутите список пальцем, выбранная строка - по центру' : 'В столбце пока нет значений'}</div></div>`;
    document.body.appendChild(veil);
    const list = veil.querySelector('.wheel-list'), rows = [...list.children];
    let cur = Math.max(0, items.findIndex(it => it.v === value)), raf = 0, snapT = 0;
    const paint = () => {
      raf = 0;
      const mid = list.scrollTop / ROW;
      cur = Math.max(0, Math.min(rows.length - 1, Math.round(mid)));
      rows.forEach((r, i) => {
        const d = Math.min(3, Math.abs(i - mid));
        r.style.transform = `scale(${1.22 - d * .12}) rotateX(${(i - mid) * 18}deg)`;
        r.style.opacity = String(1 - d * .26);
        r.classList.toggle('on', i === cur);
      });
    };
    const go = (i, smooth) => list.scrollTo({top: i * ROW, behavior: smooth ? 'smooth' : 'auto'});
    list.addEventListener('scroll', () => {
      if (!raf) raf = requestAnimationFrame(paint);
      clearTimeout(snapT);
      snapT = setTimeout(() => { if (Math.abs(list.scrollTop - cur * ROW) > 1) { go(cur, true); if (window.ui) ui.play('select'); } }, 140);
    }, {passive: true});
    list.addEventListener('click', e => { const r = e.target.closest('.wh-i'); if (r) go(+r.dataset.i, true); });
    list.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); go(Math.min(rows.length - 1, cur + 1), true); }
      if (e.key === 'ArrowUp') { e.preventDefault(); go(Math.max(0, cur - 1), true); }
      if (e.key === 'Enter') done(items[cur] ? items[cur].v : undefined);
    });
    const done = v => { veil.classList.add('closing'); setTimeout(() => veil.remove(), 160); res(v); };
    veil.addEventListener('click', e => { if (e.target === veil) done(undefined); });
    veil.querySelector('.wh-all').onclick = () => done(null);
    veil.querySelector('.wh-ok').onclick = () => done(items.length ? items[cur].v : null);
    requestAnimationFrame(() => { veil.classList.add('on'); go(cur, false); paint(); list.focus({preventScroll: true}); });
    window.WHEEL = {list, veil, pick: i => { go(i, false); paint(); }, ok: () => veil.querySelector('.wh-ok').click(), all: () => veil.querySelector('.wh-all').click()};
  });
}
