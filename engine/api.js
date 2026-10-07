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
    if (!j || typeof j !== 'object' || Array.isArray(j) || JSON.stringify(j).length > 20000) throw new ValidationError('Настройки не сохранены.');
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
    '/api/check': (ctx) => RZ.reports.check(ctx.db),
    '/api/export': exporter,
    '/api/ping': () => ({ok: true, app: 'razmotka'}),
    '/api/ui': (ctx) => ctx.db.get('ui', {}) || {},
    '/api/prefs': (ctx) => ctx.db.get('prefs', {}) || {},
    '/api/crs': (ctx) => ctx.cfg.crs,
    '/api/picket': (ctx, a) => RZ.reports.picket_xy(ctx.db, a.line, a.picket),
    '/api/nearest': (ctx, a) => RZ.reports.nearest(ctx.db, a.x, a.y),
    '/api/backup': backup,
  };
  // POST с JSON: функция(ctx, тело запроса)
  const POST = {
    '/api/sheet/save': (ctx, j) => RZ.svc_sheets.save_rows(ctx.db, j.name, j.rows || []),
    '/api/sheet/delete': (ctx, j) => RZ.svc_sheets.delete_rows(ctx.db, ctx.cfg, j.name, j.ids || []),
    '/api/sheet/apply': (ctx, j) => RZ.svc_sheets.apply(ctx.db, ctx.cfg, j.name, !!j.force),
    '/api/sheet/undo': (ctx, j) => RZ.svc_sheets.undo(ctx.db, ctx.cfg, j.name),
    '/api/sheet/unapply': (ctx, j) => RZ.svc_sheets.unapply(ctx.db, ctx.cfg, j.name, j.ids || []),
    '/api/cleanup': (ctx, j) => RZ.svc_sheets.cleanup(ctx.db, ctx.cfg, j.from, j.to, j.types || []),
    '/api/clear': (ctx) => RZ.svc_sheets.clear(ctx.db, ctx.cfg),
    '/api/settings': settings,
    '/api/crs': crs_save,
    '/api/ui': ui_save,
    '/api/prefs': prefs_save,
    '/api/underlay': (ctx, j) => RZ.underlay.save_meta(ctx.db, j),
    '/api/underlay/check': (ctx, j) => RZ.underlay.check(j),
    '/api/underlay/remove': (ctx, j) => RZ.underlay.remove(ctx.db, j.id),
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
