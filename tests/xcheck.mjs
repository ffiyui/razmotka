// Перекрёстная проверка: тот же сценарий, что выполнила Python-версия (tests/xcheck_gen.py), выполняется JS-движком,
// ответы сравниваются. Запуск: node tests/xcheck.mjs <каталог с ops.json и expected.json>
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine } from './load.mjs';

const dir = process.argv[2];
const ops = JSON.parse(fs.readFileSync(path.join(dir, 'ops.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
const ctxVm = loadEngine(['gk', 'sheets-core', 'rules', 'validation', 'config', 'store', 'svc-sheets', 'reports', 'zip', 'xlsx', 'importer', 'compare', 'exporter', 'underlay', 'api']);
const RZ = ctxVm.RZ;
const cfg = RZ.config.from_saved(null);
const db = await RZ.Database.open(RZ.kv_memory(), cfg.rules.same_day);
const ctx = {db, cfg, kv: db.kv};

async function call(kind, p, arg) {
  const body = kind === 'GET' ? null : JSON.stringify(arg);
  const r = await RZ.api.dispatch(ctx, kind, p, kind === 'GET' ? arg : {}, body);
  let v = r.value;
  if (v && v.data && v.name) return {download: p === '/api/export' ? new TextDecoder().decode(v.data).replace(/^﻿/, '') : null, name: v.name};
  return JSON.parse(JSON.stringify(v));
}
const sheetRows = async name => (await call('GET', '/api/sheet', {name})).rows || [];

async function run(op) {
  const t = op.t;
  if (t === 'load') return call('GET', '/api/sheet', {name: op.sheet});
  if (t === 'save') {
    const cur = await sheetRows(op.sheet);
    if (op.edit) {
      const rows = op.edit.map(([i, val]) => { const row = cur[i], v = [...row[3]]; v[1] = val; return {id: row[0], pos: row[1], idx: i, v}; });
      return call('POST', '/api/sheet/save', {name: op.sheet, rows});
    }
    return call('POST', '/api/sheet/save', {name: op.sheet, rows: op.rows.map((v, k) => ({id: null, pos: cur.length + k + 1, idx: cur.length + k, v}))});
  }
  const cur = await sheetRows(op.sheet || 'razm');
  const ids = () => cur.length ? [...new Set(op.pick.map(p => cur[Math.floor(p * cur.length)][0]))].sort((a, b) => a - b) : [];
  if (t === 'apply') return call('POST', '/api/sheet/apply', {name: op.sheet, force: op.force});
  if (t === 'undo') return call('POST', '/api/sheet/undo', {name: op.sheet});
  if (t === 'unapply') return call('POST', '/api/sheet/unapply', {name: op.sheet, ids: ids()});
  if (t === 'delete') return call('POST', '/api/sheet/delete', {name: op.sheet, ids: ids()});
  if (t === 'edit') {
    if (!cur.length) return null;
    const i = Math.floor(op.pick * cur.length), row = cur[i], v = [...row[3]]; v[op.col] = op.val;
    return call('POST', '/api/sheet/save', {name: op.sheet, rows: [{id: row[0], pos: row[1], idx: i, v}]});
  }
  if (t === 'cleanup') return call('POST', '/api/cleanup', {from: op.from, to: op.to, types: op.types});
  if (t === 'settings') return call('POST', '/api/settings', op.changes);
  if (t === 'clear') return call('POST', '/api/clear', {});
  if (t === 'snap') {
    const s = {};
    s.summary = await call('GET', '/api/summary', {}); s.field = await call('GET', '/api/field', {}); s.check = await call('GET', '/api/check', {});
    s.stats = await call('GET', '/api/stats', {from: '2026-10-01', to: '2026-10-31'});
    s.stats2 = await call('GET', '/api/stats', {from: '2026-10-03', to: '2026-10-08'});
    s.period = await call('GET', '/api/period', {from: '2026-10-03', to: '2026-10-09'});
    s.export_field = await call('GET', '/api/export', {what: 'field', fmt: 'csv'});
    s.export_history = await call('GET', '/api/export', {what: 'history', fmt: 'csv'});
    s.razm = await call('GET', '/api/sheet', {name: 'razm'}); s.podm = await call('GET', '/api/sheet', {name: 'podm'});
    return s;
  }
  throw new Error(t);
}

// ---- сравнение: идентификаторы строк и время не сравниваются, порядок точек периода не определён ----
function norm(x, key) {
  if (x === null || x === undefined) return null;
  if (Array.isArray(x)) return x.map(v => norm(v));
  if (typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (k === 'ids' || k === 'row_id' || k === 'ts') continue;
      o[k] = norm(v, k);
    }
    if ('error' in o) return {error: o.error, col: o.col ?? null};
    if (o.period_sorted) return o;
    return o;
  }
  return x;
}
const sheetNorm = r => (r && Array.isArray(r.rows) ? {...r, rows: r.rows.map(([, ...rest]) => rest)} : r);
function normSnap(s) {
  if (!s || !s.summary) return s;
  const out = {...s};
  out.razm = sheetNorm(s.razm); out.podm = sheetNorm(s.podm);
  const quad = a => { const q = []; for (let i = 0; i < a.length; i += 4) q.push(a.slice(i, i + 4).join(',')); return q.sort(); };
  out.period = {razm: quad(s.period.razm), podm: quad(s.period.podm)};
  return out;
}
const nrm = x => norm(normSnap(x && Array.isArray(x.rows) ? sheetNorm(x) : x));

let bad = 0, checked = 0;
for (let i = 0; i < ops.length; i++) {
  const got = await run(ops[i]);
  const a = JSON.stringify(nrm(got)), b = JSON.stringify(nrm(expected[i]));
  checked++;
  if (a !== b) {
    bad++;
    if (bad <= 5) {
      console.log(`✗ шаг ${i} ${JSON.stringify(ops[i]).slice(0, 220)}`);
      // найти первое различие
      const ga = nrm(got), gb = nrm(expected[i]);
      const walk = (x, y, p) => {
        if (JSON.stringify(x) === JSON.stringify(y)) return false;
        if (x && y && typeof x === 'object' && typeof y === 'object') {
          const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
          for (const k of keys) if (walk(x[k], y[k], p + '.' + k)) return true;
          return true;
        }
        console.log('   ', p, '\n     js:', JSON.stringify(x)?.slice(0, 200), '\n     py:', JSON.stringify(y)?.slice(0, 200));
        return true;
      };
      walk(ga, gb, '');
    }
  }
}
console.log(bad ? `\nРасхождений: ${bad} из ${checked}` : `Все ${checked} шагов совпали с Python`);
process.exit(bad ? 1 : 0);
