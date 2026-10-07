/* Проверка строк журнала перед проведением: жёсткие правила и предупреждения. Порт app/core/validation.py */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';
  const sh = RZ.sh, CellError = RZ.CellError;

  /* rows: [[номер строки на экране, id строки, значения]]. Пустые строки пропускаются.
     Любое нарушение - CellError с номером строки и столбца: строка не проводится вовсе.
     Возвращает [[id строки, Interval]] */
  function work_intervals(rows, lookup, workers_names, rules, wtype) {
    const sheet = sh.SHEETS.razm;
    const ix = {};
    for (const k of ['date', 'worker', 'line', 'p1', 'p2']) ix[k] = sh.sheet_index(sheet, k);
    const out = [];
    for (const [number, row_id, v] of rows) {
      if (sh.is_blank(sheet, v)) continue;
      const where = `Строка ${number}`;
      const need = (key, text) => {
        if (v[ix[key]] === null || v[ix[key]] === undefined) throw new CellError(`${where}: не заполнено поле «${text}».`, ix[key], row_id);
        return v[ix[key]];
      };
      const date = need('date', 'Дата');
      const name = need('worker', 'ФИО старшего');
      const line = need('line', 'Линия'), p1 = need('p1', 'Начальный ПП'), p2 = need('p2', 'Конечный ПП');
      const wid = sh.worker_id(name, lookup);
      if (wid === sh.MISSING) throw new CellError(`${where}: «${name}» нет на листе «ID старших».`, ix.worker, row_id);
      if (!(rules.line_min <= line && line <= rules.line_max))
        throw new CellError(`${where}: линия ${line} вне допустимых пределов ${rules.line_min}–${rules.line_max}.`, ix.line, row_id);
      for (const [key, val] of [['p1', p1], ['p2', p2]]) {
        if (!(rules.picket_min <= val && val <= rules.picket_max))
          throw new CellError(`${where}: пикет ${val} вне допустимых пределов ${rules.picket_min}–${rules.picket_max}.`, ix[key], row_id);
      }
      const a = Math.min(p1, p2), b = Math.max(p1, p2);      // перевёрнутый интервал допустим: каналы считаются по модулю
      if (b - a + 1 > rules.max_interval) throw new CellError(`${where}: слишком большой интервал пикетов (${b - a + 1}).`, ix.p2, row_id);
      out.push([row_id, new RZ.Interval(date, line, a, b, Math.trunc(+wid), String(name), wtype)]);
    }
    return out;
  }

  /* Ищет спорные места. Возвращает [blocking, warnings] - два списка строк.
     sps_known(line, p1, p2) -> сколько пикетов интервала есть в SPS (null, если лист пуст)
     field_pickets(line)     -> множество пикетов линии, лежащих на поле */
  function review(intervals, today, sps_known, field_pickets, rules) {
    let future = 0, unknown = 0, conflict_razm = 0, conflict_podm = 0;
    const state = new Map();
    for (const iv of intervals) if (iv.date > today) future++;
    for (const iv of intervals) {
      const known = sps_known(iv.line, iv.p1, iv.p2);
      if (known !== null && known !== undefined) unknown += iv.count - known;
      if (!state.has(iv.line)) state.set(iv.line, new Set(field_pickets(iv.line)));
      const on_field = state.get(iv.line);
      for (let p = iv.p1; p <= iv.p2; p++) {
        if (iv.type === 1) { if (on_field.has(p)) conflict_razm++; else on_field.add(p); }
        else { if (on_field.has(p)) on_field.delete(p); else conflict_podm++; }
      }
    }
    const blocking = [], warnings = [];
    const put = (text, block) => (block ? blocking : warnings).push(text);
    if (future) put(`строк с датой позже сегодняшней: ${future}`, rules.block_future_dates);
    if (unknown) put(`пикетов, которых нет в SPS: ${unknown}`, rules.block_unknown_pickets);
    if (conflict_razm) put(`размотка на пикеты, где оборудование уже числится на поле: ${conflict_razm}`, rules.block_conflicts);
    if (conflict_podm) put(`подмотка с пикетов, где оборудование на поле не числится: ${conflict_podm}`, rules.block_conflicts);
    return [blocking, warnings];
  }

  RZ.validation = {work_intervals, review};
})(globalThis.RZ);
