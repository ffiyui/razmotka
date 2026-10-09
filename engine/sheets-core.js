/* Листы журнала: столбцы, проверки при вводе и формулы. Порт app/core/sheets.py и app/core/models.py.
   Это единственное описание листов: интерфейс строит таблицы по нему, а движок по нему проверяет данные. */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';

  class ValidationError extends Error {
    constructor(message) { super(message); this.name = 'ValidationError'; }
  }
  /* Значение не подошло к столбцу. col - номер столбца (для подсветки в таблице) */
  class CellError extends ValidationError {
    constructor(message, col = null, row_id = null) { super(message); this.col = col; this.row_id = row_id; }
  }
  RZ.ValidationError = ValidationError;
  RZ.CellError = CellError;

  const WorkType = Object.freeze({
    PODM: 0, RAZM: 1,
    title: t => (t === 1 ? 'Размотка' : 'Подмотка'),
  });
  RZ.WorkType = WorkType;

  /* Интервал: одна строка ввода (кто, когда, какие пикеты). p1 <= p2 */
  class Interval {
    constructor(date, line, p1, p2, wid, worker, type) {
      Object.assign(this, {date, line, p1, p2, wid, worker, type});
    }
    get count() { return this.p2 - this.p1 + 1; }
    * pickets() { for (let p = this.p1; p <= this.p2; p++) yield p; }
  }
  RZ.Interval = Interval;

  RZ.today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

  const TITLE_PREFIX = 'Журнал учёта работы ГФО СП №';
  const INFO_PARTY_ROW = 4;      // «Сейсморазведочная партия №»: 5-й показатель
  const MISSING = '#Н/Д';        // так Excel показывает ВПР, не нашедший значение
  const NO_VALUE = '--';

  const col = (key, title, kind, width = 110, o = {}) => ({
    key, title, kind, width, calc: o.calc || '', suggest: o.suggest || '', lo: o.lo ?? 0, hi: o.hi ?? 99999999,
    err_title: o.err_title || '', err: o.err || '', note: o.note || '',
  });
  const DATE_ERR = {err_title: 'Дата', err: 'Введите дату, например 05.10.2026'};
  const LINE_ERR = {lo: 1, hi: 99999, err_title: 'Линия', err: 'Введите номер линии: целое число'};
  const PICKET_ERR = t => ({lo: 1, hi: 9999, err_title: t, err: 'Введите целый номер пикета'});

  const WORK_COLS = () => [
    col('date', 'Дата', 'date', 104, DATE_ERR),
    col('worker', 'ФИО старшего', 'text', 184, {suggest: 'workers'}),
    col('line', 'Линия', 'int', 84, LINE_ERR),
    col('p1', 'Начальный ПП', 'int', 132, PICKET_ERR('Начальный ПП')),
    col('p2', 'Конечный ПП', 'int', 126, PICKET_ERR('Конечный ПП')),
    col('count', 'Кол-во каналов', 'calc', 138, {calc: 'channels'}),
    col('akb', 'АКБ', 'text', 84),
    col('note', 'Примечание', 'text', 240),
    col('wid', 'ID старшего', 'calc', 118, {calc: 'worker_id'}),
  ];

  /* Разбивка: топографы выносят пикеты на местность. Первые шесть столбцов те же, что у размотки */
  const RAZB_COLS = () => [
    col('date', 'Дата', 'date', 104, DATE_ERR),
    col('worker', 'ФИО топографа', 'text', 184, {suggest: 'topo'}),
    col('line', 'Линия', 'int', 84, LINE_ERR),
    col('p1', 'Начальный ПП', 'int', 132, PICKET_ERR('Начальный ПП')),
    col('p2', 'Конечный ПП', 'int', 126, PICKET_ERR('Конечный ПП')),
    col('count', 'Кол-во пикетов', 'calc', 138, {calc: 'channels'}),
    col('note', 'Примечание', 'text', 280),
    col('wid', 'ID топографа', 'calc', 118, {calc: 'worker_id'}),
  ];

  const sheet = (id, title, cols, kind = 'plain', o = {}) => ({
    id, title, cols, kind, wtype: o.wtype ?? null, button: o.button || '', undo: o.undo || '',
    blank: o.blank ?? 60, heading: o.heading ?? true, locked_col: o.locked_col ?? -1,
    locked_rows: o.locked_rows ?? 0, hint: o.hint || '',
    lookup: o.lookup || 'workers', prefix: o.prefix || 'Журнал ГФО', unit: o.unit || 'канал',
  });
  /* Описание листа для интерфейса (то же, что Sheet.meta() в Python) */
  const meta = s => {
    const d = {};
    for (const k of ['id', 'title', 'kind', 'wtype', 'button', 'undo', 'blank', 'heading', 'locked_col', 'locked_rows', 'hint', 'lookup', 'prefix', 'unit']) d[k] = s[k];
    d.cols = s.cols.map(c => ({...c}));
    return d;
  };

  const SHEETS = {
    razm: sheet('razm', 'Размотка', WORK_COLS(), 'work', {wtype: 1, button: 'Размотать', undo: 'Отменить размотку'}),
    podm: sheet('podm', 'Подмотка', WORK_COLS(), 'work', {wtype: 0, button: 'Подмотать', undo: 'Отменить подмотку'}),
    oo: sheet('oo', 'Оставленное оборудование', [
      col('line', 'Линия', 'int', 90, LINE_ERR),
      col('picket', 'Пикет', 'int', 90, PICKET_ERR('Пикет')),
      col('status', 'Статус', 'int', 90, {lo: 0, hi: 1, err_title: 'Введите 0 или 1',
        err: '0 — оборудование потеряно навсегда (на списание)\n1 — оборудование пока не подмотано по объективным причинам',
        note: '0 — утерянное оборудование (на списание)\n1 — оставленное оборудование (временно)'}),
      col('reason', 'Причина', 'text', 240),
      col('note', 'Примечание', 'text', 280),
      col('date', 'Дата', 'date', 104, DATE_ERR),
    ], 'plain', {heading: false, blank: 80}),
    snake: sheet('snake', 'Змейки и вылеты', [
      col('date', 'Дата', 'date', 104, DATE_ERR),
      col('who', 'ФИО, кто устанавливал', 'text', 200),
      col('line', 'Линия', 'int', 84, LINE_ERR),
      col('p1', 'Начальный ПП', 'int', 132, PICKET_ERR('Начальный ПП')),
      col('p2', 'Конечный ПП', 'int', 126, PICKET_ERR('Конечный ПП')),
      col('count', 'Кол-во каналов', 'calc', 138, {calc: 'channels'}),
      col('note', 'Примечание', 'text', 300),
    ]),
    info: sheet('info', 'Общая информация', [
      col('name', 'Показатель', 'text', 320),
      col('value', 'Значение', 'any', 380),
    ], 'info', {heading: false, blank: 7, locked_col: 0, locked_rows: 18}),
    workers: sheet('workers', 'ID старших', [
      col('id', 'ID старшего', 'int', 120, {lo: 1, hi: 999999}),
      col('name', 'ФИО старшего', 'text', 260),
      col('same', 'ID старшего (дубль)', 'calc', 190, {calc: 'same_id'}),
    ], 'workers', {heading: false, blank: 20}),
    razb: sheet('razb', 'Разбивка', RAZB_COLS(), 'work', {wtype: 2, button: 'Разбить', undo: 'Отменить разбивку', lookup: 'topo', prefix: 'Журнал ТГО', unit: 'пикет'}),
    topo: sheet('topo', 'ID топографов', [
      col('id', 'ID топографа', 'int', 120, {lo: 1, hi: 999999}),
      col('name', 'ФИО топографа', 'text', 260),
      col('same', 'ID топографа (дубль)', 'calc', 190, {calc: 'same_id'}),
    ], 'workers', {heading: false, blank: 20}),
    /* Координаты пикетов. Из этого листа движок берёт систему координат для карты */
    sps: sheet('sps', 'SPS', [
      col('line', 'Профиль', 'int', 110, {lo: 1, hi: 99999, err_title: 'Профиль', err: 'Введите номер профиля: целое число'}),
      col('picket', 'Пикет', 'int', 110, PICKET_ERR('Пикет')),
      col('x', 'X', 'num', 150, {err_title: 'X', err: 'Введите число, например 457982,96'}),
      col('y', 'Y', 'num', 150, {err_title: 'Y', err: 'Введите число, например 5704018,11'}),
      col('z', 'Z', 'num', 110, {err_title: 'Z', err: 'Введите число, например 123,6'}),
    ], 'sps', {heading: false, blank: 200,
      hint: 'Координаты пикетов. Вставьте сюда столбцы из Excel: по ним строится карта на экране «Поле» и проверяется, существует ли пикет.'}),
  };
  for (const s of Object.values(SHEETS)) s.meta = () => meta(s);
  const JOURNAL = ['razm', 'podm', 'oo', 'snake', 'info', 'workers'];     // листы книги «Журнал ГФО»
  const WORK = ['razm', 'podm', 'razb'];                                  // листы с проведением: строка ждёт кнопки
  const ROWS = ['razm', 'podm', 'razb', 'oo', 'snake', 'info', 'workers', 'topo'];   // все листы, кроме SPS
  const ORDER = [...JOURNAL, 'razb', 'topo', 'sps'];

  /* Проверки значений отдельных ячеек листа «Общая информация» (как в книге) */
  const INFO_RULES = {4: [1, 99, 'Номер партии?', 'Введите корректный номер партии']};
  for (let r = 8; r <= 16; r++) INFO_RULES[r] = [1, 999999, 'Ошибка', 'Введите корректное целое положительное число'];

  const INFO_DEFAULT = [
    ['Участок работ', ''], ['Объём работ', ''], ['Методика работ', ''], ['Подразделение', ''],
    ['Сейсморазведочная партия №', null], ['Начальник ГФО', ''], ['Тип сейсмостанции', ''],
    ['Тип геофонов', ''], ['Количество каналов на проекте, шт.', null], ['Общая плановая размотка, кан.', null],
    ['Количество бригад по проекту', null], ['Шаг ЛПП, м', null], ['Шаг ЛПВ, м', null], ['Шаг ПП, м', null],
    ['Шаг ПВ, м', null], ['Шаг нумерации ЛПП', null], ['Шаг нумерации ЛПВ', null], ['Активная расстановка', ''],
  ];

  // ---------------------------------------------------------------- значения
  /* Разделители даты: точка, дробь, дефис, а также запятая и пробел: на цифровой клавиатуре iOS точки нет */
  const DMY = /^(\d{1,2})[./\-, ]+(\d{1,2})(?:[./\-, ]+(\d{2}|\d{4}))?$/;
  const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
  const pad = (n, w) => String(n).padStart(w, '0');

  function parse_date(text) {
    const s = String(text ?? '').trim();
    let y, mo, d, m = ISO.exec(s);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = DMY.exec(s);
      if (!m) return null;
      d = +m[1]; mo = +m[2];
      y = m[3] ? +m[3] : new Date().getFullYear();
      if (y < 100) y += 2000;
    }
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
    const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return d > dim ? null : `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
  }

  const SPACES = /[\s ]/g;
  function parse_int(text) {
    if (typeof text === 'boolean') return null;
    if (typeof text === 'number') return Number.isInteger(text) ? text : null;
    let s = String(text ?? '').replace(SPACES, '');
    s = s.replace(/[.,]0+$/, '');
    return /^-?\d+$/.test(s) ? parseInt(s, 10) : null;
  }

  /* Число с запятой или точкой: «457982,96», «457 982.96» */
  function parse_num(text) {
    if (typeof text === 'boolean') return null;
    if (typeof text === 'number') return Number.isFinite(text) ? text : null;
    const s = String(text ?? '').replace(SPACES, '').replace(/,/g, '.');
    return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : null;
  }

  /* Python round(v, n): по точному десятичному значению числа, при точной середине - к чётному */
  function round_half_even(v, n) {
    if (!Number.isFinite(v)) return v;
    const neg = v < 0, s = Math.abs(v).toFixed(Math.min(100, n + 60)), dot = s.indexOf('.');
    const tail = s.slice(dot + 1 + n);
    if (/^50*$/.test(tail)) {                                   // ровно посередине
      let big = BigInt(s.slice(0, dot) + s.slice(dot + 1, dot + 1 + n));
      if (big % 2n === 1n) big += 1n;
      const t = big.toString().padStart(n + 1, '0');
      return Number((neg ? '-' : '') + (n ? t.slice(0, -n) + '.' + t.slice(-n) : t));
    }
    return Number(v.toFixed(n));
  }
  const round4 = v => round_half_even(v, 4);

  function rule(sheet, c, rowIndex) {
    if (sheet.id === 'info' && c.kind === 'any' && rowIndex in INFO_RULES) {
      const [lo, hi, t, e] = INFO_RULES[rowIndex];
      return ['int', lo, hi, t, e];
    }
    return [c.kind, c.lo, c.hi, c.err_title, c.err];
  }

  /* Приводит введённое к хранимому виду. Пустое -> null. Не подошло -> CellError */
  function normalize(sheet, colIndex, raw, rowIndex = 0) {
    const c = sheet.cols[colIndex];
    if (c.kind === 'calc') return null;
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    const [kind, lo, hi, t, e] = rule(sheet, c, rowIndex);
    const bad = () => new CellError((t ? t + ': ' : '') + (e || 'значение не подходит').replace(/\n/g, '; '), colIndex);
    if (kind === 'date') {
      const v = parse_date(raw);
      if (v === null) throw bad();
      return v;
    }
    if (kind === 'int') {
      const v = parse_int(raw);
      if (v === null || v < lo || v > hi) throw bad();
      return v;
    }
    if (kind === 'num') {
      const v = parse_num(raw);
      if (v === null || Math.abs(v) > 1e12) throw bad();
      return Number.isInteger(v) ? v : round4(v);
    }
    const text = String(raw).trim();
    if (kind === 'any') {
      const v = parse_int(text);
      if (v !== null && /^-?\d+$/.test(text.replace(/ /g, ''))) return v;
    }
    if (text.length > 500) throw new CellError('Слишком длинный текст (больше 500 знаков).', colIndex);
    return text;
  }

  // ---------------------------------------------------------------- формулы
  /* Кол-во каналов. Незаполненная строка даёт «--» */
  const channels = (p1, p2) => (p1 === null || p1 === undefined || p2 === null || p2 === undefined ? NO_VALUE : Math.abs(p2 - p1) + 1);

  const fold = s => String(s).trim().toLowerCase();
  /* ФИО -> ID, как ВПР с точным совпадением (регистр не важен, берётся первое совпадение) */
  function worker_lookup(workers) {
    const out = new Map();
    for (const [ident, name] of workers) {
      if (name) { const k = fold(name); if (!out.has(k)) out.set(k, ident === null || ident === undefined ? 0 : ident); }
    }
    return out;
  }
  function worker_id(name, lookup) {
    if (name === null || name === undefined || String(name).trim() === '') return NO_VALUE;
    const k = fold(name);
    return lookup.has(k) ? lookup.get(k) : MISSING;
  }

  function sheet_index(sh, key) {
    const i = sh.cols.findIndex(c => c.key === key);
    if (i < 0) throw new Error(key);
    return i;
  }

  /* Значения вычисляемых столбцов строки: {индекс столбца: значение} */
  function computed(sh, values, lookup) {
    const out = {};
    sh.cols.forEach((c, i) => {
      if (c.calc === 'channels') out[i] = channels(values[sheet_index(sh, 'p1')], values[sheet_index(sh, 'p2')]);
      else if (c.calc === 'worker_id') out[i] = worker_id(values[sheet_index(sh, 'worker')], lookup);
      else if (c.calc === 'same_id') out[i] = values[sheet_index(sh, 'id')] || 0;
    });
    return out;
  }

  const blank_values = sh => sh.cols.map(() => null);
  const is_blank = (sh, values) => values.every((v, i) => sh.cols[i].kind === 'calc' || v === null || v === undefined);

  /* Текст ячейки так, как его видит пользователь (для выгрузок и копирования) */
  function display(sh, colIndex, value) {
    if (value === null || value === undefined) return '';
    const k = sh.cols[colIndex].kind;
    if (k === 'date') return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
    if (k === 'num') return String(value).replace('.', ',');
    return String(value);
  }

  /* ---------------------------------------------------------------- свои листы
     Пользователь создаёт журналы (вкладки на главной) и в них листы трёх видов:
     work - таблица работ, как «Разбивка»: строка - линия и диапазон пикетов, кнопка «Провести» отмечает пикеты
            выполненными (без учёта оборудования на поле);
     workers - таблица ID исполнителей, как «ID топографов»;
     plain - простая таблица: дата, линия, пикет, текст, примечание.
     Описания хранятся в базе (часть custom) и в файле проекта; здесь они превращаются в обычные листы. */
  const CUSTOM_KINDS = ['work', 'workers', 'plain'];
  const BUILTIN = new Set(Object.keys(SHEETS));
  const custom_id = id => typeof id === 'string' && /^c[a-z0-9]{2,24}$/.test(id) && !BUILTIN.has(id);
  function custom_sheet(d) {
    const title = String(d.title || 'Лист').slice(0, 60), lookup = custom_id(d.lookup) || d.lookup === 'workers' ? d.lookup : 'topo';
    if (d.kind === 'workers') return sheet(d.id, title, [
      col('id', 'ID исполнителя', 'int', 120, {lo: 1, hi: 999999}),
      col('name', 'ФИО исполнителя', 'text', 260),
      col('same', 'ID (дубль)', 'calc', 160, {calc: 'same_id'}),
    ], 'workers', {heading: false, blank: 20});
    if (d.kind === 'plain') return sheet(d.id, title, [
      col('date', 'Дата', 'date', 104, DATE_ERR),
      col('line', 'Линия', 'int', 84, LINE_ERR),
      col('picket', 'Пикет', 'int', 90, PICKET_ERR('Пикет')),
      col('text', 'Текст', 'text', 240),
      col('note', 'Примечание', 'text', 240),
    ], 'plain', {heading: false, blank: 60});
    return sheet(d.id, title, [
      col('date', 'Дата', 'date', 104, DATE_ERR),
      col('worker', 'ФИО исполнителя', 'text', 184, {suggest: lookup}),
      col('line', 'Линия', 'int', 84, LINE_ERR),
      col('p1', 'Начальный ПП', 'int', 132, PICKET_ERR('Начальный ПП')),
      col('p2', 'Конечный ПП', 'int', 126, PICKET_ERR('Конечный ПП')),
      col('count', 'Кол-во пикетов', 'calc', 138, {calc: 'channels'}),
      col('note', 'Примечание', 'text', 280),
      col('wid', 'ID исполнителя', 'calc', 118, {calc: 'worker_id'}),
    ], 'work', {wtype: 2, button: String(d.button || 'Провести').slice(0, 30), undo: 'Отменить проведение', lookup,
      prefix: String(d.prefix || 'Журнал').slice(0, 60), unit: 'пикет'});
  }
  /* Ставит свои листы: прежние свои убираются, встроенные не трогаются. Возвращает принятые описания */
  function register_custom(defs) {
    for (const id of Object.keys(SHEETS)) if (!BUILTIN.has(id)) delete SHEETS[id];
    const keep = a => { const b = a.filter(id => BUILTIN.has(id)); a.length = 0; a.push(...b); };
    keep(WORK); keep(ROWS); keep(ORDER);
    const ok = [];
    for (const d of Array.isArray(defs) ? defs : []) {
      if (!d || !custom_id(d.id) || !CUSTOM_KINDS.includes(d.kind) || SHEETS[d.id]) continue;
      const s = custom_sheet(d);
      s.custom = true; s.journal = String(d.journal || ''); s.meta = () => ({...meta(s), custom: true, journal: s.journal});
      SHEETS[d.id] = s; ROWS.push(d.id); ORDER.splice(ORDER.length - 1, 0, d.id);
      if (s.kind === 'work') WORK.push(d.id);
      ok.push({id: d.id, kind: d.kind, title: s.title, journal: s.journal, lookup: s.lookup, button: s.button, prefix: s.prefix});
    }
    return ok;
  }

  RZ.sh = {
    TITLE_PREFIX, INFO_PARTY_ROW, MISSING, NO_VALUE, SHEETS, JOURNAL, ORDER, WORK, ROWS, INFO_RULES, INFO_DEFAULT,
    CUSTOM_KINDS, BUILTIN, custom_id, register_custom,
    parse_date, parse_int, parse_num, normalize, channels, worker_lookup, worker_id, computed, sheet_index,
    blank_values, is_blank, display, round4, round_half_even,
  };
})(globalThis.RZ);
