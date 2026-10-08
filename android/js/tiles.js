/* Карта-подложка из интернета (Google, Esri, OpenStreetMap). Привязывать её не нужно: плитки приходят в проекции
   Web Mercator, каждая переводится в систему листа SPS (Гаусс-Крюгер, та же, что у GPS) и ложится под точки.
   Сдвиг привязки «я стою на пикете» действует и на подложку. Просмотренные плитки сохраняются в телефоне
   (кэш rz-tiles-v1, его ведёт sw.js), участок можно сохранить заранее кнопкой - тогда карта видна и без сети. */
(function () {
  'use strict';
  const g = (l, hi) => (x, y, z) => `https://mt${(x + y) % 4}.google.com/vt/lyrs=${l}&hl=ru&x=${x}&y=${y}&z=${z}${hi ? '&scale=2' : ''}`;
  const SRC = {
    gsat: {name: 'Google: спутник', url: g('s', 1), max: 20, hi: 1, att: '© Google'},
    ghyb: {name: 'Google: спутник с подписями', url: g('y', 1), max: 20, hi: 1, att: '© Google'},
    gmap: {name: 'Google: схема', url: g('m', 1), max: 20, hi: 1, att: '© Google'},
    esri: {name: 'Esri: спутник', url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, att: '© Esri, Maxar'},
    osm: {name: 'OpenStreetMap: схема', url: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, att: '© OpenStreetMap'},
  };
  const TC = 'rz-tiles-v1', LIMIT = 400, SAVE_MAX = 4000;
  const T = {src: '', alpha: 1, tiles: new Map(), last: null, saving: false};
  window.TILES = T;
  const {PI, log2, cos, tan, atan, sinh, asinh, round, floor, min, max} = Math;
  const rad = d => d * PI / 180, deg = r => r * 180 / PI;
  const lonX = (lon, n) => (lon + 180) / 360 * n, latY = (lat, n) => (1 - asinh(tan(rad(lat))) / PI) / 2 * n;
  const xLon = (x, n) => x / n * 360 - 180, yLat = (y, n) => deg(atan(sinh(PI * (1 - 2 * y / n))));
  const shift = () => { const c = window.GEO && GEO.calib; return c ? [c.dx, c.dy] : [0, 0]; };
  const corsKey = id => 'tiles_mode_' + id;
  const mode = id => { try { return localStorage.getItem(corsKey(id)) || 'cors'; } catch (e) { return 'cors'; } };

  /* ---------- загрузка плиток ---------- */
  let raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  function tile(id, z, x, y, want) {
    const key = id + '/' + z + '/' + x + '/' + y;
    let t = T.tiles.get(key);
    if (t) { T.tiles.delete(key); T.tiles.set(key, t); }                  // недавно нужные - в конец очереди
    if (!want) return t && t.ok ? t : null;
    if (t && (t.ok || t.busy || Date.now() - t.failed < 15000)) return t.ok ? t : null;
    t = {ok: false, busy: true, failed: 0, img: new Image()};
    T.tiles.set(key, t);
    if (T.tiles.size > LIMIT) for (const k of T.tiles.keys()) { if (T.tiles.size <= LIMIT * .8) break; if (!T.tiles.get(k).busy) T.tiles.delete(k); }
    const m = mode(id), img = t.img;
    if (m === 'cors') img.crossOrigin = 'anonymous';
    img.onload = () => { t.ok = true; t.busy = false; redraw(); };
    img.onerror = () => {
      t.busy = false; t.failed = Date.now();
      if (m === 'cors' && navigator.onLine !== false && !T['tried_' + id]) {       // сервер не разрешает CORS: дальше берём плитки обычным способом
        T['tried_' + id] = true;
        const probe = new Image();
        probe.onload = () => { try { localStorage.setItem(corsKey(id), 'no-cors'); } catch (e) { /* без памяти */ } T.tiles.clear(); redraw(); };
        probe.src = img.src;
      }
    };
    img.src = SRC[id].url(x, y, z);
    return null;
  }

  /* Что видно: прямоугольник в плитках выбранного уровня */
  function view(d) {
    const S = SRC[T.src], proj = window.GEO && GEO.proj;
    if (!S || !proj || !(V.s > 0)) return null;
    const w = cv.clientWidth, h = cv.clientHeight, [dx, dy] = shift();
    const ll = [[0, 0], [w, 0], [w, h], [0, h], [w / 2, h / 2]].map(p => { const q = toWorld(p[0], p[1]); return proj.inv(q[0] - dx, q[1] - dy); });
    if (ll.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 84)) return null;
    const lat0 = ll[4][0];
    let z = round(log2(156543.03392 * cos(rad(lat0)) * V.s) + (S.hi || d < 1.5 ? 0 : .5));
    z = max(3, min(S.max, z));
    let b;
    for (; z >= 3; z--) {
      const n = 2 ** z, xs = ll.map(p => lonX(p[1], n)), ys = ll.map(p => latY(p[0], n));
      b = {z, n, x0: floor(min(...xs)), x1: floor(max(...xs)), y0: max(0, floor(min(...ys))), y1: min(n - 1, floor(max(...ys)))};
      if ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) <= 150) break;
    }
    return z >= 3 ? b : null;
  }

  window.tilesDraw = function (ctx, d) {
    const b = view(d);
    T.last = b;
    if (!b) return;
    const proj = GEO.proj, [dx, dy] = shift(), id = T.src, {z, n} = b;
    const pts = new Map();
    const pt = (x, y) => {                                   // угол плитки -> экран
      const k = x + ',' + y; let p = pts.get(k);
      if (!p) { const q = proj.fwd(yLat(y, n), xLon(x, n)); p = toScreen(q[0] + dx, q[1] + dy); pts.set(k, p); }
      return p;
    };
    ctx.globalAlpha = T.alpha;
    ctx.imageSmoothingQuality = 'high';
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const xx = ((x % n) + n) % n;
      let t = tile(id, z, xx, y, true), sx = 0, sy = 0, sw = 1;
      for (let k = 1; !t && k <= 6 && z - k >= 0; k++) {     // пока плитка едет, показываем кусок более крупной
        const m = 2 ** k, a = tile(id, z - k, xx >> k, y >> k, false);
        if (a) { t = a; sw = 1 / m; sx = (xx - (xx >> k) * m) * sw; sy = (y - (y >> k) * m) * sw; }
      }
      if (!t) continue;
      const p = pt(x, y), q = pt(x + 1, y), r = pt(x, y + 1), W = t.img.naturalWidth, H = t.img.naturalHeight;
      ctx.setTransform(d * (q[0] - p[0]), d * (q[1] - p[1]), d * (r[0] - p[0]), d * (r[1] - p[1]), d * p[0], d * p[1]);
      ctx.drawImage(t.img, sx * W, sy * H, sw * W, sw * H, 0, 0, 1.004, 1.004);
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalAlpha = 1;
    const txt = SRC[id].att;                                 // подпись правообладателя
    ctx.font = '11px -apple-system,"Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'right';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.fillStyle = '#333';
    ctx.strokeText(txt, cv.clientWidth - 8, cv.clientHeight - 8); ctx.fillText(txt, cv.clientWidth - 8, cv.clientHeight - 8);
    ctx.textAlign = 'left';
  };

  /* ---------- сохранение участка для работы без сети ---------- */
  async function saved() { try { return (await caches.has(TC)) ? (await (await caches.open(TC)).keys()).length : 0; } catch (e) { return 0; } }
  async function status(text) {
    const n = await saved();
    $('tStat').textContent = text || (T.src ? (n ? `В телефоне сохранено плиток: ${n}. Они видны и без сети.` : 'Без сети видно только то, что уже просматривали или сохранили.') : '');
    $('tClear').hidden = !n || !T.src;
  }
  async function saveArea() {
    if (T.saving) { T.saving = false; return; }
    const b = T.last, S = SRC[T.src];
    if (!b || !S) return toast('Сначала включите подложку и откройте нужный участок.');
    if (!window.caches) return toast('Этот браузер не умеет хранить карты.');
    const list = [];
    for (let k = 0; k <= 3 && b.z + k <= S.max; k++) {
      const m = 2 ** k;
      for (let y = b.y0 * m; y < (b.y1 + 1) * m; y++) for (let x = b.x0 * m; x < (b.x1 + 1) * m; x++) list.push(S.url(x, y, b.z + k));
      if (list.length > SAVE_MAX) { list.length = 0; if (!k) break; k = 9; }
    }
    if (!list.length) {                                       // слишком широко даже для одного запаса масштаба: берём только то, что влезает
      for (let k = 0; k <= 3 && b.z + k <= S.max; k++) {
        const m = 2 ** k, cnt = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) * m * m;
        if (list.length + cnt > SAVE_MAX) break;
        for (let y = b.y0 * m; y < (b.y1 + 1) * m; y++) for (let x = b.x0 * m; x < (b.x1 + 1) * m; x++) list.push(S.url(x, y, b.z + k));
      }
    }
    if (!list.length) return toast('Участок слишком большой. Приблизьте карту и сохраняйте по частям.');
    T.saving = true; $('tSave').textContent = 'Остановить';
    const cache = await caches.open(TC), m = mode(T.src), viaSw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    let done = 0, bad = 0, i = 0;
    const worker = async () => {
      while (T.saving && i < list.length) {
        const url = list[i++];
        try {
          if (!(await cache.match(url))) {
            const r = await fetch(url, {mode: m});
            if (!r.ok && r.type !== 'opaque') bad++;
            else if (!viaSw) await cache.put(url, r);
          }
        } catch (e) { bad++; }
        if (++done % 20 === 0) $('tStat').textContent = `Сохраняю участок: ${done} из ${list.length}…`;
      }
    };
    await Promise.all(Array.from({length: 6}, worker));
    const stopped = !T.saving;
    T.saving = false; $('tSave').textContent = 'Сохранить участок для работы без сети';
    await status();
    toast(stopped ? 'Сохранение остановлено.' : bad ? `Сохранено ${done - bad} из ${list.length}: часть плиток не скачалась, повторите при хорошей связи.` : `Участок сохранён (${list.length} плиток, до ${min(3, S.max - b.z)} шагов приближения).`);
  }
  async function clearSaved() {
    if (!confirm('Удалить сохранённые в телефоне карты?')) return;
    try { await caches.delete(TC); } catch (e) { /* нечего удалять */ }
    status();
  }

  /* ---------- панель ---------- */
  function apply() {
    $('tAlphaRow').hidden = $('tSave').hidden = !T.src;
    $('tSrc').value = T.src; $('tAlpha').value = T.alpha;
    status(); draw();
  }
  let timer = 0;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => post('/api/prefs', {map_tiles: {src: T.src, alpha: T.alpha}}).catch(() => {}), 300); };
  $('tSrc').innerHTML = '<option value="">Выключена</option>' + Object.entries(SRC).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  $('tSrc').onchange = () => { T.src = SRC[$('tSrc').value] ? $('tSrc').value : ''; apply(); save(); };
  $('tAlpha').oninput = () => { T.alpha = +$('tAlpha').value; draw(); save(); };
  $('tSave').onclick = saveArea;
  $('tClear').onclick = clearSaved;
  window.addEventListener('online', () => { T.tiles.forEach(t => { t.failed = 0; }); redraw(); });
  api('/api/prefs').then(p => {
    const s = (p && p.map_tiles) || {};
    T.src = SRC[s.src] ? s.src : ''; T.alpha = s.alpha >= .1 && s.alpha <= 1 ? s.alpha : 1;
    apply();
  }).catch(() => apply());
})();
