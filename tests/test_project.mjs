// Разбивка, задания и файл проекта в движке телефона. Запуск: node tests/test_project.mjs
// С двумя путями (node tests/test_project.mjs <файл с ПК> <куда сохранить ответ>) - обмен с настольной программой:
// файл начальника отряда загружается «в телефон», задание выполняется частично, файл с выполненным сохраняется для ПК.
import fs from 'node:fs';
import { loadEngine } from './load.mjs';

const FILES = ['gk', 'sheets-core', 'rules', 'validation', 'config', 'store', 'svc-sheets', 'reports', 'tasks', 'zip', 'xlsx', 'importer', 'compare', 'exporter', 'underlay', 'project', 'api'];
let bad = 0, n = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' ? ' | ' + JSON.stringify(extra) : '')); };
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b) ? '' : {got: a, want: b});

async function phone() {
  const RZ = loadEngine(FILES).RZ, cfg = RZ.config.from_saved(null);
  const db = await RZ.Database.open(RZ.kv_memory(), cfg.rules.same_day), ctx = {db, cfg, kv: db.kv};
  const call = async (kind, p, arg, bytes) => {
    const r = await RZ.api.dispatch(ctx, kind, p, kind === 'GET' ? arg || {} : (bytes ? arg || {} : {}), kind === 'GET' ? null : bytes || JSON.stringify(arg || {}));
    return r.value && r.value.data ? r.value : JSON.parse(JSON.stringify(r.value));
  };
  const save = (name, rows) => call('POST', '/api/sheet/save', {name, rows: rows.map((v, k) => ({id: null, pos: 1000 + k, idx: k, v}))});
  const file = async (args = {}) => (await call('GET', '/api/project/export', args));
  const look = async (...files) => call('POST', '/api/project/inspect', {}, RZ.exporter.pack_files(files.map((f, k) => [f.name || `файл${k}.rzm`, f.data])));
  const take = async (files, mode = 'merge', parts = null) => { const rep = await look(...files); if (rep.error) return rep; return call('POST', '/api/project/apply', {token: rep.token, mode, parts}); };
  const rows = async name => (await call('GET', '/api/sheet', {name})).rows;
  return {RZ, db, cfg, call, save, file, look, take, rows};
}
const sps = (lines = [5001, 5009, 5017], n = 60) => lines.flatMap((l, k) => Array.from({length: n}, (_, i) => [l, 100 + i, 457000 + 25 * i, 5704000 + 200 * k, 120]));
const stake = (date, who, line, a, b, note = null) => [date, who, line, a, b, null, note, null];
const work = (date, who, line, a, b) => [date, who, line, a, b, null, null, null, null];

// ---------------------------------------------------------------- разбивка и оценка места пикета
{
  const P = await phone();
  await P.save('sps', sps());
  await P.save('workers', [[1, 'Иванов И. И.', null]]);
  await P.save('topo', [[11, 'Топоров Т. Т.', null]]);
  const meta = (await P.call('GET', '/api/sheets')).sheets.find(s => s.id === 'razb');
  eq('лист «Разбивка»', [meta.button, meta.prefix, meta.lookup, meta.unit], ['Разбить', 'Журнал ТГО', 'topo', 'пикет']);
  const ids = (await P.save('razb', [stake('2026-10-08', 'Топоров Т. Т.', 5001, 100, 109), stake('2026-10-08', 'Топоров Т. Т.', 5025, 100, 104), stake('2026-10-08', 'Топоров Т. Т.', 5009, 158, 163)])).ids;
  let f = await P.call('GET', '/api/field');
  eq('задания видны на карте, разбитого пока нет', [f.staked.length, f.plan.length / 4], [0, 21]);
  // линии 5025 в SPS нет: место считается по соседним линиям (шаг 200 м на 8 номеров, 25 м на пикет)
  const t = await P.call('GET', '/api/task', {sheet: 'razb', id: ids[1]});
  eq('место пикета без координат посчитано по соседним линиям', [t.est, t.missing, t.points.slice(0, 4)], [5, 0, [457000, 5704600, 100, 0]]);
  const t2 = await P.call('GET', '/api/task', {sheet: 'razb', id: ids[2]});
  eq('за концом линии место считается по её последним пикетам', [t2.est, t2.points.slice(-4), t2.points.slice(0, 4)], [4, [457000 + 25 * 63, 5704200, 163, 0], [457000 + 25 * 58, 5704200, 158, 1]]);
  const all = await P.call('GET', '/api/tasks');
  eq('список заданий', all.items.map(i => [i.sheet, i.line, i.p1, i.p2, i.count]), [['razb', 5001, 100, 109, 10], ['razb', 5025, 100, 104, 5], ['razb', 5009, 158, 163, 6]]);
  eq('задания одного исполнителя', (await P.call('GET', '/api/tasks', {me: 'никто'})).items.length, 0);
  // прошёл задание кусками: 100-103 и 106-107, остальное не тронуто
  const res = await P.call('POST', '/api/task/done', {sheet: 'razb', id: ids[0], visited: [100, 101, 102, 103, 106, 107, 500]});
  eq('задание разбито на диапазоны', [res.done, res.left, res.rows, res.units], [[[100, 103], [106, 107]], [], 2, 6]);
  const got = (await P.rows('razb')).map(r => [r[3][2], r[3][3], r[3][4], r[2]]);
  eq('в журнале фактически пройденное, непройденное заданием не осталось', got, [[5001, 100, 103, 1], [5001, 106, 107, 1], [5025, 100, 104, 0], [5009, 158, 163, 0]]);
  f = await P.call('GET', '/api/field');
  const s = await P.call('GET', '/api/summary');
  eq('разбитое на карте и в сводке', [f.staked.length / 6, s.staked, s.drafts.razb, s.field], [6, 6, 2, 0]);
  eq('нечего вносить, если ничего не пройдено', (await P.call('POST', '/api/task/done', {sheet: 'razb', id: ids[1], visited: [1, 2]})).error, 'Ни один пикет задания не пройден.');
  const w = await P.call('POST', '/api/task/done', {sheet: 'razb', id: ids[1], visited: [100, 101, 102, 103, 104]});
  ok('пикетов нет в SPS: сначала вопрос, журнал не тронут', Array.isArray(w.warnings) && (await P.rows('razb')).length === 4, w);
  const w2 = await P.call('POST', '/api/task/done', {sheet: 'razb', id: ids[1], visited: [100, 101, 102, 103, 104], force: true});
  eq('с подтверждением задание внесено целиком', [w2.done, w2.left, (await P.call('GET', '/api/summary')).staked], [[[100, 104]], [], 11]);
  await P.call('POST', '/api/sheet/undo', {name: 'razb'});
  eq('отмена разбивки', (await P.call('GET', '/api/summary')).staked, 6);
  // размотка по заданию
  const rz = (await P.save('razm', [work('2026-10-08', 'Иванов И. И.', 5001, 100, 119)])).ids;
  const r2 = await P.call('POST', '/api/task/done', {sheet: 'razm', id: rz[0], visited: Array.from({length: 12}, (_, i) => 100 + i)});
  eq('размотка по заданию: пройдено 12 из 20', [r2.done, r2.left, (await P.call('GET', '/api/summary')).field], [[[100, 111]], [], 12]);
  // нахлёст: размотка на пикеты, где оборудование уже лежит
  const rz2 = (await P.save('razm', [work('2026-10-08', 'Иванов И. И.', 5001, 108, 115)])).ids;
  const all8 = Array.from({length: 8}, (_, i) => 108 + i);
  const ck = await P.call('POST', '/api/task/check', {sheet: 'razm', id: rz2[0], visited: all8});
  eq('проверка нахлёста перед записью', [ck.overlap, ck.overlap_count], [[[108, 111]], 4]);
  const tr2 = await P.call('POST', '/api/task/done', {sheet: 'razm', id: rz2[0], visited: all8, overlap: 'trim'});
  eq('без нахлёста: записаны только пикеты без оборудования', [tr2.done, (await P.call('GET', '/api/summary')).field], [[[112, 115]], 16]);
  await P.call('POST', '/api/sheet/undo', {name: 'razm'});
  const rz3 = (await P.rows('razm')).find(r => !r[2] && r[3][3] === 112)[0];
  const kp = await P.call('POST', '/api/task/done', {sheet: 'razm', id: rz3, visited: [112, 113], overlap: 'keep', mode: 'orig'});
  eq('исходный вид задания записывается целиком', [kp.done, kp.warnings], [[[112, 115]], undefined]);
  await P.call('POST', '/api/sheet/undo', {name: 'razm'});
  const rz4 = (await P.save('razm', [work('2026-10-08', 'Иванов И. И.', 5001, 110, 113)])).ids;
  const kw = await P.call('POST', '/api/task/done', {sheet: 'razm', id: rz4[0], visited: [110, 111, 112]});
  ok('нахлёст без выбора - вопрос, журнал не тронут', Array.isArray(kw.warnings) && kw.warnings[0].startsWith('размотка на пикеты'), kw);
  const fd = await P.call('POST', '/api/find', {ranges: [{line: 5001, p1: 105, p2: 107}, {line: '5009', p2: '120'}, {line: 5017}]});
  eq('поиск пикетов', fd.rows.map(r => [r.found, r.missing]), [[3, 0], [1, 0], [60, 0]]);
  // треки
  const tr = await P.call('POST', '/api/tracks', {add: {name: 'Обход', pts: [457000, 5704000, 0, 457030, 5704040, 60]}});
  await P.call('POST', '/api/tracks', {uid: tr.uid, name: 'Обход линии 5001', show: false});
  const tl = (await P.call('GET', '/api/tracks')).items;
  eq('трек записан и переименован', [tl.length, tl[0].name, tl[0].show, tl[0].length, tl[0].seconds], [1, 'Обход линии 5001', false, 50, 60]);
  ok('короткий трек не принимается', !!(await P.call('POST', '/api/tracks', {add: {pts: [1, 2, 0]}})).error);
  // данные переживают перезапуск приложения
  await P.db.flush();
  const again = await P.RZ.Database.open(P.db.kv, P.cfg.rules.same_day);
  eq('после перезапуска всё на месте', again.read(r => [r.staked_total(), r.rows_full('razb').length, r.rows_full('razb')[0][4].length, r.gone_uids().size, (again.get('tracks') || []).length]), [6, 4, 32, 0, 1]);
}

// ---------------------------------------------------------------- файл проекта между устройствами
{
  const chief = await phone();
  await chief.save('sps', sps());
  await chief.save('workers', [[1, 'Иванов И. И.', null]]);
  await chief.save('topo', [[11, 'Топоров Т. Т.', null]]);
  await chief.save('razb', [stake('2026-10-08', 'Топоров Т. Т.', 5001, 100, 119), stake('2026-10-08', 'Топоров Т. Т.', 5001, 130, 139)]);
  await chief.save('razm', [work('2026-10-07', 'Иванов И. И.', 5001, 100, 109), work('2026-10-08', 'Иванов И. И.', 5009, 100, 104)]);
  await chief.call('POST', '/api/sheet/apply', {name: 'razm', force: true, ids: [(await chief.rows('razm'))[0][0]]});
  await chief.db.set('dxf', [{uid: 'd1', name: '01_Аминов', color: '#34C759', visible: true, labels: true, items: [{name: '001', kind: 'poly', pts: [0, 0, 100, 0, 100, 200, 0, 200]}]}]);
  const full = await chief.file({name: 'Проект начальника'});
  eq('имя файла задаётся', full.name, 'Проект начальника.rzm');
  const zip = await chief.RZ.zip.read(full.data);
  eq('в файле манифест, журнал и настройки', zip.names, ['manifest.json', 'journal.json', 'settings.json']);
  const only = await chief.file({parts: '', tasks: 'razb'});
  const j = JSON.parse(await (await chief.RZ.zip.read(only.data)).text('journal.json'));
  eq('выгрузка только заданий на разбивку', [j.sheets.razb.length, j.sheets.razm.length, j.sheets.topo.length, 'sps' in j, JSON.parse(await (await chief.RZ.zip.read(only.data)).text('manifest.json')).partial], [2, 0, 1, false, true]);
  const onlyAll = JSON.parse(await (await chief.RZ.zip.read((await chief.file({tasks: 'all'})).data)).text('journal.json'));
  eq('выгрузка заданий всех видов: проведённое не кладётся', [onlyAll.sheets.razb.length, onlyAll.sheets.razm.length], [2, 1]);

  const topo = await phone();
  let rep = await topo.look(full);
  eq('пустому проекту предлагается замена', [rep.here.empty, rep.single, rep.parts.sps.file, rep.parts.dxf.new, rep.parts.settings.on], [true, true, 180, 1, true]);
  let res = await topo.call('POST', '/api/project/apply', {token: rep.token, mode: 'replace'});
  eq('телефон топографа - копия проекта', [res.rows.razb, res.rows.razm, res.rows.sps, res.dxf, (await topo.call('GET', '/api/summary')).field], [2, 2, 180, 1, 10]);
  ok('ключ одноразовый', !!(await topo.call('POST', '/api/project/apply', {token: rep.token, mode: 'replace'})).error);
  eq('контуры пришли с файлом', (await topo.call('GET', '/api/dxf')).layers.map(l => [l.name, l.count, l.items[0].area]), [['01_Аминов', 1, 20000]]);
  const t = (await topo.call('GET', '/api/tasks', {me: 'топоров т. т.'})).items;
  await topo.call('POST', '/api/task/done', {sheet: 'razb', id: t[0].id, visited: Array.from({length: 15}, (_, i) => 100 + i)});
  await topo.save('topo', [[12, 'Вешкин В. В.', null]]);
  const extra = (await topo.save('razb', [stake('2026-10-08', 'Вешкин В. В.', 5009, 140, 149)])).ids;
  await topo.call('POST', '/api/sheet/apply', {name: 'razb', force: true, ids: extra});
  await topo.call('POST', '/api/tracks', {add: {name: 'Смена', pts: [457000, 5704000, 0, 457100, 5704000, 90]}});
  const back = await topo.file({name: 'Топоров Т. Т. 08.10.2026 22ч55м'});

  rep = await chief.look(back);
  const razb = rep.changes.work.find(w => w.sheet === 'razb');
  eq('табло у начальника: кто сколько выполнил', [razb.rows, razb.units, razb.who, razb.tasks], [2, 25, [{name: 'Топоров Т. Т.', rows: 1, units: 15}, {name: 'Вешкин В. В.', rows: 1, units: 10}], 0]);
  eq('новый исполнитель и трек', [rep.changes.people, rep.parts.tracks.new, rep.files[0].source], [[{sheet: 'topo', title: 'ID топографов', added: ['Вешкин В. В.']}], 1, 'телефон']);
  eq('проверка ничего не меняет', (await chief.rows('razb')).map(r => [r[3][3], r[3][4]]), [[100, 119], [130, 139]]);
  res = await chief.call('POST', '/api/project/apply', {token: rep.token, mode: 'merge'});
  const got = (await chief.rows('razb')).map(r => [r[3][1], r[3][3], r[3][4], r[2], !!r[5]]);
  eq('принятое ждёт кнопки и помечено', got, [['Топоров Т. Т.', 100, 114, 0, true], ['Топоров Т. Т.', 130, 139, 0, false], ['Вешкин В. В.', 140, 149, 0, true]]);
  eq('на карту принятое не попало, трек принят', [(await chief.call('GET', '/api/summary')).staked, res.tracks], [0, 1]);
  const again = await chief.look(back);
  eq('тот же файл второй раз ничего не добавляет', again.changes.work.map(w => [w.rows, w.tasks, w.changed]), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  ok('чужой файл отклоняется', (await chief.look({data: new TextEncoder().encode('not a project')})).error.includes('не файл проекта'));
  ok('файл только с заданиями нельзя поставить на место проекта', (await topo.take([only], 'replace')).error.includes('только задания'));
  const acc = (await chief.rows('razb')).filter(r => r[5]).map(r => r[0]);
  await chief.call('POST', '/api/sheet/apply', {name: 'razb', force: true, ids: acc});
  eq('после кнопки разбивка на карте', (await chief.call('GET', '/api/summary')).staked, 25);
  // удалённое задание не возвращается
  const del = (await chief.rows('razb')).find(r => r[3][3] === 130)[0];
  await chief.call('POST', '/api/sheet/delete', {name: 'razb', ids: [del]});
  await chief.take([back]);
  ok('снятое задание файл обратно не приносит', !(await chief.rows('razb')).some(r => r[3][3] === 130));
  res = await topo.take([await chief.file()]);
  eq('у топографа снятое задание исчезает', [res.changes.work.find(w => w.sheet === 'razb').removed, (await topo.rows('razb')).some(r => r[3][3] === 130)], [1, false]);
}

// ---------------------------------------------------------------- обмен с настольной программой
if (process.argv[2]) {
  const P = await phone();
  const pc = {name: 'chief.rzm', data: new Uint8Array(fs.readFileSync(process.argv[2]))};
  const rep = await P.look(pc);
  ok('файл с компьютера читается', !rep.error && rep.files[0].rows.sps > 0, rep.error || rep.files[0].rows);
  const res = await P.call('POST', '/api/project/apply', {token: rep.token, mode: 'replace'});
  const s = await P.call('GET', '/api/summary');
  console.log('PC->phone', JSON.stringify({rows: res.rows, field: s.field, staked: s.staked, drafts: s.drafts, dxf: res.dxf}));
  const t = (await P.call('GET', '/api/tasks')).items.filter(i => i.sheet === 'razb');
  const r = await P.call('POST', '/api/task/done', {sheet: 'razb', id: t[0].id, visited: Array.from({length: 12}, (_, i) => t[0].p1 + i), force: true});
  ok('задание с компьютера выполнено частично: непройденное заданием не осталось', r.ok && r.left.length === 0, r);
  await P.save('razm', [work('2026-10-08', 'Иванов И. И.', 5009, 110, 119)]);
  await P.call('POST', '/api/sheet/apply', {name: 'razm', force: true});
  await P.call('POST', '/api/tracks', {add: {name: 'Смена', pts: [457000, 5704000, 0, 457100, 5704000, 90]}});
  fs.writeFileSync(process.argv[3], (await P.file({name: 'Топоров Т. Т. 08.10.2026 22ч55м'})).data);
}
console.log(`\nПровалено ${bad} из ${n}`);
process.exit(bad ? 1 : 0);
