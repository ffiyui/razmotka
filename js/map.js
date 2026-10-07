/* Экран «Поле»: карта оборудования, слои с выбором формы и цвета точек, топографические подложки и список по линиям */
let F = {sps: [], field: [], dates: [], names: [], segments: [], left: [], lost: [], schematic: false};
let P = {razm: [], podm: []};                 // размотка и подмотка за выбранный период
let V = {s: 1, ox: 0, oy: 0, deg: 0, c: 1, n: 0};   // вид: масштаб, сдвиг и наклон (градусы по часовой стрелке, его cos и sin)
let B = null;                                 // границы данных
let BSETS = [];                               // наборы точек, по которым считаются границы
const U = {items: [], active: 0, cache: {}};  // подложки: список, номер выбранной, загруженные картинки по номерам
const cv = $('map'), ctx = cv.getContext('2d');

/* Вид слоёв карты: цвет, форма и размер точек. Меняется щелчком по образцу в легенде,
   хранится на сервере (data/prefs.json). k - множитель размера, min - наименьший размер в пикселях. */
const MAP_DEFAULT = {
  sps: {c: '#C3C9D4', shape: 'square', k: .8}, field: {c: '#1D1D1F', shape: 'square', k: 1},
  razm: {c: '#FF9500', shape: 'square', k: 1.15}, podm: {c: '#007AFF', shape: 'square', k: 1.15},
  left: {c: '#FF3B30', shape: 'circle', k: 1, min: 10}, lost: {c: '#8E1B16', shape: 'cross', k: 1, min: 10},
};
const LAYER_TITLE = {sps: 'Пикеты SPS', field: 'Лежит на поле', razm: 'Размотано за период', podm: 'Подмотано за период', left: 'Оставленное оборудование', lost: 'Утерянное оборудование'};
const cloneStyle = () => JSON.parse(JSON.stringify(MAP_DEFAULT));
let MS = cloneStyle(), PREFS = {};
function paintSwatches() {
  document.querySelectorAll('.sw').forEach(b => { const st = MS[b.dataset.layer]; b.innerHTML = shapeSvg(st.shape, st.c, 14); });
  $('swReset').hidden = JSON.stringify(MS) === JSON.stringify(MAP_DEFAULT);
}
async function loadMapStyle() {
  try {
    PREFS = await api('/api/prefs');
    if (PREFS.theme) loadTheme(PREFS.theme);
    const saved = PREFS.map_style || {}, old = PREFS.map_colors || {};          // map_colors - только цвета, из прежних версий
    for (const k of Object.keys(MAP_DEFAULT)) {
      const v = saved[k] || {}, c = v.c || (saved[k] ? null : old[k]);
      if (/^#[0-9a-f]{6}$/i.test(c || '')) MS[k].c = c;
      if (SHAPES[v.shape]) MS[k].shape = v.shape;
      if (v.k >= .4 && v.k <= 5) MS[k].k = +v.k;
    }
  } catch (err) { /* вид по умолчанию */ }
  paintSwatches();
}
let styleTimer = 0;
function styleChanged() {
  sprites.clear(); paintSwatches(); draw();
  clearTimeout(styleTimer); styleTimer = setTimeout(() => post('/api/prefs', {map_style: MS}).catch(() => {}), 400);
}
/* Окно слоя: форма, размер, цвет */
function openLayerStyle(button) {
  const key = button.dataset.layer, st = MS[key];
  const html = () => `<div class="pal-title">${LAYER_TITLE[key]}: форма</div><div class="shape-grid">` +
    Object.keys(SHAPES).map(n => `<button type="button" class="shape-b${n === st.shape ? ' on' : ''}" data-shape="${n}" title="${SHAPES[n].title}">${shapeSvg(n, st.c, 16)}</button>`).join('') + '</div>' +
    `<div class="pal-title">Размер</div><label class="range">мельче<input type="range" class="st-size" min="0.4" max="5" step="0.1" value="${st.k}" style="flex:1">крупнее</label>` +
    `<div class="pal-title">Цвет</div>${paletteHtml(st.c)}` +
    `<div class="pal-row"><button type="button" class="pal-none">Как было</button><label class="pal-own">Свой<input type="color" value="${st.c}"></label></div>`;
  const {el} = popover(button, html());
  const bind = () => {
    el.querySelector('.st-size').oninput = e => { st.k = +e.target.value; styleChanged(); };
    el.querySelector('input[type=color]').oninput = e => { st.c = e.target.value; styleChanged(); el.querySelectorAll('.shape-b').forEach(b => { b.innerHTML = shapeSvg(b.dataset.shape, st.c, 16); }); };
  };
  bind();
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.shape) st.shape = b.dataset.shape;
    else if (b.dataset.c) st.c = b.dataset.c;
    else if (b.classList.contains('pal-none')) Object.assign(st, JSON.parse(JSON.stringify(MAP_DEFAULT[key])));
    else return;
    styleChanged(); el.innerHTML = html(); bind();
  });
}
document.querySelectorAll('.sw').forEach(b => { b.onclick = e => { e.preventDefault(); openLayerStyle(b); }; });
$('swReset').onclick = () => { MS = cloneStyle(); styleChanged(); };
const colorsReady = loadMapStyle();

/* Скрытие панели инструментов: карта занимает всю ширину, вернуть панель можно кнопкой «три точки» на карте.
   На узком экране (телефон) панель - шторка снизу, она по умолчанию закрыта и ничего не запоминает. */
function setSide(hidden) {
  if (isNarrow()) { $('fieldWrap').classList.toggle('sheet-open', !hidden); return; }
  $('fieldWrap').classList.toggle('noside', hidden);
  remember('noside', hidden ? '1' : '0');
  resizeMap();
}
$('sideHide').onclick = () => setSide(true);
$('sideShow').onclick = () => setSide(false);
if (remember('noside') === '1') $('fieldWrap').classList.add('noside');
$('sideScrim').onclick = () => setSide(true);
window.addEventListener('hashchange', () => $('fieldWrap').classList.remove('sheet-open'));
(function sheetSwipe() {                                            // шторку можно утянуть вниз (или вправо в ландшафте) за верхнюю строку
  const head = document.querySelector('.side-head');
  let t0 = null;
  head.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') t0 = {x: e.clientX, y: e.clientY, id: e.pointerId}; });
  head.addEventListener('pointermove', e => {
    if (!t0 || e.pointerId !== t0.id) return;
    const dx = e.clientX - t0.x, dy = e.clientY - t0.y;
    if (dy > 48 && dy > Math.abs(dx) || dx > 64 && dx > Math.abs(dy) * 1.5 && window.innerWidth > window.innerHeight) { t0 = null; setSide(true); }
  });
  head.addEventListener('pointerup', () => { t0 = null; });
  head.addEventListener('pointercancel', () => { t0 = null; });
})();

/* ---------- загрузка ---------- */
async function loadField() {
  await colorsReady;
  F = await api('/api/field');
  if (!S.field) {
    $('fieldTitle').textContent = 'На поле пока ничего нет';
    $('fieldLead').textContent = 'Заполните лист «Размотка» и нажмите «Размотать»: оборудование появится на карте.';
  } else {
    $('fieldTitle').textContent = 'На поле ' + nf(S.field) + ' ' + plural(S.field, 'канал', 'канала', 'каналов');
    // Число в заголовке - фактическое: считается по последнему событию каждого пикета,
    // поэтому повторные размотки и подмотки без размотки в него не входят.
    let lead = 'Оборудование лежит на ' + nf(S.field_lines) + ' ' + plural(S.field_lines, 'линии', 'линиях', 'линиях') + '.';
    if (S.bad) lead += ' Это фактическое количество: лишние размотки и подмотки (' + nf(S.bad) + ' в «Проверке») в него не входят.';
    const dc = S.draft_channels || {razm: 0, podm: 0};
    if (dc.razm || dc.podm) lead += ' Не учтены черновики, по которым не нажата кнопка: размотка ' + nf(dc.razm) + ' кан., подмотка ' + nf(dc.podm) + ' кан.';
    if (F.no_xy) lead += ' У ' + nf(F.no_xy) + ' ' + plural(F.no_xy, 'пикета', 'пикетов', 'пикетов') + ' нет координат в SPS, на карте их не видно.';
    $('fieldLead').textContent = lead;
  }
  const by = {};
  for (const [l, a, b] of F.segments) (by[l] = by[l] || []).push([a, b]);
  const keys = Object.keys(by);
  $('lines').innerHTML = keys.length ? keys.map(l => {
    const n = by[l].reduce((s, x) => s + x[1] - x[0] + 1, 0);
    return `<div class="ln"><b>${l}</b><span>${by[l].map(x => x[0] === x[1] ? x[0] : x[0] + '–' + x[1]).join(', ')}</span><i>${nf(n)}</i></div>`;
  }).join('') : '<div class="empty">На поле нет оборудования.</div>';

  $('lgSps').style.display = F.schematic ? 'none' : '';
  $('lgLeft').style.display = F.left.length ? '' : 'none';
  $('lgLost').style.display = F.lost.length ? '' : 'none';
  $('mapNote').textContent = F.schematic ? 'Схема по номерам линий и пикетов. Заполните лист SPS, чтобы карта строилась в координатах.' : '';
  $('uBtn').disabled = F.schematic;
  $('uBtn').title = F.schematic ? 'Подложка привязывается к координатам листа SPS: сначала заполните его' : '';
  $('uList').style.display = F.schematic ? 'none' : '';

  BSETS = F.sps.length ? [[F.sps, 2]] : [[F.field, 6], [F.left, 4], [F.lost, 4]];
  B = bounds(BSETS);
  if (!V.restored) { V.restored = true; setAngle(+PREFS.map_tilt || 0); }      // наклон прошлого сеанса
  $('mLevel').disabled = !B;
  await loadUnderlays();
  await loadPeriod();
  resizeMap(); fit();
}
/* Границы точек. turned - в повёрнутых координатах вида: по ним карта вписывается в окно при наклоне. */
function bounds(sets, turned) {
  let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18, any = false;
  const c = turned ? V.c : 1, n = turned ? V.n : 0;
  for (const [a, step] of sets) for (let i = 0; i < a.length; i += step) {
    const x = a[i] * c - a[i + 1] * n, y = a[i] * n + a[i + 1] * c; any = true;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return any ? {x0, x1, y0, y1} : null;
}
async function loadPeriod() {
  const on = $('lRazm').checked || $('lPodm').checked;
  if (on && $('mFrom').value && $('mTo').value)
    P = await api(`/api/period?from=${$('mFrom').value}&to=${$('mTo').value}`);
  $('mCount').textContent = on ? 'За период: размотано ' + nf(P.razm.length / 4) + ', подмотано ' + nf(P.podm.length / 4) : 'Включите слои «за период» справа от карты';
  draw();
}
/* Быстрый выбор периода: отсчёт идёт от последнего дня работ. Слои «за период» включаются сами. */
$('mPresets').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  const end = S.date_max || today(), days = {day: 0, week: 6, month: 29}[b.dataset.range];
  $('mTo').value = end;
  $('mFrom').value = days === undefined ? (S.date_min || end) : new Date(Date.parse(end) - days * 864e5).toISOString().slice(0, 10);
  $('lRazm').checked = true; $('lPodm').checked = true;
  [...$('mPresets').children].forEach(x => x.classList.toggle('on', x === b));
  loadPeriod();
};

/* ---------- вид ---------- */
let mapSize = null;                           // размер карты при последней отрисовке
function resizeMap() {
  const r = $('mapBox').getBoundingClientRect(), d = window.devicePixelRatio || 1;
  if (!r.width) return;
  mapSize = {w: r.width, h: r.height};
  cv.width = r.width * d; cv.height = r.height * d;
  draw();
}
/* Размер карты изменился (окно, полноэкранный режим): середина остаётся на месте, видимая область подгоняется под новый размер */
function reframe() {
  const r = $('mapBox').getBoundingClientRect(), old = mapSize;
  if (r.width && old && (r.width !== old.w || r.height !== old.h)) {
    const mid = toWorld(old.w / 2, old.h / 2);
    V.s *= Math.min(r.width / old.w, r.height / old.h);
    const now = toScreen(mid[0], mid[1]);
    V.ox += r.width / 2 - now[0]; V.oy += r.height / 2 - now[1];
  }
  resizeMap();
}
/* Точка поля -> экран и обратно. Наклон поворачивает поле вокруг начала координат, затем идут масштаб и сдвиг. */
const toScreen = (x, y) => [(x * V.c - y * V.n) * V.s + V.ox, V.oy - (x * V.n + y * V.c) * V.s];
const toWorld = (sx, sy) => { const x = (sx - V.ox) / V.s, y = (V.oy - sy) / V.s; return [x * V.c + y * V.n, y * V.c - x * V.n]; };
function setAngle(deg) {
  deg = Math.round(((+deg || 0) % 360 + 540) % 360 - 180);
  if (deg === -180) deg = 180;
  const r = -deg * Math.PI / 180;
  V.deg = deg; V.c = Math.cos(r); V.n = Math.sin(r);
  $('mTilt').value = deg; $('mTiltOut').textContent = (deg > 0 ? '+' : deg < 0 ? '−' : '') + Math.abs(deg) + '°';
  $('mNorth').hidden = !deg || F.schematic;
  $('mNorth').firstElementChild.style.transform = `rotate(${deg}deg)`;
  $('mReset').disabled = !deg && V.fitted;
}
/* Наклон меняется вокруг середины окна: то, что было в центре, в центре и остаётся */
let tiltTimer = 0;
function tilt(deg) {
  const r = $('mapBox').getBoundingClientRect(), mid = toWorld(r.width / 2, r.height / 2);
  setAngle(deg);
  const now = toScreen(mid[0], mid[1]);
  V.ox += r.width / 2 - now[0]; V.oy += r.height / 2 - now[1];
  draw();
  saveTilt();
}
function saveTilt() { clearTimeout(tiltTimer); tiltTimer = setTimeout(() => post('/api/prefs', {map_tilt: V.deg}).catch(() => {}), 400); }
function fit() {
  let b = V.deg ? bounds(BSETS, true) : B;
  const u = underlayNow();
  if (!b && u) {                               // данных нет, но есть подложка: показываем её целиком
    const c = [[0, 0], [u.img.naturalWidth, 0], [u.img.naturalWidth, u.img.naturalHeight], [0, u.img.naturalHeight]].map(p => underlayPoint(u.t, p[0], p[1]))
      .map(p => [p[0] * V.c - p[1] * V.n, p[0] * V.n + p[1] * V.c]);
    b = {x0: Math.min(...c.map(p => p[0])), x1: Math.max(...c.map(p => p[0])), y0: Math.min(...c.map(p => p[1])), y1: Math.max(...c.map(p => p[1]))};
  }
  V.fitted = true; $('mReset').disabled = !V.deg;
  if (!b) return draw();
  const r = $('mapBox').getBoundingClientRect(), pad = 40, w = b.x1 - b.x0 || 1, h = b.y1 - b.y0 || 1;
  V.s = Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad) / h);
  V.ox = (r.width - w * V.s) / 2 - b.x0 * V.s;
  V.oy = (r.height + h * V.s) / 2 + b.y0 * V.s;
  draw();
}

/* ---------- отрисовка ---------- */
/* Точки слоя. Квадрат рисуется напрямую (так быстрее всего), остальные фигуры - готовым образцом:
   фигура один раз рисуется в маленький холст, а затем штампуется в каждую точку. */
const sprites = new Map();
function sprite(shape, color, size, d) {
  const key = shape + color + size.toFixed(1) + d;
  let c = sprites.get(key);
  if (!c) {
    const px = Math.ceil(size * 1.5 * d) + 2;
    c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d');
    g.translate(px / 2, px / 2); g.scale(d, d);
    shapeDraw(g, shape, size / 2, color);
    if (sprites.size > 60) sprites.clear();
    sprites.set(key, c);
  }
  return c;
}
function layer(a, step, st, z) {
  const size = Math.max(st.min || 0, z * st.k), w = cv.clientWidth, h = cv.clientHeight, m = size + 2;
  const {s, ox, oy, c, n} = V;
  if (st.shape === 'square' || size < 3.5) {              // мелкие точки неотличимы по форме: рисуем быстрым способом
    ctx.fillStyle = st.c;
    const hs = size * .45, sd = size * .9;
    for (let i = 0; i < a.length; i += step) {
      const x = (a[i] * c - a[i + 1] * n) * s + ox, y = oy - (a[i] * n + a[i + 1] * c) * s;
      if (x < -m || y < -m || x > w + m || y > h + m) continue;
      ctx.fillRect(x - hs, y - hs, sd, sd);
    }
    return;
  }
  const d = window.devicePixelRatio || 1, sp = sprite(st.shape, st.c, size, d), box = sp.width / d, hb = box / 2;
  for (let i = 0; i < a.length; i += step) {
    const x = (a[i] * c - a[i + 1] * n) * s + ox, y = oy - (a[i] * n + a[i + 1] * c) * s;
    if (x < -m || y < -m || x > w + m || y > h + m) continue;
    ctx.drawImage(sp, x - hb, y - hb, box, box);
  }
}
function draw() {
  const d = window.devicePixelRatio || 1;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
  if (window.tilesDraw && !F.schematic) tilesDraw(ctx, d);      // карта из интернета (js/tiles.js)
  const u = underlayNow();
  if (u && !F.schematic) {
    const t = u.t, s = V.s * d, c = V.c, n = V.n;   // пиксель картинки -> координаты -> наклон -> экран
    ctx.setTransform(s * (c * t.a - n * t.d), -s * (n * t.a + c * t.d), s * (c * t.b - n * t.e), -s * (n * t.b + c * t.e),
      s * (c * t.c - n * t.f) + d * V.ox, d * V.oy - s * (n * t.c + c * t.f));
    ctx.globalAlpha = +$('uAlpha').value;
    ctx.drawImage(u.img, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  const z = Math.max(1.3, Math.min(7, V.s * 18));
  if ($('lSps').checked) layer(F.sps, 2, MS.sps, z);
  if ($('lField').checked) layer(F.field, 6, MS.field, z);
  if ($('lPodm').checked) layer(P.podm, 4, MS.podm, z);
  if ($('lRazm').checked) layer(P.razm, 4, MS.razm, z);
  if ($('lLeft').checked) layer(F.left, 4, MS.left, z);
  if ($('lLost').checked) layer(F.lost, 4, MS.lost, z);
  if (!B && !u && !(window.TILES && TILES.last)) {
    ctx.fillStyle = '#63636A'; ctx.font = '15px -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Карта появится, когда на поле будет оборудование или заполнится лист SPS', cv.clientWidth / 2, cv.clientHeight / 2);
  }
  if (window.geoDraw && !F.schematic) geoDraw(ctx, d);      // моё местоположение (js/geo.js)
}

/* ---------- мышь и касания ---------- */
/* Мышь: сдвиг перетаскиванием, масштаб колёсиком, подсказка под курсором.
   Касания (Pointer Events): один палец - сдвиг; два пальца - масштаб и поворот вокруг точки между ними;
   двойной тап - приблизить; тап по точке - та же подсказка, что у мыши (закрывается тапом по пустому месту). */
let drag = null;
const moved = () => { if (V.fitted) { V.fitted = false; $('mReset').disabled = false; } };      // вид сдвинут: его можно вернуть
const touches = new Map();                    // касания на холсте: номер -> {x, y} в координатах карты
let tap = null, lastTap = null, pinch = null, drawRaf = 0;
const redraw = () => { if (!drawRaf) drawRaf = requestAnimationFrame(() => { drawRaf = 0; draw(); }); };
const local = e => { const r = cv.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
cv.onpointerdown = e => {
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
  if (e.pointerType === 'mouse') { drag = {x: e.clientX, y: e.clientY}; return; }
  touches.set(e.pointerId, local(e));
  $('tip').style.display = 'none';
  if (touches.size === 1) { const p = local(e); tap = {x: p.x, y: p.y, t: Date.now(), moved: false, lx: p.x, ly: p.y}; pinch = null; }
  else if (touches.size === 2) { tap = null; startPinch(); }
};
function startPinch() {
  const [p, q] = [...touches.values()], c = {x: (p.x + q.x) / 2, y: (p.y + q.y) / 2};
  pinch = {d0: Math.hypot(q.x - p.x, q.y - p.y) || 1, a: Math.atan2(q.y - p.y, q.x - p.x), acc: 0, s0: V.s, deg0: V.deg, w: toWorld(c.x, c.y)};
}
function movePinch() {
  const [p, q] = [...touches.values()], c = {x: (p.x + q.x) / 2, y: (p.y + q.y) / 2};
  const a = Math.atan2(q.y - p.y, q.x - p.x);
  let step = (a - pinch.a) * 180 / Math.PI;                  // поворот пальцев за кадр, без скачка через ±180°
  step = ((step + 540) % 360) - 180;
  pinch.acc += step; pinch.a = a;
  const dead = 4, turn = Math.abs(pinch.acc) <= dead ? 0 : pinch.acc - Math.sign(pinch.acc) * dead;   // мелкая «дрожь» не вращает карту
  V.s = Math.max(1e-7, pinch.s0 * Math.hypot(q.x - p.x, q.y - p.y) / pinch.d0);
  const before = V.deg;
  setAngle(pinch.deg0 + turn);                              // тот же ползунок «Наклон» и стрелка севера
  const now = toScreen(pinch.w[0], pinch.w[1]);             // точка под серединой пальцев остаётся под ней: вращение и масштаб вокруг неё
  V.ox += c.x - now[0]; V.oy += c.y - now[1];
  moved(); redraw();
  if (V.deg !== before) saveTilt();
}
function moveTouch(e) {
  if (!touches.has(e.pointerId)) return;
  const p = local(e);
  touches.set(e.pointerId, p);
  if (pinch && touches.size >= 2) return movePinch();
  if (!tap) return;
  if (!tap.moved && Math.hypot(p.x - tap.x, p.y - tap.y) > 8) tap.moved = true;
  if (tap.moved) { V.ox += p.x - tap.lx; V.oy += p.y - tap.ly; tap.lx = p.x; tap.ly = p.y; moved(); redraw(); }
  else { tap.lx = tap.x; tap.ly = tap.y; }
}
function liftTouch(e) {
  if (e.pointerType === 'mouse') { drag = null; return; }
  touches.delete(e.pointerId);
  if (pinch) {
    if (touches.size < 2) {                                 // остался один палец: продолжает сдвиг без скачка
      pinch = null;
      const rest = [...touches.values()][0];
      tap = rest ? {x: rest.x, y: rest.y, t: 0, moved: true, lx: rest.x, ly: rest.y} : null;
    }
    return;
  }
  if (e.type === 'pointerup' && tap && !tap.moved && Date.now() - tap.t < 600) onTap(tap);
  tap = null;
}
cv.onpointerup = cv.onpointercancel = liftTouch;
cv.onpointermove = e => {
  if (e.pointerType !== 'mouse') return moveTouch(e);
  if (drag) { moved(); V.ox += e.clientX - drag.x; V.oy += e.clientY - drag.y; drag = {x: e.clientX, y: e.clientY}; $('tip').style.display = 'none'; draw(); return; }
  hover(e);
};
cv.onwheel = e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = e.deltaY < 0 ? 1.25 : 0.8;
  V.ox = mx - (mx - V.ox) * k; V.oy = my - (my - V.oy) * k; V.s *= k;
  moved(); draw();
};
cv.onpointerleave = e => { if (e.pointerType === 'mouse') $('tip').style.display = 'none'; };    // у касания «уход» приходит сразу после отпускания
cv.addEventListener('gesturestart', e => e.preventDefault());    // Safari: щипок по карте не должен масштабировать страницу
/* Приблизить в k раз вокруг точки (mx, my): короткая плавная анимация */
function zoomAt(mx, my, k) {
  const s0 = V.s, ox0 = V.ox, oy0 = V.oy, t0 = performance.now(), dur = 180;
  moved();
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), kk = Math.pow(k, 1 - Math.pow(1 - t, 3));
    V.s = s0 * kk; V.ox = mx - (mx - ox0) * kk; V.oy = my - (my - oy0) * kk;
    draw();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function onTap(p) {
  const now = Date.now();
  if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 32) {     // двойной тап
    lastTap = null; $('tip').style.display = 'none'; zoomAt(p.x, p.y, 2); return;
  }
  lastTap = {x: p.x, y: p.y, t: now};
  showTip(p.x, p.y, 24);                                    // палец неточнее мыши: радиус поиска точки больше
}
function nearest(a, step, mx, my, best) {
  for (let i = 0; i < a.length; i += step) {
    const dx = (a[i] * V.c - a[i + 1] * V.n) * V.s + V.ox - mx, dy = V.oy - (a[i] * V.n + a[i + 1] * V.c) * V.s - my, q = dx * dx + dy * dy;
    if (q < best.q) { best.q = q; best.i = i; best.a = a; }
  }
}
function hover(e) { const p = local(e); showTip(p.x, p.y, 10); }
function showTip(mx, my, radius) {
  const r = cv.getBoundingClientRect(), best = {q: radius * radius, i: -1, a: null};
  if ($('lField').checked) nearest(F.field, 6, mx, my, best);
  if ($('lRazm').checked) nearest(P.razm, 4, mx, my, best);
  if ($('lPodm').checked) nearest(P.podm, 4, mx, my, best);
  if ($('lLeft').checked) nearest(F.left, 4, mx, my, best);
  if ($('lLost').checked) nearest(F.lost, 4, mx, my, best);
  const t = $('tip');
  if (best.i < 0) { t.style.display = 'none'; return; }
  const a = best.a, i = best.i;
  let s = 'Линия ' + a[i + 2] + ', ПП ' + a[i + 3];
  if (a === F.field) s += ' — на поле с ' + dru(F.dates[a[i + 4]]) + ', ' + F.names[a[i + 5]];
  else if (a === F.left) s += ' — оставленное оборудование';
  else if (a === F.lost) s += ' — утерянное оборудование';
  else s += a === P.razm ? ' — размотано за период' : ' — подмотано за период';
  t.textContent = s; t.style.display = 'block';
  t.style.left = Math.max(8, Math.min(mx + 14, r.width - t.offsetWidth - 8)) + 'px';
  t.style.top = (radius > 10 && my - 34 - t.offsetHeight < 8 ? my + 22 : Math.max(my - 34, 8)) + 'px';
}
for (const id of ['lSps', 'lField', 'lLeft', 'lLost']) $(id).onchange = draw;
for (const id of ['lRazm', 'lPodm']) $(id).onchange = loadPeriod;
for (const id of ['mFrom', 'mTo']) $(id).onchange = () => { [...$('mPresets').children].forEach(x => x.classList.remove('on')); loadPeriod(); };
$('mFit').onclick = fit;
/* Наклон: ползунок, выравнивание профилей по горизонтали и возврат вида */
$('mTilt').oninput = () => tilt($('mTilt').value);
$('mTilt').ondblclick = () => tilt(0);
$('mLevel').onclick = () => {
  if (!B) return toast('Выравнивать пока нечего: на карте нет точек.');
  const deg = Math.round(F.line_angle || 0);
  if (deg === V.deg) return toast(deg ? 'Профили уже идут горизонтально.' : 'Профили идут горизонтально и без наклона.');
  tilt(deg); fit();
};
$('mReset').onclick = () => { tilt(0); fit(); };
$('mNorth').onclick = () => tilt(0);

/* Полноэкранный режим: карта с панелью инструментов занимает всё окно, а окно разворачивается на весь экран.
   Выход - той же кнопкой или клавишей Esc. Середина карты и видимая область при этом сохраняются. */
function setFull(on) {
  const wrap = $('fieldWrap');
  if (wrap.classList.contains('full') === on) return;
  wrap.classList.toggle('full', on);
  document.body.classList.toggle('mapfull', on);
  for (const id of ['mFull', 'mFullSide']) $(id).setAttribute('aria-pressed', on);
  $('mFull').title = on ? (isTouch() ? 'Выйти из полноэкранного режима' : 'Выйти из полноэкранного режима (Esc)') : 'На весь экран';
  $('mFull').setAttribute('aria-label', $('mFull').title);
  $('mFullSide').textContent = on ? 'Выйти из полного экрана' : 'На весь экран';
  reframe();
  const root = document.documentElement;
  // На сенсорных экранах полноэкранный режим - «псевдо»: карта растягивается на всё окно (position:fixed), Fullscreen API не нужен
  if (isTouch()) return;
  try {
    if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch (err) { /* окно не умеет разворачиваться: карта всё равно занимает его целиком */ }
}
const isFull = () => $('fieldWrap').classList.contains('full');
$('mFull').onclick = $('mFullSide').onclick = () => setFull(!isFull());
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && isFull()) setFull(false); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !isFull() || $('veil').style.display === 'flex' || document.querySelector('.palette')) return;
  setFull(false);
});
window.addEventListener('hashchange', () => setFull(false));
window.onresize = reframe;
/* Поворот телефона, смена размера окна и панелей: холст пересчитывается, середина карты остаётся на месте */
(function watchSize() {
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(reframe, 60); };
  window.addEventListener('orientationchange', () => setTimeout(reframe, 250));
  if (window.ResizeObserver) new ResizeObserver(later).observe($('mapBox'));
  if (window.visualViewport) visualViewport.addEventListener('resize', later);
})();

/* ---------- топографическая подложка ---------- */
const U_NAMES = ['Левый верхний', 'Правый верхний', 'Правый нижний', 'Левый нижний'];

/* Преобразование «пиксель картинки -> координаты»: X = a·px + b·py + c, Y = d·px + e·py + f.
   Два противоположных угла - подложка без поворота. Три и больше - с поворотом и перекосом;
   при четырёх углах подбирается наилучшее и считается невязка: она показывает ошибку в координатах. */
function underlayTransform(w, h, corners) {
  const px = [[0, 0], [w, 0], [w, h], [0, h]];
  const pts = corners.map((c, i) => c ? {u: px[i][0], v: px[i][1], x: c[0], y: c[1]} : null).filter(Boolean);
  if (pts.length < 2) return null;
  let t;
  if (pts.length === 2) {
    const [p, q] = pts;
    if (p.u === q.u || p.v === q.v) return null;
    const a = (q.x - p.x) / (q.u - p.u), e = (q.y - p.y) / (q.v - p.v);
    t = {a, b: 0, c: p.x - a * p.u, d: 0, e, f: p.y - e * p.v};
  } else {
    // наименьшие квадраты: решаем систему 3×3 отдельно для X и для Y
    let suu = 0, suv = 0, su = 0, svv = 0, sv = 0, n = pts.length, bx = [0, 0, 0], by = [0, 0, 0];
    for (const p of pts) {
      suu += p.u * p.u; suv += p.u * p.v; su += p.u; svv += p.v * p.v; sv += p.v;
      bx[0] += p.u * p.x; bx[1] += p.v * p.x; bx[2] += p.x;
      by[0] += p.u * p.y; by[1] += p.v * p.y; by[2] += p.y;
    }
    const m = [[suu, suv, su], [suv, svv, sv], [su, sv, n]];
    const det = r => r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
    const D = det(m);
    if (!D) return null;
    const solve = rhs => [0, 1, 2].map(k => det(m.map((row, i) => row.map((val, j) => j === k ? rhs[i] : val))) / D);
    const [a, b, c] = solve(bx), [d, e, f] = solve(by);
    t = {a, b, c, d, e, f};
  }
  if (!(Math.abs(t.a * t.e - t.b * t.d) > 0)) return null;
  t.residual = Math.max(...pts.map(p => Math.hypot(t.a * p.u + t.b * p.v + t.c - p.x, t.d * p.u + t.e * p.v + t.f - p.y)));
  return t;
}
const underlayPoint = (t, u, v) => [t.a * u + t.b * v + t.c, t.d * u + t.e * v + t.f];

/* Выбранная подложка, если её картинка уже загружена */
function underlayNow() { const u = U.cache[U.active]; return u && u.img && u.t ? u : null; }

/* Список подложек в панели справа: щелчок по строке переключает, «⋯» открывает привязку */
function renderUnderlays() {
  const row = (id, name, edit) => `<div class="urow${id === U.active ? ' on' : ''}" data-id="${id}" title="${esc(name)}"><span class="uradio"></span>` +
    `<span class="uname">${esc(name)}</span>${edit ? '<button class="icon-btn" data-edit title="Привязка, название, удаление">⋯</button>' : ''}</div>`;
  $('uList').innerHTML = U.items.length ? row(0, 'Без подложки', false) + U.items.map(i => row(i.id, i.name, true)).join('') : '';
  const cur = U.items.find(i => i.id === U.active);
  $('uAlphaRow').hidden = !cur;
  if (cur) $('uAlpha').value = cur.opacity || 0.7;
}
async function loadUnderlays() {
  await colorsReady;
  U.items = (await api('/api/underlays')).items || [];
  if (U.active === 0 && !U.restored) { U.restored = true; U.active = +PREFS.map_underlay || 0; }
  if (!U.items.some(i => i.id === U.active)) U.active = 0;
  renderUnderlays();
  await ensureUnderlay();
}
/* Картинка подложки загружается при первом выборе и остаётся в памяти */
async function ensureUnderlay() {
  const item = U.items.find(i => i.id === U.active);
  if (!item) return;
  let u = U.cache[item.id];
  if (!u || u.stamp !== item.stamp) {
    const img = new Image();
    // картинку отдаёт движок приложения, а не сервер: <img src> до него не достучится, поэтому через fetch и blob-адрес
    let url = null;
    try { const r = await fetch(`/api/underlay/image?id=${item.id}&v=${item.stamp}`); if (r.ok) url = URL.createObjectURL(await r.blob()); } catch (err) { /* не открылась */ }
    if (url) await new Promise(res => { img.onload = res; img.onerror = res; img.src = url; });
    if (u && u.url) URL.revokeObjectURL(u.url);
    u = U.cache[item.id] = {img: img.naturalWidth ? img : null, stamp: item.stamp, url};
  }
  u.t = u.img ? underlayTransform(u.img.naturalWidth, u.img.naturalHeight, item.corners) : null;
}
async function selectUnderlay(id) {
  U.active = id;
  renderUnderlays();
  post('/api/prefs', {map_underlay: id}).catch(() => {});
  await ensureUnderlay();
  if (id && !underlayNow()) toast('Картинку не удалось открыть. Сохраните подложку как PNG или JPG.');
  draw();
}
$('uList').onclick = e => {
  const row = e.target.closest('.urow');
  if (!row) return;
  const id = +row.dataset.id;
  if (e.target.closest('[data-edit]')) underlayDialog(U.items.find(i => i.id === id));
  else if (id !== U.active) selectUnderlay(id);
};
let alphaTimer = 0;
$('uAlpha').oninput = () => {
  const cur = U.items.find(i => i.id === U.active);
  if (!cur) return;
  cur.opacity = +$('uAlpha').value; draw();
  clearTimeout(alphaTimer); alphaTimer = setTimeout(() => post('/api/underlay', {id: cur.id, opacity: cur.opacity}).catch(() => {}), 400);
};

/* Окно привязки: название, файл и координаты углов. item - подложка для правки, без него создаётся новая. */
function underlayForm(values, name, isNew, message) {
  const rows = U_NAMES.map((n, i) => `<tr><td>${n}</td><td><input class="uc" data-i="${i}" data-k="0" value="${esc(values[i][0])}" inputmode="decimal"></td>` +
    `<td><input class="uc" data-i="${i}" data-k="1" value="${esc(values[i][1])}" inputmode="decimal"></td></tr>`).join('');
  return `<p>Координаты углов картинки в той же системе, что X и Y на листе SPS.</p>` +
    `<label for="uName">Название в списке</label><input class="wide" id="uName" value="${esc(name)}" placeholder="По имени файла" maxlength="120">` +
    `<label for="uFile" style="margin-top:12px">Файл подложки (PNG, JPG, BMP)</label><input type="file" id="uFile" accept=".png,.jpg,.jpeg,.bmp,.webp,.gif,.tif,.tiff">` +
    (isNew ? '' : `<div class="uhint">Чтобы оставить прежнюю картинку, файл не выбирайте.</div>`) +
    `<table class="utable"><tr><th>Угол</th><th>X</th><th>Y</th></tr>${rows}</table>` +
    `<div class="uhint">Можно вставить все углы разом из Excel: четыре строки по два числа. Если подложка не повёрнута, хватит двух противоположных углов.</div>` +
    (message ? `<div class="uerr">${esc(message)}</div>` : '') +
    (isNew ? '' : `<button class="btn small danger" id="uRemove" type="button">Убрать подложку</button>`);
}
async function underlayDialog(item) {
  let id = item ? item.id : null, name = item ? item.name : '', message = '', file = null;
  let values = [0, 1, 2, 3].map(i => item && item.corners[i] ? item.corners[i].map(v => String(v).replace('.', ',')) : ['', '']);
  for (;;) {
    const answer = ask(item ? 'Подложка «' + item.name + '»' : 'Добавить подложку', underlayForm(values, name, !item, message), item ? 'Сохранить' : 'Привязать');
    const body = $('dBody'), inputs = () => [...body.querySelectorAll('.uc')];
    body.querySelector(item ? '.uc' : '#uFile').focus();
    body.onpaste = e => {                       // вставка блока чисел из Excel раскладывается по ячейкам
      const nums = e.clipboardData.getData('text/plain').split(/[\t\r\n;]+/).map(s => s.replace(/[\s ]/g, '')).filter(s => s !== '' && gxParseNum(s) !== null);
      if (nums.length < 2 || !e.target.classList.contains('uc')) return;
      e.preventDefault();
      const all = inputs(), start = all.indexOf(e.target);
      nums.forEach((n, k) => { if (all[start + k]) all[start + k].value = n; });
    };
    let removed = false;
    if ($('uRemove')) $('uRemove').onclick = () => { removed = true; $('dNo').click(); };
    const ok = await answer;
    body.onpaste = null;
    if (removed) {
      if (await ask('Убрать подложку?', '<p>Картинка «' + esc(item.name) + '» и её привязка будут удалены из программы. Исходный файл на диске останется.</p>', 'Убрать')) {
        await post('/api/underlay/remove', {id});
        delete U.cache[id];
        if (U.active === id) { U.active = 0; post('/api/prefs', {map_underlay: 0}).catch(() => {}); }
        await loadUnderlays(); draw(); toast('Подложка убрана.');
      }
      return;
    }
    if (!ok) return;
    values = [0, 1, 2, 3].map(i => [0, 1].map(k => body.querySelector(`.uc[data-i="${i}"][data-k="${k}"]`).value.trim()));
    name = $('uName').value.trim();
    file = $('uFile').files[0] || file;
    const corners = values.map(v => v[0] === '' && v[1] === '' ? null : v);
    if (!file && !id) { message = 'Выберите файл подложки.'; continue; }
    const checked = await post('/api/underlay/check', {corners});          // углы проверяются до передачи файла
    if (checked.error) { message = checked.error; continue; }
    if (file) {
      let up;
      try { up = await api('/api/underlay/image?name=' + encodeURIComponent(file.name) + (id ? '&id=' + id : ''), {method: 'POST', body: file}); }
      catch (err) { up = {error: 'Не удалось передать файл подложки.'}; }
      if (up.error) { message = up.error; file = null; continue; }
      id = up.id; file = null;
    }
    const meta = {id, corners};
    if (name) meta.name = name;
    const saved = await post('/api/underlay', meta);
    if (saved.error) { message = saved.error; continue; }
    delete U.cache[id];
    U.active = id;
    post('/api/prefs', {map_underlay: id}).catch(() => {});
    await loadUnderlays();
    const u = underlayNow();
    if (!u) { toast('Картинку не удалось открыть. Сохраните подложку как PNG или JPG.'); draw(); return; }
    draw();
    toast((item ? 'Подложка сохранена.' : 'Подложка привязана.') + (u.t.residual > 0.01 ? ' Невязка по углам: ' + nf(Math.round(u.t.residual * 10) / 10) + ' м.' : ''));
    return;
  }
}
$('uBtn').onclick = () => underlayDialog(null);
