/* Таблица адресов: какой адрес какую функцию вызывает. Порт app/web/api.py + server.py.
   Интерфейс по-прежнему ходит на «сервер» по /api/..., но запросы перехватываются здесь и отвечает сам движок. */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';
  const ValidationError = RZ.ValidationError;

  /* Файл, который пользователь сохраняет себе */
  class Download { constructor(data, name, ctype, headers = {}) { Object.assign(this, {data, name, ctype, headers}); } }
  /* Содержимое, которое браузер показывает сам (картинка подложки) */
  class Raw { constructor(data, ctype) { Object.assign(this, {data, ctype}); } }
  RZ.Download = Download; RZ.Raw = Raw;

  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const fileOf = r => new Download(r.data, r.name, r.ctype);

  function ui_save(ctx, j) {
    if (!j || typeof j !== 'object' || Array.isArray(j) || JSON.stringify(j).length > 20000) throw new ValidationError('Раскладка меню не сохранена: слишком большая.');
    ctx.db.set('ui', j);
    return {ok: true};
  }
  function prefs_save(ctx, j) {
    if (!j || typeof j !== 'object' || Array.isArray(j) || JSON.stringify(j).length > 600000) throw new ValidationError('Настройки не сохранены.');
    ctx.db.set('prefs', {...(ctx.db.get('prefs', {}) || {}), ...j});
    return {ok: true};
  }
  function settings(ctx, changes) {
    let recalc;
    try { recalc = RZ.config.update_rules(ctx.cfg, changes); }
    catch (e) { throw new ValidationError(`Правила не сохранены: ${e.message}`); }
    ctx.db.set('config', ctx.cfg);
    if (recalc) RZ.svc_sheets.recalc(ctx.db, ctx.cfg);
    return {ok: true, recalculated: recalc};
  }
  function crs_save(ctx, j) {
    const zone = parseInt(j.zone, 10), ell = String(j.ellipsoid || '');
    if (!RZ.gk || !RZ.gk.ELLIPSOIDS[ell]) throw new ValidationError('Неизвестный эллипсоид.');
    if (!(zone >= 1 && zone <= 60)) throw new ValidationError('Номер зоны: от 1 до 60.');
    ctx.cfg.crs = {ellipsoid: ell, zone};
    ctx.db.set('config', ctx.cfg);
    return {ok: true};
  }
  function backup(ctx) {
    const text = JSON.stringify(ctx.db.snapshot());
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return new Download(new TextEncoder().encode(text), `Размотка_копия_${p(d.getDate())}_${p(d.getMonth() + 1)}_${d.getFullYear()}.json`, 'application/json');
  }
  function restore(ctx, bytes) {
    let snap;
    try { snap = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new ValidationError('Это не файл копии данных программы.'); }
    ctx.db.restore(snap, ctx.cfg.rules.same_day);
    return {ok: true, razm: (snap.rows.razm || []).length, podm: (snap.rows.podm || []).length, sps: (snap.sps || []).length};
  }

  async function exporter(ctx, a) {
    const E = RZ.exporter;
    if (a.what === 'journal') return fileOf({...(await E.journal_xlsx(ctx.db)), ctype: XLSX});
    if (a.fmt === 'xlsx') return fileOf({...(await E.table_xlsx(ctx.db, a.what || '')), ctype: XLSX});
    return fileOf({...E.table_csv(ctx.db, a.what || ''), ctype: 'text/csv; charset=utf-8'});
  }

  /* Несколько файлов History одним запросом: в ответ архив .zip, отчёт по файлам - в заголовке X-Report */
  async function history_batch(ctx, a, bytes) {
    if (bytes.length > 400 << 20) throw new ValidationError('Файлы слишком большие для одной передачи. Выберите меньше файлов.');
    const files = RZ.exporter.unpack_files(bytes);
    const r = await RZ.exporter.station_history_batch(ctx.db, ctx.cfg, files, a.mode || '508');
    const rep = r.report, empty = rep.filter(x => !x.found);
    const brief = {files: rep.length, rows: rep.reduce((n, x) => n + x.rows, 0), found: rep.reduce((n, x) => n + x.found, 0),
      empty: empty.map(x => x.source.slice(0, 80)).slice(0, 8), empty_count: empty.length};
    return new Download(r.data, r.name, 'application/zip', {'X-Report': encodeURIComponent(JSON.stringify(brief))});
  }

  /* Контуры DXF и треки лежат рядом с настройками: приходят с файлом проекта, на телефоне их только показывают */
  const COLOR = /^#[0-9a-fA-F]{6}$/;
  function dxf_load(ctx) {
    const area = p => { let s = 0; for (let i = 0; i < p.length; i += 2) { const k = (i + 2) % p.length; s += p[i] * p[k + 1] - p[k] * p[i + 1]; } return Math.abs(s) / 2; };
    return {layers: (ctx.db.get('dxf', []) || []).map((l, n) => ({id: n + 1, name: l.name, color: l.color, visible: l.visible !== false, labels: l.labels !== false,
      count: l.items.length, items: l.items.map((it, k) => ({id: k + 1, name: it.name, kind: it.kind, pts: it.pts, ...(it.kind === 'poly' ? {area: Math.round(area(it.pts) * 10) / 10} : {})}))}))};
  }
  function dxf_layer(ctx, j) {
    const list = (ctx.db.get('dxf', []) || []).slice(), i = parseInt(j.id, 10) - 1;
    if (!list[i]) throw new ValidationError('Слой не найден: обновите страницу.');
    const l = {...list[i]};
    if ('name' in j) { const name = String(j.name || '').trim(); if (!name || name.length > 80) throw new ValidationError('Название слоя: от 1 до 80 знаков.'); l.name = name; }
    if ('color' in j) { if (!COLOR.test(String(j.color || ''))) throw new ValidationError('Цвет слоя задаётся как #RRGGBB.'); l.color = String(j.color).toUpperCase(); }
    for (const k of ['visible', 'labels']) if (k in j) l[k] = !!j[k];
    list[i] = l; ctx.db.set('dxf', list);
    return {ok: true};
  }
  function dxf_remove(ctx, j) {
    const list = (ctx.db.get('dxf', []) || []).slice(), i = parseInt(j.id, 10) - 1;
    if (!list[i]) throw new ValidationError('Слой не найден: обновите страницу.');
    list.splice(i, 1); ctx.db.set('dxf', list);
    return {ok: true};
  }
  /* Треки: запись своего пути. pts - [x, y, время (с от начала), ...] в координатах листа SPS */
  const tracks_load = ctx => ({items: (ctx.db.get('tracks', []) || []).map(t => {
    let len = 0; for (let i = 3; i < t.pts.length; i += 3) len += Math.hypot(t.pts[i] - t.pts[i - 3], t.pts[i + 1] - t.pts[i - 2]);
    return {uid: t.uid, name: t.name, ts: t.ts, show: !!t.show, pts: t.pts, length: Math.round(len), seconds: t.pts.length >= 3 ? Math.round(t.pts[t.pts.length - 1]) : 0};
  })});
  function tracks_save(ctx, j) {
    let list = (ctx.db.get('tracks', []) || []).slice();
    if (j.add) {
      const pts = (Array.isArray(j.add.pts) ? j.add.pts : []).map(Number);
      if (pts.length < 6 || pts.length % 3 || pts.some(v => !Number.isFinite(v))) throw new ValidationError('Трек слишком короткий: в нём меньше двух точек.');
      if (list.length >= 500) throw new ValidationError('Треков уже 500: удалите ненужные.');
      const t = {uid: RZ.new_uid(), name: String(j.add.name || 'Трек').trim().slice(0, 80) || 'Трек', ts: RZ.now_utc(), show: true, pts};
      list.push(t); ctx.db.set('tracks', list);
      return {ok: true, uid: t.uid};
    }
    const i = list.findIndex(t => t.uid === j.uid);
    if (i < 0) throw new ValidationError('Трек не найден: обновите страницу.');
    if (j.remove) list.splice(i, 1);
    else {
      const t = {...list[i]};
      if ('name' in j) { const name = String(j.name || '').trim(); if (!name || name.length > 80) throw new ValidationError('Название трека: от 1 до 80 знаков.'); t.name = name; }
      if ('show' in j) t.show = !!j.show;
      list[i] = t;
    }
    ctx.db.set('tracks', list);
    return {ok: true};
  }
  async function project_export(ctx, a) { const r = await RZ.project.export_project(ctx.db, ctx.cfg, a); return new Download(r.data, r.name, 'application/octet-stream'); }

  const C = ctx => ctx;                       // обработчики получают {db, cfg}
  // GET: функция(ctx, параметры адреса)
  const GET = {
    '/api/summary': (ctx) => RZ.reports.summary(ctx.db, ctx.cfg),
    '/api/sheets': () => RZ.svc_sheets.meta(),
    '/api/sheet': (ctx, a) => RZ.svc_sheets.load(ctx.db, a.name || '', a.brief === '1'),
    '/api/underlays': (ctx) => RZ.underlay.load(ctx.db),
    '/api/underlay/image': async (ctx, a) => { const r = await RZ.underlay.image(ctx.db, a.id); return new Raw(r.data, r.ctype); },
    '/api/field': (ctx) => RZ.reports.field_map(ctx.db),
    '/api/period': (ctx, a) => RZ.reports.period(ctx.db, a.from || '', a.to || ''),
    '/api/stats': (ctx, a) => RZ.reports.stats(ctx.db, a.from || '', a.to || ''),
    '/api/leaders': (ctx, a) => RZ.reports.leaders(ctx.db, a.from || '', a.to || ''),
    '/api/custom': (ctx) => RZ.svc_sheets.custom_list(ctx.db),
    '/api/check': (ctx) => RZ.reports.check(ctx.db),
    '/api/export': exporter,
    '/api/ping': () => ({ok: true, app: 'razmotka'}),
    '/api/ui': (ctx) => ctx.db.get('ui', {}) || {},
    '/api/prefs': (ctx) => ctx.db.get('prefs', {}) || {},
    '/api/crs': (ctx) => ctx.cfg.crs,
    '/api/picket': (ctx, a) => RZ.reports.picket_xy(ctx.db, a.line, a.picket),
    '/api/nearest': (ctx, a) => RZ.reports.nearest(ctx.db, a.x, a.y),
    '/api/backup': backup,
    '/api/tasks': (ctx, a) => RZ.tasks.list(ctx.db, a.me || ''),
    '/api/task': (ctx, a) => RZ.tasks.points(ctx.db, a.sheet, a.id),
    '/api/dxf': dxf_load,
    '/api/tracks': tracks_load,
    '/api/project/export': project_export,
  };
  // POST с JSON: функция(ctx, тело запроса)
  const POST = {
    '/api/sheet/save': (ctx, j) => RZ.svc_sheets.save_rows(ctx.db, j.name, j.rows || []),
    '/api/sheet/delete': (ctx, j) => RZ.svc_sheets.delete_rows(ctx.db, ctx.cfg, j.name, j.ids || []),
    '/api/sheet/apply': (ctx, j) => RZ.svc_sheets.apply(ctx.db, ctx.cfg, j.name, !!j.force, j.ids || null),
    '/api/sheet/undo': (ctx, j) => RZ.svc_sheets.undo(ctx.db, ctx.cfg, j.name),
    '/api/sheet/unapply': (ctx, j) => RZ.svc_sheets.unapply(ctx.db, ctx.cfg, j.name, j.ids || []),
    '/api/cleanup': (ctx, j) => RZ.svc_sheets.cleanup(ctx.db, ctx.cfg, j.from, j.to, j.types || []),
    '/api/clear': (ctx) => RZ.svc_sheets.clear(ctx.db, ctx.cfg),
    '/api/settings': settings,
    '/api/custom': (ctx, j) => RZ.svc_sheets.custom_save(ctx.db, ctx.cfg, j),
    '/api/crs': crs_save,
    '/api/ui': ui_save,
    '/api/prefs': prefs_save,
    '/api/underlay': (ctx, j) => RZ.underlay.save_meta(ctx.db, j),
    '/api/underlay/check': (ctx, j) => RZ.underlay.check(j),
    '/api/underlay/remove': (ctx, j) => RZ.underlay.remove(ctx.db, j.id),
    '/api/find': (ctx, j) => RZ.reports.find(ctx.db, j.ranges),
    '/api/task/done': (ctx, j) => RZ.tasks.complete(ctx.db, ctx.cfg, j.sheet, j.id, j.visited || [], !!j.force, {mode: j.mode, overlap: j.overlap}),
    '/api/task/check': (ctx, j) => RZ.tasks.check(ctx.db, j.sheet, j.id, j.visited || [], j.mode),
    '/api/dxf/layer': dxf_layer,
    '/api/dxf/remove': dxf_remove,
    '/api/tracks': tracks_save,
    '/api/project/apply': (ctx, j) => RZ.project.apply(ctx.db, ctx.cfg, j.token, j.mode || 'merge', j.parts || null),
    '/api/project/discard': (ctx, j) => RZ.project.discard(j.token, ctx.db),
    '/api/bye': () => ({ok: true}),
    '/api/quit': () => ({ok: true}),
  };
  // POST с файлом: функция(ctx, параметры адреса, тело как Uint8Array или Blob)
  const UPLOAD = {
    '/api/import/journal': (ctx, a, b) => RZ.importer.import_journal(ctx.db, ctx.cfg, b),
    '/api/import/macro': (ctx, a, b) => RZ.importer.import_macro(ctx.db, ctx.cfg, b, a.tgo_only === '1'),
    '/api/history': (ctx, a, b) => { const r = RZ.exporter.station_history(ctx.db, ctx.cfg, b, a.mode || '508'); return new Download(r.data, r.name, 'text/csv; charset=windows-1251'); },
    '/api/history/batch': history_batch,
    '/api/compare': (ctx, a, b) => RZ.compare.compare(ctx.db, ctx.cfg, b),
    '/api/underlay/image': (ctx, a, b) => RZ.underlay.save_image(ctx.db, a.name, b, a.id),
    '/api/restore': (ctx, a, b) => restore(ctx, b),
    '/api/project/inspect': (ctx, a, b) => RZ.project.inspect(ctx.db, ctx.cfg, RZ.exporter.unpack_files(b)),
  };
  // запросы с файлом читают тело как байты; остальные получают разобранный JSON
  const BLOB_BODY = new Set(['/api/underlay/image']);

  /* Выполняет запрос. Возвращает объект: JSON-значение, Download или Raw. Ошибки ввода - {error, row_id, col}, как у сервера */
  async function dispatch(ctx, method, path, args, body) {
    try {
      if (method === 'GET' || method === 'HEAD') {
        if (!GET[path]) return {status: 404, json: {error: 'Не найдено'}};
        return {status: 200, value: await GET[path](ctx, args)};
      }
      if (UPLOAD[path]) {
        const data = BLOB_BODY.has(path) ? body : new Uint8Array(await new Response(body).arrayBuffer());
        return {status: 200, value: await UPLOAD[path](ctx, args, data)};
      }
      if (POST[path]) {
        const text = body ? await new Response(body).text() : '';
        return {status: 200, value: await POST[path](ctx, JSON.parse(text || '{}'))};
      }
      return {status: 404, json: {error: 'Не найдено'}};
    } catch (e) {
      if (e instanceof ValidationError) return {status: 200, value: {error: e.message, row_id: e.row_id ?? null, col: e.col ?? null}};
      console.error('Ошибка при обработке ' + path, e);
      return {status: 500, value: {error: `Внутренняя ошибка: ${e && e.message ? e.message : e}.`}};
    }
  }

  /* Ответ в виде настоящего Response: интерфейс не отличает его от ответа сервера */
  function to_response(r) {
    const v = r.json || r.value;
    if (v instanceof Download) {
      return new Response(v.data, {status: 200, headers: {'Content-Type': v.ctype, 'X-Filename': encodeURIComponent(v.name), ...v.headers}});
    }
    if (v instanceof Raw) return new Response(v.data, {status: 200, headers: {'Content-Type': v.ctype}});
    return new Response(JSON.stringify(v), {status: r.status, headers: {'Content-Type': 'application/json; charset=utf-8'}});
  }

  RZ.api = {GET, POST, UPLOAD, dispatch, to_response, Download, Raw};
})(globalThis.RZ);
