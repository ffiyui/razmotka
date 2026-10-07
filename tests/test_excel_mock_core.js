/* Заглушка ядра для тестов Excel-слоя, пока нет настоящих sheets-core/validation: порт нужных функций app/core.
   Исполняется внутри vm-контекста; метаданные листов берёт из globalThis.__META__ (сброс из Python). */
globalThis.RZ = globalThis.RZ || {};
(function () {
  class ValidationError extends Error {}
  class CellError extends ValidationError {
    constructor(message, col, row_id) { super(message); this.col = col === undefined ? null : col; this.row_id = row_id === undefined ? null : row_id; }
  }
  const META = globalThis.__META__;
  const SHEETS = META.meta;
  const INFO_RULES = META.info_rules;
  const MISSING = '#Н/Д', NO_VALUE = '--';
  const TITLE_PREFIX = 'Журнал учёта работы ГФО СП №';

  function parse_date(text) {
    const s = String(text == null ? '' : text).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else {
      m = /^(\d{1,2})[./\-](\d{1,2})(?:[./\-](\d{2}|\d{4}))?$/.exec(s);
      if (!m) return null;
      d = +m[1]; mo = +m[2];
      y = m[3] ? +m[3] : new Date().getFullYear();
      if (y < 100) y += 2000;
    }
    if (!(y >= 2000 && y <= 2100)) return null;
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return t.toISOString().slice(0, 10);
  }
  function parse_int(text) {
    if (typeof text === 'boolean') return null;
    if (typeof text === 'number') return Number.isInteger(text) ? text : null;
    let s = String(text == null ? '' : text).replace(/[\s ]/g, '').replace(/[.,]0+$/, '');
    return /^-?\d+$/.test(s) ? parseInt(s, 10) : null;
  }
  function parse_num(text) {
    if (typeof text === 'boolean') return null;
    if (typeof text === 'number') return isFinite(text) ? text : null;
    const s = String(text == null ? '' : text).replace(/[\s ]/g, '').replace(/,/g, '.');
    return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : null;
  }
  function rule(sheet, col, row_index) {
    if (sheet.id === 'info' && col.kind === 'any' && INFO_RULES[row_index]) {
      const [lo, hi, t, e] = INFO_RULES[row_index];
      return ['int', lo, hi, t, e];
    }
    return [col.kind, col.lo, col.hi, col.err_title, col.err];
  }
  function normalize(sheet, ci, raw, row_index) {
    row_index = row_index || 0;
    const col = sheet.cols[ci];
    if (col.kind === 'calc') return null;
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    const [kind, lo, hi, t, e] = rule(sheet, col, row_index);
    const bad = () => new CellError((t ? t + ': ' : '') + (e || 'значение не подходит').replace(/\n/g, '; '), ci);
    if (kind === 'date') { const v = parse_date(raw); if (v === null) throw bad(); return v; }
    if (kind === 'int') { const v = parse_int(raw); if (v === null || v < lo || v > hi) throw bad(); return v; }
    if (kind === 'num') {
      const v = parse_num(raw);
      if (v === null || Math.abs(v) > 1e12) throw bad();
      return Number.isInteger(v) ? v : Number(v.toFixed(4));
    }
    const text = String(raw).trim();
    if (kind === 'any') {
      const v = parse_int(text);
      if (v !== null && /^-?\d+$/.test(text.replace(/ /g, ''))) return v;
    }
    if (text.length > 500) throw new CellError('Слишком длинный текст (больше 500 знаков).', ci);
    return text;
  }
  const channels = (p1, p2) => (p1 == null || p2 == null ? NO_VALUE : Math.abs(p2 - p1) + 1);
  function worker_lookup(workers) {
    const m = new Map();
    for (const [id, name] of workers) if (name) { const k = String(name).trim().toLowerCase(); if (!m.has(k)) m.set(k, id == null ? 0 : id); }
    return m;
  }
  function worker_id(name, lookup) {
    if (name == null || String(name).trim() === '') return NO_VALUE;
    const k = String(name).trim().toLowerCase();
    return lookup.has(k) ? lookup.get(k) : MISSING;
  }
  function sheet_index(sheet, key) {
    const i = sheet.cols.findIndex((c) => c.key === key);
    if (i < 0) throw new Error(key);
    return i;
  }
  function computed(sheet, values, lookup) {
    const out = {};
    sheet.cols.forEach((col, i) => {
      if (col.calc === 'channels') out[i] = channels(values[sheet_index(sheet, 'p1')], values[sheet_index(sheet, 'p2')]);
      else if (col.calc === 'worker_id') out[i] = worker_id(values[sheet_index(sheet, 'worker')], lookup);
      else if (col.calc === 'same_id') out[i] = values[sheet_index(sheet, 'id')] || 0;
    });
    return out;
  }
  const is_blank = (sheet, values) => values.every((v, i) => sheet.cols[i].kind === 'calc' || v === null || v === undefined);

  RZ.ValidationError = ValidationError;
  RZ.CellError = CellError;
  RZ.sh = { SHEETS, JOURNAL: ['razm', 'podm', 'oo', 'snake', 'info', 'workers'], ORDER: Object.keys(SHEETS), TITLE_PREFIX, MISSING, NO_VALUE,
    parse_date, parse_int, parse_num, normalize, channels, worker_lookup, worker_id, computed, sheet_index, is_blank };

  RZ.validation = { work_intervals(rows, lookup, names, rules, wtype) {
    const sheet = SHEETS.razm;
    const ix = {};
    for (const k of ['date', 'worker', 'line', 'p1', 'p2']) ix[k] = sheet_index(sheet, k);
    const out = [];
    for (const [number, row_id, v] of rows) {
      if (is_blank(sheet, v)) continue;
      const where = `Строка ${number}`;
      const need = (key, text) => {
        if (v[ix[key]] == null) throw new CellError(`${where}: не заполнено поле «${text}».`, ix[key], row_id);
        return v[ix[key]];
      };
      const date = need('date', 'Дата'), name = need('worker', 'ФИО старшего');
      const line = need('line', 'Линия'), p1 = need('p1', 'Начальный ПП'), p2 = need('p2', 'Конечный ПП');
      const wid = worker_id(name, lookup);
      if (wid === MISSING) throw new CellError(`${where}: «${name}» нет на листе «ID старших».`, ix.worker, row_id);
      if (!(rules.line_min <= line && line <= rules.line_max)) throw new CellError(`${where}: линия ${line} вне допустимых пределов ${rules.line_min}–${rules.line_max}.`, ix.line, row_id);
      for (const [key, val] of [['p1', p1], ['p2', p2]]) {
        if (!(rules.picket_min <= val && val <= rules.picket_max)) throw new CellError(`${where}: пикет ${val} вне допустимых пределов ${rules.picket_min}–${rules.picket_max}.`, ix[key], row_id);
      }
      const a = Math.min(p1, p2), b = Math.max(p1, p2);
      if (b - a + 1 > rules.max_interval) throw new CellError(`${where}: слишком большой интервал пикетов (${b - a + 1}).`, ix.p2, row_id);
      out.push([row_id, { date, line, p1: a, p2: b, wid: Number(wid), worker: String(name), type: wtype, count: b - a + 1 }]);
    }
    return out;
  } };
})();
