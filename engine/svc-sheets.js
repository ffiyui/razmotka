/* Листы журнала: чтение, правка, проведение (размотать / подмотать) и отмена. Порт app/services/sheets.py */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';
  const sh = RZ.sh, ValidationError = RZ.ValidationError;

  function sheet_of(name) {
    if (!Object.prototype.hasOwnProperty.call(sh.SHEETS, name)) throw new ValidationError('Неизвестный лист.');
    return sh.SHEETS[name];
  }

  function seed_info(repo) {
    sh.INFO_DEFAULT.forEach(([name, value], i) => repo.insert_row('info', i + 1, [name, value]));
  }

  function meta() {
    const info_rules = {};
    for (const [k, v] of Object.entries(sh.INFO_RULES)) info_rules[String(k)] = [...v];
    return {sheets: sh.ORDER.map(k => sh.SHEETS[k].meta()), missing: sh.MISSING, no_value: sh.NO_VALUE,
      title_prefix: sh.TITLE_PREFIX, info_rules};
  }

  function party(repo) {
    const rows = repo.sheet_rows('info');
    if (rows.length > sh.INFO_PARTY_ROW && rows[sh.INFO_PARTY_ROW][2].length > 1) return rows[sh.INFO_PARTY_ROW][2][1];
    return null;
  }

  function draft_counts(repo) {
    const out = {};
    for (const name of ['razm', 'podm']) {
      const s = sh.SHEETS[name];
      out[name] = repo.sheet_rows(name).filter(([, , v, batch]) => batch === null && !sh.is_blank(s, v)).length;
    }
    return out;
  }

  /* Сколько каналов в строках-черновиках: они ждут кнопки и на поле пока не учтены */
  function draft_channels(repo) {
    const out = {};
    for (const name of ['razm', 'podm']) {
      const s = sh.SHEETS[name];
      out[name] = repo.sheet_rows(name).reduce((n, [, , v, batch]) =>
        n + (batch === null && !sh.is_blank(s, v) && v[3] !== null && v[4] !== null ? Math.abs(v[4] - v[3]) + 1 : 0), 0);
    }
    return out;
  }

  const action_of = a => ({ts: a[1], rows: a[2], channels: a[3]});

  /* Строки листа. brief - только сведения о последнем действии, без строк */
  function load(db, name, brief = false) {
    const sheet = sheet_of(name);
    if (brief) {
      const action = db.read(repo => (sheet.kind === 'work' ? repo.last_action(name) : null));
      return action ? {action: action_of(action)} : {};
    }
    return db.write(repo => {            // первая загрузка «Общей информации» создаёт список показателей
      if (name === 'info' && !repo.sheet_rows('info').length) seed_info(repo);
      const rows = repo.sheet_rows(name);
      const action = sheet.kind === 'work' ? repo.last_action(name) : null;
      const formats = repo.sheet_formats(name);
      const out = {rows: rows.map(([i, pos, v, batch]) => [i, pos, batch === null ? 0 : 1, v, ...(i in formats ? [formats[i]] : [])])};
      if (action) out.action = action_of(action);
      return out;
    });
  }

  function clean(sheet, values, index, old = null) {
    if (!Array.isArray(values) || values.length !== sheet.cols.length) throw new ValidationError('Неверная строка.');
    const out = [];
    for (let c = 0; c < sheet.cols.length; c++) {
      try { out.push(sh.normalize(sheet, c, values[c], index)); }
      catch (e) { if (e instanceof RZ.CellError) e.col = c; throw e; }
    }
    if (sheet.locked_col >= 0 && index < sheet.locked_rows) {
      const was = old ? old[sheet.locked_col] : null;
      if (out[sheet.locked_col] !== was) throw new ValidationError('Название показателя менять нельзя: от него зависит расчёт.');
    }
    return out;
  }

  const COLOR = /^#[0-9a-fA-F]{6}$/;
  /* Оформление ячеек строки: {номер столбца: {b, i, u, l - начертание; c - цвет текста; g - заливка}} */
  function clean_format(sheet, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    for (const [key, cell] of Object.entries(raw)) {
      if (!/^\d+$/.test(key) || +key >= sheet.cols.length || !cell || typeof cell !== 'object') continue;
      const fmt = {};
      for (const k of ['b', 'i', 'u', 'l']) if (cell[k]) fmt[k] = 1;
      for (const k of ['c', 'g']) if (typeof cell[k] === 'string' && COLOR.test(cell[k])) fmt[k] = cell[k].toLowerCase();
      if (Object.keys(fmt).length) out[String(+key)] = fmt;
    }
    return Object.keys(out).length ? out : null;
  }

  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  /* Сохраняет строки: id = null создаёт новую. У проведённой строки можно менять только оформление */
  function save_rows(db, name, rows) {
    const sheet = sheet_of(name);
    if (sheet.kind === 'work' && rows.length > 50000) throw new ValidationError('Слишком много строк за один раз.');
    const ids = db.write(repo => {
      const old = repo.get_rows(name, rows.filter(r => r.id).map(r => r.id));
      const out = [];
      for (const r of rows) {
        let rid = r.id;
        if (rid && !old.has(rid)) throw new ValidationError('Строка не найдена: обновите страницу.');
        const values = clean(sheet, r.v, parseInt(r.idx ?? 0, 10), rid ? old.get(rid)[1] : null);
        const pos = parseFloat(r.pos ?? 0);
        if (rid && old.get(rid)[2] !== null) {
          if (!same(values, old.get(rid)[1])) throw new ValidationError('Строка проведена. Сначала верните её в черновик.');
        } else if (rid) repo.update_row(name, rid, pos, values);
        else rid = repo.insert_row(name, pos, values);
        if ('f' in r) repo.set_format(name, rid, clean_format(sheet, r.f));
        out.push(rid);
      }
      return out;
    });
    if (name === 'sps' || name === 'info') db.coords = null;      // координаты изменились: карта возьмёт их заново
    return {ids};
  }

  /* Удаляет строки. Проведённая строка удаляется вместе со своим следом в учёте */
  function delete_rows(db, cfg, name, ids) {
    const sheet = sheet_of(name);
    ids = ids.map(i => parseInt(i, 10));
    const done = db.write(repo => {
      if (sheet.locked_rows) throw new ValidationError('Строки этого листа удалять нельзя.');
      const done = repo.done_ids(name, ids);
      repo.delete_rows(name, ids);
      if (done.length) { repo.delete_events(done); repo.rebuild_state(cfg.rules.same_day); }
      return done;
    });
    if (name === 'sps') db.coords = null;
    return {ok: true, recalculated: done.length > 0};
  }

  // ---------------------------------------------------------------- проведение
  const lookup_of = repo => sh.worker_lookup(repo.sheet_rows('workers').map(([, , v]) => [v[0], v[1]]));
  const pad = n => String(n).padStart(2, '0');
  const now_iso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  /* Размотать / подмотать: все строки-черновики листа проверяются и проводятся разом. Либо всё, либо ничего */
  function apply(db, cfg, name, force = false) {
    const sheet = sheet_of(name);
    if (sheet.kind !== 'work') throw new ValidationError('На этом листе нет проведения.');
    const rules = cfg.rules;
    return db.write(repo => {
      const rows = repo.sheet_rows(name);
      const drafts = [];
      rows.forEach(([rid, , v, batch], n) => { if (batch === null) drafts.push([n + 1, rid, v]); });
      const intervals = RZ.validation.work_intervals(drafts, lookup_of(repo), null, rules, sheet.wtype);
      if (!intervals.length) throw new ValidationError('Нечего проводить: заполните строки таблицы.');
      const has_sps = repo.sps_count() > 0;
      const [blocking, warnings] = RZ.validation.review(
        intervals.map(x => x[1]), RZ.today(),
        has_sps ? (l, a, b) => repo.sps_known(l, a, b) : () => null, l => repo.field_pickets(l), rules);
      if (blocking.length) throw new ValidationError('Не проведено: ' + blocking.join('; ') + '.');
      if (warnings.length && !force) return {warnings};

      repo.delete_rows(name, drafts.filter(([, , v]) => sh.is_blank(sheet, v)).map(([, rid]) => rid));
      const batch = repo.new_batch(now_iso(), name, 'apply');
      let total = 0;
      intervals.forEach(([rid, iv], k) => {
        repo.insert_events(rid, iv.line, iv.p1, iv.p2, iv.date, iv.type, iv.wid, iv.worker, batch * 1000000 + k);
        total += iv.count;
      });
      repo.set_done(intervals.map(x => x[0]), batch);
      repo.finish_batch(batch, intervals.length, total);
      repo.rebuild_state(rules.same_day);
      return {ok: true, rows: intervals.length, channels: total};
    });
  }

  function revert(repo, cfg, ids) {
    repo.delete_events(ids);
    repo.set_done(ids, null);
    repo.rebuild_state(cfg.rules.same_day);
  }

  /* Отменяет последнее проведение листа: его строки возвращаются в черновик */
  function undo(db, cfg, name) {
    const sheet = sheet_of(name);
    return db.write(repo => {
      const last = sheet.kind === 'work' ? repo.last_action(name) : null;
      if (!last) throw new ValidationError('Отменять нечего.');
      const ids = repo.batch_row_ids(last[0]);
      revert(repo, cfg, ids);
      repo.mark_undone(last[0]);
      return {ok: true, rows: ids.length, channels: last[3]};
    });
  }

  /* Возвращает выбранные проведённые строки в черновик (чтобы их можно было исправить) */
  function unapply(db, cfg, name, ids) {
    sheet_of(name);
    return db.write(repo => {
      const done = repo.done_ids(name, ids.map(i => parseInt(i, 10)));
      if (done.length) revert(repo, cfg, done);
      return {ok: true, rows: done.length};
    });
  }

  // ---------------------------------------------------------------- уборка данных
  function cleanup(db, cfg, d1, d2, types) {
    const a = sh.parse_date(d1), b = sh.parse_date(d2);
    if (a === null || b === null || a > b) throw new ValidationError('Укажите корректный диапазон дат.');
    types = (types || []).filter(t => t === 0 || t === 1);
    if (!types.length) throw new ValidationError('Выберите, что удалять: подмотку, размотку или оба типа.');
    return db.write(repo => {
      let removed = 0;
      for (const [name, wtype] of [['razm', 1], ['podm', 0]]) {
        if (!types.includes(wtype)) continue;
        const ids = repo.sheet_rows(name).filter(([, , v]) => v[0] && a <= v[0] && v[0] <= b).map(r => r[0]);
        repo.delete_events(ids);
        repo.delete_rows(name, ids);
        removed += ids.length;
      }
      repo.rebuild_state(cfg.rules.same_day);
      return {ok: true, deleted: removed};
    });
  }

  function clear(db, cfg) {
    db.write(repo => {
      repo.clear_sheet('razm'); repo.clear_sheet('podm'); repo.clear_events(); repo.clear_batches();
      repo.rebuild_state(cfg.rules.same_day);
    });
    return {ok: true};
  }

  function recalc(db, cfg) {
    db.write(repo => repo.rebuild_state(cfg.rules.same_day));
    return {ok: true};
  }

  RZ.svc_sheets = {meta, party, draft_counts, draft_channels, load, save_rows, delete_rows, apply, undo, unapply, cleanup, clear, recalc};
})(globalThis.RZ);
