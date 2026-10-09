/* Метки на карте (GeoLink): значок из набора (js/icons.js, по темам), подпись и цвет.
   Поставить: кнопка с булавкой на карте, затем касание места (или «Здесь» - по GPS).
   Касание метки - изменить или удалить. Слой «Метки» включается в панели слоёв.
   Хранятся в настройках телефона (PREFS.marks) в координатах листа SPS. */
(() => {
  'use strict';
  const M = {add: false};
  window.MARKS = M;
  const COLORS = ['#F0F6FC', '#58A6FF', '#3FB950', '#D29922', '#F85149', '#BC8CFF', '#DB61A2'];
  const FUEL = ['Лукойл', 'Новатэк', 'Газпром', 'Башнефть', 'Роснефть', 'Татнефть', 'Сургутнефтегаз'];
  const list = () => (Array.isArray(PREFS.marks) ? PREFS.marks : []);
  const save = a => { PREFS.marks = a; post('/api/prefs', {marks: a}).catch(() => {}); draw(); };
  M.list = list;

  function setAdd(on) {
    M.add = on;
    const b = $('mMark'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) toast(GEO && GEO.xy ? 'Коснитесь карты, где поставить метку, или кнопки «Здесь» в окне метки.' : 'Коснитесь карты, где поставить метку.');
  }
  async function edit(m, fresh) {
    const colors = COLORS.map(c => `<label class="mk-c" style="--c:${c}"><input type="radio" name="mkColor" value="${c}"${c === (m.color || COLORS[0]) ? ' checked' : ''} aria-label="Цвет ${c}"><i></i></label>`).join('');
    const extra = `<div class="mk-row"><span class="mk-l">Цвет</span>${colors}</div>` +
      `<div class="mk-row"><span class="mk-l">Топливо</span>${FUEL.map(f => `<button type="button" class="chip mk-fuel">${f}</button>`).join('')}</div>` +
      (fresh && GEO && GEO.xy ? '<label class="tick"><input type="checkbox" id="mkHere"> Поставить там, где я стою (GPS)</label>' : '');
    const r = await askNameIcon(fresh ? 'Новая метка' : 'Метка', m.text || '', m.icon || 'pin', !fresh, extra);
    if (!r) return;
    const a = list().filter(x => x.id !== m.id);
    if (r.remove) { save(a); toast('Метка удалена.'); return; }
    const c = r.form.querySelector('input[name="mkColor"]:checked'), here = r.form.querySelector('#mkHere');
    const n = {...m, text: r.title.slice(0, 60), icon: r.icon, color: c ? c.value : (m.color || COLORS[0])};
    if (here && here.checked && GEO.xy) { n.x = GEO.xy[0]; n.y = GEO.xy[1]; }
    a.push(n); save(a);
  }
  document.addEventListener('click', e => {                   // название компании для бочки - одним касанием
    const b = e.target.closest && e.target.closest('.mk-fuel');
    if (!b || !$('niName')) return;
    $('niName').value = b.textContent;
  });

  /* Касание карты: ставим метку (режим добавления) или открываем ту, что под пальцем */
  window.marksTap = p => {
    if (F.schematic) { if (M.add) { setAdd(false); toast('Метки ставятся только на карте в координатах.'); return true; } return false; }
    if (M.add) {
      setAdd(false);
      const [x, y] = toWorld(p.x, p.y);
      edit({id: 'm' + Date.now().toString(36), x, y, icon: 'pin', text: '', color: COLORS[0], ts: today()}, true);
      return true;
    }
    if (!$('lMarks').checked) return false;
    let best = null, bq = 26 * 26;
    for (const m of list()) {
      const [sx, sy] = toScreen(m.x, m.y), q = (sx - p.x) ** 2 + (sy - p.y) ** 2;
      if (q < bq) { bq = q; best = m; }
    }
    if (!best) return false;
    edit(best, false);
    return true;
  };

  window.marksDraw = () => {
    if (F.schematic || !$('lMarks').checked) return;
    const a = list(); if (!a.length) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    ctx.save();
    ctx.font = '600 11px Inter,system-ui,sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const m of a) {
      const [x, y] = toScreen(m.x, m.y);
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
      const c = m.color || COLORS[0];
      ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.2832); ctx.fillStyle = '#161B22'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = c; ctx.stroke();
      const img = iconImage(m.icon, c, 18);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, x - 9, y - 9, 18, 18);
      if (m.text) {
        const tw = ctx.measureText(m.text).width;
        ctx.fillStyle = 'rgba(13,17,23,.85)'; ctx.beginPath(); ctx.roundRect(x - tw / 2 - 5, y + 17, tw + 10, 16, 4); ctx.fill();
        ctx.fillStyle = c; ctx.fillText(m.text, x, y + 25.5);
      }
    }
    ctx.restore();
  };

  if ($('mMark')) $('mMark').onclick = () => setAdd(!M.add);
  if ($('lMarks')) $('lMarks').onchange = () => draw();
})();
