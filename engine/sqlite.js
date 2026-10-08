/* Чтение базы SQLite (razmotka.db) без библиотек - только чтение таблиц целиком.
   Нужно для файлов проекта, сохранённых прежними версиями программы для компьютера: в них нет journal.json,
   есть только база. Из базы собирается тот же journal.json, что пишет нынешняя версия (как Python _journal + _upgrade).
   Формат файла: https://www.sqlite.org/fileformat2.html (страницы b-дерева, записи, страницы переполнения). */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';

  function open(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 100 || new TextDecoder().decode(u8.subarray(0, 15)) !== 'SQLite format 3') throw new Error('sqlite');
    let pageSize = dv.getUint16(16);
    if (pageSize === 1) pageSize = 65536;
    const usable = pageSize - u8[20];
    const enc = dv.getUint32(56);
    if (enc > 1) throw new Error('sqlite: кодировка UTF-16 не поддерживается');
    const userVersion = dv.getInt32(60);
    const utf8 = new TextDecoder('utf-8');
    const pageOff = p => (p - 1) * pageSize;

    function varint(pos) {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        const b = u8[pos + i];
        v = v * 128 + (b & 127);
        if (b < 128) return [v, pos + i + 1];
      }
      return [v * 256 + u8[pos + 8], pos + 9];
    }
    /* Содержимое ячейки целиком (с учётом страниц переполнения) */
    function payload(pos, total, index) {
      const x = index ? Math.floor((usable - 12) * 64 / 255) - 23 : usable - 35;
      if (total <= x) return u8.subarray(pos, pos + total);
      const m = Math.floor((usable - 12) * 32 / 255) - 23;
      let local = m + ((total - m) % (usable - 4));
      if (local > x) local = m;
      const out = new Uint8Array(total);
      out.set(u8.subarray(pos, pos + local));
      let got = local, next = dv.getUint32(pos + local), guard = 0;
      while (got < total && next && guard++ < 1e6) {
        const o = pageOff(next), n = Math.min(usable - 4, total - got);
        out.set(u8.subarray(o + 4, o + 4 + n), got);
        got += n; next = dv.getUint32(o);
      }
      return out;
    }
    function record(p) {
      const rv = new DataView(p.buffer, p.byteOffset, p.byteLength);
      let [hsize, pos] = varint2(p, 0);
      const types = [];
      while (pos < hsize) { const r = varint2(p, pos); types.push(r[0]); pos = r[1]; }
      let at = hsize;
      return types.map(t => {
        if (t === 0) return null;
        if (t === 8) return 0;
        if (t === 9) return 1;
        if (t >= 1 && t <= 6) {
          const n = [0, 1, 2, 3, 4, 6, 8][t];
          let v;
          if (n === 1) v = rv.getInt8(at);
          else if (n === 2) v = rv.getInt16(at);
          else if (n === 3) v = (rv.getInt8(at) << 16) | rv.getUint16(at + 1);
          else if (n === 4) v = rv.getInt32(at);
          else if (n === 6) v = rv.getInt16(at) * 4294967296 + rv.getUint32(at + 2);
          else v = rv.getInt32(at) * 4294967296 + rv.getUint32(at + 4);
          at += n; return v;
        }
        if (t === 7) { const v = rv.getFloat64(at); at += 8; return v; }
        if (t >= 12) {
          const n = t % 2 ? (t - 13) / 2 : (t - 12) / 2, part = p.subarray(at, at + n);
          at += n;
          return t % 2 ? utf8.decode(part) : part.slice();
        }
        return null;
      });
    }
    function varint2(arr, pos) {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        const b = arr[pos + i];
        v = v * 128 + (b & 127);
        if (b < 128) return [v, pos + i + 1];
      }
      return [v * 256 + arr[pos + 8], pos + 9];
    }
    /* Все записи дерева по порядку: [rowid, значения] (у таблиц WITHOUT ROWID rowid нет) */
    function scan(root) {
      const out = [], stack = [root], seen = new Set();
      while (stack.length) {
        const page = stack.pop();
        if (!page || seen.has(page)) continue;
        seen.add(page);
        const base = pageOff(page), h = page === 1 ? base + 100 : base;
        const type = u8[h], cells = dv.getUint16(h + 3), interior = type === 2 || type === 5;
        const ptrs = h + (interior ? 12 : 8), kids = [];
        for (let i = 0; i < cells; i++) {
          const c = base + dv.getUint16(ptrs + 2 * i);
          if (type === 13) {                                   // лист таблицы
            const [total, p1] = varint(c), [rowid, p2] = varint(p1);
            out.push([rowid, record(payload(p2, total, false))]);
          } else if (type === 5) {                             // внутренняя страница таблицы
            kids.push(dv.getUint32(c));
          } else if (type === 10) {                            // лист индекса (таблицы WITHOUT ROWID)
            const [total, p1] = varint(c);
            out.push([null, record(payload(p1, total, true))]);
          } else if (type === 2) {
            kids.push(dv.getUint32(c));
            const [total, p1] = varint(c + 4);
            out.push([null, record(payload(p1, total, true))]);
          } else throw new Error('sqlite: повреждённая страница');
        }
        if (interior) kids.push(dv.getUint32(h + 8));
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
      return out;
    }
    const master = scan(1).map(([, v]) => ({type: v[0], name: v[1], root: v[3], sql: v[4] || ''}));
    /* Имена столбцов из CREATE TABLE (и добавленных ALTER TABLE ADD COLUMN - SQLite дописывает их в sql) */
    function columns(sql) {
      const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
      const parts = []; let depth = 0, cur = '';
      for (const ch of body) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      return parts.map(s => s.trim()).filter(s => s && !/^(primary|unique|check|foreign|constraint)\b/i.test(s))
        .map(s => { const name = s.split(/\s+/)[0].replace(/^["`\[]|["`\]]$/g, ''); return {name, rowid: /\binteger\s+primary\s+key\b/i.test(s)}; });
    }
    function table(name) {
      const t = master.find(r => r.type === 'table' && r.name === name);
      if (!t) return null;
      const cols = columns(t.sql);
      return scan(t.root).map(([rowid, v]) => {
        const o = {};
        cols.forEach((c, i) => { o[c.name] = c.rowid ? rowid : (i < v.length ? v[i] : null); });
        return o;
      });
    }
    return {userVersion, tables: master.filter(r => r.type === 'table').map(r => r.name), table};
  }

  // ---------------------------------------------------------------- SHA-1 (как hashlib.sha1 у программы для ПК)
  function sha1hex(str) {
    const msg = new TextEncoder().encode(str), len = msg.length;
    const n = (((len + 8) >> 6) + 1) * 16, w = new Int32Array(n);
    for (let i = 0; i < len; i++) w[i >> 2] |= msg[i] << (24 - (i % 4) * 8);
    w[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    w[n - 1] = len * 8;
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const x = new Int32Array(80);
    for (let i = 0; i < n; i += 16) {
      for (let t = 0; t < 16; t++) x[t] = w[i + t];
      for (let t = 16; t < 80; t++) { const v = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16]; x[t] = (v << 1) | (v >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = t < 20 ? 0x5A827999 : t < 40 ? 0x6ED9EBA1 : t < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        const tmp = (((a << 5) | (a >>> 27)) + f + e + k + x[t]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }
  /* Номер записи по содержимому - тот же, что считает программа для ПК при обновлении старой базы (db.stable_uid) */
  const pyStr = v => (v === null || v === undefined ? 'None' : typeof v === 'object' && 'py' in v ? v.py : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : pyFloat(v)) : String(v));
  const pyFloat = v => { const s = String(v); return /[.eE]/.test(s) ? s.replace(/e\+?/, 'e+').replace('e+-', 'e-') : s + '.0'; };
  const stable_uid = (...parts) => sha1hex(parts.map(pyStr).join('\x1f')).slice(0, 32);

  /* journal.json из базы прежней версии */
  function journal(bytes) {
    const db = open(bytes), has = n => db.tables.includes(n);
    const SHEETS = ['razm', 'podm', 'razb', 'oo', 'snake', 'info', 'workers', 'topo'];
    const out = {version: 1, sheets: {}, gone: [], from_db: db.userVersion};
    for (const s of SHEETS) out.sheets[s] = [];
    if (has('sheet_rows')) {
      const rows = db.table('sheet_rows').sort((a, b) => (a.sheet < b.sheet ? -1 : a.sheet > b.sheet ? 1 : a.pos - b.pos || a.id - b.id));
      const seen = new Map();
      for (const r of rows) {
        if (!out.sheets[r.sheet]) continue;
        let v; try { v = JSON.parse(r.data); } catch (e) { continue; }
        let uid = r.uid;
        if (!uid) { const key = r.sheet + '\x00' + r.data, k = (seen.get(key) || 0) + 1; seen.set(key, k); uid = stable_uid(r.sheet, r.data, k); }
        let fmt = null; try { fmt = r.fmt ? JSON.parse(r.fmt) : null; } catch (e) { fmt = null; }
        out.sheets[r.sheet].push({uid, pos: r.pos, v, done: r.batch !== null && r.batch !== undefined, ts: r.ts || '', origin: r.origin || null, fmt});
      }
    } else if (has('intervals')) {                          // самая первая версия: интервалы размотки и подмотки
      const iv = db.table('intervals').sort((a, b) => (b.type - a.type) || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
      iv.forEach((r, k) => {
        const sheet = r.type === 1 ? 'razm' : 'podm', data = [r.date, r.worker, r.line, r.p1, r.p2, null, null, null, null];
        out.sheets[sheet].push({uid: stable_uid(sheet, JSON.stringify(data), 1) , pos: k + 1, v: data, done: true, ts: '', origin: null, fmt: null});
      });
      if (has('workers')) db.table('workers').sort((a, b) => a.id - b.id).forEach(w => out.sheets.workers.push({uid: stable_uid('workers', w.id, w.name), pos: w.id, v: [w.id, w.name, null], done: false, ts: '', origin: null, fmt: null}));
    }
    if (has('sps')) out.sps = db.table('sps').sort((a, b) => a.pos - b.pos || a.id - b.id).map(r => [r.line, r.picket, r.x, r.y, r.z]);
    else if (has('tgo')) out.sps = db.table('tgo').sort((a, b) => a.line - b.line || a.picket - b.picket).map(r => [r.line, r.picket, r.x, r.y, null]);
    if (has('marks')) {
      const seen = new Map();
      out.marks = db.table('marks').sort((a, b) => a.id - b.id).map(m => {
        let uid = m.uid;
        if (!uid) { const real = v => (typeof v === 'number' ? {py: pyFloat(v)} : v), parts = [real(m.x), real(m.y), m.line, m.picket, m.shape, m.color, m.text, m.ts || ''], key = JSON.stringify(parts), k = (seen.get(key) || 0) + 1; seen.set(key, k); uid = stable_uid('mark', ...parts, k); }
        return [uid, m.x, m.y, m.line, m.picket, m.shape, m.color, m.text || '', m.schem || 0, m.ts || ''];
      });
    }
    if (has('gone')) out.gone = db.table('gone').map(g => g.uid).filter(Boolean).sort();
    if (has('dxf_layers') && has('dxf_items')) {
      const items = new Map();
      for (const it of db.table('dxf_items').sort((a, b) => a.id - b.id)) {
        let pts = []; try { pts = JSON.parse(it.pts); } catch (e) { pts = []; }
        if (!items.has(it.layer)) items.set(it.layer, []);
        items.get(it.layer).push({name: it.name, kind: it.kind, pts});
      }
      out.dxf = db.table('dxf_layers').sort((a, b) => a.pos - b.pos || a.id - b.id)
        .map(l => ({uid: l.uid, name: l.name, color: l.color, visible: !!l.visible, labels: !!l.labels, items: items.get(l.id) || []}));
    }
    return out;
  }

  RZ.sqlite = {open, journal, sha1hex, stable_uid};
})(globalThis.RZ);
