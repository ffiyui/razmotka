/* exporter: выгрузки - History для станции, таблицы в CSV и XLSX, журнал. Порт services/exporter.py */
globalThis.RZ = globalThis.RZ || {};
(function () {
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isNone = (v) => v === null || v === undefined;
  const py_strip = (s) => RZ.xlsx.py_strip(s);
  const stripChars = (s, chars) => {                    // str.strip(chars)
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  };
  const today = () => {
    if (typeof RZ.today === 'function') return RZ.today();
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const stamp = () => { const t = today(); return t.slice(8, 10) + '_' + t.slice(5, 7); };   // %d_%m

  // ---------------------------------------------------------------- windows-1251
  let _enc = null;
  function encTable() {
    if (_enc) return _enc;
    const dec = new TextDecoder('windows-1251');
    const t = new Uint8Array(65536);                     // символ -> байт, 0 = нет в кодировке
    for (let b = 0x80; b < 256; b++) {
      if (b === 0x98) continue;                           // в cp1251 Python байта 0x98 нет
      t[dec.decode(Uint8Array.of(b)).charCodeAt(0)] = b;
    }
    return (_enc = t);
  }

  // bytes.decode('cp1251', 'replace')
  function decode1251(u8) {
    return new TextDecoder('windows-1251').decode(u8).replace(/\u0098/g, '�');
  }

  // str.encode('cp1251', 'replace'): неизвестное -> '?'
  function encode1251(s) {
    const t = encTable();
    const out = new Uint8Array(s.length);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) out[n++] = c;
      else {
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
          const d = s.charCodeAt(i + 1);
          if (d >= 0xDC00 && d <= 0xDFFF) i++;            // пара - один символ
        }
        out[n++] = c < 65536 && t[c] ? t[c] : 0x3F;
      }
    }
    return out.slice(0, n);
  }

  // str.splitlines() без пустых строк; вызывается после проверки strip()
  const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

  // ---------------------------------------------------------------- History для станции
  function _last_map(db, cfg) {
    return db.read((repo) => {
      const m = new Map();
      for (const [line, picket, , worker, wtype] of repo.last_events(cfg.rules.same_day)) {
        m.set(line + ',' + picket, [worker, Number(wtype) === 1 ? 'Размотка' : 'Подмотка']);
      }
      return m;
    });
  }

  function _history(last, data, mode, report) {
    const sep = mode === '428' ? '\t' : ',';
    const out = [];
    let suffix = '508', found = 0;
    const lines = decode1251(data).split(LINE_BREAK).filter((l) => py_strip(l) !== '');
    lines.forEach((raw, i) => {
      let cells = raw.split(sep);
      while (cells.length < 10) cells.push('');
      if (mode === '428') cells = [cells[0], cells[1], cells[2], cells[3], cells[8], cells[5], cells[6], cells[7]];
      cells = cells.slice(0, 8);
      if (i === 1 && mode === '428') suffix = stripChars(py_strip(cells[0]), '"') || '428';
      for (const k of [0, 4]) if (cells[k] !== '') cells[k] = '"' + cells[k] + '"';
      if (i === 0) {
        cells.push('Worker', 'Type of work');
      } else {
        const a = RZ.xlsx.py_int_float(cells[2]), b = RZ.xlsx.py_int_float(cells[3]);
        const key = a === undefined || b === undefined ? null : a + ',' + b;
        const hit = key === null ? undefined : last.get(key);
        if (hit) found++;
        cells.push(...(hit || ['', '']));
      }
      out.push(cells.join(','));
    });
    if (report) { report.rows = Math.max(lines.length - 1, 0); report.found = found; }
    return [encode1251(out.join('\r\n') + '\r\n'), `history_${suffix}.csv`];
  }

  // к файлу со станции (428XL - txt, 508XT - csv) дописывает старшего и тип последней работы на пикете
  function station_history(db, cfg, data, mode, report) {
    const [bytes, name] = _history(_last_map(db, cfg), data, mode, report);
    return { data: bytes, name };
  }

  // несколько файлов одним телом запроса: 4 байта длины имени, имя UTF-8, 8 байт длины содержимого, содержимое
  function pack_files(files) {
    const enc = new TextEncoder();
    const parts = [];
    let total = 0;
    for (const [name, data] of files) {
      const raw = enc.encode(name);
      const head = new Uint8Array(4 + raw.length + 8);
      const dv = new DataView(head.buffer);
      dv.setUint32(0, raw.length, false);
      head.set(raw, 4);
      dv.setBigUint64(4 + raw.length, BigInt(data.length), false);
      parts.push(head, data);
      total += head.length + data.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // int.from_bytes(body[a:b], 'big'): короткий срез даёт меньшее число
  function be(body, a, b) {
    let n = 0;
    for (let i = a; i < Math.min(b, body.length); i++) n = n * 256 + body[i];
    return n;
  }

  function unpack_files(body) {
    const files = [];
    const dec = new TextDecoder('utf-8');
    let i = 0;
    while (i < body.length) {
      const n = be(body, i, i + 4);
      const name = dec.decode(body.subarray(i + 4, i + 4 + n));
      i += 4 + n;
      const size = be(body, i, i + 8);
      if (n === 0 || n > 1024 || body.length - i - 8 < size) {
        throw new RZ.ValidationError('Файлы переданы с ошибкой. Выберите их заново.');
      }
      files.push([name, body.subarray(i + 8, i + 8 + size)]);
      i += 8 + size;
    }
    return files;
  }

  // имя обработанного файла по имени исходного: 0512.txt -> history_0512.csv; повторы получают номер
  function _history_name(source, taken) {
    let base = source.replace(/\\/g, '/');
    base = base.slice(base.lastIndexOf('/') + 1);                 // os.path.basename
    const dot = base.lastIndexOf('.');                             // os.path.splitext
    let stem = base;
    if (dot > 0 && /[^.]/.test(base.slice(0, dot))) stem = base.slice(0, dot);
    stem = py_strip(stem);
    if (stem.toLowerCase().startsWith('history')) stem = stem.slice(7).replace(/^[ _-]+/, '');
    let clean = '';
    for (const ch of stem) if (!'<>:"/|?*'.includes(ch) && ch >= ' ') clean += ch;
    stem = stripChars(clean, ' .') || 'файл';
    let name = `history_${stem}.csv`, k = 1;
    while (taken.has(name.toLowerCase())) { k++; name = `history_${stem}_${k}.csv`; }
    taken.add(name.toLowerCase());
    return name;
  }

  // несколько файлов со станции разом: каждый обрабатывается отдельно, результаты кладутся в один архив .zip
  async function station_history_batch(db, cfg, files, mode) {
    if (!files.length) throw new RZ.ValidationError('Выберите файлы со станции.');
    if (files.length > 500) throw new RZ.ValidationError('Слишком много файлов за один раз: не больше 500.');
    const last = _last_map(db, cfg);
    const taken = new Set(), report = [], parts = [];
    for (const [source, data] of files) {
      const info = {};
      const [out] = _history(last, data, mode, info);
      const name = _history_name(source, taken);
      parts.push({ name, data: out });
      report.push({ source, name, rows: info.rows, found: info.found });
    }
    return { data: await RZ.zip.write(parts), name: `history_${stamp()}.zip`, report };
  }

  // ---------------------------------------------------------------- таблицы
  const EXPORT_NAMES = { field: 'Оборудование на поле', history: 'История по пикетам' };
  const EXPORT_WIDTHS = { field: [13, 10, 10, 13, 34, 14, 14], history: [13, 10, 10, 13, 34, 14] };

  // заголовок и строки таблицы: дата в виде ГГГГ-ММ-ДД, числа числами
  function _table(db, what) {
    if (!has(EXPORT_NAMES, what)) throw new Error('Неизвестная выгрузка');
    return db.read((repo) => {
      if (what === 'field') {
        const c = RZ.reports.coords(db, repo);
        const head = ['Дата', 'Линия', 'Пикет', 'ID старшего', 'ФИО старшего', 'x', 'y'], rows = [];
        for (const [line, picket, date, worker, wid] of repo.field_rows()) {
          const xy = c.schematic ? [null, null] : (c.xy(line, picket) || [null, null]);
          rows.push([date, line, picket, wid, worker, xy[0], xy[1]]);
        }
        return [head, rows];
      }
      const [head, found] = repo.export_history();
      return [head, found.map((r) => r.slice())];
    });
  }

  // csv.writer(delimiter=';', lineterminator='\r\n'), QUOTE_MINIMAL
  function csv_field(v) {
    if (isNone(v)) return '';
    const s = String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // CSV с разделителем ';' и BOM - открывается в русском Excel двойным щелчком
  function table_csv(db, what) {
    const [head, rows] = _table(db, what);
    const ru_date = (v) => (v ? v.slice(8, 10) + '.' + v.slice(5, 7) + '.' + v.slice(0, 4) : '');
    // в Python x и y - всегда float (округление до 0.1): целое печатается как 457982,0
    const float_cols = what === 'field' ? [5, 6] : [];
    const ru_num = (v) => (Number.isInteger(v) ? v + ',0' : String(v).replace('.', ','));
    const lines = [head.map(csv_field).join(';')];
    for (const row of rows) {
      const cells = [ru_date(row[0])];
      for (let i = 1; i < row.length; i++) {
        const v = row[i];
        cells.push(typeof v === 'number' && (float_cols.includes(i) || !Number.isInteger(v)) ? ru_num(v) : v);
      }
      lines.push(cells.map(csv_field).join(';'));
    }
    const body = new TextEncoder().encode(lines.join('\r\n') + '\r\n');
    const out = new Uint8Array(body.length + 3);
    out.set([0xEF, 0xBB, 0xBF]);
    out.set(body, 3);
    return { data: out, name: EXPORT_NAMES[what] + '.csv' };
  }

  // та же таблица книгой .xlsx: даты датами, числа числами, шапка закреплена, включён фильтр
  async function table_xlsx(db, what) {
    const W = RZ.xlsx;
    const [head, rows] = _table(db, what);
    const out = [head.map((h) => [h, W.HEADER])];
    for (const row of rows) out.push([row[0] ? new W.Date(row[0]) : null].concat(row.slice(1)));
    const ref = `A1:${W.col_letter(head.length - 1)}${Math.max(out.length, 2)}`;
    const xml = W.sheet_xml(out, EXPORT_WIDTHS[what], { freeze_row: 1, filter_ref: ref });
    return { data: await W.write_book([[EXPORT_NAMES[what], xml]]), name: EXPORT_NAMES[what] + '.xlsx' };
  }

  // журнал в .xlsx с теми же листами, столбцами и формулами, что в книге «Журнал ГФО»
  async function journal_xlsx(db) {
    const W = RZ.xlsx, sh = RZ.sh;
    const [data, party] = db.read((repo) => {
      const d = {};
      for (const k of sh.JOURNAL) d[k] = repo.sheet_rows(k).map((r) => r[2]);
      return [d, RZ.svc_sheets.party(repo)];
    });
    const lookup = sh.worker_lookup(data.workers.map((v) => [v[0], v[1]]));
    const worker_rows = data.workers.length + 1;
    const title = sh.TITLE_PREFIX + (isNone(party) ? '' : String(party));
    const title_formula = new W.Formula(`"${sh.TITLE_PREFIX}"&'Общая информация'!$B$6`, title);
    const date = (v) => (v ? new W.Date(v) : null);
    const widths = (sheet) => sheet.cols.map((c) => c.width / 7.5);

    const work_sheet = (key) => {
      const sheet = sh.SHEETS[key];
      const rows = [[[title_formula, W.TITLE]], [], [[sheet.title, W.SUBTITLE]], sheet.cols.map((c) => [c.title, W.HEADER])];
      const ci = sh.sheet_index(sheet, 'count');
      data[key].forEach((v, i) => {
        const n = i + 5;
        const calc = sh.computed(sheet, v, lookup);
        rows.push([date(v[0]), v[1], v[2], v[3], v[4],
          new W.Formula(`IF(AND(D${n}="",E${n}=""),"--",ABS(E${n}-D${n})+1)`, calc[ci]), v[6], v[7],
          new W.Formula(`IF(B${n}="","--",VLOOKUP(B${n},'ID старших'!$B$2:$C$${worker_rows},2,0))`, calc[8])]);
      });
      return W.sheet_xml(rows, widths(sheet), { freeze_row: 4, filter_ref: `A4:I${rows.length}`, heights: { 1: 24 } });
    };

    const snake_sheet = () => {
      const sheet = sh.SHEETS.snake;
      const rows = [[[title_formula, W.TITLE]], [], [[sheet.title, W.SUBTITLE]], sheet.cols.map((c) => [c.title, W.HEADER])];
      data.snake.forEach((v, i) => {
        const n = i + 5;
        rows.push([date(v[0]), v[1], v[2], v[3], v[4],
          new W.Formula(`IF(AND(D${n}="",E${n}=""),"--",ABS(E${n}-D${n})+1)`, sh.channels(v[3], v[4])), v[6]]);
      });
      return W.sheet_xml(rows, widths(sheet), { freeze_row: 4, filter_ref: `A4:G${rows.length}`, heights: { 1: 24 } });
    };

    const plain_sheet = (key) => {
      const sheet = sh.SHEETS[key];
      const rows = [sheet.cols.map((c) => [c.title, W.HEADER])];
      for (const v of data[key]) rows.push(sheet.cols.map((c, i) => (c.kind === 'date' && v[i] ? new W.Date(v[i]) : v[i])));
      return W.sheet_xml(rows, widths(sheet), { freeze_row: 1, filter_ref: `A1:${W.col_letter(sheet.cols.length - 1)}${Math.max(rows.length, 2)}` });
    };

    const workers_sheet = () => {
      const rows = [sh.SHEETS.workers.cols.map((c) => [c.title, W.HEADER])];
      data.workers.forEach((v, i) => rows.push([v[0], v[1], new W.Formula(`A${i + 2}`, v[0] || 0)]));
      return W.sheet_xml(rows, [16, 34, 24], { freeze_row: 1, filter_ref: `A1:C${Math.max(rows.length, 2)}` });
    };

    const info_sheet = () => {
      const rows = [sh.SHEETS.info.cols.map((c) => [c.title, W.HEADER])].concat(data.info.map((v) => v.slice()));
      return W.sheet_xml(rows, [44, 52], { freeze_row: 1 });
    };

    const book = [['Подмотка', work_sheet('podm')], ['Размотка', work_sheet('razm')],
      ['Оставленное оборудование', plain_sheet('oo')], ['Змейки и вылеты', snake_sheet()],
      ['Общая информация', info_sheet()], ['ID старших', workers_sheet()]];
    return { data: await W.write_book(book), name: `Журнал_ГФО_${stamp()}.xlsx` };
  }

  RZ.exporter = { station_history, pack_files, unpack_files, station_history_batch, table_csv, table_xlsx, journal_xlsx,
    _history_name, _table, encode1251, decode1251, EXPORT_NAMES, EXPORT_WIDTHS };
})();
