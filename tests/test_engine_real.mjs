// Службы Excel на настоящем хранилище (а не на подделке): журнал из Python загружается в JS-базу,
// выгрузки и сверка сравниваются с эталоном Python. Эталон строит tests/test_excel_helper.py (его запускает test_excel_io.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const D = '/tmp/claude-0/-home-claude/52abce27-64ed-5652-a5bf-b5b8690429c7/scratchpad/xl/data';
if (!fs.existsSync(D + '/dump.json')) { console.log('Сначала запустите node tests/test_excel_io.mjs (он строит эталон)'); process.exit(2); }
const rd = n => new Uint8Array(fs.readFileSync(path.join(D, n))), rj = n => JSON.parse(fs.readFileSync(path.join(D, n), 'utf8'));
const dump = rj('dump.json'), cfgJ = rj('cfg.json');
const ctx = loadEngine(['gk', 'sheets-core', 'rules', 'validation', 'config', 'store', 'svc-sheets', 'reports', 'zip', 'xlsx', 'importer', 'compare', 'exporter', 'underlay', 'api']);
const RZ = ctx.RZ;
let pass = 0, fail = 0;
const same = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x === y) pass++; else { fail++; let i = 0; while (x[i] === y[i]) i++; console.log('FAIL:', m, '\n  js', x.slice(Math.max(0, i - 60), i + 120), '\n  py', y.slice(Math.max(0, i - 60), i + 120)); } };
const eqBytes = (a, b, m) => same(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'), m);

const cfg = RZ.config.from_saved(cfgJ);
const db = await RZ.Database.open(RZ.kv_memory(), cfg.rules.same_day);
const res = await RZ.importer.import_journal(db, cfg, rd('journal.xlsx'));
console.log('импорт журнала:', JSON.stringify(res.sheets), 'не распознано:', res.problems);
// SPS в журнал не входит: ставим те же координаты, что были в эталоне
if (dump.sheets.sps.length) db.write(r => r.replace_sps(dump.sheets.sps.map(x => x[2])));
db.coords = null;

const real = rj('real.json');
same(db.read(r => r.totals()), real.totals, 'totals после импорта');
same(db.read(r => r.field_rows()), real.field_rows, 'field_rows после импорта');
for (const rule of ['razm_last', 'podm_last', 'entry_order']) {
  same(db.read(r => r.last_events(rule)).map(x => [x[0], x[1], x[3], x[4]]), real.last_events[rule].map(x => [x[0], x[1], x[3], x[4]]), `last_events ${rule}`);
  same(db.read(r => r.last_events_full(rule)).map(x => x.slice(0, 5)), real.last_events_full[rule].map(x => x.slice(0, 5)), `last_events_full ${rule}`);
}
same(db.read(r => r.export_history()), real.export_history, 'export_history');
for (const mode of ['428', '508']) {
  const rep = {};
  const r = RZ.exporter.station_history(db, cfg, rd(`in${mode}.bin`), mode, rep);
  eqBytes(r.data, rd(`real_out${mode}.bin`), `History ${mode} на настоящей базе`);
  same([r.name, rep], real['hist' + mode], `History ${mode}: отчёт`);
}
eqBytes(RZ.exporter.table_csv(db, 'field').data, rd('real_csv_field.csv'), 'CSV: оборудование на поле');
eqBytes(RZ.exporter.table_csv(db, 'history').data, rd('real_csv_history.csv'), 'CSV: история');
const cmp = JSON.parse(JSON.stringify(await RZ.compare.compare(db, cfg, rd('compare.xlsm'))));
for (const k of Object.keys(real.compare)) {
  if (k === 'rows_book') continue;                       // порядок равных по ключу строк в Python не определён (set)
  same(cmp[k], real.compare[k], 'compare: ' + k);
}
console.log(fail ? `Провалено ${fail} из ${pass + fail}` : `Все ${pass} проверок совпали с Python`);
process.exit(fail ? 1 : 0);
