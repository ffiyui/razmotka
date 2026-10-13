/* Правила учёта, не зависящие от хранилища и интерфейса. Порт app/core/rules.py */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';

  /* Ключ сортировки событий одного пикета: больший ключ = более позднее событие.
     Строки сравниваются так же, как в SQL: дата всегда ГГГГ-ММ-ДД, поэтому сравнение по частям равно сравнению склейки. */
  function last_event_key(date, wtype, seq, same_day) {
    const t = +wtype;
    if (same_day === 'razm_last') return date + t;
    if (same_day === 'podm_last') return date + (1 - t);
    if (same_day === 'entry_order') return date + String(seq).padStart(12, '0') + t;
    throw new Error(same_day);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /* events: [[date, type, seq]] одного пикета. На поле, если последнее событие - размотка */
  function is_on_field(events, same_day) {
    if (!events.length) return false;
    let best = null, bk = null;
    for (const e of events) { const k = last_event_key(e[0], e[1], e[2], same_day); if (bk === null || k > bk) { bk = k; best = e; } }
    return +best[1] === 1;
  }

  /* Проигрывает историю одного пикета по порядку. events: [[date, type, seq, src]].
     Возвращает [лежит ли на поле, [[date, вид, src]]]: «razm» - повторная размотка, «podm» - подмотка без размотки */
  function replay(events, same_day) {
    let state = false;
    const bad = [];
    const sorted = events.map(e => [last_event_key(e[0], e[1], e[2], same_day), e]).sort((a, b) => cmp(a[0], b[0]) || a[1][2] - b[1][2]);
    for (const [, [date, wtype, , src]] of sorted) {
      if (+wtype === 1) { if (state) bad.push([date, 'razm', src]); state = true; }
      else { if (!state) bad.push([date, 'podm', src]); state = false; }
    }
    return [state, bad];
  }

  /* [[line, picket, key]] по возрастанию -> [[line, p1, p2, key]] по непрерывным пикетам */
  function segments(rows) {
    const out = [];
    for (const [line, picket, key] of rows) {
      const last = out[out.length - 1];
      if (last && last[0] === line && last[2] === picket - 1 && last[3] === key) last[2] = picket;
      else out.push([line, picket, picket, key]);
    }
    return out;
  }

  RZ.rules = {last_event_key, is_on_field, replay, segments};
})(globalThis.RZ);
