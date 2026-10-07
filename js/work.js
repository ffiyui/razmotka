/* Работа в поле на телефоне. Подключается после js/map.js и js/geo.js.
   - задания: список на листах «Размотка», «Подмотка», «Разбивка» и кнопка «На карте»;
   - задание на карте: диапазон светится; у пикетов без координат место посчитано (engine/reports.js, Coords.est);
   - выполнение: «Начать …», пикет засчитывается в 10 метрах от него, видно процент, пауза, «Завершить …»;
   - «кто работает на этом телефоне»: галочка у фамилии на вкладках ID;
   - треки: запись своего пути кнопкой на карте, вкладка «Треки»;
   - поиск пикетов на карте и контуры DXF, пришедшие с файлом проекта;
   - файл проекта: сохранение и загрузка с табло «кто сколько выполнил». */

const NEAR = 10;                               // м: пикет считается пройденным, когда человек вошёл в этот круг
const VERB = {razm: 'размотку', podm: 'подмотку', razb: 'разбивку'};
const pad2 = n => String(n).padStart(2, '0');
const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);   // без мигания
const fmtM = m => (m >= 1000 ? (Math.round(m / 10) / 100).toLocaleString('ru-RU') + ' км' : nf(Math.round(m)) + ' м');
const rangeText = (a, b) => (a === b ? String(a) : a + '–' + b);
const meName = () => (PREFS.me && PREFS.me.name) || '';

/* Показать на карте прямоугольник. b - границы в повёрнутых координатах вида (как у bounds(..., true)) */
function showBox(b, span) {
  const r = $('mapBox').getBoundingClientRect(), pad = Math.min(70, r.width / 6);
  const top = $('findBox').hidden ? 0 : Math.min($('findBox').offsetHeight + 16, r.height / 3);
  const bottom = $('taskBar').hidden ? 0 : Math.min($('taskBar').offsetHeight + 12, r.height / 3);
  const w = Math.max(b.x1 - b.x0, span || 1), h = Math.max(b.y1 - b.y0, (span || 1) * .6);
  V.s = Math.min((r.width - 2 * pad) / w, (r.height - top - bottom - 2 * pad) / h);
  V.ox = r.width / 2 - (b.x0 + b.x1) / 2 * V.s;
  V.oy = top + (r.height - top - bottom) / 2 + (b.y0 + b.y1) / 2 * V.s;
  moved(); draw();
}

/* ---------- кто работает на этом телефоне ---------- */
/* Галочка у фамилии на вкладке «ID старших» или «ID топографов». По ней отбираются «мои» задания и называется файл проекта. */
function setMe(name, list) {
  PREFS.me = name ? {name, list} : null;
  post('/api/prefs', {me: PREFS.me}).catch(() => {});
  for (const p of Object.values(Sheets.pages)) if (p.loaded) workSheetHook(p);
  if (typeof prjFill === 'function') prjFill();
}
function peopleBox(page) {
  let box = page.el.querySelector('.mebox');
  if (!box) {
    box = document.createElement('div'); box.className = 'mebox';
    page.el.querySelector('.sh-tools').before(box);
    box.onchange = e => { const n = e.target.dataset.name; if (n !== undefined) setMe(e.target.checked ? n : '', page.name); };
  }
  const names = [...new Set(page.grid.rows.map(r => r.v[1]).filter(n => n !== null && String(n).trim() !== '').map(n => String(n).trim()))];
  const me = meName().toLowerCase(), html = names.length
    ? `<span class="me-t">Кто работает на этом телефоне:</span>` + names.map(n => `<label class="me-chip${n.toLowerCase() === me ? ' on' : ''}">` +
        `<input type="checkbox" data-name="${esc(n)}"${n.toLowerCase() === me ? ' checked' : ''}>${esc(n)}</label>`).join('')
    : '';
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

/* ---------- задания на листах работ ---------- */
function tasksBox(page) {
  let box = page.el.querySelector('.tkbox');
  if (!box) {
    box = document.createElement('details'); box.className = 'tkbox';
    box.innerHTML = '<summary></summary><div class="tklist"></div>';
    page.el.querySelector('.sh-tools').before(box);
    box.onclick = e => {
      const b = e.target.closest('button[data-task]');
      if (b) { e.preventDefault(); page.flush().then(ok => { if (ok !== false) showTask(page.name, +b.dataset.task); }); }
    };
    box.onchange = e => { if (e.target.classList.contains('tk-mine')) { remember('tk_mine', e.target.checked ? '1' : '0'); workSheetHook(page); } };
    box.addEventListener('toggle', () => { remember('tk_open_' + page.name, box.open ? '1' : '0'); page.grid.layout(); page.grid.render(); });
    box.open = remember('tk_open_' + page.name) === '1';
  }
  const g = page.grid, ix = g.ix, me = meName().toLowerCase(), unit = page.meta.unit === 'пикет' ? 'пик.' : 'кан.';
  const all = g.rows.filter(r => !r.done && !g.isBlank(r) && r.v[ix.line] !== null && r.v[ix.p1] !== null && r.v[ix.p2] !== null);
  const isMine = r => String(r.v[ix.worker] || '').trim().toLowerCase() === me;
  const mine = me ? all.filter(isMine) : [], only = mine.length > 0 && remember('tk_mine') !== '0', list = only ? mine : all;
  const key = JSON.stringify([list.map(r => [r.id, r.v, r.from]), me, only, all.length]);
  box.hidden = !all.length;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.querySelector('summary').innerHTML = `Задания: <b>${nf(all.length)}</b>` + (me && mine.length ? ` <span>мои: ${nf(mine.length)}</span>` : '') +
    (me && mine.length ? `<label class="tick tk-mine-l"><input type="checkbox" class="tk-mine"${only ? ' checked' : ''}> только мои</label>` : '');
  box.querySelector('.tklist').innerHTML = list.map(r => {
    const a = Math.min(r.v[ix.p1], r.v[ix.p2]), b = Math.max(r.v[ix.p1], r.v[ix.p2]);
    return `<div class="tkrow${me && isMine(r) ? ' mine' : ''}"><div class="tk-t"><b>Л ${r.v[ix.line]} · ПП ${rangeText(a, b)}</b>` +
      `<span>${nf(b - a + 1)} ${unit} · ${esc(g.text(r, ix.date))} · ${esc(r.v[ix.worker] === null ? 'исполнитель не указан' : r.v[ix.worker])}${r.from ? ' · из файла' : ''}</span></div>` +
      (r.id ? `<button type="button" class="btn small" data-task="${r.id}">На карте</button>` : '') + `</div>`;
  }).join('');
}
function workSheetHook(page) {
  if (page.work) tasksBox(page);
  else if (page.meta.kind === 'workers') peopleBox(page);
}

/* ---------- задание на карте и его выполнение ---------- */
const W = {task: null, visited: new Set(), state: 'idle', near: null, timer: 0};   // state: idle | run | pause
window.WORK = W;
const taskColor = () => cssVar({razm: '--razm', podm: '--blue', razb: '--razb'}[W.task.sheet]) || '#007AFF';
const taskName = t => `${t.title} · Л ${t.line} · ПП ${rangeText(t.p1, t.p2)}`;
/* Ход выполнения записывается сразу: телефон может выгрузить приложение в любую минуту */
function saveSession() {
  post('/api/prefs', {session: W.task ? {sheet: W.task.sheet, id: W.task.id, visited: [...W.visited], state: W.state} : null}).catch(() => {});
}
function taskTotal() { return W.task.points.length / 4; }
function renderTask() {
  const bar = $('taskBar'), t = W.task;
  bar.hidden = !t;
  if (!t) return;
  const n = taskTotal(), done = W.visited.size, verb = VERB[t.sheet], unit = t.unit === 'пикет' ? ['пикет', 'пикета', 'пикетов'] : ['канал', 'канала', 'каналов'];
  $('tkTitle').textContent = taskName(t);
  bar.style.setProperty('--tk', taskColor());
  let sub;
  if (W.state === 'idle') {
    sub = `${nf(n)} ${plural(n, ...unit)}` + (t.worker ? ' · ' + t.worker : '') +
      (t.est ? ` · место ${t.est === n ? 'задания' : nf(t.est) + ' ' + plural(t.est, 'пикета', 'пикетов', 'пикетов')} посчитано примерно: координат в SPS нет` : '') +
      (t.missing ? ` · не показано ${nf(t.missing)}: место определить не по чему` : '');
  } else {
    sub = `Пройдено ${nf(done)} из ${nf(n)} · ${Math.floor(done * 100 / n)} %`;
    if (W.state === 'pause') sub += ' · пауза';
    else if (W.near) sub += ` · до ПП ${W.near.picket} — ${fmtM(W.near.dist)}`;
    else if (GEO.err) sub += ' · ' + GEO.err;
    else if (!GEO.xy) sub += ' · жду GPS…';
  }
  $('tkSub').textContent = sub;
  $('tkProg').hidden = W.state === 'idle';
  $('tkFill').style.width = (n ? done * 100 / n : 0) + '%';
  $('tkGo').hidden = W.state !== 'idle'; $('tkGo').textContent = 'Начать ' + verb;
  $('tkPause').hidden = W.state === 'idle'; $('tkPause').textContent = W.state === 'pause' ? 'Продолжить' : 'Пауза';
  $('tkEnd').hidden = W.state === 'idle'; $('tkEnd').textContent = 'Завершить ' + verb;
}
/* Свечение задания «дышит»: карта перерисовывается несколько раз в секунду, пока задание на экране */
function glow() {
  clearTimeout(W.timer);
  if (!W.task || still || document.hidden || !$('p-field').classList.contains('on')) return;
  draw();
  W.timer = setTimeout(glow, W.state === 'run' ? 250 : 90);
}
function zoomTask() {
  const p = W.task.points, flat = [];
  for (let i = 0; i < p.length; i += 4) flat.push(p[i], p[i + 1]);
  showBox(bounds([[flat, 2]], true), 220);
}
/* Показать задание на карте. keep - восстановленное состояние прошлого сеанса */
async function showTask(sheet, id, keep) {
  if (W.task && W.state !== 'idle' && !(W.task.sheet === sheet && W.task.id === id) && !keep) {
    if (!await ask('Задание выполняется', `<p>Сейчас идёт «${esc(taskName(W.task))}»: пройдено ${nf(W.visited.size)} из ${nf(taskTotal())}. Если открыть другое задание, пройденное не запишется.</p>`, 'Открыть другое')) return;
  }
  let t;
  try { t = await api(`/api/task?sheet=${sheet}&id=${id}`); } catch (e) { t = {error: 'Задание не открылось.'}; }
  if (t.error) { if (!keep) toast(t.error); return; }
  if (!t.points.length) return toast('Место задания определить не по чему: в листе SPS нет ни одного пикета рядом. Загрузите файл проекта с листом SPS.');
  const same = W.task && W.task.sheet === sheet && W.task.id === id;
  W.task = t;
  if (keep) { W.visited = new Set(keep.visited || []); W.state = keep.state === 'idle' ? 'idle' : 'pause'; }
  else if (!same) { W.visited = new Set(); W.state = 'idle'; }
  W.near = null;
  saveSession();
  if (keep) { renderTask(); glow(); return; }
  if (location.hash !== '#field') history.pushState(null, '', '#field');
  await show('field');
  renderTask();
  if (document.body.classList.contains('touch') && typeof setFull === 'function') { setFull(true); await new Promise(r => setTimeout(r, 60)); }   // на телефоне - карта во весь экран
  zoomTask(); glow();
  if (t.est) toast('Координат этих пикетов в SPS нет: место на карте посчитано по соседним пикетам и линиям.');
}
function dropTask() { W.task = null; W.visited = new Set(); W.state = 'idle'; W.near = null; saveSession(); renderTask(); draw(); }
function startTask() {
  if (!W.task) return;
  if (F.schematic) return toast('Карта нарисована схемой без координат: идти по ней нельзя. Нужен лист SPS.');
  W.state = 'run';
  if (!GEO.on && window.geoStart) geoStart();
  saveSession(); renderTask(); glow();
  toast('Идите по пикетам: пикет засчитывается в ' + NEAR + ' метрах от него.');
}
/* Новое положение с GPS: трек и пикеты задания в круге 10 м */
function workFix(xy, acc, ts) {
  trackFix(xy, ts);
  if (!W.task || W.state !== 'run' || !(acc <= 50)) return;
  const p = W.task.points;
  let added = 0, best = null;
  for (let i = 0; i < p.length; i += 4) {
    if (W.visited.has(p[i + 2])) continue;
    const d = Math.hypot(p[i] - xy[0], p[i + 1] - xy[1]);
    if (d <= NEAR) { W.visited.add(p[i + 2]); added++; }
    else if (!best || d < best.dist) best = {picket: p[i + 2], dist: d};
  }
  W.near = best;
  if (added) {
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* не критично */ }
    saveSession();
    if (W.visited.size === taskTotal()) toast('Все пикеты задания пройдены. Нажмите «Завершить ' + VERB[W.task.sheet] + '».');
  }
  renderTask();
}
window.workFix = workFix;
window.workStatus = () => { if (W.task && W.state !== 'idle') renderTask(); };      // ошибка GPS видна прямо на плашке задания
function runsOf(numbers) {
  const out = [];
  for (const n of [...numbers].sort((a, b) => a - b)) { const l = out[out.length - 1]; if (l && l[1] === n - 1) l[1] = n; else out.push([n, n]); }
  return out;
}
async function finishTask() {
  const t = W.task, n = taskTotal(), done = W.visited.size, verb = VERB[t.sheet];
  if (!done) {
    if (await ask('Ничего не пройдено', `<p>Вы не вошли в круг ${NEAR} м ни у одного пикета задания. Закончить без записи в журнал?</p>`, 'Закончить')) { W.state = 'idle'; W.visited = new Set(); saveSession(); renderTask(); draw(); }
    return;
  }
  const runs = runsOf(W.visited), walked = runs.map(r => 'от ' + r[0] + ' до ' + r[1]).join(', ');
  const all = done === n && !t.missing;
  const text = all
    ? `<p>Задание пройдено полностью: линия ${t.line}, ПП ${rangeText(t.p1, t.p2)}, ${nf(done)}. Внести в журнал?</p>`
    : `<p>Вы прошли ${esc(walked)} (${nf(done)} из ${nf(n + t.missing)}). Внести изменения вашего задания в журнал?</p>` +
      (runs.length > 1 ? `<p>Задание разделится на диапазоны: пройденные будут записаны как выполненные, остальные останутся заданием.</p>` : `<p>Непройденная часть останется заданием.</p>`);
  const was = W.state;
  W.state = 'pause'; renderTask();
  const answer = ask('Завершить ' + verb + '?', text, 'Да', false);
  $('dNo').textContent = 'Нет';
  const yes = await answer;
  $('dNo').textContent = 'Отмена';
  if (!yes) { W.state = was; renderTask(); glow(); return; }
  const body = {sheet: t.sheet, id: t.id, visited: [...W.visited]};
  let j = await post('/api/task/done', body);
  if (j.warnings) {
    if (!await ask('Проверьте данные', '<p>В задании есть спорные места:</p><ul>' + j.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>', 'Всё равно внести')) return;
    j = await post('/api/task/done', {...body, force: true});
  }
  if (j.error) return toast(j.error);
  const u = j.unit === 'пикет' ? picketWord(j.units) : chanWord(j.units);
  W.task = null; W.visited = new Set(); W.state = 'idle'; saveSession(); renderTask();
  for (const p of Object.values(Sheets.pages)) if (p.work) dirty[p.name] = true;
  await changed(true);
  toast(`Внесено в журнал: ${u}` + (j.left.length ? `. Осталось заданием: ПП ${j.left.map(r => rangeText(r[0], r[1])).join(', ')}` : '') + '.');
}
$('tkGo').onclick = startTask;
$('tkPause').onclick = () => { W.state = W.state === 'pause' ? 'run' : 'pause'; if (W.state === 'run' && !GEO.on && window.geoStart) geoStart(); saveSession(); renderTask(); glow(); };
$('tkEnd').onclick = finishTask;
$('tkClose').onclick = async () => {
  if (W.state !== 'idle' && W.visited.size && !await ask('Убрать задание?', `<p>Пройдено ${nf(W.visited.size)} из ${nf(taskTotal())}. Если убрать задание с карты, пройденное не запишется в журнал.</p>`, 'Убрать')) return;
  dropTask();
};
/* Касание карты, пока задание показано и не начато: предложение начать работу */
function workTap() {
  if (!W.task || W.state !== 'idle' || F.schematic) return false;
  const t = W.task;
  ask(taskName(t), `<p>Линия ${t.line}, пикеты ${rangeText(t.p1, t.p2)}${t.worker ? ', ' + esc(t.worker) : ''}.</p>` +
    `<p>Пикет засчитывается, когда вы подойдёте к нему на ${NEAR} метров. Можно поставить на паузу и продолжить в другом месте.</p>`, 'Начать ' + VERB[t.sheet]).then(ok => { if (ok) startTask(); });
  return true;
}
window.workTap = workTap;
document.addEventListener('visibilitychange', () => { if (!document.hidden) glow(); });
window.addEventListener('hashchange', () => setTimeout(glow, 300));
(async () => {                                   // задание прошлого сеанса возвращается на карту (на паузе: GPS после перезапуска выключен)
  try { await colorsReady; } catch (e) { /* без настроек */ }
  const s = PREFS.session;
  if (s && s.sheet && s.id) showTask(s.sheet, s.id, s);
})();

function drawTask(z) {
  const t = W.task;
  if (!t) return;
  const p = t.points, w = cv.clientWidth, h = cv.clientHeight, color = taskColor();
  const pulse = still ? .8 : .6 + .4 * Math.sin(performance.now() / 380);
  ctx.save();
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.beginPath();                               // свечение вдоль диапазона
  for (let i = 0; i < p.length; i += 4) { const [x, y] = toScreen(p[i], p[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  if (p.length === 4) { const [x, y] = toScreen(p[0], p[1]); ctx.lineTo(x + .01, y); }
  ctx.shadowColor = color; ctx.shadowBlur = 18 + 10 * pulse;
  ctx.globalAlpha = .28 + .3 * pulse; ctx.strokeStyle = color; ctx.lineWidth = Math.max(12, z * 3.4); ctx.stroke();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  const r = Math.max(4.5, z * 1.1), zone = NEAR * V.s;
  for (let i = 0; i < p.length; i += 4) {
    const [x, y] = toScreen(p[i], p[i + 1]);
    if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
    const done = W.visited.has(p[i + 2]);
    if (W.state !== 'idle' && !done && zone > 9) {           // круг, в который нужно войти
      ctx.beginPath(); ctx.arc(x, y, zone, 0, 6.2832); ctx.strokeStyle = color; ctx.globalAlpha = .35; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
    ctx.fillStyle = done ? '#34C759' : '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = done ? '#1F7A36' : color;
    ctx.setLineDash(p[i + 3] || done ? [] : [3, 2.5]);       // место посчитано примерно: пунктир
    ctx.stroke(); ctx.setLineDash([]);
  }
  const [lx, ly] = toScreen(p[0], p[1]), text = 'Л ' + t.line + ' · ПП ' + rangeText(t.p1, t.p2);
  ctx.font = '600 12px -apple-system,"Segoe UI",system-ui,sans-serif'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width, bx = Math.max(6, Math.min(w - tw - 24, lx - tw / 2 - 9)), by = ly - r - 30;
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(bx, by, tw + 18, 22, 11); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(text, bx + 9, by + 11.5);
  ctx.restore();
}

/* ---------- треки ---------- */
const T = {items: [], rec: null};
window.TRACKS = T;
async function loadTracks() {
  let j = {};
  try { j = await api('/api/tracks'); } catch (e) { /* настольный сервер треков не хранит */ }
  T.items = j.items || [];
}
const durText = s => (s >= 3600 ? Math.floor(s / 3600) + ' ч ' + pad2(Math.floor(s % 3600 / 60)) + ' мин' : Math.floor(s / 60) + ' мин ' + pad2(s % 60) + ' с');
function tracksRender() {
  $('trList').innerHTML = T.items.length ? T.items.map(t => `<div class="trrow" data-uid="${t.uid}">` +
    `<input type="checkbox"${t.show ? ' checked' : ''} aria-label="Показывать на карте">` +
    `<div class="tr-t"><b>${esc(t.name)}</b><span>${dru(t.ts.slice(0, 10))} · ${fmtM(t.length)} · ${durText(t.seconds)}</span></div>` +
    `<button type="button" class="btn small" data-a="name">Имя</button><button type="button" class="btn small" data-a="map">На карте</button>` +
    `<button type="button" class="btn small danger" data-a="del" aria-label="Удалить трек">✕</button></div>`).join('')
    : '<div class="empty">Треков пока нет. Откройте «Поле» и нажмите на карте кнопку с линией: запись начнётся.</div>';
}
$('trList').onchange = async e => {
  const row = e.target.closest('.trrow'); if (!row) return;
  const j = await post('/api/tracks', {uid: row.dataset.uid, show: e.target.checked});
  if (j.error) toast(j.error);
  await loadTracks(); dirty.field = true;
};
$('trList').onclick = async e => {
  const b = e.target.closest('button'), row = e.target.closest('.trrow'), t = row && T.items.find(x => x.uid === row.dataset.uid);
  if (!b || !t) return;
  if (b.dataset.a === 'name') {
    const ok = await ask('Имя трека', `<input id="trName" class="wide" style="width:100%" maxlength="80" value="${esc(t.name)}">`, 'Сохранить');
    if (!ok) return;
    const j = await post('/api/tracks', {uid: t.uid, name: $('trName').value});
    if (j.error) return toast(j.error);
  } else if (b.dataset.a === 'del') {
    if (!await ask('Удалить трек?', `<p>«${esc(t.name)}», ${fmtM(t.length)}.</p>`, 'Удалить')) return;
    await post('/api/tracks', {uid: t.uid, remove: true});
  } else if (b.dataset.a === 'map') {
    if (!t.show) await post('/api/tracks', {uid: t.uid, show: true});
    await loadTracks(); tracksRender();
    $('lTracks').checked = true;
    history.pushState(null, '', '#field'); await show('field');
    const flat = []; for (let i = 0; i < t.pts.length; i += 3) flat.push(t.pts[i], t.pts[i + 1]);
    return showBox(bounds([[flat, 2]], true), 150);
  }
  await loadTracks(); tracksRender(); dirty.field = true;
};
/* Запись: точка добавляется, когда человек сместился на 3 м и больше */
function recNote() {
  const r = T.rec, el = $('recNote');
  el.hidden = !r;
  $('tRec').classList.toggle('on', !!r); $('tRec').setAttribute('aria-pressed', !!r);
  $('tRec').title = r ? 'Остановить запись трека' : 'Записать трек своего движения';
  if (r) el.textContent = 'Запись трека: ' + fmtM(r.len) + ' · ' + durText(Math.round((Date.now() - r.t0) / 1000)) + (r.pts.length ? '' : ' · жду GPS…');
}
function trackFix(xy, ts) {
  const r = T.rec;
  if (!r) return;
  const n = r.pts.length;
  if (n) { const d = Math.hypot(xy[0] - r.pts[n - 3], xy[1] - r.pts[n - 2]); if (d < 3) return recNote(); r.len += d; }
  r.pts.push(Math.round(xy[0] * 10) / 10, Math.round(xy[1] * 10) / 10, Math.round(((ts || Date.now()) - r.t0) / 1000));
  if (r.pts.length % 30 === 0) remember('track_live', JSON.stringify(r));
  recNote();
}
async function saveTrack(r, name) {
  if (r.pts.length < 6) { toast('Трек не сохранён: в нём меньше двух точек.'); return false; }
  const j = await post('/api/tracks', {add: {name, pts: r.pts}});
  if (j.error) { toast(j.error); return false; }
  await loadTracks(); if ($('p-tracks').classList.contains('on')) tracksRender();
  return true;
}
const trackDefault = t0 => { const d = new Date(t0); return `${meName() ? meName() + ' ' : 'Трек '}${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
$('tRec').onclick = async () => {
  if (!T.rec) {
    if (F.schematic) return toast('Трек записывается в координатах листа SPS: сначала загрузите его.');
    T.rec = {t0: Date.now(), pts: [], len: 0};
    if (!GEO.on && window.geoStart) geoStart();
    if (GEO.xy) trackFix(GEO.xy, Date.now());
    recNote(); draw();
    return toast('Запись трека началась. Чтобы закончить, нажмите эту кнопку ещё раз.');
  }
  const r = T.rec;
  const ok = await ask('Закончить запись трека?', `<p>${fmtM(r.len)} · ${durText(Math.round((Date.now() - r.t0) / 1000))}</p><label for="trNew">Имя трека</label>` +
    `<input id="trNew" class="wide" style="width:100%" maxlength="80" value="${esc(trackDefault(r.t0))}">`, 'Сохранить трек');
  if (!ok) return;
  T.rec = null; remember('track_live', ''); recNote();
  if (await saveTrack(r, $('trNew').value)) toast('Трек сохранён. Он во вкладке «Треки».');
  draw();
};
// свернули приложение - запись не должна пропасть: черновик трека кладётся в память телефона
document.addEventListener('visibilitychange', () => { if (document.hidden && T.rec) remember('track_live', JSON.stringify(T.rec)); });
(async () => {                                   // недописанный трек прошлого запуска сохраняется сам
  let r = null;
  try { r = JSON.parse(remember('track_live') || 'null'); } catch (e) { /* нет черновика */ }
  if (!r || !Array.isArray(r.pts)) return;
  remember('track_live', '');
  try { await RZ.ready; } catch (e) { /* настольный сервер */ }
  if (r.pts.length >= 6 && await saveTrack(r, trackDefault(r.t0) + ' (не завершён)')) toast('Запись трека прервалась при закрытии приложения: пройденная часть сохранена во вкладке «Треки».');
})();
function drawTracks() {
  const lines = $('lTracks').checked ? T.items.filter(t => t.show).map(t => [t.pts, '#FF2D55']) : [];
  if (T.rec && T.rec.pts.length >= 3) lines.push([T.rec.pts, '#FF3B30']);
  if (!lines.length) return;
  ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
  for (const [p, color] of lines) {
    for (const [c, wd] of [['rgba(255,255,255,.9)', 5], [color, 2.6]]) {
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 3) { const [x, y] = toScreen(p[i], p[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = c; ctx.lineWidth = wd; ctx.stroke();
    }
    const [x, y] = toScreen(p[0], p[1]);
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}

/* ---------- поиск пикетов ---------- */
const findRowHtml = (v, first) => `<div class="find-row">` +
  `<input class="f-line" inputmode="numeric" placeholder="Линия" aria-label="Линия" value="${esc(v.line)}">` +
  `<input class="f-p1" inputmode="numeric" placeholder="ПП от" aria-label="Пикет от" value="${esc(v.p1)}">` +
  `<input class="f-p2" inputmode="numeric" placeholder="ПП до" aria-label="Пикет до" value="${esc(v.p2)}">` +
  (first ? `<button type="submit" class="btn small main" id="findGo">Найти</button><button type="button" class="icon-btn" data-add title="Ещё один диапазон" aria-label="Добавить диапазон">+</button>`
    : `<button type="button" class="icon-btn" data-del title="Убрать строку" aria-label="Убрать строку">×</button>`) + `</div>`;
const findValues = () => [...$('findRows').children].map(row => ({line: row.querySelector('.f-line').value.trim(),
  p1: row.querySelector('.f-p1').value.trim(), p2: row.querySelector('.f-p2').value.trim()}));
function findRender(values) { $('findRows').innerHTML = values.map((v, i) => findRowHtml(v, i === 0)).join(''); }
function findOpen(on) {
  $('findBox').hidden = !on;
  $('mFind').setAttribute('aria-expanded', on);
  $('mFind').classList.toggle('on', on || FIND.pts.length > 0);
  if (on) $('findBox').querySelector('input').focus();
}
findRender([{line: '', p1: '', p2: ''}]);
$('mFind').onclick = () => findOpen($('findBox').hidden);
$('findClear').onclick = () => {
  findRender([{line: '', p1: '', p2: ''}]);
  FIND.pts = []; FIND.labels = []; $('findNote').textContent = ''; $('findClear').hidden = true; draw();
};
$('findRows').onclick = e => {
  const b = e.target.closest('button');
  if (!b || b.type === 'submit') return;
  const values = findValues();
  if ('add' in b.dataset) {
    values.push({line: values[values.length - 1].line, p1: '', p2: ''});
    findRender(values);
    $('findRows').lastChild.querySelector(values[values.length - 1].line ? '.f-p1' : '.f-line').focus();
  } else if ('del' in b.dataset) { values.splice([...$('findRows').children].indexOf(b.parentNode), 1); findRender(values); }
};
$('findBox').onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); findOpen(false); } };
$('findBox').onsubmit = async e => {
  e.preventDefault();
  const ranges = findValues().filter(v => v.line || v.p1 || v.p2);
  if (!ranges.length) return toast('Укажите линию и пикет.');
  let j;
  try { j = await post('/api/find', {ranges}); } catch (err) { j = {error: 'Поиск не выполнен.'}; }
  if (j.error) return toast(j.error);
  FIND.pts = j.points; FIND.labels = [];
  const where = new Map();
  for (let i = 0; i < j.points.length; i += 4) where.set(j.points[i + 2] + ':' + j.points[i + 3], i);
  for (const row of j.rows) {
    if (!row.found) continue;
    let at = -1;
    if (row.p1 === null) { for (let i = 0; i < j.points.length && at < 0; i += 4) if (j.points[i + 2] === row.line) at = i; }
    else for (let p = row.p1; p <= row.p2 && at < 0; p++) if (where.has(row.line + ':' + p)) at = where.get(row.line + ':' + p);
    if (at >= 0) FIND.labels.push({x: j.points[at], y: j.points[at + 1], text: 'Л ' + row.line + (row.p1 === null ? '' : ' · ПП ' + rangeText(row.p1, row.p2))});
  }
  const found = j.points.length / 4, missing = j.rows.reduce((s, row) => s + row.missing, 0);
  const none = j.rows.filter(row => !row.found).map(row => 'линия ' + row.line + (row.p1 === null ? '' : ', ПП ' + rangeText(row.p1, row.p2)));
  $('findNote').textContent = found ? 'Найдено: ' + picketWord(found) + (missing ? ' · нет в SPS: ' + nf(missing) : '')
    : 'Не найдено: ' + none.join('; ') + (F.schematic ? '' : '. Таких пикетов нет в листе SPS');
  $('findClear').hidden = false; $('mFind').classList.add('on');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();      // клавиатура телефона уходит, карта видна
  if (found) showBox(bounds([[FIND.pts, 4]], true), 260); else draw();
};
function drawFind(z) {
  const a = FIND.pts;
  if (!a.length) return;
  const w = cv.clientWidth, h = cv.clientHeight, r = Math.max(5.5, z * 1.25), accent = cssVar('--accent') || '#007AFF';
  for (const [color, width] of [['rgba(0,0,0,.55)', 4.6], ['#fff', 3.2], [accent, 2]]) {
    ctx.beginPath();
    for (let i = 0; i < a.length; i += 4) {
      const [x, y] = toScreen(a[i], a[i + 1]);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  ctx.font = '600 12px -apple-system,"Segoe UI",system-ui,sans-serif'; ctx.textBaseline = 'middle';
  for (const l of FIND.labels) {
    const [x, y] = toScreen(l.x, l.y);
    if (x < -200 || y < -30 || x > w + 20 || y > h + 30) continue;
    const tw = ctx.measureText(l.text).width, bx = x - tw / 2 - 9, by = y - r - 28;
    ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(bx, by, tw + 18, 21, 10.5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(l.text, bx + 9, by + 11);
  }
  ctx.textBaseline = 'alphabetic';
}
window.workDraw = z => { if (F.schematic) return drawFind(z); drawTracks(); drawTask(z); drawFind(z); };

/* ---------- контуры DXF: приходят с файлом проекта, здесь их показывают ---------- */
const haText = a => (Math.round(a / 100) / 100).toLocaleString('ru-RU') + ' га';
async function loadDxf() {
  let j = {};
  try { j = await api('/api/dxf'); } catch (err) { /* без контуров */ }
  DX.layers = j.layers || [];
  for (const l of DX.layers) for (const it of l.items) {
    const p = it.pts;
    let a0 = 1e18, b0 = 1e18, a1 = -1e18, b1 = -1e18, sx = 0, sy = 0, sa = 0;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < a0) a0 = p[i]; if (p[i] > a1) a1 = p[i]; if (p[i + 1] < b0) b0 = p[i + 1]; if (p[i + 1] > b1) b1 = p[i + 1];
      const k = (i + 2) % p.length, cr = (p[i] - p[0]) * (p[k + 1] - p[1]) - (p[k] - p[0]) * (p[i + 1] - p[1]);
      sa += cr; sx += (p[i] + p[k] - 2 * p[0]) * cr; sy += (p[i + 1] + p[k + 1] - 2 * p[1]) * cr;
    }
    it.bb = [a0, b0, a1, b1];
    it.c = it.kind === 'poly' && Math.abs(sa) > 1e-6 ? [p[0] + sx / (3 * sa), p[1] + sy / (3 * sa)] : [(a0 + a1) / 2, (b0 + b1) / 2];
  }
  $('dxBox').hidden = !DX.layers.length || F.schematic;
  $('dxCount').textContent = DX.layers.length ? nf(DX.layers.length) : '';
  $('dxList').innerHTML = DX.layers.map(l => `<div class="dxrow" data-id="${l.id}"><input type="checkbox"${l.visible ? ' checked' : ''} aria-label="Показывать слой">` +
    `<i class="dxsw" style="--c:${l.color}"></i><span class="uname" data-show>${esc(l.name)}</span><span class="dx-n">${nf(l.count)}</span></div>`).join('');
}
$('dxList').onchange = e => {
  const row = e.target.closest('.dxrow'), l = row && DX.layers.find(x => x.id === +row.dataset.id);
  if (!l) return;
  l.visible = e.target.checked; post('/api/dxf/layer', {id: l.id, visible: l.visible}).catch(() => {}); draw();
};
$('dxList').onclick = e => {
  const row = e.target.closest('.dxrow'), l = row && DX.layers.find(x => x.id === +row.dataset.id);
  if (!l || !e.target.closest('[data-show]')) return;
  const pts = [];
  for (const it of l.items) pts.push(it.bb[0], it.bb[1], it.bb[2], it.bb[1], it.bb[2], it.bb[3], it.bb[0], it.bb[3]);
  if (pts.length) { if (typeof setSide === 'function' && document.body.classList.contains('touch')) setSide(true); showBox(bounds([[pts, 2]], true), 200); }
};
function dxfDraw() {
  if (F.schematic || !DX.layers.length) return;
  const w = cv.clientWidth, h = cv.clientHeight, {s, ox, oy, c, n} = V, labels = [];
  const X = (x, y) => (x * c - y * n) * s + ox, Y = (x, y) => oy - (x * n + y * c) * s;
  ctx.lineJoin = 'round';
  for (const l of DX.layers) {
    if (!l.visible) continue;
    ctx.strokeStyle = ctx.fillStyle = l.color; ctx.lineWidth = 1.6;
    for (const it of l.items) {
      const b = it.bb, xs = [X(b[0], b[1]), X(b[2], b[1]), X(b[2], b[3]), X(b[0], b[3])], ys = [Y(b[0], b[1]), Y(b[2], b[1]), Y(b[2], b[3]), Y(b[0], b[3])];
      const sx0 = Math.min(...xs), sx1 = Math.max(...xs), sy0 = Math.min(...ys), sy1 = Math.max(...ys);
      if (sx1 < 0 || sy1 < 0 || sx0 > w || sy0 > h) continue;
      const size = Math.max(sx1 - sx0, sy1 - sy0), p = it.pts;
      if (it.kind === 'text') { if (l.labels && V.s > .02) labels.push([it.name, X(p[0], p[1]), Y(p[0], p[1])]); continue; }
      if (it.kind === 'point' || size < 2.5) { ctx.fillRect(X(it.c[0], it.c[1]) - 1.5, Y(it.c[0], it.c[1]) - 1.5, 3, 3); continue; }
      ctx.beginPath(); ctx.moveTo(X(p[0], p[1]), Y(p[0], p[1]));
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(X(p[i], p[i + 1]), Y(p[i], p[i + 1]));
      if (it.kind === 'poly') { ctx.closePath(); ctx.globalAlpha = .16; ctx.fill(); }
      ctx.globalAlpha = 1; ctx.stroke();
      if (l.labels && it.kind === 'poly' && size > 44) labels.push([it.name, X(it.c[0], it.c[1]), Y(it.c[0], it.c[1])]);
    }
  }
  ctx.globalAlpha = 1;
  if (!labels.length) return;
  ctx.font = '600 12px -apple-system,"Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.fillStyle = '#1D1D1F';
  for (const [text, x, y] of labels) { const t = text.length > 28 ? text.slice(0, 27) + '…' : text; ctx.strokeText(t, x, y); ctx.fillText(t, x, y); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function dxfTip(mx, my) {
  if (F.schematic || !DX.layers.length) return '';
  const [x, y] = toWorld(mx, my);
  let best = null, layer = null;
  for (const l of DX.layers) {
    if (!l.visible) continue;
    for (const it of l.items) {
      if (it.kind !== 'poly' || x < it.bb[0] || x > it.bb[2] || y < it.bb[1] || y > it.bb[3]) continue;
      const p = it.pts;
      let hit = false;
      for (let i = 0, k = p.length - 2; i < p.length; k = i, i += 2)
        if ((p[i + 1] > y) !== (p[k + 1] > y) && x < (p[k] - p[i]) * (y - p[i + 1]) / (p[k + 1] - p[i + 1]) + p[i]) hit = !hit;
      if (hit && (!best || it.area < best.area)) { best = it; layer = l; }
    }
  }
  return best ? best.name + ' · ' + layer.name + ' · ' + haText(best.area) : '';
}
window.dxfDraw = dxfDraw; window.dxfTip = dxfTip;

/* ---------- файл проекта ---------- */
const prjBoxes = () => [...$('prjParts').querySelectorAll('input[data-part]')];
function prjStamp() { const d = new Date(); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}ч${pad2(d.getMinutes())}м`; }
/* Имя файла - по исполнителю: «Дульцев К.А. 08.10.2026 22ч55м». Если себя не отметили, имя вводится вручную. */
function prjFill() {
  const me = meName(), el = $('prjName');
  if (me && (!el.value || el.dataset.auto === el.value)) { el.value = me + ' ' + prjStamp(); el.dataset.auto = el.value; }
  $('prjWho').textContent = me ? 'Вы: ' + me + '. Имя файла подставлено само, его можно изменить.'
    : 'Чтобы имя файла подставлялось само, отметьте себя галочкой во вкладке «ID старших» или «ID топографов».';
}
$('prjOnly').onchange = () => { $('prjTasks').disabled = !$('prjOnly').checked; };
$('prjTasks').disabled = true;
$('prjSave').onclick = async () => {
  for (const p of Object.values(Sheets.pages)) if (p.flush && !(await p.flush())) return;
  let name = $('prjName').value.trim();
  if (!name) {
    const ok = await ask('Имя файла', '<p>Назовите файл: обычно это фамилия того, кто выполнял задания.</p>' +
      `<input id="prjAsk" class="wide" style="width:100%" maxlength="100" placeholder="Например: Дульцев К.А.">`, 'Сохранить');
    if (!ok) return;
    name = $('prjAsk').value.trim();
    if (!name) return toast('Имя файла не указано.');
    name += ' ' + prjStamp();
  }
  const parts = prjBoxes().filter(b => b.checked).map(b => b.dataset.part), btn = $('prjSave'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Готовлю файл…';
  try {
    await download('/api/project/export?parts=' + parts.join(',') + ($('prjOnly').checked ? '&tasks=' + $('prjTasks').value : '') + '&name=' + encodeURIComponent(name), {}, name + '.rzm');
  } catch (e) { toast('Не удалось подготовить файл.'); }
  btn.disabled = false; btn.textContent = label;
};
const prjFiles = () => [...$('prjFile').files];
$('prjFile').onchange = () => { const n = prjFiles().length; $('prjLoad').textContent = n > 1 ? 'Проверить файлы' : 'Проверить файл'; $('prjNote').textContent = n > 1 ? 'Выбрано: ' + filesWord(n) : ''; };
/* Табло изменений: по каждому виду работ - кто сколько выполнил */
function boardHtml(ch) {
  const unit = w => (w.unit === 'пикет' ? 'пик.' : 'кан.'), done = ch.work.filter(w => w.rows);
  let h = '';
  if (done.length) {
    h += '<div class="board"><table><tr><th>Работа</th><th>Кто выполнил</th><th class="r">Строк</th><th class="r">Объём</th></tr>';
    for (const w of done) {
      h += w.who.map(p => `<tr><td>${esc(w.title)}</td><td>${esc(p.name)}</td><td class="r">${nf(p.rows)}</td><td class="r">+${nf(p.units)} ${unit(w)}</td></tr>`).join('');
      h += `<tr class="bd-who"><td colspan="2"><b>${esc(w.title)}: всего</b></td><td class="r"><b>${nf(w.rows)}</b></td><td class="r"><b>+${nf(w.units)} ${unit(w)}</b></td></tr>`;
    }
    h += '</table></div>';
  }
  const notes = [], sum = k => ch.work.reduce((s, w) => s + w[k], 0), per = k => ch.work.filter(w => w[k]).map(w => w.title.toLowerCase() + ' ' + nf(w[k])).join(', ');
  if (sum('tasks')) notes.push('Новые задания: ' + per('tasks'));
  if (sum('changed')) notes.push('Изменённые задания: ' + per('changed'));
  if (sum('removed')) notes.push('Снятые задания (в файле они удалены): ' + per('removed'));
  for (const o of ch.other) if (o.added || o.changed) notes.push(o.title + ': новых строк ' + nf(o.added) + (o.changed ? ', изменённых ' + nf(o.changed) : ''));
  for (const p of ch.people) notes.push(p.title + ', новые: ' + p.added.join(', '));
  if (sum('differs')) notes.push('Строки, которые проведены и здесь, и в файле, но отличаются (оставлены здешние): ' + nf(sum('differs')));
  if (ch.bad) notes.push('Строки с ошибками пропущены: ' + nf(ch.bad));
  if (notes.length) h += '<ul>' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
  if (!h) h = '<p>Для журнала в файле нет ничего нового: все его строки здесь уже есть.</p>';
  else if (done.length) h += '<p>Принятые строки на поле сразу не попадут: они будут ждать кнопки на своём листе.</p>';
  return h;
}
const PRJ_TITLE = {journal: 'журнал', sps: 'лист SPS', dxf: 'контуры DXF', tracks: 'треки', settings: 'правила учёта и система координат'};
async function projectDialog(rep) {
  const f0 = rep.files[0], P = rep.parts, here = k => nf((rep.here.rows || {})[k] || 0);
  let mode = rep.single && rep.here.empty ? 'replace' : 'merge';
  const has = p => p === 'journal' || !!(P[p] && P[p].on);
  const start = p => (mode === 'replace' ? true : p === 'journal' ? true : p === 'dxf' || p === 'tracks' ? P[p].new > 0 : p === 'sps' ? P[p].here === 0 : false);
  const text = p => {
    const m = mode === 'merge', d = P[p] || {};
    if (p === 'journal') return m ? 'журнал <small>— новые строки добавятся и будут ждать кнопки</small>' : 'журнал целиком <small>— заменит здешний</small>';
    if (p === 'dxf') return 'контуры DXF <small>— ' + (m ? 'новых слоёв: ' + nf(d.new) : 'слоёв: ' + nf(d.file) + ', заменят здешние (' + nf(d.here) + ')') + '</small>';
    if (p === 'tracks') return 'треки <small>— новых: ' + nf(d.new) + '</small>';
    if (p === 'sps') return 'лист SPS <small>— ' + nf(d.file) + ' ' + plural(d.file, 'пикет', 'пикета', 'пикетов') + ', заменит здешний (' + nf(d.here) + ')</small>';
    return 'правила учёта и система координат <small>— ' + (d.differs ? 'отличаются от здешних' : 'такие же, как здесь') + '</small>';
  };
  const files = rep.files.map(f => `${esc(f.name)} <small>— сохранён ${esc(whenText(f.created || ''))}${f.source ? ', ' + esc(f.source) : ''}${f.partial ? ' · только задания' : ''}</small>`).join('<br>');
  const inner = () => (mode === 'merge' ? `<div class="bd-title">Что нового ${rep.files.length === 1 ? 'в файле' : 'в файлах'}</div>` + boardHtml(rep.changes)
      : `<div class="bd-title">Проект станет копией файла</div><ul><li>Размотка: ${rowsWord(f0.rows.razm || 0)} <small>(сейчас ${here('razm')})</small></li>` +
        `<li>Подмотка: ${rowsWord(f0.rows.podm || 0)} <small>(сейчас ${here('podm')})</small></li><li>Разбивка: ${rowsWord(f0.rows.razb || 0)} <small>(сейчас ${here('razb')})</small></li></ul>` +
        `<p>То, что внесено здесь и чего нет в файле, пропадёт. Выполненные строки останутся выполненными.</p>`) +
    `<div class="bd-title">Что загрузить</div><div class="parts">` + Object.keys(PRJ_TITLE).filter(p => p === 'journal' || p in P).map(p => has(p)
      ? `<label class="tick"><input type="checkbox" data-part="${p}"${start(p) ? ' checked' : ''}${p === 'journal' && mode === 'replace' ? ' disabled' : ''}><span>${text(p)}</span></label>`
      : `<label class="tick off"><input type="checkbox" disabled><span>${PRJ_TITLE[p]} <small>— в файле нет</small></span></label>`).join('') + `</div>`;
  const answer = ask(rep.files.length === 1 ? 'Файл проекта' : 'Файлы проекта: ' + nf(rep.files.length),
    `<p class="bd-files">${files}</p><div class="bd-mode">` +
    `<label class="tick"><input type="radio" name="prjMode" value="merge"${mode === 'merge' ? ' checked' : ''}><span>Принять изменения<small>Новые задания и строки добавляются; ваши данные остаются.</small></span></label>` +
    (rep.single ? `<label class="tick"><input type="radio" name="prjMode" value="replace"${mode === 'replace' ? ' checked' : ''}><span>Заменить проект<small>Проект на телефоне становится копией файла.</small></span></label>` : '') +
    `</div><div id="prjInner">${inner()}</div>`, 'Загрузить выбранное', false, true);
  const body = $('dBody'), boxes = () => [...body.querySelectorAll('input[data-part]')];
  const check = () => { $('dYes').disabled = !boxes().some(b => b.checked); };
  body.onchange = e => { if (e.target.name === 'prjMode') { mode = e.target.value; $('prjInner').innerHTML = inner(); } check(); };
  check();
  const ok = await answer;
  const parts = boxes().filter(b => b.checked).map(b => b.dataset.part);
  body.onchange = null; $('dYes').disabled = false;
  return ok && parts.length ? {mode, parts} : null;
}
$('prjLoad').onclick = async () => {
  const files = prjFiles(), btn = $('prjLoad');
  if (!files.length) return toast('Выберите файл проекта (.rzm).');
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Проверяю…';
  let rep;
  try { rep = await api('/api/project/inspect', {method: 'POST', body: await packFiles(files)}); } catch (e) { rep = {error: 'Не удалось прочитать файл проекта.'}; }
  btn.disabled = false; btn.textContent = label;
  if (rep.error) return toast(rep.error);
  const pick = await projectDialog(rep);
  if (!pick) { post('/api/project/discard', {token: rep.token}).catch(() => {}); return; }
  if (pick.mode === 'replace' && W.task) dropTask();
  let j;
  try { j = await post('/api/project/apply', {token: rep.token, mode: pick.mode, parts: pick.parts}); } catch (e) { j = {error: 'Не удалось загрузить файл проекта.'}; }
  if (j.error) return toast(j.error);
  $('prjFile').value = ''; $('prjFile').onchange();
  $('sFrom').dataset.set = ''; $('sFrom').value = ''; $('sTo').value = '';
  if (window.geoReloadCrs) geoReloadCrs();
  await loadWorkers(); await changed(true);
  const r = j.rows || {}, got = p => j.parts.includes(p), extra = [];
  if (got('sps')) extra.push('Пикетов в SPS: ' + nf(r.sps || 0));
  if (got('dxf')) extra.push('Слоёв с контурами: ' + nf(j.dxf || 0));
  if (got('tracks')) extra.push('Треков: ' + nf(j.tracks || 0));
  if (got('settings')) extra.push('Правила учёта и система координат взяты из файла');
  const list = extra.length ? '<ul>' + extra.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '';
  const tasks = (r.razb || 0) + (r.razm || 0) + (r.podm || 0);
  if (j.mode === 'replace') {
    const go = await ask('Проект загружен', '<ul><li>Размотка: ' + rowsWord(r.razm || 0) + '</li><li>Подмотка: ' + rowsWord(r.podm || 0) + '</li><li>Разбивка: ' + rowsWord(r.razb || 0) + '</li></ul>' + list +
      '<p>Задания — на листах «Размотка», «Подмотка» и «Разбивка», в списке «Задания». Кнопка «На карте» покажет задание в поле.</p>', tasks ? 'К заданиям' : 'Хорошо', !tasks, true);
    if (go && tasks) location.hash = '#' + (S.drafts.razb ? 'razb' : S.drafts.razm ? 'razm' : S.drafts.podm ? 'podm' : 'razb');
    return;
  }
  const first = got('journal') ? (j.changes.work.find(w => w.rows) || j.changes.work.find(w => w.tasks || w.changed)) : null;
  const go = await ask('Загружено', (got('journal') ? boardHtml(j.changes) : '') + list, first ? 'Открыть лист «' + first.title + '»' : 'Хорошо', !first, true);
  if (first && go) location.hash = '#' + first.sheet;
};
prjFill();
