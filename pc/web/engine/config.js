/* Настройки программы. Порт app/services/config.py: отсутствующие ключи берутся из DEFAULTS.
   Хранятся в том же хранилище, что и данные (ключ «config»), а не в файле config.json. */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';

  const SAME_DAY_RULES = ['razm_last', 'podm_last', 'entry_order'];

  const DEFAULTS = {
    rules: {
      // Что считать последним событием, если размотка и подмотка пикета стоят одной датой:
      //   razm_last - размотку (как в книге Excel), podm_last - подмотку, entry_order - то, что внесено позже
      same_day: 'razm_last',
      max_interval: 5000,
      line_min: 1, line_max: 99999,
      picket_min: 1, picket_max: 9999,
      // Жёсткий режим: спорные строки не вносятся вообще, а не по подтверждению
      block_unknown_pickets: false,
      block_conflicts: false,
      block_future_dates: false,
    },
    import: {
      // Названия листов журнала Excel, из которого загружаются данные
      journal_sheets: {
        razm: 'Размотка', podm: 'Подмотка', oo: 'Оставленное оборудование',
        snake: 'Змейки и вылеты', info: 'Общая информация', workers: 'ID старших',
      },
    },
    // Система координат листа SPS (для GPS): эллипсоид и номер зоны Гаусса-Крюгера
    crs: {ellipsoid: 'gsk2011', zone: 10},
  };

  // Что разрешено менять из окна программы и какого типа значение
  const EDITABLE_RULES = {
    same_day: String, max_interval: v => { const n = Number(v); if (!Number.isInteger(n)) throw new TypeError('not int'); return n; },
    block_unknown_pickets: Boolean, block_conflicts: Boolean, block_future_dates: Boolean,
  };

  const clone = o => JSON.parse(JSON.stringify(o));
  function merge(base, extra) {
    for (const [k, v] of Object.entries(extra || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') merge(base[k], v);
      else base[k] = v;
    }
    return base;
  }

  function validate(cfg) {
    const r = cfg.rules;
    if (!SAME_DAY_RULES.includes(r.same_day)) throw new Error('rules.same_day: допустимо ' + SAME_DAY_RULES.join(', '));
    if (!(r.max_interval >= 1 && r.max_interval <= 100000)) throw new Error('rules.max_interval: от 1 до 100000');
    if (r.line_min > r.line_max || r.picket_min > r.picket_max) throw new Error('rules: минимум больше максимума');
    return cfg;
  }

  function from_saved(saved) {
    const cfg = merge(clone(DEFAULTS), saved || {});
    try { validate(cfg); } catch (e) { return clone(DEFAULTS); }
    return cfg;
  }

  /* Меняет правила из окна программы. Возвращает true, если нужно пересчитать поле */
  function update_rules(cfg, changes) {
    const next = clone(cfg);
    for (const [key, value] of Object.entries(changes)) {
      if (!(key in EDITABLE_RULES)) throw new Error(`Правило «${key}» нельзя менять из программы.`);
      next.rules[key] = EDITABLE_RULES[key](value);
    }
    validate(next);
    const recalc = next.rules.same_day !== cfg.rules.same_day;
    cfg.rules = next.rules;
    return recalc;
  }

  RZ.config = {DEFAULTS, SAME_DAY_RULES, EDITABLE_RULES, from_saved, update_rules, validate, clone};
})(globalThis.RZ);
