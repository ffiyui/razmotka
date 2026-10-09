/* Хранилище: данные в памяти + сохранение в IndexedDB. Порт app/storage/{db,repository}.py.
   Всё состояние живёт в памяти (телефону хватает), на диск пишутся только изменившиеся части.
   Операции записи идут по одной и целиком: если внутри выбросили исключение, состояние откатывается. */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';

  // ---------------------------------------------------------------- носители (IndexedDB и память для тестов)
  /* Память: тот же интерфейс, что у IndexedDB. Нужна в тестах Node и при запрете хранилища */
  function kv_memory() {
    const data = new Map(), blobs = new Map();
    return {
      kind: 'memory',
      async load() { return new Map(data); },
      async put(entries, deletes = []) { for (const [k, v] of entries) data.set(k, structuredClone(v)); for (const k of deletes) data.delete(k); },
      async put_blob(key, blob) { blobs.set(key, blob); },
      async get_blob(key) { return blobs.get(key) || null; },
      async del_blob(key) { blobs.delete(key); },
      async wipe() { data.clear(); blobs.clear(); },
    };
  }

  /* IndexedDB: хранилище «kv» (части данных) и «blobs» (картинки подложек, вне основной загрузки) */
  function kv_idb(name = 'razmotka') {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Хранилище занято другой вкладкой.'));
    });
    let dbp = null;
    const db = () => dbp || (dbp = open());
    const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return {
      kind: 'idb',
      async load() {
        const d = await db(), tx = d.transaction('kv', 'readonly'), st = tx.objectStore('kv');
        const keys = await req(st.getAllKeys()), vals = await req(st.getAll());
        return new Map(keys.map((k, i) => [k, vals[i]]));
      },
      async put(entries, deletes = []) {
        const d = await db(), tx = d.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
        for (const [k, v] of entries) st.put(v, k);
        for (const k of deletes) st.delete(k);
        await done(tx);
      },
      async put_blob(key, blob) { const d = await db(), tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, key); await done(tx); },
      async get_blob(key) { const d = await db(); return (await req(d.transaction('blobs').objectStore('blobs').get(key))) || null; },
      async del_blob(key) { const d = await db(), tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').delete(key); await done(tx); },
      async wipe() { const d = await db(), tx = d.transaction(['kv', 'blobs'], 'readwrite'); tx.objectStore('kv').clear(); tx.objectStore('blobs').clear(); await done(tx); },
    };
  }
  RZ.kv_memory = kv_memory;
  RZ.kv_idb = kv_idb;

  // ---------------------------------------------------------------- репозиторий
  const ROW_SHEETS = RZ.sh.ROWS;            // живой список: свои листы пользователя добавляются в него (sheets-core.js, register_custom)
  /* Постоянный номер строки: по нему проекты объединяются (тот же смысл, что uid в настольной версии) */
  const new_uid = () => { let s = ''; for (let i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; };
  const now_utc = () => new Date().toISOString().slice(0, 19);
  RZ.new_uid = new_uid; RZ.now_utc = now_utc;
  const K = 1e6;                         // ключ пикета = линия * K + пикет
  const nul = v => (v === undefined ? null : v);
  const byPosId = (a, b) => a.pos - b.pos || a.id - b.id;

  /* Сжатый вид листа SPS для диска: строк сотни тысяч, объекты в IndexedDB были бы тяжёлыми */
  function pack_sps(rows) {
    const n = rows.length, id = new Int32Array(n), pos = new Float64Array(n), line = new Int32Array(n), picket = new Int32Array(n);
    const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
    rows.forEach((r, i) => {
      const v = r.v;
      id[i] = r.id; pos[i] = r.pos; line[i] = v[0] === null ? -1 : v[0]; picket[i] = v[1] === null ? -1 : v[1];
      x[i] = v[2] === null ? NaN : v[2]; y[i] = v[3] === null ? NaN : v[3]; z[i] = v[4] === null ? NaN : v[4];
    });
    return {n, id, pos, line, picket, x, y, z};
  }
  function unpack_sps(p) {
    const out = new Array(p.n), f = a => (Number.isNaN(a) ? null : a), g = a => (a < 0 ? null : a);
    for (let i = 0; i < p.n; i++) out[i] = {id: p.id[i], pos: p.pos[i], v: [g(p.line[i]), g(p.picket[i]), f(p.x[i]), f(p.y[i]), f(p.z[i])], batch: null, fmt: null};
    return out;
  }

  class Repository {
    constructor(db, tx) { this.db = db; this.tx = tx; this.p = db.parts; }

    // ---- части состояния с откатом: первая запись в транзакции делает копию --------------------
    _w(name) {
      if (!this.tx) throw new Error('Запись вне транзакции.');
      if (!this.tx.saved.has(name)) {
        if (this.p[name] === undefined && name.startsWith('rows:')) this.p[name] = [];     // свой лист, в котором ещё нет строк
        const cur = this.p[name];
        this.tx.saved.set(name, cur);
        this.p[name] = cur instanceof Map ? new Map(cur) : Array.isArray(cur) ? cur.slice() : {...cur};
        this.db._drop_caches(name);
      }
      return this.p[name];
    }
    _meta() { this._w('meta'); return this.p.meta; }

    // ---- правило "последнего события" ------------------------------------------------------------
    // Ключ сравнения события: [дата, число]. Совпадает с core.rules.last_event_key() и SQL-выражением Python-версии
    static key_of(same_day, run) {
      if (same_day === 'razm_last') return run.type;
      if (same_day === 'podm_last') return 1 - run.type;
      if (same_day === 'entry_order') return run.seq * 2 + run.type;
      throw new Error(same_day);
    }
    static key_text(same_day, run) { return RZ.rules.last_event_key(run.date, run.type, run.seq, same_day); }

    // ---- строки листов -------------------------------------------------------------------------
    _rows(sheet) { if (sheet !== 'sps' && !this.p['rows:' + sheet] && RZ.sh.SHEETS[sheet]) this.p['rows:' + sheet] = []; return sheet === 'sps' ? this.p.sps : this.p['rows:' + sheet]; }
    _sorted(sheet) {
      const a = this._rows(sheet);
      if (!a) throw new Error('Неизвестный лист: ' + sheet);
      if (!this.db.sorted.get(sheet)) {
        let ok = true;
        for (let i = 1; i < a.length && ok; i++) if (byPosId(a[i - 1], a[i]) > 0) ok = false;
        if (!ok) a.sort(byPosId);
        this.db.sorted.set(sheet, true);
      }
      return a;
    }
    /* [[id, pos, values, batch]] по порядку на листе */
    sheet_rows(sheet) { return this._sorted(sheet).map(r => [r.id, r.pos, r.v, r.batch]); }
    _index(sheet) {
      let m = this.db.index.get(sheet);
      if (!m) { m = new Map(); for (const r of this._rows(sheet)) m.set(r.id, r); this.db.index.set(sheet, m); }
      return m;
    }
    /* Map id -> [pos, values, batch] */
    get_rows(sheet, ids) {
      const out = new Map(), idx = this._index(sheet);
      for (const id of ids) { const r = idx.get(id); if (r) out.set(id, [r.pos, r.v, r.batch]); }
      return out;
    }
    insert_row(sheet, pos, values, batch = null, uid = null, origin = null, fmt = null, ts = null) {
      const meta = this._meta(), arr = this._w(sheet === 'sps' ? 'sps' : 'rows:' + sheet);
      const id = sheet === 'sps' ? ++meta.next_sps : ++meta.next_row;
      const row = {id, pos, v: values.slice(), batch: sheet === 'sps' ? null : nul(batch), fmt: fmt || null};
      if (sheet !== 'sps') { row.uid = uid || new_uid(); row.ts = ts || now_utc(); row.origin = origin || null; }
      const last = arr[arr.length - 1];
      if (last && byPosId(last, row) > 0) this.db.sorted.set(sheet, false);
      arr.push(row);
      if (sheet === 'sps') this.db.drop_sps_index();
      this.db.index.delete(sheet);
      this.tx.dirty.add(sheet);
      return id;
    }
    /* origin: undefined - не трогать, иначе новое значение (откуда строка принята) */
    update_row(sheet, row_id, pos, values, origin = undefined, ts = null) {
      const arr = this._w(sheet === 'sps' ? 'sps' : 'rows:' + sheet);
      const i = arr.findIndex(r => r.id === row_id);
      if (i < 0) return;
      arr[i] = {...arr[i], pos, v: values.slice()};
      if (sheet !== 'sps') { arr[i].ts = ts || now_utc(); if (origin !== undefined) arr[i].origin = origin; }
      if (sheet === 'sps') this.db.drop_sps_index();
      this.db.sorted.set(sheet, false);
      this.db.index.delete(sheet);
      this.tx.dirty.add(sheet);
    }
    /* Оформление ячеек листа: {id строки: {номер столбца: {b, i, u, l, c, g}}}. У SPS оформления нет */
    sheet_formats(sheet) {
      const out = {};
      if (sheet === 'sps') return out;
      for (const r of this._rows(sheet)) if (r.fmt) out[r.id] = r.fmt;
      return out;
    }
    set_format(sheet, row_id, fmt) {
      if (sheet === 'sps') return;
      const arr = this._w('rows:' + sheet), i = arr.findIndex(r => r.id === row_id);
      if (i < 0) return;
      arr[i] = {...arr[i], fmt: fmt || null};
      this.db.index.delete(sheet);
      this.tx.dirty.add(sheet);
    }
    /* Строки со служебными полями: [[id, pos, значения, batch, uid, ts, origin, fmt]] */
    rows_full(sheet) { return this._sorted(sheet).map(r => [r.id, r.pos, r.v, r.batch, r.uid, r.ts || '', r.origin || null, r.fmt]); }
    origins(sheet) { const out = new Map(); for (const r of this._rows(sheet)) if (r.origin) out.set(r.id, r.origin); return out; }
    max_pos(sheet) { let m = 0; for (const r of this._rows(sheet)) if (r.pos > m) m = r.pos; return m; }
    gone_uids() { return new Set(this.p.gone); }
    forget_gone(uids) { const s = new Set(uids); if (!s.size) return; this._w('gone'); this.p.gone = this.p.gone.filter(u => !s.has(u)); this.tx.dirty.add('gone'); }
    add_gone(uids) { const g = this._w('gone'); for (const u of uids) if (u && !g.includes(u)) g.push(u); this.tx.dirty.add('gone'); }
    delete_rows(sheet, ids, remember = true) {
      const name = sheet === 'sps' ? 'sps' : 'rows:' + sheet, gone = new Set(ids);
      if (remember && sheet !== 'sps') this.add_gone(this.p[name].filter(r => gone.has(r.id) && r.uid).map(r => r.uid));   // удалённая строка при объединении не вернётся
      this._w(name);
      this.p[name] = this.p[name].filter(r => !gone.has(r.id));
      this.db.index.delete(sheet);
      this.tx.dirty.add(sheet);
      if (sheet === 'sps') this.db.drop_sps_index();
    }
    clear_sheet(sheet) {
      const name = sheet === 'sps' ? 'sps' : 'rows:' + sheet;
      this._w(name);
      this.p[name] = [];
      this.db.index.delete(sheet);
      this.tx.dirty.add(sheet);
      if (sheet === 'sps') this.db.drop_sps_index();
    }
    set_done(ids, batch) {
      const set = new Set(ids);
      for (const sheet of ROW_SHEETS) {
        const arr = this.p['rows:' + sheet];
        if (!arr || !arr.some(r => set.has(r.id))) continue;
        const w = this._w('rows:' + sheet);
        for (let i = 0; i < w.length; i++) if (set.has(w[i].id)) w[i] = {...w[i], batch: nul(batch)};
        this.db.index.delete(sheet);
        this.tx.dirty.add(sheet);
      }
    }
    done_ids(sheet, ids) {
      const set = new Set(ids);
      return this._rows(sheet).filter(r => r.batch !== null && set.has(r.id)).map(r => r.id);
    }

    // ---- действия (проведения) -------------------------------------------------------------------
    new_batch(ts, sheet, kind) {
      const meta = this._meta(), id = ++meta.next_batch;
      this._w('batches').push({id, ts, sheet, kind, rows: 0, channels: 0, undone: 0});
      this.tx.dirty.add('batches');
      return id;
    }
    _batch_set(id, change) {
      const arr = this._w('batches'), i = arr.findIndex(b => b.id === id);
      if (i >= 0) arr[i] = {...arr[i], ...change};
      this.tx.dirty.add('batches');
    }
    finish_batch(batch, rows, channels) { this._batch_set(batch, {rows, channels}); }
    mark_undone(batch) { this._batch_set(batch, {undone: 1}); }
    /* Последнее действие этого листа, которое ещё можно отменить: [id, время, строк, каналов] */
    last_action(sheet) {
      const batches = this.p.batches;
      for (let i = batches.length - 1; i >= 0; i--) {
        const b = batches[i];
        if (b.sheet !== sheet || b.kind !== 'apply' || b.undone) continue;
        const n = this.batch_row_ids(b.id).length;
        if (n) return [b.id, b.ts, n, b.channels];
      }
      return null;
    }
    batch_row_ids(batch) {
      const out = [];
      for (const sheet of ROW_SHEETS) for (const r of this.p['rows:' + sheet] || []) if (r.batch === batch) out.push(r.id);
      return out;
    }
    clear_batches() { this._w('batches'); this.p.batches = []; this.tx.dirty.add('batches'); }

    // ---- события по пикетам: хранятся интервалами (по одному на строку журнала) ------------------
    insert_events(src, line, p1, p2, date, wtype, wid, worker, seq) {
      this._w('events').set(src, {src, line, p1, p2, date, type: wtype, wid, worker, seq});
      this.tx.dirty.add('events');
    }
    delete_events(src_ids) {
      const ev = this._w('events');
      for (const s of src_ids) ev.delete(s);
      this.tx.dirty.add('events');
    }
    clear_events() { this._w('events'); this.p.events = new Map(); this.tx.dirty.add('events'); }

    // ---- разбивка: интервалами, по одному на строку листа «Разбивка» ---------------------------
    /* sheet - лист, строка которого провела пикеты: «Разбивка» (razb) или свой лист работ */
    insert_staked(src, line, p1, p2, date, wid, worker, sheet = 'razb') { this._w('staked').set(src, sheet === 'razb' ? {src, line, p1, p2, date, wid, worker} : {src, line, p1, p2, date, wid, worker, sheet}); this.tx.dirty.add('staked'); }
    delete_staked(src_ids) { const st = this._w('staked'); for (const s of src_ids) st.delete(s); this.tx.dirty.add('staked'); }
    clear_staked() { this._w('staked'); this.p.staked = new Map(); this.tx.dirty.add('staked'); }
    /* Map ключ пикета -> [линия, пикет, дата последней разбивки, топограф] */
    _staked(sheet = 'razb') {
      const m = new Map();
      for (const r of this.p.staked.values()) if ((r.sheet || 'razb') === sheet) for (let p = r.p1; p <= r.p2; p++) {
        const k = r.line * K + p, was = m.get(k);
        if (!was || was[2] < r.date) m.set(k, [r.line, p, r.date, r.worker]);
      }
      return m;
    }
    staked_known(line, p1, p2, sheet = 'razb') { const m = this._staked(sheet); let n = 0; for (let p = p1; p <= p2; p++) if (m.has(line * K + p)) n++; return n; }
    staked_points(sheet = 'razb') { return [...this._staked(sheet).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]); }
    staked_total(sheet = 'razb') { return this._staked(sheet).size; }
    staked_stats(d1, d2, sheet = 'razb') {
      const m = new Map();
      for (const r of this.p.staked.values()) if ((r.sheet || 'razb') === sheet && r.date >= d1 && r.date <= d2) m.set(r.worker, (m.get(r.worker) || 0) + r.p2 - r.p1 + 1);
      return [...m].sort((a, b) => b[1] - a[1]);
    }

    // ---- координаты пикетов (лист SPS) -----------------------------------------------------------
    sps_count() { let n = 0; for (const r of this.p.sps) if (r.v[0] !== null && r.v[1] !== null) n++; return n; }
    /* Сколько пикетов интервала есть в SPS */
    sps_known(line, p1, p2) {
      const idx = this.db.sps_index(this.p.sps), m = idx.get(line);
      if (!m) return 0;
      let n = 0;
      for (let p = p1; p <= p2; p++) if (m.has(p)) n++;
      return n;
    }
    /* [линия, пикет, x, y] всех пикетов с координатами, в порядке листа */
    sps_points() {
      const out = [];
      for (const r of this._sorted('sps')) { const v = r.v; if (v[0] !== null && v[1] !== null && v[2] !== null && v[3] !== null) out.push([v[0], v[1], v[2], v[3]]); }
      return out;
    }
    /* rows: [[линия, пикет, x, y, z]] */
    replace_sps(rows) {
      this._w('sps');
      const meta = this._meta();
      this.p.sps = rows.map((r, n) => ({id: ++meta.next_sps, pos: n + 1, v: r.slice(0, 5), batch: null, fmt: null}));
      this.db.sorted.set('sps', true);
      this.db.index.delete('sps');
      this.tx.dirty.add('sps');
      this.db.drop_sps_index();
    }

    // ---- состояние поля --------------------------------------------------------------------------
    field_pickets(line) { return new Set(this.db.field_index(this.p.field).get(line) || []); }
    field_rows() { return this.p.field; }

    /* Раскладывает события по пикетам. Возвращает {keys, start, order, runs}: пикеты по возрастанию (линия, пикет),
       у каждого события в порядке src (как их видит SQLite при группировке) */
    _groups() {
      const runs = [...this.p.events.values()].sort((a, b) => a.src - b.src);
      const gid = new Map(), count = [];
      for (const r of runs) {
        const base = r.line * K;
        for (let p = r.p1; p <= r.p2; p++) {
          const k = base + p; let g = gid.get(k);
          if (g === undefined) { g = count.length; gid.set(k, g); count.push(0); }
          count[g]++;
        }
      }
      const start = new Int32Array(count.length + 1);
      for (let g = 0; g < count.length; g++) start[g + 1] = start[g] + count[g];
      const fill = start.slice(0, count.length), order = new Int32Array(start[count.length]);
      runs.forEach((r, ri) => {
        const base = r.line * K;
        for (let p = r.p1; p <= r.p2; p++) order[fill[gid.get(base + p)]++] = ri;
      });
      const keys = Float64Array.from(gid.keys()).sort();
      return {keys, gid, start, order, runs};
    }

    /* Пересчитывает всё производное от истории: что лежит на поле и где история противоречит сама себе.
       На поле лежат пикеты, у которых последнее событие - размотка. Противоречие - событие того же типа, что и
       предыдущее на этом пикете: повторная размотка или подмотка того, что не числилось на поле. */
    rebuild_state(same_day) {
      const {keys, gid, start, order, runs} = this._groups();
      const field = [], anomalies = [];
      const kd = runs.map(r => r.date), kn = runs.map(r => Repository.key_of(same_day, r));
      const less = (a, b) => (kd[a] < kd[b] || (kd[a] === kd[b] && kn[a] < kn[b]));          // ключ a меньше ключа b
      for (const key of keys) {
        const g = gid.get(key), s = start[g], e = start[g + 1];
        const line = Math.floor(key / K), picket = key - line * K;
        // последнее событие: максимум ключа, при равенстве - с меньшим src (первое встреченное)
        let best = order[s];
        for (let i = s + 1; i < e; i++) if (less(best, order[i])) best = order[i];
        const br = runs[best];
        if (br.type === 1) field.push([line, picket, br.date, br.worker, br.wid]);
        // противоречия: события по порядку (ключ, затем seq)
        if (e - s === 1) { if (br.type === 0) anomalies.push([line, picket, br.date, 'podm', br.src]); continue; }
        const list = Array.from(order.subarray(s, e));
        list.sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : runs[a].seq - runs[b].seq));
        let prev = null;
        for (const ri of list) {
          const r = runs[ri];
          if ((r.type === 1 && prev === 1) || (r.type === 0 && (prev === null || prev === 0)))
            anomalies.push([line, picket, r.date, r.type === 1 ? 'razm' : 'podm', r.src]);
          prev = r.type;
        }
      }
      this._w('field'); this.p.field = field;
      this._w('anomalies'); this.p.anomalies = anomalies;
      this.db._drop_caches('field');
    }

    /* [[линия, пикет, ключ, старший, тип]] последнего события каждого пикета */
    last_events(same_day) {
      return this._last(same_day).map(([line, picket, r]) => [line, picket, Repository.key_text(same_day, r), r.worker, r.type]);
    }
    /* Последнее событие каждого пикета: [линия, пикет, дата, тип, старший, id строки журнала] */
    last_events_full(same_day) {
      return this._last(same_day).map(([line, picket, r]) => [line, picket, r.date, r.type, r.worker, r.src]);
    }
    _last(same_day) {
      const {keys, gid, start, order, runs} = this._groups();
      const kd = runs.map(r => r.date), kn = runs.map(r => Repository.key_of(same_day, r)), out = [];
      for (const key of keys) {
        const g = gid.get(key), s = start[g], e = start[g + 1];
        let best = order[s];
        for (let i = s + 1; i < e; i++) { const c = order[i]; if (kd[best] < kd[c] || (kd[best] === kd[c] && kn[best] < kn[c])) best = c; }
        const line = Math.floor(key / K);
        out.push([line, key - line * K, runs[best]]);
      }
      return out;
    }

    // ---- отчёты ----------------------------------------------------------------------------------
    totals() {
      let razm = 0, podm = 0, dmin = null, dmax = null;
      for (const r of this.p.events.values()) {
        const n = r.p2 - r.p1 + 1;
        if (r.type === 1) razm += n; else podm += n;
        if (dmin === null || r.date < dmin) dmin = r.date;
        if (dmax === null || r.date > dmax) dmax = r.date;
      }
      const lines = new Set();
      for (const f of this.p.field) lines.add(f[0]);
      for (const r of this.p.staked.values()) {
        if (dmin === null || r.date < dmin) dmin = r.date;
        if (dmax === null || r.date > dmax) dmax = r.date;
      }
      return {razm, podm, date_min: dmin, date_max: dmax, field: this.p.field.length, field_lines: lines.size, staked: this.staked_total()};
    }
    /* [[линия, пикет, дата, вид, src]] по виду, линии, src, дате, пикету */
    anomalies() {
      return this.p.anomalies.slice().sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0) || a[0] - b[0] || a[4] - b[4]
        || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0) || a[1] - b[1]);
    }
    anomaly_counts() {
      const out = {razm: 0, podm: 0};
      for (const a of this.p.anomalies) out[a[3]]++;
      return out;
    }
    /* [[тип, линия, пикет]] без повторов */
    period_points(d1, d2) {
      const seen = new Set(), out = [];
      for (const r of this.p.events.values()) {
        if (r.date < d1 || r.date > d2) continue;
        for (let p = r.p1; p <= r.p2; p++) {
          const k = (r.line * K + p) * 2 + r.type;
          if (!seen.has(k)) { seen.add(k); out.push([r.type, r.line, p]); }
        }
      }
      return out;
    }
    stats(d1, d2) {
      const days = new Map(), workers = new Map(), lines = new Map();
      for (const r of this.p.events.values()) {
        if (r.date < d1 || r.date > d2) continue;
        const n = r.p2 - r.p1 + 1, a = r.type === 1 ? n : 0, b = r.type === 1 ? 0 : n;
        for (const [m, k] of [[days, r.date], [workers, r.worker], [lines, r.line]]) {
          const v = m.get(k);
          if (v) { v[0] += a; v[1] += b; } else m.set(k, [a, b]);
        }
      }
      const rows = m => [...m].map(([k, [a, b]]) => [k, a, b]);
      const bin = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
      // как SQLite: сортировка по числу событий по убыванию, равные идут в обратном порядке имён
      return {
        staked: this.staked_stats(d1, d2),
        days: rows(days).sort((x, y) => bin(x[0], y[0])),
        workers: rows(workers).sort((x, y) => (y[1] + y[2]) - (x[1] + x[2]) || bin(y[0], x[0])),
        lines: rows(lines).sort((x, y) => x[0] - y[0]),
      };
    }
    /* Лидеры за период по каждому листу работ: {лист: [[исполнитель, объём], ...]} по убыванию объёма.
       Размотка и подмотка - по проведённым каналам, разбивка и свои листы - по проведённым пикетам */
    leaders(d1, d2) {
      const m = {};
      const add = (sheet, who, n) => { const w = m[sheet] || (m[sheet] = new Map()); w.set(who, (w.get(who) || 0) + n); };
      for (const r of this.p.events.values()) if (r.date >= d1 && r.date <= d2) add(r.type === 1 ? 'razm' : 'podm', r.worker, r.p2 - r.p1 + 1);
      for (const r of this.p.staked.values()) if (r.date >= d1 && r.date <= d2) add(r.sheet || 'razb', r.worker, r.p2 - r.p1 + 1);
      const out = {};
      for (const [k, w] of Object.entries(m)) out[k] = [...w].filter(([who]) => who).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      return out;
    }
    /* [заголовок, строки] истории по пикетам: по типу, дате, старшему, линии, пикету */
    export_history() {
      const head = ['Дата', 'Линия', 'Пикет', 'ID старшего', 'ФИО старшего', 'Тип работ'];
      const rows = [];
      for (const r of this.p.events.values()) for (let p = r.p1; p <= r.p2; p++) rows.push([r.date, r.line, p, r.wid, r.worker, r.type === 1 ? 'Размотка' : 'Подмотка']);
      // общий порядок по (тип, дата, старший, линия, пикет)
      rows.sort((a, b) => (a[5] < b[5] ? -1 : a[5] > b[5] ? 1 : 0) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
        || (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0) || a[1] - b[1] || a[2] - b[2]);
      return [head, rows];
    }
  }

  // ---------------------------------------------------------------- база
  /* Выдаёт репозиторий на время одной операции. Запись идёт строго по очереди и целиком */
  class Database {
    constructor(kv) {
      this.kv = kv;
      this.parts = {meta: {next_row: 0, next_sps: 0, next_batch: 0}, sps: [], batches: [], events: new Map(), field: [], anomalies: [],
        staked: new Map(), gone: []};
      for (const s of ROW_SHEETS) this.parts['rows:' + s] = [];
      this.sorted = new Map(); this.index = new Map(); this.dirty = new Set();
      this._spsIdx = null; this._fieldIdx = null;
      this.coords = null;                  // координаты пикетов в памяти; сбрасывается при правке листов SPS и «Общая информация»
      this.extra = new Map();              // прочие ключи хранилища: настройки, меню, подложки (см. get/set)
      this._extraDirty = new Set(); this._timer = 0; this._flushing = Promise.resolve(); this._tx = null;
    }

    static async open(kv, same_day = 'razm_last', preloaded = null) {
      const db = new Database(kv), saved = preloaded || await kv.load();
      for (const [k, v] of saved) {
        if (k === 'meta') db.parts.meta = {...db.parts.meta, ...v};
        else if (k === 'sps') db.parts.sps = unpack_sps(v);
        else if (k === 'batches') db.parts.batches = v;
        else if (k === 'events') db.parts.events = new Map(v.map(r => [r.src, r]));
        else if (k === 'staked') db.parts.staked = new Map(v.map(r => [r.src, r]));
        else if (k === 'gone') db.parts.gone = v;
        else if (k.startsWith('rows:')) db.parts[k] = v.map(([id, pos, values, batch, fmt, uid, ts, origin]) =>
          ({id, pos, v: values, batch, fmt, uid: uid || new_uid(), ts: ts || '', origin: origin || null}));
        else db.extra.set(k, v);
      }
      db.sorted.set('sps', true);
      RZ.sh.register_custom(db.extra.get('custom'));                // свои листы пользователя
      for (const s of ROW_SHEETS) if (!db.parts['rows:' + s]) db.parts['rows:' + s] = [];
      if (db.parts.events.size) { db.write(repo => repo.rebuild_state(same_day), false); db.dirty.delete('events'); }
      return db;
    }

    _drop_caches(name) {
      if (name === 'field') this._fieldIdx = null;
    }
    drop_sps_index() { this._spsIdx = null; }
    sps_index(arr) {
      if (!this._spsIdx) {
        const m = new Map();
        for (const r of arr) {
          const [l, p] = r.v;
          if (l === null || p === null) continue;
          let s = m.get(l); if (!s) m.set(l, s = new Set());
          s.add(p);
        }
        this._spsIdx = m;
      }
      return this._spsIdx;
    }
    field_index(arr) {
      if (!this._fieldIdx) {
        const m = new Map();
        for (const [l, p] of arr) { let a = m.get(l); if (!a) m.set(l, a = []); a.push(p); }
        this._fieldIdx = m;
      }
      return this._fieldIdx;
    }

    /* Чтение: fn(repo) вызывается сразу, возвращает результат fn */
    read(fn) { return fn(new Repository(this, this._tx)); }

    /* Запись: fn(repo) целиком или никак. persist=false - не сохранять на диск (внутренний пересчёт при открытии) */
    write(fn, persist = true) {
      if (this._tx) return fn(new Repository(this, this._tx));        // вложенный вызов идёт в ту же операцию
      const tx = this._tx = {saved: new Map(), dirty: new Set()};
      let out;
      try {
        out = fn(new Repository(this, tx));
      } catch (e) {
        for (const [name, orig] of tx.saved) this.parts[name] = orig;
        this.sorted.clear(); this.index.clear(); this._spsIdx = null; this._fieldIdx = null;
        throw e;
      } finally {
        this._tx = null;
      }
      if (persist && tx.saved.size) { for (const d of tx.dirty) this.dirty.add(d); this._schedule(); }
      return out;
    }

    // ---- прочие значения (настройки, раскладка меню, подложки) -----------------------------------
    get(key, fallback = null) { return this.extra.has(key) ? this.extra.get(key) : fallback; }
    set(key, value) { this.extra.set(key, value); this._extraDirty.add(key); this._schedule(); }

    // ---- сохранение на диск ---------------------------------------------------------------------
    _schedule(delay = 350) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => { this.flush(); }, delay);
    }
    /* Записывает на диск всё, что изменилось. Вызывается и при сворачивании приложения */
    flush() {
      clearTimeout(this._timer);
      const entries = [], P = this.parts, dirty = this.dirty;
      this.dirty = new Set();
      const extra = [...this._extraDirty]; this._extraDirty = new Set();
      if (dirty.size) entries.push(['meta', P.meta]);
      for (const part of dirty) {
        if (part === 'sps') entries.push(['sps', pack_sps(P.sps)]);
        else if (part === 'batches') entries.push(['batches', P.batches]);
        else if (part === 'events') entries.push(['events', [...P.events.values()]]);
        else if (part === 'staked') entries.push(['staked', [...P.staked.values()]]);
        else if (part === 'gone') entries.push(['gone', P.gone]);
        else if (ROW_SHEETS.includes(part)) entries.push(['rows:' + part, P['rows:' + part].map(r => [r.id, r.pos, r.v, r.batch, r.fmt, r.uid, r.ts, r.origin])]);
      }
      for (const k of extra) entries.push([k, this.extra.get(k)]);
      if (!entries.length) return this._flushing;
      this._flushing = this._flushing.then(() => this.kv.put(entries)).catch(err => {
        console.error('Не удалось сохранить данные', err);
        for (const [k] of entries) if (k !== 'meta') { if (k.startsWith('rows:')) this.dirty.add(k.slice(5)); else if (['sps', 'batches', 'events', 'staked', 'gone'].includes(k)) this.dirty.add(k); else this._extraDirty.add(k); }
        if (typeof RZ.onSaveError === 'function') RZ.onSaveError(err);
      });
      return this._flushing;
    }
    /* Полная выгрузка данных для резервной копии */
    snapshot() {
      const P = this.parts, out = {format: 'razmotka-backup', version: 1, meta: P.meta, batches: P.batches, sps: [], events: [...P.events.values()], rows: {}, extra: {}};
      for (const s of ROW_SHEETS) out.rows[s] = (P['rows:' + s] || []).map(r => [r.id, r.pos, r.v, r.batch, r.fmt, r.uid, r.ts, r.origin]);
      out.staked = [...P.staked.values()]; out.gone = P.gone;
      out.sps = P.sps.map(r => [r.id, r.pos, ...r.v]);
      for (const [k, v] of this.extra) if (!k.startsWith('blob:')) out.extra[k] = v;
      return out;
    }
    /* Заменяет все данные содержимым копии */
    restore(snap, same_day) {
      if (!snap || snap.format !== 'razmotka-backup') throw new RZ.ValidationError('Это не файл копии данных программы.');
      RZ.sh.register_custom(snap.extra && snap.extra.custom);             // свои листы копии - до её строк
      this.write(repo => {
        const P = this.parts;
        for (const s of ROW_SHEETS) { repo._w('rows:' + s); P['rows:' + s] = (snap.rows[s] || []).map(([id, pos, v, batch, fmt, uid, ts, origin]) =>
          ({id, pos, v, batch, fmt, uid: uid || new_uid(), ts: ts || '', origin: origin || null})); }
        repo._w('staked'); P.staked = new Map((snap.staked || []).map(r => [r.src, r]));
        repo._w('gone'); P.gone = snap.gone || [];
        repo._w('sps'); P.sps = (snap.sps || []).map(([id, pos, ...v]) => ({id, pos, v, batch: null, fmt: null}));
        repo._w('batches'); P.batches = snap.batches || [];
        repo._w('events'); P.events = new Map((snap.events || []).map(r => [r.src, r]));
        repo._w('meta'); P.meta = {next_row: 0, next_sps: 0, next_batch: 0, ...(snap.meta || {})};
        repo.rebuild_state(same_day);
        for (const s of ROW_SHEETS) this.dirty.add(s);
        for (const k of ['sps', 'batches', 'events', 'staked', 'gone']) this.dirty.add(k);
        this.sorted.clear(); this.index.clear(); this._spsIdx = null;
      });
      this.coords = null;
      for (const [k, v] of Object.entries(snap.extra || {})) this.set(k, v);
    }
  }

  RZ.Repository = Repository;
  RZ.Database = Database;
})(globalThis.RZ);
