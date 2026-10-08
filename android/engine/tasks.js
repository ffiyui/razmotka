/* Задания: строки листов «Размотка», «Подмотка» и «Разбивка», по которым кнопка ещё не нажата.
   Здесь список заданий, точки задания для карты (место пикета без координат считается) и запись выполненного:
   человек прошёл задание целиком или кусками - в журнал записываются проведённые строки по пройденным диапазонам
   (или задание в исходном виде, если так выбрано); непройденное заданием не остаётся. */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';
  const sh = RZ.sh, ValidationError = RZ.ValidationError;
  const fold = s => String(s || '').trim().toLowerCase();

  /* [[a, b]] - непрерывные диапазоны из набора номеров */
  function runs(numbers) {
    const out = [];
    for (const p of [...new Set(numbers)].sort((x, y) => x - y)) {
      const last = out[out.length - 1];
      if (last && last[1] === p - 1) last[1] = p; else out.push([p, p]);
    }
    return out;
  }

  /* Задания всех видов работ. me - показать только задания этого исполнителя (пусто - все) */
  function list(db, me = '') {
    const who = fold(me), out = [];
    db.read(repo => {
      for (const name of sh.WORK) {
        const sheet = sh.SHEETS[name], origins = repo.origins(name);
        repo.sheet_rows(name).forEach(([id, , v, batch], n) => {
          if (batch !== null || sh.is_blank(sheet, v) || v[2] === null || v[3] === null || v[4] === null) return;
          if (who && fold(v[1]) !== who) return;
          out.push({sheet: name, title: sheet.title, button: sheet.button, unit: sheet.unit, id, row: n + 1, date: v[0], worker: v[1],
            line: v[2], p1: Math.min(v[3], v[4]), p2: Math.max(v[3], v[4]), count: Math.abs(v[4] - v[3]) + 1,
            note: v[sh.sheet_index(sheet, 'note')] || '', from: origins.get(id) || ''});
        });
      }
    });
    return {items: out};
  }

  function row_of(repo, name, id) {
    const sheet = sh.SHEETS[name];
    if (!sheet || sheet.kind !== 'work') throw new ValidationError('Неизвестный вид работ.');
    const got = repo.get_rows(name, [parseInt(id, 10)]).get(parseInt(id, 10));
    if (!got) throw new ValidationError('Задания уже нет в журнале: обновите список.');
    return {sheet, pos: got[0], v: got[1], batch: got[2]};
  }

  /* Точки задания для карты: [x, y, пикет, точно ли (1 - координаты из SPS, 0 - место посчитано), ...] */
  function points(db, name, id) {
    return db.read(repo => {
      const {sheet, v, batch} = row_of(repo, name, id), c = RZ.reports.coords(db, repo);
      if (v[2] === null || v[3] === null || v[4] === null) throw new ValidationError('В задании не заполнены линия и пикеты.');
      const a = Math.min(v[3], v[4]), b = Math.max(v[3], v[4]), pts = [];
      if (b - a > 20000) throw new ValidationError('Слишком большой диапазон пикетов.');
      let missing = 0, est = 0;
      for (let p = a; p <= b; p++) {
        const xy = c.est(v[2], p);
        if (!xy) { missing++; continue; }
        if (!xy[2]) est++;
        pts.push(xy[0], xy[1], p, xy[2] ? 1 : 0);
      }
      return {sheet: name, title: sheet.title, button: sheet.button, unit: sheet.unit, id: parseInt(id, 10), done: batch !== null,
        worker: v[1], date: v[0], line: v[2], p1: a, p2: b, points: pts, missing, est, schematic: c.schematic};
    });
  }

  /* Какие пикеты пройдены. mode: 'fact' - только пройденные (кусками - несколько диапазонов), 'orig' - задание
     в исходном виде целиком. Непройденное заданием не остаётся. */
  function walked(v, visited, mode) {
    const a = Math.min(v[3], v[4]), b = Math.max(v[3], v[4]);
    if (mode === 'orig') return [[a, b]];
    return runs((visited || []).map(p => parseInt(p, 10)).filter(p => p >= a && p <= b));
  }
  /* Нахлёст (только размотка и подмотка): размотка на пикеты, где оборудование уже лежит, подмотка с пикетов,
     где его нет. Возвращает номера таких пикетов */
  function overlap_of(repo, name, line, ranges) {
    if (name !== 'razm' && name !== 'podm') return [];
    const field = repo.field_pickets(line), out = [];
    for (const [x, y] of ranges) for (let p = x; p <= y; p++) if (field.has(p) === (name === 'razm')) out.push(p);
    return out;
  }
  const CONFLICT = /^(размотка на пикеты|подмотка с пикетов)/;

  /* Проверка перед записью: что будет записано и есть ли нахлёст */
  function check(db, name, id, visited, mode = 'fact') {
    return db.read(repo => {
      const {v, batch} = row_of(repo, name, id);
      if (batch !== null) throw new ValidationError('Это задание уже проведено.');
      const done = walked(v, visited, mode), over = overlap_of(repo, name, v[2], done);
      return {done, overlap: runs(over), overlap_count: over.length, line: v[2]};
    });
  }

  /* Записывает выполненное: пройденные диапазоны становятся проведёнными строками (первая - само задание, чтобы
     начальник отряда узнал его по номеру строки). Непройденное заданием не остаётся.
     opt.mode - 'fact' | 'orig'; opt.overlap - 'keep' (записать с нахлёстом) | 'trim' (убрать пикеты нахлёста).
     Всё или ничего: если строку провести нельзя, журнал не меняется. */
  function complete(db, cfg, name, id, visited, force = false, opt = {}) {
    id = parseInt(id, 10);
    const mode = opt.mode === 'orig' ? 'orig' : 'fact';
    return db.write(repo => {
      const {sheet, pos, v, batch} = row_of(repo, name, id);
      if (batch !== null) throw new ValidationError('Это задание уже проведено.');
      let done = walked(v, visited, mode);
      if (!done.length) throw new ValidationError('Ни один пикет задания не пройден.');
      if (opt.overlap === 'trim') {
        const over = new Set(overlap_of(repo, name, v[2], done)), keep = [];
        for (const [x, y] of done) for (let p = x; p <= y; p++) if (!over.has(p)) keep.push(p);
        done = runs(keep);
        if (!done.length) throw new ValidationError(name === 'razm' ? 'На всех пройденных пикетах оборудование уже лежит: записывать нечего.' : 'Ни на одном пройденном пикете оборудование не числится: записывать нечего.');
      }
      const today = RZ.today(), ids = [];
      const with_range = range => { const w = v.slice(); w[0] = today; w[3] = range[0]; w[4] = range[1]; return w; };
      repo.update_row(name, id, pos, with_range(done[0]));
      ids.push(id);
      let k = 0;
      for (const r of done.slice(1)) ids.push(repo.insert_row(name, pos + (++k) * 1e-4, with_range(r)));
      let res = RZ.svc_sheets.apply(db, cfg, name, force, ids);
      if (res.warnings && opt.overlap === 'keep') {                       // нахлёст уже разрешён: о нём не спрашиваем второй раз
        const rest = res.warnings.filter(w => !CONFLICT.test(w));
        if (!rest.length) res = RZ.svc_sheets.apply(db, cfg, name, true, ids);
        else res = {warnings: rest};
      }
      if (res.warnings) { const e = new ValidationError('warnings'); e.warnings = res.warnings; throw e; }   // откат: спросим и повторим с force
      return {ok: true, done, left: [], rows: res.rows, units: res.channels, unit: sheet.unit};
    });
  }
  function complete_safe(db, cfg, name, id, visited, force, opt) {
    try { return complete(db, cfg, name, id, visited, force, opt); }
    catch (e) { if (e.warnings) return {warnings: e.warnings}; throw e; }
  }

  RZ.tasks = {list, points, check, complete: complete_safe, runs};
})(globalThis.RZ);
