/* Расстояние до точки (кнопка с линейкой на карте). Куда ведёт указатель:
   - идёт задание - к следующему пикету задания: сначала к первому (ближнему краю диапазона), затем к следующему по ходу;
   - найдены пикеты (поиск) - к первому найденному, дойдя до него (ближе радиуса зачёта) - к следующему;
   - касание любой точки карты переносит указатель на неё (пока кнопка включена).
   На карте - пунктир от вас до точки и плашка с номером, расстоянием и стрелкой направления. */
(() => {
  'use strict';
  const D = {on: false, manual: null, reached: new Set()};
  window.DIST = D;
  const W = () => window.WORK;
  const R = () => (W() && W().radius) || 10;

  function taskTarget() {
    const w = W(), t = w && w.task;
    if (!t || typeof nextPicket !== 'function') return null;
    if (w.last === null && !(GEO.xy)) {                         // нет GPS: просто первый пикет диапазона
      const i = pointIndex(t.p1); if (i < 0) return null;
      return {x: t.points[i], y: t.points[i + 1], line: t.line, picket: t.p1};
    }
    const dir = w.dir, p = nextPicket(); w.dir = dir;            // только узнать следующий: ход задания не меняется
    if (p === null) return null;
    const i = pointIndex(p);
    return i < 0 ? null : {x: t.points[i], y: t.points[i + 1], line: t.line, picket: p};
  }
  function findTarget() {
    const a = FIND.pts || [];
    for (let i = 0; i < a.length; i += 4) {
      const key = a[i + 2] + ':' + a[i + 3];
      if (D.reached.has(key)) continue;
      if (GEO.xy && Math.hypot(a[i] - GEO.xy[0], a[i + 1] - GEO.xy[1]) <= R()) { D.reached.add(key); continue; }   // дошли - к следующему
      return {x: a[i], y: a[i + 1], line: a[i + 2], picket: a[i + 3]};
    }
    return null;
  }
  D.target = () => D.manual || taskTarget() || findTarget();

  function setOn(on) {
    D.on = on; D.manual = null; D.reached.clear();
    $('mDist').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('distChip').hidden = !on;
    if (on) {
      if (!GEO.on && window.geoStart) geoStart();
      if (!D.target()) toast('Коснитесь точки на карте или найдите пикеты: покажу расстояние до них.');
    }
    draw();
  }
  $('mDist').onclick = () => setOn(!D.on);
  /* Касание точки карты при включённой кнопке: указатель переходит на неё */
  D.pick = (x, y, line, picket) => { if (!D.on) return; D.manual = {x, y, line, picket}; draw(); };

  const arrow = deg => `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${Math.round(deg)}deg)" aria-hidden="true"><path d="M8 1.5l4.5 11L8 10l-4.5 2.5z" fill="currentColor"/></svg>`;
  window.distDraw = () => {
    if (!D.on) return;
    const chip = $('distChip'), t = D.target();
    if (!t) { chip.innerHTML = '<span>Выберите точку: коснитесь её на карте</span>'; return; }
    const name = (t.line != null ? 'Л ' + t.line + ' · ' : '') + (t.picket != null ? 'ПП ' + t.picket : 'точка');
    if (!GEO.xy) { chip.innerHTML = `<b>${esc(name)}</b><span>жду GPS…</span>`; drawRing(t); return; }
    const d = Math.hypot(t.x - GEO.xy[0], t.y - GEO.xy[1]);
    const a = toScreen(GEO.xy[0], GEO.xy[1]), b = toScreen(t.x, t.y);
    const deg = Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI;     // направление на экране: 0 - вверх
    ctx.save();
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = '#F0F6FC'; ctx.globalAlpha = .85;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.restore();
    drawRing(t);
    chip.innerHTML = `<b>${esc(name)}</b><span class="dc-m">${fmtM(d)}</span><span class="dc-a">${arrow(deg)}</span>` +
      (D.manual ? '<button type="button" class="dc-x" aria-label="Вернуть указатель к заданию">↺</button>' : '');
  };
  function drawRing(t) {
    const [x, y] = toScreen(t.x, t.y);
    ctx.save(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#58A6FF';
    ctx.beginPath(); ctx.arc(x, y, 13, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fillStyle = '#58A6FF'; ctx.fill();
    ctx.restore();
  }
  $('distChip').addEventListener('click', e => { if (e.target.closest('.dc-x')) { D.manual = null; draw(); } });
})();
