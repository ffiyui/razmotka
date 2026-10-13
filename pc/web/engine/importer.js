/* importer: загрузка данных из книг Excel (журнал и книга с макросом). Порт services/importer.py */
globalThis.RZ = globalThis.RZ || {};
(function () {
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isNone = (v) => v === null || v === undefined;

  function _int(row, key) {
    if (!has(row, key)) return null;
    const v = RZ.xlsx.py_int_float(row[key]);
    return v === undefined ? null : v;
  }

  function _date(raw) {
    if (isNone(raw)) return null;
    const text = RZ.xlsx.py_strip(raw);
    if (/^\d{5}(\.\d+)?$/.test(text)) return RZ.xlsx.serial_to_iso(text);   // дата Excel хранится числом
    return RZ.sh.parse_date(text);
  }

  class Problems {
    constructor() { this.count = 0; this.examples = []; }
    add(where, text) {
      this.count++;
      if (this.examples.length < 5) this.examples.push(`${where}: ${text}`);
    }
  }

  // значение ячейки при загрузке; что не распознано - пропускается и попадает в отчёт
  function _cell(sheet, c, raw, problems, where) {
    if (isNone(raw)) return null;
    try {
      if (sheet.cols[c].kind === 'date') {
        const v = _date(raw);
        if (v === null) throw new RZ.CellError('не дата', c);
        return v;
      }
      return RZ.sh.normalize(sheet, c, raw);
    } catch (e) {
      if (!(e instanceof RZ.CellError)) throw e;
      problems.add(where, `«${raw}» - ${sheet.cols[c].title.toLowerCase()} не распознано`);
      return null;
    }
  }

  // строки данных листа: всё, что ниже строки с заголовком header_text в столбце A
  async function _data_rows(book, sheet_name, header_text, columns) {
    const out = [];
    let started = false;
    for (const [number, row] of await book.rows(sheet_name, columns)) {
      if (started) out.push([number, row]);
      else if (RZ.xlsx.py_strip(has(row, 'A') ? row.A : '') === header_text) started = true;
    }
    return out;
  }

  // ---------------------------------------------------------------- журнал
  const JOURNAL_SHEETS = { razm: 'Размотка', podm: 'Подмотка', oo: 'Оставленное оборудование',
    snake: 'Змейки и вылеты', info: 'Общая информация', workers: 'ID старших' };

  // значения хранимых столбцов листа; letters - буква столбца книги для каждого столбца таблицы (или null)
  function _stored_values(sheet, row, letters, problems, where) {
    return letters.map((letter, c) => (letter === null || sheet.cols[c].kind === 'calc'
      ? null : _cell(sheet, c, row[letter], problems, where)));
  }

  const LAYOUT = {
    razm: ['Дата', 'ABCDEFGHI', 'ABCDE.GH.'],
    podm: ['Дата', 'ABCDEFGHI', 'ABCDE.GH.'],
    snake: ['Дата', 'ABCDEFG', 'ABCDE.G'],
  };

  async function import_journal(db, cfg, bytes) {
    const sh = RZ.sh;
    const book = await RZ.xlsx.open(bytes);
    const names = cfg['import'].journal_sheets;
    const found = {};
    for (const k of Object.keys(names)) if (has(book.sheets, names[k])) found[k] = names[k];
    if (!('razm' in found) && !('podm' in found)) {
      throw new RZ.ValidationError(`В книге нет листов «${names.razm}» и «${names.podm}». Проверьте, что выбран файл журнала.`);
    }

    const problems = new Problems();
    const data = {};
    for (const key of Object.keys(found)) {
      const sheet_name = found[key];
      const sheet = sh.SHEETS[key];
      const rows = [];
      if (has(LAYOUT, key)) {
        const [header, cols, letters] = LAYOUT[key];
        const lt = [...letters].map((ch) => (ch === '.' ? null : ch));
        for (const [number, row] of await _data_rows(book, sheet_name, header, cols)) {
          const v = _stored_values(sheet, row, lt, problems, `${sheet.title}, строка ${number}`);
          if (!sh.is_blank(sheet, v)) rows.push(v);
        }
      } else if (key === 'oo') {
        for (const [number, row] of await book.rows(sheet_name, 'ABCDEF')) {
          if (number === 1) continue;
          const v = _stored_values(sheet, row, [...'ABCDEF'], problems, `${sheet.title}, строка ${number}`);
          if (!sh.is_blank(sheet, v)) rows.push(v);
        }
      } else if (key === 'info') {
        for (const [number, row] of await book.rows(sheet_name, 'AB')) {
          if (number === 1) continue;
          const idx = number - 2;
          while (rows.length < idx) rows.push([null, null]);
          const v = [row.A ? RZ.xlsx.py_strip(row.A) : null, null];
          if (!isNone(row.B)) {
            try {
              v[1] = sh.normalize(sheet, 1, row.B, idx);
            } catch (e) {
              if (!(e instanceof RZ.CellError)) throw e;
              problems.add(`${sheet.title}, строка ${number}`, `«${row.B}» не подходит к показателю`);
            }
          }
          rows.push(v);
        }
        while (rows.length && sh.is_blank(sheet, rows[rows.length - 1])) rows.pop();
      } else if (key === 'workers') {
        for (const [number, row] of await book.rows(sheet_name, 'ABC')) {
          if (number === 1) continue;
          const v = _stored_values(sheet, row, ['A', 'B', null], problems, `${sheet.title}, строка ${number}`);
          if (!sh.is_blank(sheet, v)) rows.push(v);
        }
      }
      data[key] = rows;
    }

    const result = { ok: true, sheets: {} };
    const drafts = db.write((repo) => {
      for (const key of Object.keys(data)) {
        repo.clear_sheet(key);
        data[key].forEach((v, i) => repo.insert_row(key, i + 1, v));
        result.sheets[sh.SHEETS[key].title] = data[key].length;
      }
      repo.clear_events();
      repo.clear_batches();
      const n = _post_import(repo, cfg, problems);
      repo.rebuild_state(cfg.rules.same_day);
      return n;
    });
    db.coords = null;
    Object.assign(result, { problems: problems.count, examples: problems.examples, drafts });
    return result;
  }

  // проводит загруженные строки журнала, которые заполнены верно; остальные остаются черновиками
  function _post_import(repo, cfg, problems) {
    const sh = RZ.sh;
    const lookup = sh.worker_lookup(repo.sheet_rows('workers').map((r) => [r[2][0], r[2][1]]));
    let drafts = 0;
    for (const [name, wtype] of [['razm', 1], ['podm', 0]]) {
      const rows = repo.sheet_rows(name);
      if (!rows.length) continue;
      let ok = [];
      rows.forEach((r, i) => {
        const n = i + 1;
        try {
          ok = ok.concat(RZ.validation.work_intervals([[n, r[0], r[2]]], lookup, null, cfg.rules, wtype));
        } catch (e) {
          if (!(e instanceof RZ.CellError)) throw e;
          drafts++;
          const msg = String(e.message);
          const at = msg.indexOf(': ');
          problems.add(`${sh.SHEETS[name].title}, строка ${n}`, at < 0 ? msg : msg.slice(at + 2));
        }
      });
      const batch = repo.new_batch('', name, 'import');
      let channels = 0;
      ok.forEach(([rid, iv], k) => {
        repo.insert_events(rid, iv.line, iv.p1, iv.p2, iv.date, Number(iv.type), iv.wid, iv.worker, batch * 1000000 + k);
        channels += iv.count;
      });
      repo.set_done(ok.map((p) => p[0]), batch);
      repo.finish_batch(batch, ok.length, channels);
    }
    return drafts;
  }

  // ---------------------------------------------------------------- книга с макросом
  const MACRO_SHEETS = { intervals: 'Таблица подмотки и размотки', tgo: 'ТГО', workers: 'ID старших' };

  // round(x, 4) как в Python: по точному значению, ничья - к чётному
  function round4(x) {
    if (!isFinite(x) || Math.abs(x) >= 1e15) return x;
    const full = x.toFixed(40);
    const dot = full.indexOf('.');
    const tailDigits = full.slice(dot + 5);
    let r = Number(x.toFixed(4));
    if (/^50*$/.test(tailDigits)) {                       // точная ничья: к чётному
      const down = full.slice(0, dot + 5);
      const last = Number(down[down.length - 1]);
      r = last % 2 === 0 ? Number(down) : Number(x.toFixed(4));
    }
    return r;
  }

  async function import_macro(db, cfg, bytes, tgo_only) {
    const book = await RZ.xlsx.open(bytes);
    const need = tgo_only ? [MACRO_SHEETS.tgo] : Object.values(MACRO_SHEETS);
    const missing = need.filter((n) => !has(book.sheets, n));
    if (missing.length) throw new RZ.ValidationError('В книге нет листов: ' + missing.join(', '));

    const tgo = [];                                       // лист «ТГО»: B линия, C пикет, D x, E y, F z
    for (const [, r] of await book.rows(MACRO_SHEETS.tgo, 'BCDEF')) {
      if (_int(r, 'B') === null || _int(r, 'C') === null) continue;
      const num = (key) => {
        if (!has(r, key)) return null;
        const f = RZ.xlsx.py_float(r[key]);
        return f === undefined ? null : round4(f);
      };
      tgo.push([_int(r, 'B'), _int(r, 'C'), num('D'), num('E'), num('F')]);
    }
    if (!tgo.length) throw new RZ.ValidationError('Лист «ТГО» пуст.');
    if (tgo_only) {
      db.write((repo) => { repo.replace_sps(tgo); });
      db.coords = null;
      return { ok: true, tgo: tgo.length };
    }

    const workers = [];
    for (const [n, r] of await book.rows(MACRO_SHEETS.workers, 'AB')) {
      if (n > 1 && _int(r, 'A') !== null && r.B) workers.push([_int(r, 'A'), r.B, null]);
    }
    const work = { 1: [], 0: [] };
    for (const [, r] of await book.rows(MACRO_SHEETS.intervals, 'ABCDEFGH')) {
      const wtype = r.H === 'Размотка' ? 1 : r.H === 'Подмотка' ? 0 : null;
      if (wtype === null || ['A', 'B', 'C', 'D'].some((k) => _int(r, k) === null)) continue;
      work[wtype].push([RZ.xlsx.serial_to_iso(r.A), has(r, 'F') ? r.F : null, _int(r, 'B'), _int(r, 'C'), _int(r, 'D'),
        null, null, null, null]);
    }

    const problems = new Problems();
    const drafts = db.write((repo) => {
      repo.replace_sps(tgo);
      for (const key of ['workers', 'razm', 'podm']) repo.clear_sheet(key);
      workers.forEach((v, i) => repo.insert_row('workers', i + 1, v));
      for (const [key, wtype] of [['razm', 1], ['podm', 0]]) {
        work[wtype].forEach((v, i) => repo.insert_row(key, i + 1, v));
      }
      repo.clear_events();
      repo.clear_batches();
      const n = _post_import(repo, cfg, problems);
      repo.rebuild_state(cfg.rules.same_day);
      return n;
    });
    db.coords = null;
    return { ok: true, tgo: tgo.length, razm: work[1].length, podm: work[0].length, workers: workers.length,
      drafts, problems: problems.count, examples: problems.examples };
  }

  RZ.importer = { import_journal, import_macro, _post_import, _int, _date, _serial_to_iso: (v) => RZ.xlsx.serial_to_iso(v),
    JOURNAL_SHEETS, MACRO_SHEETS };
})();
