// Свои листы пользователя (журналы и листы GeoLink): создание, проведение, карта, лидеры, файл проекта.
// Запуск: node tests/test_custom.mjs
import { loadEngine } from './load.mjs';

const FILES = ['gk', 'sheets-core', 'rules', 'validation', 'config', 'store', 'svc-sheets', 'reports', 'tasks', 'zip', 'xlsx', 'importer', 'compare', 'exporter', 'underlay', 'sqlite', 'project', 'api'];
let bad = 0, n = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && !cond ? ' | ' + JSON.stringify(extra) : '')); };
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), {got: a, want: b});

async function phone(kv) {
  const RZ = loadEngine(FILES).RZ, cfg = RZ.config.from_saved(null);
  const db = await RZ.Database.open(kv || RZ.kv_memory(), cfg.rules.same_day), ctx = {db, cfg, kv: db.kv};
  const call = async (kind, p, arg, bytes) => {
    const r = await RZ.api.dispatch(ctx, kind, p, kind === 'GET' ? arg || {} : (bytes ? arg || {} : {}), kind === 'GET' ? null : bytes || JSON.stringify(arg || {}));
    return r.value && r.value.data ? r.value : JSON.parse(JSON.stringify(r.value));
  };
  const save = (name, rows) => call('POST', '/api/sheet/save', {name, rows: rows.map((v, k) => ({id: null, pos: 1000 + k, idx: k, v}))});
  const look = async (...files) => call('POST', '/api/project/inspect', {}, RZ.exporter.pack_files(files.map((f, k) => [f.name || `файл${k}.rzm`, f.data])));
  const take = async (files, mode = 'merge') => { const rep = await look(...files); if (rep.error) return rep; return call('POST', '/api/project/apply', {token: rep.token, mode}); };
  return {RZ, db, cfg, call, save, look, take};
}
const sps = (lines = [5001, 5009], m = 40) => lines.flatMap((l, k) => Array.from({length: m}, (_, i) => [l, 100 + i, 457000 + 25 * i, 5704000 + 200 * k, 120]));

const P = await phone();
await P.save('sps', sps());
const ids = (await P.call('POST', '/api/custom', {add: {kind: 'workers', title: 'ID геодезистов', journal: 'g1', prefix: 'Журнал геодезии'}})).id;
const wid = (await P.call('POST', '/api/custom', {add: {kind: 'work', title: 'Вешки', journal: 'g1', prefix: 'Журнал геодезии', lookup: ids}})).id;
const pid = (await P.call('POST', '/api/custom', {add: {kind: 'plain', title: 'Заметки', journal: 'g1'}})).id;
ok('свои листы созданы', /^c[a-z0-9]+$/.test(ids) && /^c[a-z0-9]+$/.test(wid) && /^c[a-z0-9]+$/.test(pid));
const meta = (await P.call('GET', '/api/sheets')).sheets;
const w = meta.find(s => s.id === wid);
ok('лист работ в описании листов: кнопка, подпись журнала, ID из своего листа', w && w.kind === 'work' && w.custom && w.button === 'Провести' && w.prefix === 'Журнал геодезии' && w.lookup === ids && w.unit === 'пикет', w);
ok('лист ID и простая таблица', meta.find(s => s.id === ids).kind === 'workers' && meta.find(s => s.id === pid).cols.length === 5);
await P.save(ids, [[21, 'Геодезистов Г. Г.', null], [22, 'Вешкина В. В.', null]]);
await P.save(wid, [['2026-10-08', 'Геодезистов Г. Г.', 5001, 100, 109, null, null, null], ['2026-10-09', 'Вешкина В. В.', 5009, 100, 104, null, null, null]]);
let s = await P.call('GET', '/api/summary');
eq('черновики своего листа ждут кнопки', [s.drafts[wid], s.draft_channels[wid]], [2, 15]);
const ap = await P.call('POST', '/api/sheet/apply', {name: wid, force: true});
eq('кнопка «Провести»', [ap.rows, ap.channels], [2, 15]);
s = await P.call('GET', '/api/summary');
eq('выполнено по листу, разбивка не задета', [s.done[wid], s.done.razb, s.staked], [15, 0, 0]);
const rows = (await P.call('GET', '/api/sheet', {name: wid})).rows;
eq('ID исполнителя в проведённом взят из своего листа ID', [...P.db.parts.staked.values()].filter(r => r.sheet === wid).map(r => r.wid).sort(), [21, 22]);
const f = await P.call('GET', '/api/field');
eq('на карте: свой слой, не «Разбито»', [f.custom[wid].length / 6, f.staked.length], [15, 0]);
const L = await P.call('GET', '/api/leaders', {from: '2026-10-01', to: '2026-10-31'});
eq('лидеры по своему листу', L.sheets.find(x => x.id === wid).rows, [['Геодезистов Г. Г.', 10], ['Вешкина В. В.', 5]]);
eq('лидеры за неделю', (await P.call('GET', '/api/leaders', {from: '2026-10-09', to: '2026-10-15'})).sheets.find(x => x.id === wid).rows, [['Вешкина В. В.', 5]]);
await P.save(wid, [['2026-10-09', 'Вешкина В. В.', 5009, 103, 106, null, null, null]]);
const warn = await P.call('POST', '/api/sheet/apply', {name: wid});
ok('повтор: предупреждение словами своего листа', Array.isArray(warn.warnings) && warn.warnings.some(x => x.includes('уже выполнены: 2')), warn);
await P.call('POST', '/api/sheet/undo', {name: wid});
eq('отмена проведения', (await P.call('GET', '/api/summary')).done[wid], 0);
await P.call('POST', '/api/sheet/apply', {name: wid, force: true});
await P.call('POST', '/api/custom', {rename: {id: wid, title: 'Вешки и ленты'}});
ok('переименование листа', (await P.call('GET', '/api/sheets')).sheets.find(x => x.id === wid).title === 'Вешки и ленты');
const t = (await P.call('GET', '/api/tasks')).items;
ok('список заданий видит свои листы', Array.isArray(t));

// ---- после перезапуска
await P.db.flush();
const again = await phone(P.db.kv);
eq('после перезапуска свои листы и их строки на месте', [(await again.call('GET', '/api/sheets')).sheets.filter(x => x.custom).length, (await again.call('GET', '/api/summary')).done[wid]], [3, 17]);

// ---- файл проекта: другой телефон получает свои листы
const file = await P.call('GET', '/api/project/export', {});
const Q = await phone();
await Q.save('sps', sps());
const rep = await Q.look(file);
ok('проверка файла видит строки своих листов', rep.changes && !rep.error, rep.error);
await Q.call('POST', '/api/project/apply', {token: rep.token, mode: 'replace'});
s = await Q.call('GET', '/api/summary');
eq('замена проекта: свои листы, выполненное, ID', [(await Q.call('GET', '/api/sheets')).sheets.filter(x => x.custom).map(x => x.title).sort(), s.done[wid]], [['ID геодезистов', 'Вешки и ленты', 'Заметки'].sort(), 17]);
const R = await phone();
await R.save('sps', sps());
const r2 = await R.take([file]);
ok('объединение с пустым телефоном: листы появились, строки ждут кнопки', !r2.error && (await R.call('GET', '/api/summary')).drafts[wid] === 3, r2);

// ---- удаление листа
const rm1 = await P.call('POST', '/api/custom', {remove: ids});
ok('лист ID, нужный листу работ, не удаляется', !!rm1.error, rm1);
await P.call('POST', '/api/custom', {remove: wid});
s = await P.call('GET', '/api/summary');
ok('лист работ удалён вместе с выполненным', s.done[wid] === undefined && !(await P.call('GET', '/api/sheets')).sheets.some(x => x.id === wid));
const after = (await P.call('GET', '/api/sheets')).sheets.map(x => x.id);
ok('встроенные листы на месте', ['razm', 'podm', 'razb', 'topo', 'workers', 'sps'].every(k => after.includes(k)), after);

console.log(`\nПровалено ${bad} из ${n}`);
process.exit(bad ? 1 : 0);
