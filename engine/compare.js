/* compare: сверка программы с книгой Excel «Контроль размотки». Порт services/compare.py */
globalThis.RZ = globalThis.RZ || {};
(function () {
  const BOOK = { field: 'Оборудование на поле', history: 'История подмотки и размотки',
    intervals: 'Таблица подмотки и размотки' };
  const LIMIT = 400;                                      // больше строк в отчёт не выводится (итоги считаются по всем)
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isNone = (v) => v === null || v === undefined;
  const kp = (line, picket) => line + ',' + picket;       // ключ пикета (Python: кортеж)

  function _type(value) { return value === 'Размотка' ? 1 : value === 'Подмотка' ? 0 : null; }

  // оборудование на поле так, как его считает макрос книги.
  // events: [[date, line, picket, type, worker]]. Возвращает Map "линия,пикет" -> [date, type, worker]
  // для ВСЕХ пикетов (последнее событие); на поле те, у кого type == 1
  function excel_field(events) {
    const seen = new Set();
    const last = new Map();
    for (const e of events) {
      const id = JSON.stringify(e);
      if (seen.has(id)) continue;                         // полные повторы убираются
      seen.add(id);
      const [date, line, picket, wtype, worker] = e;
      const key = kp(line, picket);
      const cur = last.get(key);
      if (!cur || date > cur[0] || (date === cur[0] && wtype > cur[1])) last.set(key, [date, wtype, worker]);
    }
    return last;
  }

  async function _read_book(bytes) {
    const book = await RZ.xlsx.open(bytes);
    if (!has(book.sheets, BOOK.history) && !has(book.sheets, BOOK.field)) {
      throw new RZ.ValidationError(`В книге нет листов «${BOOK.history}» и «${BOOK.field}». Нужна книга «Контроль размотки».`);
    }
    const num = RZ.importer._int;
    const iso = (v) => RZ.xlsx.serial_to_iso(v);
    const history = [], field = new Map(), intervals = new Map();
    if (has(book.sheets, BOOK.history)) {
      for (const [, r] of await book.rows(BOOK.history, 'ABCDEF')) {
        const t = _type(r.F);
        if (t === null || [num(r, 'A'), num(r, 'B'), num(r, 'C')].some((x) => x === null)) continue;
        history.push([iso(r.A), num(r, 'B'), num(r, 'C'), t, has(r, 'E') ? r.E : '']);
      }
    }
    if (has(book.sheets, BOOK.field)) {
      for (const [n, r] of await book.rows(BOOK.field, 'ABCDEF')) {
        if (n === 1 || num(r, 'B') === null || num(r, 'C') === null) continue;
        const date = num(r, 'A') !== null ? iso(r.A) : null;
        field.set(kp(num(r, 'B'), num(r, 'C')), { line: num(r, 'B'), picket: num(r, 'C'), date, worker: has(r, 'E') ? r.E : '' });
      }
    }
    if (has(book.sheets, BOOK.intervals)) {
      for (const [, r] of await book.rows(BOOK.intervals, 'ABCDEFGH')) {
        const t = _type(r.H);
        if (t === null || [num(r, 'A'), num(r, 'B'), num(r, 'C'), num(r, 'D')].some((x) => x === null)) continue;
        const a = Math.min(num(r, 'C'), num(r, 'D')), b = Math.max(num(r, 'C'), num(r, 'D'));
        const d = iso(r.A), line = num(r, 'B');
        intervals.set(`${d}|${line}|${a}|${b}|${t}`, { date: d, line, p1: a, p2: b, type: t });
      }
    }
    return [history, field, intervals];
  }

  function _ru(date) { return date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : ''; }

  // сравнение элементов кортежей Python: null меньше всего
  function cmp(a, b) {
    if (a === b) return 0;
    if (isNone(a)) return -1;
    if (isNone(b)) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // [[line, picket, причина, лист, строка, id строки]] -> свёрнутые по подряд идущим пикетам записи
  function _segments(items) {
    const out = [];
    const sorted = items.slice().sort((x, y) => {
      for (let i = 0; i < 6; i++) { const c = cmp(x[i], y[i]); if (c) return c; }
      return 0;
    });
    for (const [line, picket, reason, sheet, row, row_id] of sorted) {
      const last = out.length ? out[out.length - 1] : null;
      if (last && last.line === line && last.p2 === picket - 1 && last.reason === reason && last.row_id === row_id) {
        last.p2 = picket;
      } else {
        out.push({ line, p1: picket, p2: picket, reason, sheet, row, row_id });
      }
    }
    return out;
  }

  async function compare(db, cfg, bytes) {
    const sh = RZ.sh;
    const [history, book_field_sheet, book_intervals] = await _read_book(bytes);
    const book_last = excel_field(history);
    const by_history = new Map();
    for (const [k, v] of book_last) if (v[1] === 1) by_history.set(k, true);
    // число «на поле» в книге - её лист «Оборудование на поле»; если листа нет, берём расчёт по её истории
    const book_field = book_field_sheet.size ? new Set(book_field_sheet.keys()) : new Set(by_history.keys());

    const rule = cfg.rules.same_day;
    const snap = db.read((repo) => {
      const prog_field = new Map();
      for (const r of repo.field_rows()) prog_field.set(kp(r[0], r[1]), [r[0], r[1]]);
      const prog_last = new Map();
      for (const [l, p, d, t, w, src] of repo.last_events_full(rule)) prog_last.set(kp(l, p), [d, t, w, src]);
      const totals = repo.totals();
      const where = new Map(), drafts = new Map(), prog_intervals = new Map(), draft_rows = [], draft_keys = new Set();
      for (const [name, wtype] of [['razm', 1], ['podm', 0]]) {
        const sheet = sh.SHEETS[name];
        repo.sheet_rows(name).forEach((r, i) => {
          const number = i + 1;
          const rid = r[0], v = r[2], batch = r[3];
          where.set(rid, [name, number]);
          if (sh.is_blank(sheet, v)) return;
          if ([v[0], v[2], v[3], v[4]].some(isNone)) {
            if (isNone(batch)) {
              draft_rows.push({ sheet: name, row: number, row_id: rid, channels: 0, date: v[0], line: v[2], p1: v[3], p2: v[4] });
            }
            return;
          }
          const a = Math.min(v[3], v[4]), b = Math.max(v[3], v[4]);
          if (isNone(batch)) {                            // черновик: в учёт не попал
            draft_rows.push({ sheet: name, row: number, row_id: rid, channels: b - a + 1, date: v[0], line: v[2], p1: a, p2: b });
            draft_keys.add(`${v[0]}|${v[2]}|${a}|${b}|${wtype}`);
            for (let p = a; p <= b; p++) {
              const k = `${v[2]},${p},${wtype}`;
              if (!drafts.has(k)) drafts.set(k, [v[0], number, rid]);
            }
          } else {
            const k = `${v[0]}|${v[2]}|${a}|${b}|${wtype}`;
            if (!prog_intervals.has(k)) prog_intervals.set(k, { date: v[0], line: v[2], p1: a, p2: b, type: wtype, sheet: name, row: number, row_id: rid });
          }
        });
      }
      return { prog_field, prog_last, totals, where, drafts, prog_intervals, draft_rows, draft_keys };
    });
    const { prog_field, prog_last, totals, where, drafts, prog_intervals, draft_rows, draft_keys } = snap;
    const whereOf = (src) => where.get(src) || [null, null];

    // ---- поле: пикет за пикетом ------------------------------------------
    const only_prog = [], only_book = [];
    for (const [key, [line, picket]] of prog_field) {   // в программе лежит, в книге нет
      if (book_field.has(key)) continue;
      const [d, , , src0] = prog_last.get(key);
      let src = src0;
      let [sheet, row] = whereOf(src);
      const b = book_last.get(key);
      let reason;
      if (!b) {
        reason = `В программе размотка ${_ru(d)}, в книге по этому пикету записей нет`;
      } else if (b[1] === 0) {
        const draft = drafts.get(`${line},${picket},0`);
        if (draft && draft[0] === b[0]) {
          reason = `Подмотка ${_ru(b[0])} в программе не проведена: не нажата кнопка «Подмотать»`;
          sheet = 'podm'; row = draft[1]; src = draft[2];
        } else if (b[0] >= d) {
          reason = `В книге есть подмотка ${_ru(b[0])} (${b[2]}), в программе её нет`;
          sheet = row = src = null;
        } else {
          reason = `В программе размотка ${_ru(d)}, в книге последняя запись — подмотка ${_ru(b[0])}`;
        }
      } else {
        reason = 'В книге по истории пикет лежит на поле, но лист «Оборудование на поле» не пересчитан';
        sheet = row = src = null;
      }
      only_prog.push([line, picket, reason, sheet, row, src]);
    }
    const book_pos = (key) => {
      if (book_field_sheet.has(key)) { const f = book_field_sheet.get(key); return [f.line, f.picket]; }
      const [l, p] = key.split(',').map(Number);
      return [l, p];
    };
    for (const key of book_field) {                      // в книге лежит, в программе нет
      if (prog_field.has(key)) continue;
      const [line, picket] = book_pos(key);
      const b = book_last.get(key);
      const fs = book_field_sheet.get(key);
      const bdate = b ? b[0] : (fs ? fs.date : null);
      const p = prog_last.get(key);
      let sheet = null, row = null, src = null, reason;
      if (b && b[1] === 0) {
        reason = 'В книге по истории пикет подмотан, но лист «Оборудование на поле» не пересчитан';
      } else if (!p || p[0] < (bdate || '')) {
        const draft = drafts.get(`${line},${picket},1`);
        if (draft) {
          reason = `Размотка ${_ru(draft[0])} в программе не проведена: не нажата кнопка «Размотать»`;
          sheet = 'razm'; row = draft[1]; src = draft[2];
        } else {
          reason = `В книге есть размотка ${_ru(bdate)}, в программе её нет`;
        }
      } else {
        [sheet, row] = whereOf(p[3]);
        src = p[3];
        reason = `В программе есть подмотка ${_ru(p[0])}, в книге её нет`;
      }
      only_book.push([line, picket, reason, sheet, row, src]);
    }

    // ---- журнал: строка за строкой ---------------------------------------
    const rows_prog = [], rows_book = [];
    if (book_intervals.size) {
      for (const [k, v] of prog_intervals) if (!book_intervals.has(k)) rows_prog.push({ ...v });
    }
    for (const [k, v] of book_intervals) {
      if (!prog_intervals.has(k) && !draft_keys.has(k)) rows_book.push({ ...v });    // черновики показаны отдельно
    }
    const order = (x, y) => cmp(x.date, y.date) || cmp(x.type, y.type) || cmp(x.line, y.line) || cmp(x.p1, y.p1);
    rows_prog.sort(order);
    rows_book.sort(order);
    const chan = (rows, t) => rows.filter((r) => r.type === t).reduce((s, r) => s + r.p2 - r.p1 + 1, 0);

    const seg_prog = _segments(only_prog), seg_book = _segments(only_book);
    const uniq = new Set(history.map((e) => JSON.stringify(e)));
    let book_razm = 0;
    for (const e of uniq) if (JSON.parse(e)[3] === 1) book_razm++;
    return {
      program: { field: prog_field.size, razm: totals.razm, podm: totals.podm },
      book: { field: book_field.size, razm: book_razm, podm: uniq.size - book_razm,
        by_history: by_history.size, has_field_sheet: book_field_sheet.size > 0, has_history: history.length > 0,
        has_intervals: book_intervals.size > 0 },
      only_program: only_prog.length, only_book: only_book.length,
      field_program: seg_prog.slice(0, LIMIT), field_book: seg_book.slice(0, LIMIT),
      field_more: Math.max(0, seg_prog.length - LIMIT) + Math.max(0, seg_book.length - LIMIT),
      rows_program: rows_prog.slice(0, LIMIT), rows_book: rows_book.slice(0, LIMIT),
      rows_program_total: rows_prog.length, rows_book_total: rows_book.length,
      rows_program_channels: { razm: chan(rows_prog, 1), podm: chan(rows_prog, 0) },
      rows_book_channels: { razm: chan(rows_book, 1), podm: chan(rows_book, 0) },
      drafts: draft_rows.slice(0, LIMIT),
      draft_channels: {
        razm: draft_rows.filter((r) => r.sheet === 'razm').reduce((s, r) => s + r.channels, 0),
        podm: draft_rows.filter((r) => r.sheet === 'podm').reduce((s, r) => s + r.channels, 0),
      },
    };
  }

  RZ.compare = { compare, excel_field, BOOK, LIMIT, _read_book };
})();
