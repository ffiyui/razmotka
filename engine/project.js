/* Файл проекта (.rzm): обмен с настольной программой и между телефонами. Порт app/services/project.py.
   Файл - архив zip: manifest.json (что это за файл), journal.json (строки листов с постоянными номерами, SPS,
   контуры DXF, треки) и settings.json (правила учёта и система координат). Базы SQLite на телефоне нет:
   настольная программа кладёт в файл и базу, и journal.json, а из файла с телефона собирает базу сама.

   Загрузка идёт в два шага: inspect показывает, что в файлах нового и кто это выполнил, apply меняет проект.
   «Принять изменения» (merge) - новые строки добавляются и ждут кнопки; «Заменить проект» (replace) - проект
   становится копией файла, выполненные строки остаются выполненными. */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';
  const sh = RZ.sh, ValidationError = RZ.ValidationError;
  const APP = 'razmotka', FORMAT = 2, EXT = '.rzm';
  const PARTS = ['journal', 'sps', 'dxf', 'tracks', 'settings'];
  /* Листы, которые объединяются: встроенные и свои листы пользователя (sheets-core.js, register_custom) */
  const PEOPLE_LIST = () => ['workers', 'topo', ...sh.ROWS.filter(n => sh.SHEETS[n].custom && sh.SHEETS[n].kind === 'workers')];
  const MERGED_LIST = () => ['razm', 'podm', 'razb', 'oo', 'snake', ...sh.ROWS.filter(n => sh.SHEETS[n].custom && sh.SHEETS[n].kind !== 'workers')];
  const NOT_A_PROJECT = 'Это не файл проекта. Нужен файл .rzm, сохранённый кнопкой «Сохранить файл проекта».';
  const pending = new Map();                 // проверенные файлы ждут решения пользователя: ключ -> источники
  const pad = n => String(n).padStart(2, '0');
  const fold = s => String(s || '').trim().toLowerCase();

  // ---------------------------------------------------------------- сохранение
  /* a.parts - что положить (через запятую: sps, dxf, tracks, settings); журнал кладётся всегда.
     a.tasks - из журнала только задания: название листа работ или all. a.name - имя файла без расширения. */
  async function export_project(db, cfg, a = {}) {
    const parts = new Set(String(a.parts ?? PARTS.join(',')).split(',').filter(p => PARTS.includes(p)));
    parts.add('journal');
    const tasks = a.tasks || null;
    if (tasks && tasks !== 'all' && !sh.WORK.includes(tasks)) throw new ValidationError('Неизвестный вид работ для выгрузки заданий.');
    const keep = tasks ? (tasks === 'all' ? sh.WORK : [tasks]) : null;
    const journal = {version: 1, sheets: {}, gone: []};
    const party = db.read(repo => {
      for (const name of sh.ROWS) {
        let rows = repo.rows_full(name);
        if (keep && !['info', 'workers', 'topo'].includes(name)) rows = keep.includes(name) ? rows.filter(r => r[3] === null) : [];
        journal.sheets[name] = rows.map(([, pos, v, batch, uid, ts, origin, fmt]) => ({uid, pos, v, done: batch !== null, ts, origin, fmt: fmt || null}));
      }
      if (!keep) journal.gone = [...repo.gone_uids()];
      if (parts.has('sps')) journal.sps = repo.sheet_rows('sps').map(r => r[2]);
      return RZ.svc_sheets.party(repo);
    });
    journal.custom = db.get('custom', []) || [];             // свои листы пользователя: описания
    if (parts.has('dxf')) journal.dxf = db.get('dxf', []) || [];
    if (parts.has('tracks')) journal.tracks = (db.get('tracks', []) || []).map(({uid, name, ts, pts}) => ({uid, name, ts, pts}));
    const d = new Date(), who = (db.get('prefs', {}) || {}).me, me = (who && typeof who === 'object' ? who.name : who) || '';
    const rows = {}; for (const [k, v] of Object.entries(journal.sheets)) rows[k] = v.length;
    rows.sps = (journal.sps || []).length;
    const manifest = {app: APP, format: FORMAT, created: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      source: (me || 'телефон').slice(0, 60), device: 'phone', party, rows, marks: 0, dxf: (journal.dxf || []).length, underlays: null,
      parts: {journal: true, sps: parts.has('sps'), marks: false, dxf: parts.has('dxf'), underlays: false, settings: parts.has('settings'), ui: false, tracks: parts.has('tracks')}};
    if (keep) { manifest.partial = true; manifest.tasks = tasks; }
    const files = [{name: 'manifest.json', data: JSON.stringify(manifest, null, 1)}, {name: 'journal.json', data: JSON.stringify(journal)}];
    if (parts.has('settings')) files.push({name: 'settings.json', data: JSON.stringify({rules: cfg.rules, crs: cfg.crs}, null, 1)});
    const data = await RZ.zip.write(files);
    const safe = String(a.name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    const name = (safe || `Размотка_телефон_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`) + EXT;
    return {data, name};
  }

  // ---------------------------------------------------------------- чтение файла
  async function open(bytes, name) {
    let zip;
    try { zip = await RZ.zip.read(bytes); } catch (e) { throw new ValidationError(NOT_A_PROJECT); }
    const json = async (file) => { try { return JSON.parse(await zip.text(file)); } catch (e) { throw new ValidationError(`Файл проекта повреждён: не читается ${file}.`); } };
    if (!zip.has('manifest.json')) throw new ValidationError(NOT_A_PROJECT);
    const m = await json('manifest.json');
    if (!m || m.app !== APP) throw new ValidationError(NOT_A_PROJECT);
    if (!Number.isInteger(m.format) || m.format > FORMAT) throw new ValidationError('Файл проекта создан более новой версией программы. Обновите приложение.');
    let journal;
    if (zip.has('journal.json')) journal = await json('journal.json');
    else if (zip.has('razmotka.db') && RZ.sqlite) {          // файл прежней версии программы для ПК: только база SQLite
      try { journal = RZ.sqlite.journal(await zip.read('razmotka.db')); }
      catch (e) { throw new ValidationError('Файл проекта повреждён: не читается база razmotka.db.'); }
    } else throw new ValidationError('Файл проекта повреждён: в нём нет журнала.');
    if (!journal || typeof journal.sheets !== 'object') throw new ValidationError('Файл проекта повреждён: не читается журнал.');
    const settings = zip.has('settings.json') ? await json('settings.json') : null;
    const rows = {};
    for (const k of sh.ROWS) rows[k] = Array.isArray(journal.sheets[k]) ? journal.sheets[k].length : 0;
    rows.sps = Array.isArray(journal.sps) ? journal.sps.length : 0;
    const created = String(m.created || ''), when = created.length >= 16 ? `${created.slice(8, 10)}.${created.slice(5, 7)}.${created.slice(0, 4)} ${created.slice(11, 16)}` : '';
    const stem = String(name).replace(/\.[^.]*$/, '');
    return {name, manifest: m, journal, settings, rows, partial: !!m.partial,
      parts: {journal: true, sps: rows.sps > 0, dxf: Array.isArray(journal.dxf) && journal.dxf.length > 0,
        tracks: Array.isArray(journal.tracks) && journal.tracks.length > 0, settings: !!(settings && typeof settings === 'object')},
      label: [String(m.source || '').trim() || stem, when].filter(Boolean).join(' · ').slice(0, 120)};
  }
  const info = s => ({name: s.name, created: s.manifest.created, source: s.manifest.source, party: s.manifest.party, rows: s.rows,
    parts: s.parts, partial: s.partial, tasks: s.manifest.tasks || null, dxf: (s.journal.dxf || []).length, tracks: (s.journal.tracks || []).length});

  /* Настройки из файла, проверенные до любых изменений */
  function new_settings(src, cfg) {
    const next = RZ.config.clone({rules: cfg.rules, crs: cfg.crs}), st = src.settings || {};
    try {
      if (st.rules && typeof st.rules === 'object') for (const [k, kind] of Object.entries(RZ.config.EDITABLE_RULES)) if (k in st.rules) next.rules[k] = kind(st.rules[k]);
      if (st.crs) {
        const zone = parseInt(st.crs.zone, 10);
        if (!RZ.gk.ELLIPSOIDS[st.crs.ellipsoid] || !(zone >= 1 && zone <= 60)) throw new Error('система координат');
        next.crs = {ellipsoid: st.crs.ellipsoid, zone};
      }
      RZ.config.validate({...cfg, ...next});
    } catch (e) { throw new ValidationError(`Файл проекта повреждён: настройки не подходят (${e.message}).`); }
    return next;
  }

  // ---------------------------------------------------------------- объединение журналов
  /* По чему строка узнаётся, если номера не совпали: та же работа, внесённая на двух устройствах */
  function key_of(sheet, v) {
    if (sheet.kind === 'work') {
      let a = v[3], b = v[4];
      if (a !== null && b !== null) [a, b] = [Math.min(a, b), Math.max(a, b)];
      return JSON.stringify([v[0], fold(v[1]), v[2], a, b]);
    }
    return JSON.stringify(v.filter((x, i) => sheet.cols[i].kind !== 'calc'));
  }
  const units = v => (v[3] !== null && v[4] !== null ? Math.abs(v[4] - v[3]) + 1 : 0);
  const plain = (sheet, v) => JSON.stringify(v.filter((x, i) => sheet.cols[i].kind !== 'calc'));

  /* Считает, что изменится в журнале, если принять файлы. Сам ничего не меняет: изменения выполняет run() */
  class Merge {
    constructor(repo) {
      this.P = PEOPLE_LIST(); this.M = MERGED_LIST();
      this.recs = []; this.by_uid = new Map(); this.pool = new Map();
      this.gone = repo.gone_uids(); this.revive = new Set(); this.bad = 0;
      this.stat = {}; for (const n of this.M) this.stat[n] = {tasks: 0, changed: 0, removed: 0, same: 0, differs: 0, added: 0};
      this.people = Object.fromEntries(this.P.map(n => [n, []])); this.names = {};
      for (const name of [...this.P, ...this.M]) {
        const sheet = sh.SHEETS[name];
        for (const [id, pos, v, batch, uid, ts, origin, fmt] of repo.rows_full(name)) {
          const rec = {id, sheet: name, pos, v, batch, uid, ts, origin, fmt, taken: false};
          this.recs.push(rec);
          if (uid) this.by_uid.set(uid, rec);
          if (this.M.includes(name) && !sh.is_blank(sheet, v)) {
            const k = name + '|' + key_of(sheet, v); let a = this.pool.get(k); if (!a) this.pool.set(k, a = []); a.push(rec);
          }
        }
        if (this.P.includes(name)) this.names[name] = new Set(this.recs.filter(r => r.sheet === name && r.v[1]).map(r => fold(r.v[1])));
      }
    }
    _new(name, v, uid, ts, fmt, origin = null) {
      const rec = {id: null, sheet: name, pos: 0, v, batch: null, uid, ts: ts || '', origin, fmt: fmt || null, taken: true};
      this.recs.push(rec);
      if (uid) this.by_uid.set(uid, rec);
      return rec;
    }
    add(journal, label) {
      const rows_of = name => (Array.isArray(journal.sheets[name]) ? journal.sheets[name].filter(r => r && typeof r === 'object') : []);
      for (const name of this.P) {
        const sheet = sh.SHEETS[name];
        for (const r of rows_of(name)) {
          const v = r.v;
          if (!Array.isArray(v) || v.length !== sheet.cols.length || !v[1]) continue;
          const k = fold(v[1]);
          if (this.names[name].has(k)) continue;
          this.names[name].add(k); this.people[name].push(String(v[1]).trim());
          this._new(name, [v[0], v[1], null], this.by_uid.has(r.uid) ? null : r.uid || null, r.ts, null);
        }
      }
      for (const name of this.M) {
        const sheet = sh.SHEETS[name], st = this.stat[name], work = sheet.kind === 'work', rows = [];
        for (const r of rows_of(name)) {
          let v;
          try { v = RZ.svc_sheets.clean(sheet, r.v, 1e9); } catch (e) { this.bad++; continue; }
          if (sh.is_blank(sheet, v)) continue;
          rows.push([v, !!r.done, r.uid || null, String(r.ts || ''), r.fmt || null]);
          if (r.uid && this.by_uid.has(r.uid)) this.by_uid.get(r.uid).taken = true;      // найдена по номеру: по содержимому её уже не ищут
        }
        for (const [v, done, uid, ts, fmt] of rows) {
          let rec = uid ? this.by_uid.get(uid) : null;
          if (!rec) {
            if (uid && this.gone.has(uid) && !(work && done)) { st.same++; continue; }     // здесь строку удалили: черновик обратно не берём
            const same = (this.pool.get(name + '|' + key_of(sheet, v)) || []).find(r => !r.taken);
            if (!same) {
              rec = this._new(name, v, uid, ts, fmt);
              if (uid && this.gone.has(uid)) this.revive.add(uid);
              if (work && done) { rec.origin = label; rec.accepted = true; } else st[work ? 'tasks' : 'added']++;
              continue;
            }
            rec = same; rec.taken = true;
            if (uid) this.by_uid.set(uid, rec);
          }
          if (rec.sheet !== name || rec.delete) continue;
          const differs = plain(sheet, rec.v) !== plain(sheet, v);
          if (!work || (rec.batch === null && !done)) {       // обе стороны - черновик: берётся более поздняя правка
            if (differs && ts > (rec.ts || '') && !rec.accepted) { rec.v = v; rec.ts = ts; rec.dirty = true; st.changed++; } else st.same++;
          } else if (rec.batch !== null) {                    // здесь строка уже проведена: её не трогаем
            st[done && key_of(sheet, rec.v) !== key_of(sheet, v) ? 'differs' : 'same']++;
          } else if (rec.accepted || (rec.origin && !differs)) st.same++;        // уже принята раньше и ждёт кнопки
          else { rec.v = v; rec.origin = label; rec.accepted = true; rec.dirty = true; }   // там работа выполнена, здесь - задание: принимаем факт
        }
      }
      for (const uid of journal.gone || []) {                 // там строку удалили: наш нетронутый черновик тоже снимается
        const rec = this.by_uid.get(uid);
        if (rec && rec.id !== null && rec.batch === null && !rec.origin && this.M.includes(rec.sheet) && !rec.dirty && !rec.delete) {
          rec.delete = true; this.stat[rec.sheet].removed++;
        }
      }
    }
    report() {
      const work = [], other = [];
      for (const name of this.M) {
        const sheet = sh.SHEETS[name], st = this.stat[name];
        if (sheet.kind !== 'work') { other.push({sheet: name, title: sheet.title, added: st.added, changed: st.changed}); continue; }
        const who = new Map();
        for (const rec of this.recs) if (rec.sheet === name && rec.accepted) {
          const k = String(rec.v[1] || '—'); let w = who.get(k); if (!w) who.set(k, w = [0, 0]);
          w[0]++; w[1] += units(rec.v);
        }
        const people = [...who].map(([n, [rows, u]]) => ({name: n, rows, units: u})).sort((a, b) => b.units - a.units);
        work.push({sheet: name, title: sheet.title, unit: sheet.unit, who: people, rows: people.reduce((s, p) => s + p.rows, 0),
          units: people.reduce((s, p) => s + p.units, 0), tasks: st.tasks, changed: st.changed, removed: st.removed, same: st.same, differs: st.differs});
      }
      return {work, other, bad: this.bad, people: this.P.filter(n => this.people[n].length).map(n => ({sheet: n, title: sh.SHEETS[n].title, added: this.people[n]}))};
    }
    run(repo) {
      const last = new Map();
      for (const rec of this.recs) {
        const name = rec.sheet;
        if (rec.delete) repo.delete_rows(name, [rec.id], false);
        else if (rec.id === null) {
          const pos = (last.has(name) ? last.get(name) : repo.max_pos(name)) + 1;
          last.set(name, pos);
          rec.id = repo.insert_row(name, pos, rec.v, null, rec.uid, rec.origin, rec.fmt, rec.ts || null);
        } else if (rec.dirty) repo.update_row(name, rec.id, rec.pos, rec.v, rec.origin || null, rec.ts || null);
      }
      repo.forget_gone(this.revive);
    }
  }

  /* Слои и треки объединяются по постоянному номеру (и по названию слоя) */
  function merge_list(have, incoming, by_name) {
    const uids = new Set(have.map(x => x.uid)), names = new Set(have.map(x => fold(x.name))), fresh = [];
    for (const x of incoming || []) {
      if (!x || typeof x !== 'object' || uids.has(x.uid) || (by_name && names.has(fold(x.name)))) continue;
      uids.add(x.uid); names.add(fold(x.name)); fresh.push(x);
    }
    return fresh;
  }
  const clean_dxf = l => ({uid: String(l.uid || RZ.new_uid()), name: String(l.name || 'Слой').slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(l.color || '') ? l.color : '#34C759',
    visible: l.visible !== false, labels: l.labels !== false,
    items: (Array.isArray(l.items) ? l.items : []).filter(i => i && Array.isArray(i.pts)).map(i => ({name: String(i.name || '').slice(0, 120), kind: String(i.kind || 'line'), pts: i.pts.map(Number)}))});
  const clean_track = t => ({uid: String(t.uid || RZ.new_uid()), name: String(t.name || 'Трек').slice(0, 80), ts: String(t.ts || ''), show: false,
    pts: (Array.isArray(t.pts) ? t.pts : []).map(Number)});

  function merge_all(db, repo, sources, want, run) {
    const merge = new Merge(repo);
    let dxf = (db.get('dxf', []) || []).slice(), tracks = (db.get('tracks', []) || []).slice(), nd = 0, ni = 0, nt = 0;
    for (const s of sources) {
      merge.add(s.journal, s.label);
      if (want.has('dxf') && s.parts.dxf) { const f = merge_list(dxf, s.journal.dxf, true).map(clean_dxf); nd += f.length; ni += f.reduce((n, l) => n + l.items.length, 0); dxf = dxf.concat(f); }
      if (want.has('tracks') && s.parts.tracks) { const f = merge_list(tracks, s.journal.tracks, false).map(clean_track); nt += f.length; tracks = tracks.concat(f); }
    }
    if (run && want.has('journal')) merge.run(repo);
    const out = merge.report();
    out.marks = 0; out.dxf = {layers: nd, items: ni}; out.tracks = nt;
    return {out, dxf, tracks};
  }

  // ---------------------------------------------------------------- проверка и загрузка
  /* Первый шаг: файлы проверяются, проект не меняется. files: [[имя, байты]] */
  async function inspect(db, cfg, files) {
    if (!files.length) throw new ValidationError('Выберите файл проекта (.rzm).');
    if (files.length > 60) throw new ValidationError('Слишком много файлов за один раз: не больше 60.');
    const sources = [];
    for (const [name, bytes] of files) {
      try { sources.push(await open(bytes, String(name).split(/[\\/]/).pop().slice(0, 120))); }
      catch (e) { if (e instanceof ValidationError && files.length > 1) throw new ValidationError(`«${name}»: ${e.message}`); throw e; }
    }
    const first = sources[0], single = sources.length === 1 && !first.partial;
    RZ.sh.register_custom(custom_union(db.get('custom', []), sources));        // свои листы из файлов - чтобы увидеть их строки
    const {here, changes} = db.read(repo => {
      const here = {}; for (const k of sh.ROWS) here[k] = repo.sheet_rows(k).length;
      here.sps = repo.sps_count();
      return {here, changes: merge_all(db, repo, sources, new Set(PARTS), false).out};
    });
    const parts = {journal: {on: true},
      dxf: {on: sources.some(s => s.parts.dxf), file: sources.reduce((n, s) => n + (s.journal.dxf || []).length, 0), here: (db.get('dxf', []) || []).length, new: changes.dxf.layers},
      tracks: {on: sources.some(s => s.parts.tracks), file: sources.reduce((n, s) => n + (s.journal.tracks || []).length, 0), here: (db.get('tracks', []) || []).length, new: changes.tracks}};
    if (single) {
      let differs = false;
      if (first.parts.settings) { const n = new_settings(first, cfg); differs = JSON.stringify(n.rules) !== JSON.stringify(cfg.rules) || JSON.stringify(n.crs) !== JSON.stringify(cfg.crs); }
      parts.sps = {on: first.parts.sps, file: first.rows.sps, here: here.sps};
      parts.settings = {on: first.parts.settings, differs};
    }
    const token = RZ.new_uid();
    pending.clear();                         // ждёт решения только последняя проверка
    pending.set(token, sources);
    return {token, single, files: sources.map(info), parts, changes, here: {rows: here, empty: sh.WORK.reduce((n, k) => n + here[k], 0) === 0}};
  }

  function discard(token, db) { pending.delete(token); if (db) RZ.sh.register_custom(db.get('custom', [])); return {ok: true}; }
  /* Свои листы: здешние и из файлов, без повторов (по номеру листа) */
  function custom_union(local, sources) {
    const out = (Array.isArray(local) ? local : []).map(d => ({...d})), ids = new Set(out.map(d => d.id));
    for (const s of sources) for (const d of Array.isArray(s.journal.custom) ? s.journal.custom : []) if (d && RZ.sh.custom_id(d.id) && !ids.has(d.id)) { ids.add(d.id); out.push({...d}); }
    return out;
  }

  /* Заменяет журнал содержимым файла: выполненные строки получают след в учёте, как после кнопки */
  function replace_journal(repo, cfg, journal) {
    for (const name of sh.ROWS) repo.clear_sheet(name);
    repo.clear_events(); repo.clear_staked(); repo.clear_batches();
    repo._w('gone'); repo.p.gone = (journal.gone || []).map(String); repo.tx.dirty.add('gone');
    const done = new Map();
    for (const name of sh.ROWS) {
      const sheet = sh.SHEETS[name];
      (Array.isArray(journal.sheets[name]) ? journal.sheets[name] : []).forEach((r, k) => {
        let v;
        try { v = RZ.svc_sheets.clean(sheet, r && r.v, 1e9); } catch (e) { return; }
        const id = repo.insert_row(name, Number(r.pos) || k + 1, v, null, r.uid || null, r.origin || null, r.fmt || null, r.ts || null);
        if (r.done && sheet.kind === 'work') { if (!done.has(name)) done.set(name, []); done.get(name).push([k + 1, id, v]); }
      });
    }
    for (const [name, rows] of done) {
      const sheet = sh.SHEETS[name], lookup = RZ.svc_sheets.lookup_of(repo, sheet.lookup);
      const batch = repo.new_batch(RZ.svc_sheets.now_iso(), name, 'import'), ok = [];
      rows.forEach((row, k) => {
        let got;
        try { got = RZ.validation.work_intervals([row], lookup, null, cfg.rules, sheet.wtype, sheet); } catch (e) { return; }   // строка с ошибкой остаётся черновиком
        if (!got.length) return;
        const [id, iv] = got[0];
        if (sheet.wtype === 2) repo.insert_staked(id, iv.line, iv.p1, iv.p2, iv.date, iv.wid, iv.worker, name);
        else repo.insert_events(id, iv.line, iv.p1, iv.p2, iv.date, iv.type, iv.wid, iv.worker, batch * 1000000 + k);
        ok.push(id);
      });
      repo.set_done(ok, batch);
    }
  }

  /* Второй шаг: проект меняется так, как отметил пользователь */
  function apply(db, cfg, token, mode = 'merge', parts = null) {
    const sources = pending.get(token);
    if (!sources) throw new ValidationError('Файл проекта нужно выбрать заново.');
    const first = sources[0], single = sources.length === 1;
    if (mode !== 'merge' && mode !== 'replace') throw new ValidationError('Неизвестный способ загрузки.');
    if (mode === 'replace' && !single) throw new ValidationError('Заменить проект можно только одним файлом. Несколько файлов принимаются как изменения.');
    if (mode === 'replace' && first.partial) throw new ValidationError('В файле только задания, а не весь проект: его можно только принять как изменения.');
    let want = new Set((parts || PARTS).filter(p => PARTS.includes(p)));
    const one_file = new Set(['sps', 'settings']);
    want = new Set([...want].filter(p => (one_file.has(p) ? single && first.parts[p] : sources.some(s => s.parts[p]))));
    if (mode === 'replace') want.add('journal');
    if (!want.size) throw new ValidationError('Отметьте, что загрузить из файла.');
    const next = want.has('settings') ? new_settings(first, cfg) : null;
    const same_day = (next || cfg).rules.same_day;
    const custom = mode === 'replace' ? custom_union([], [first]) : custom_union(db.get('custom', []), sources);
    RZ.sh.register_custom(custom);
    let changes = null, dxf = null, tracks = null;
    const counts = db.write(repo => {
      if (mode === 'replace') {
        replace_journal(repo, next ? {...cfg, rules: next.rules} : cfg, first.journal);
        if (want.has('dxf')) dxf = (first.journal.dxf || []).map(clean_dxf);
        if (want.has('tracks')) tracks = (db.get('tracks', []) || []).concat(merge_list(db.get('tracks', []) || [], first.journal.tracks, false).map(clean_track));
      } else {
        const m = merge_all(db, repo, sources, want, true);
        changes = m.out;
        if (want.has('dxf')) dxf = m.dxf;
        if (want.has('tracks')) tracks = m.tracks;
      }
      if (want.has('sps')) repo.replace_sps(first.journal.sps.filter(Array.isArray).map(r => [...r, null, null, null, null, null].slice(0, 5)));
      repo.rebuild_state(same_day);
      const c = {}; for (const k of sh.ROWS) c[k] = repo.sheet_rows(k).length;
      c.sps = repo.sps_count();
      return c;
    });
    db.coords = null;
    if (next) { cfg.rules = next.rules; cfg.crs = next.crs; db.set('config', cfg); }
    db.set('custom', custom);
    if (dxf) db.set('dxf', dxf);
    if (tracks) db.set('tracks', tracks);
    pending.delete(token);
    return {ok: true, mode, parts: [...want].sort(), created: first.manifest.created, party: first.manifest.party, rows: counts,
      marks: 0, dxf: (db.get('dxf', []) || []).length, tracks: (db.get('tracks', []) || []).length, underlays: null, changes, files: sources.length, backup: null};
  }

  RZ.project = {PARTS, export_project, inspect, apply, discard, open};
})(globalThis.RZ);
