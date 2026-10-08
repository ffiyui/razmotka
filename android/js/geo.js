/* Моё местоположение на карте поля. GPS (широта, долгота) переводится в систему листа SPS проекцией Гаусса-Крюгера
   (по умолчанию ГСК-2011, зона 10, восток без номера зоны). Если GPS даёт сдвиг, можно встать на пикет с известным
   номером: сдвиг запоминается и прибавляется ко всем следующим положениям.
   Сторона карты - js/map.js: он вызывает geoDraw() в конце отрисовки. */
(() => {
  const G = {
    on: false, watch: null, follow: false, course: false, fix: null, xy: null, near: null, centered: false,
    proj: null, calib: null, recent: [], err: '',
  };
  window.GEO = G;
  window.geoStart = () => start();                                            // состояние доступно из проверок и из js/data.js

  const fmt = (n, d = 0) => Number(n).toFixed(d).replace('.', ',');
  const secure = window.isSecureContext !== false;

  /* ---------- система координат ---------- */
  async function loadCrs() {
    let crs = {ellipsoid: 'gsk2011', zone: 10};
    try { const r = await fetch('/api/crs'); const j = await r.json(); if (j && j.ellipsoid) crs = j; } catch (e) { /* настольный сервер без этого адреса */ }
    try { G.proj = RZ.gk.make(crs.ellipsoid, crs.zone); } catch (e) { G.proj = RZ.gk.make('gsk2011', 10); }
    G.crs = crs;
    if (G.fix) project();
  }
  window.geoReloadCrs = loadCrs;

  /* Положение на карте с учётом привязки: «сырое» из GPS + сдвиг */
  function project() {
    if (!G.fix || !G.proj) return;
    const [e, n] = G.proj.fwd(G.fix.lat, G.fix.lon);
    G.raw = [e, n];
    const c = G.calib;
    G.xy = [e + (c ? c.dx : 0), n + (c ? c.dy : 0)];
  }

  /* ---------- сохранение привязки: вместе с остальными настройками вида (входит в копию данных) ---------- */
  async function loadCalib() {
    try { await colorsReady; } catch (e) { /* не критично */ }
    const c = (PREFS && PREFS.geo_calib) || null;
    G.calib = c && Number.isFinite(c.dx) && Number.isFinite(c.dy) ? c : null;
    if (G.fix) project();
    status();
  }
  const saveCalib = () => post('/api/prefs', {geo_calib: G.calib}).catch(() => {});

  /* ---------- включение и выключение ---------- */
  function start() {
    if (G.on) return;
    G.err = '';
    if (!navigator.geolocation) { G.err = 'Это устройство не умеет определять местоположение.'; return status(); }
    if (!secure) { G.err = 'GPS работает только на защищённом адресе (https). Откройте приложение по https-ссылке.'; return status(); }
    G.on = true; G.centered = false;
    G.watch = navigator.geolocation.watchPosition(onFix, onErr, {enableHighAccuracy: true, maximumAge: 1000, timeout: 30000});
    sync();
  }
  function stop() {
    if (G.watch !== null) navigator.geolocation.clearWatch(G.watch);
    Object.assign(G, {on: false, watch: null, follow: false, course: false, fix: null, xy: null, near: null, recent: []});
    $('gCourse').checked = false;
    sync(); draw();
  }

  function onErr(e) {
    const text = {1: ANDROID ? 'Нет доступа к геолокации. Включите «Местоположение» и разрешите его этому приложению (или Chrome): Настройки → Приложения → Разрешения → Местоположение.'
      : 'Нет доступа к геолокации. Разрешите её: Настройки → Конфиденциальность → Службы геолокации → Safari (или это приложение).',
      2: 'Положение сейчас определить не получается. Выйдите на открытое место.', 3: 'Положение не определилось вовремя. Подождите или выйдите на открытое место.'}[e.code];
    G.err = text || 'Ошибка геолокации.';
    if (e.code === 1) { stop(); G.err = text; }
    status();
  }

  /* ---------- новое положение ---------- */
  function onFix(p) {
    const c = p.coords;
    G.err = '';
    G.fix = {lat: c.latitude, lon: c.longitude, acc: c.accuracy, heading: Number.isFinite(c.heading) ? c.heading : null,
      speed: Number.isFinite(c.speed) ? c.speed : null, ts: p.timestamp};
    project();
    if (G.raw) { G.recent.push([G.raw[0], G.raw[1], p.timestamp]); if (G.recent.length > 8) G.recent.shift(); }
    sync();
    locate();
    nearestPicket();
    status();
    if (!G.centered) { G.centered = true; centerOnMe(true); }
    else if (G.follow) centerOnMe(false);
    if (G.course) applyCourse();
    if (window.workFix && G.xy && !F.schematic) workFix(G.xy, c.accuracy, p.timestamp);   // задание и запись трека (js/work.js)
    draw();
  }
  /* Для внешних проверок: подставляет положение вместе с курсом и скоростью (браузер их подделывать не умеет) */
  window.geoInject = (c) => onFix({coords: {latitude: c.lat, longitude: c.lon, accuracy: c.acc ?? 5, heading: c.heading ?? null, speed: c.speed ?? null}, timestamp: Date.now()});

  /* ---------- ближайший пикет (не чаще раза в секунду) ---------- */
  let nearAt = 0, nearBusy = false;
  async function nearestPicket() {
    const now = Date.now();
    if (nearBusy || !G.xy || now - nearAt < 1000 || F.schematic) return;
    nearAt = now; nearBusy = true;
    try { const j = await api(`/api/nearest?x=${G.xy[0]}&y=${G.xy[1]}`); G.near = j && j.line !== undefined ? j : null; }
    catch (e) { G.near = null; }
    nearBusy = false; status();
  }

  /* ---------- вид карты ---------- */
  const isOn = () => G.on && G.xy && !F.schematic;
  function geoTilt(deg) {                                   // как tilt() из map.js, но без записи в настройки
    const r = $('mapBox').getBoundingClientRect(), mid = toWorld(r.width / 2, r.height / 2);
    setAngle(deg);
    const now = toScreen(mid[0], mid[1]);
    V.ox += r.width / 2 - now[0]; V.oy += r.height / 2 - now[1];
  }
  function centerOnMe(zoom) {
    if (!isOn()) return;
    const r = $('mapBox').getBoundingClientRect();
    if (!r.width) return;
    if (zoom && V.s < r.width / 600) V.s = r.width / 400;    // из общего вида приближаем до 400 м в ширину
    const [sx, sy] = toScreen(G.xy[0], G.xy[1]);
    V.ox += r.width / 2 - sx; V.oy += r.height / 2 - sy;
    V.fitted = false; $('mReset').disabled = false;
  }
  /* Направление движения в сетке карты: курс GPS отсчитывается от истинного севера, сетка повёрнута на сближение меридианов */
  function gridHeading() {
    const f = G.fix;
    if (!f || f.heading === null || !(f.speed > 0.7) || !G.proj) return null;
    return f.heading - G.proj.convergence(f.lat, f.lon);
  }
  let lastDeg = null;
  function applyCourse() {
    const h = gridHeading();
    if (h === null) return;
    const deg = Math.round(-h);                              // впереди - вверх экрана: угол наклона противоположен курсу
    if (lastDeg !== null && Math.abs(((deg - lastDeg + 540) % 360) - 180) < 4) return;   // мелкое дрожание курса не поворачивает карту
    lastDeg = deg; geoTilt(deg);
    if (G.follow) centerOnMe(false);
  }

  /* ---------- рисование поверх карты ---------- */
  window.geoDraw = function (ctx, d) {
    if (!isOn()) return;
    const [sx, sy] = toScreen(G.xy[0], G.xy[1]), w = cv.clientWidth, h = cv.clientHeight, f = G.fix;
    const out = sx < 0 || sy < 0 || sx > w || sy > h;
    ctx.save();
    if (out) {                                               // за краем окна: стрелка у края в сторону «я»
      const m = 22, x = Math.max(m, Math.min(w - m, sx)), y = Math.max(m, Math.min(h - m, sy)), a = Math.atan2(sy - h / 2, sx - w / 2);
      ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = '#0A84FF'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -9); ctx.lineTo(-3, 0); ctx.lineTo(-7, 9); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore(); return;
    }
    const R = Math.max(0, f.acc * V.s);
    if (R > 6) {                                             // круг точности
      ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.2832);
      ctx.fillStyle = 'rgba(10,132,255,.13)'; ctx.fill();
      ctx.strokeStyle = 'rgba(10,132,255,.38)'; ctx.lineWidth = 1; ctx.stroke();
    }
    const gh = gridHeading();
    if (gh !== null) {                                       // направление движения: луч-«фонарик»
      const dx = Math.sin(gh * Math.PI / 180), dy = Math.cos(gh * Math.PI / 180);
      const ux = dx * V.c - dy * V.n, uy = -(dx * V.n + dy * V.c), a = Math.atan2(uy, ux);
      const g = ctx.createRadialGradient(sx, sy, 6, sx, sy, 46);
      g.addColorStop(0, 'rgba(10,132,255,.55)'); g.addColorStop(1, 'rgba(10,132,255,0)');
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, 46, a - .5, a + .5); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath(); ctx.arc(sx, sy, 6.4, 0, 6.2832); ctx.fillStyle = '#0A84FF'; ctx.fill();
    ctx.restore();
  };

  /* ---------- привязка на известном пикете ---------- */
  async function calibrate() {
    if (!isOn()) return toast('Сначала включите «Показать меня» и дождитесь положения.');
    if (G.fix.acc > 25 && !await ask('Положение неточное', `<p>Точность сейчас около ${fmt(G.fix.acc)} м. Привязка по такому положению получится неточной. Выйдите на открытое место и подождите, пока точность станет лучше 10 м.</p>`, 'Всё равно привязать')) return;
    const last = remember('geo_last') || '';
    const html = `<p>Встаньте прямо на пикет с известным номером и введите его. Все положения на карте сдвинутся так, чтобы вы оказались на этом пикете.</p>
      <div class="row" style="gap:10px"><div><label for="gcLine">Линия</label><input id="gcLine" type="number" inputmode="numeric" style="width:100%" value="${esc(last.split(',')[0] || '')}"></div>
      <div><label for="gcPick">Пикет</label><input id="gcPick" type="number" inputmode="numeric" style="width:100%" value="${esc(last.split(',')[1] || '')}"></div></div>
      <p class="gc-msg" id="gcMsg" style="color:var(--muted);font-size:13px;margin:8px 0 0"></p>`;
    if (!await ask('Я стою на пикете', html, 'Привязать')) return;
    const line = parseInt($('gcLine').value, 10), picket = parseInt($('gcPick').value, 10);
    if (!(line > 0) || !(picket > 0)) return toast('Введите номер линии и пикета.');
    const k = await api(`/api/picket?line=${line}&picket=${picket}`);
    if (!k || k.x === undefined) return toast(`Пикета ${picket} на линии ${line} нет в листе SPS.`);
    // среднее по последним положениям: единичный отсчёт GPS шумит на метры
    const pts = G.recent.filter(p => Date.now() - p[2] < 15000), use = pts.length ? pts : G.recent;
    const mx = use.reduce((s, p) => s + p[0], 0) / use.length, my = use.reduce((s, p) => s + p[1], 0) / use.length;
    G.calib = {dx: k.x - mx, dy: k.y - my, line, picket, n: use.length, ts: new Date().toISOString().slice(0, 16)};
    remember('geo_last', line + ',' + picket);
    saveCalib(); project(); nearestPicket(); status(); sync(); draw();
    toast(`Привязано к линии ${line}, пикету ${picket}: сдвиг ${fmt(Math.hypot(G.calib.dx, G.calib.dy), 1)} м.`);
  }
  function calibReset() { G.calib = null; saveCalib(); project(); nearestPicket(); status(); sync(); draw(); toast('Привязка сброшена.'); }

  /* ---------- панель ---------- */
  function sync() {
    const on = G.on;
    $('gLocate').textContent = on ? 'Скрыть меня' : 'Показать меня';
    $('gFollow').hidden = !on; $('gCourseRow').hidden = !on;
    $('gCalib').hidden = !on; $('gCalibReset').hidden = !G.calib;
    $('gFollow').setAttribute('aria-pressed', G.follow); $('gFollow').classList.toggle('on', G.follow);
    $('gBtn').classList.toggle('on', on); $('gBtn').setAttribute('aria-pressed', G.follow);
    $('gBtn').title = !on ? 'Показать моё местоположение' : G.follow ? 'Перестать следить' : 'Следить за мной';
  }
  function status() {
    const el = $('gStat'), f = G.fix, parts = [];
    if (window.workStatus) workStatus();
    if (G.err) { el.textContent = G.err; el.className = 'gstat bad'; return; }
    el.className = 'gstat';
    if (F && F.schematic && G.on) { el.textContent = 'Карта нарисована схемой, без координат. Заполните лист SPS, чтобы видеть себя на карте.'; return; }
    if (!G.on) { el.textContent = ''; return; }
    if (!f) { el.textContent = 'Определяю положение…'; return; }
    parts.push(`точность ±${fmt(f.acc)} м`);
    if (G.near) parts.push(`ближайший пикет: линия ${G.near.line}, ПП ${G.near.picket} (${fmt(G.near.dist)} м)`);
    else if (G.xy && !F.schematic) parts.push('рядом нет пикетов SPS');
    if (G.calib) parts.push(`привязка: сдвиг ${fmt(Math.hypot(G.calib.dx, G.calib.dy), 1)} м (линия ${G.calib.line}, ПП ${G.calib.picket})`);
    el.textContent = parts.join(' · ');
  }
  function locate() { /* положение вне карты поля: стрелка у края рисуется в geoDraw */ }

  const toggle = () => (G.on ? stop() : start());
  $('gLocate').onclick = toggle;
  $('gBtn').onclick = () => {
    if (!G.on) { start(); return; }
    if (!isOn()) return;
    if (!G.follow) { G.follow = true; centerOnMe(false); draw(); } else G.follow = false;
    sync();
  };
  $('gFollow').onclick = () => { G.follow = !G.follow; if (G.follow) { centerOnMe(false); draw(); } sync(); };
  $('gCourse').onchange = () => {
    G.course = $('gCourse').checked; lastDeg = null;
    if (G.course) { G.follow = true; sync(); if (gridHeading() === null) toast('Карта повернётся по ходу, когда вы пойдёте (нужна скорость больше 2–3 км/ч).'); applyCourse(); centerOnMe(false); draw(); }
  };
  $('gCalib').onclick = calibrate;
  $('gCalibReset').onclick = calibReset;
  // ручной сдвиг карты выключает слежение: иначе карта вырывалась бы из-под пальца
  (() => {
    let down = null;
    cv.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY}; });
    cv.addEventListener('pointermove', e => {
      if (down && G.follow && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { G.follow = false; sync(); }
    });
    const up = () => { down = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', () => { if (G.follow) { G.follow = false; sync(); } }, {passive: true});
  })();
  // свернули приложение - iOS приостанавливает GPS: при возвращении подписка заводится заново
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !G.on) return;
    navigator.geolocation.clearWatch(G.watch);
    G.watch = navigator.geolocation.watchPosition(onFix, onErr, {enableHighAccuracy: true, maximumAge: 1000, timeout: 30000});
  });
  loadCrs(); loadCalib(); sync(); status();
})();
