// Тесты Excel/файловых служб (этап 2): importer, compare, exporter против эталона Python.
// Запуск: node tests/test_excel_io.mjs   (Python-эталон строится tests/test_excel_helper.py mkdata)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(HERE, '..', 'engine');
const D = '/tmp/claude-0/-home-claude/52abce27-64ed-5652-a5bf-b5b8690429c7/scratchpad/xl/data';
fs.mkdirSync(D, { recursive: true });
execFileSync('python3', [path.join(HERE, 'test_excel_helper.py'), 'mkdata', D], { stdio: 'inherit' });

let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log('FAIL:', m); } };
const same = (a, b, m) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) passed++; else {
    failed++;
    let i = 0; while (i < x.length && x[i] === y[i]) i++;
    console.log('FAIL:', m, '\n  got ', x.slice(Math.max(0, i - 80), i + 160), '\n  want', y.slice(Math.max(0, i - 80), i + 160));
  }
};
const rd = (n) => new Uint8Array(fs.readFileSync(path.join(D, n)));
const rj = (n) => JSON.parse(fs.readFileSync(path.join(D, n), 'utf8'));
const hex = (u8) => Buffer.from(u8).toString('hex');
const bytesEq = (a, b, m) => {
  if (a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0) { passed++; return; }
  failed++;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  console.log('FAIL:', m, `длины ${a.length}/${b.length}, первое отличие ${i}`,
    '\n  got ', JSON.stringify(Buffer.from(a.slice(Math.max(0, i - 30), i + 60)).toString('utf8')),
    '\n  want', JSON.stringify(Buffer.from(b.slice(Math.max(0, i - 30), i + 60)).toString('utf8')));
};

const dump = rj('dump.json');
const cfg = rj('cfg.json');

// ---- контекст: настоящее ядро, если оно уже есть, иначе заглушка
const realCore = fs.readFileSync(path.join(ENGINE, 'sheets-core.js'), 'utf8').length > 200;
const ctx = loadEngine(realCore ? ['gk', 'sheets-core', 'rules', 'validation', 'config', 'store', 'svc-sheets', 'reports', 'zip', 'xlsx', 'importer', 'compare', 'exporter', 'underlay', 'api'] : [], { __META__: { meta: dump.meta, info_rules: dump.info_rules } });
if (!realCore) {
  vm.runInContext(fs.readFileSync(path.join(HERE, 'test_excel_mock_core.js'), 'utf8'), ctx, { filename: 'mock_core' });
  // порядок как в index.html: ядро (заглушка) раньше остальных; перезагружаем службы поверх
  for (const f of ['zip', 'xlsx', 'importer', 'compare', 'exporter']) vm.runInContext(fs.readFileSync(path.join(ENGINE, f + '.js'), 'utf8'), ctx, { filename: f });
}
const RZ = ctx.RZ;
console.log(realCore ? 'ядро: настоящее' : 'ядро: заглушка tests/test_excel_mock_core.js');

// ---- поддельное хранилище на основе сброса из Python
class FakeRepo {
  constructor(src) {
    this.sheets = {}; this.events = []; this.batches = []; this.sps = []; this.nextId = 1; this.nextBatch = 1; this.rule = cfg.rules.same_day;
    for (const k of Object.keys(dump.sheets)) {
      this.sheets[k] = src ? dump.sheets[k].map((r) => ({ id: r[0], pos: r[1], values: JSON.parse(JSON.stringify(r[2])), batch: r[3] })) : [];
    }
    this.src = src;
  }
  sheet_rows(n) { return this.sheets[n].map((r) => [r.id, r.pos, r.values, r.batch]); }
  insert_row(n, pos, values) { const id = this.nextId++; this.sheets[n].push({ id, pos, values, batch: null }); return id; }
  clear_sheet(n) { this.sheets[n] = []; }
  clear_events() { this.events = []; }
  clear_batches() { this.batches = []; this.nextBatch = 1; }
  new_batch(ts, sheet, kind) { const id = this.nextBatch++; this.batches.push({ id, sheet, kind }); return id; }
  finish_batch(id, rows, channels) { Object.assign(this.batches.find((b) => b.id === id), { rows, channels }); }
  set_done(ids, batch) { for (const k of Object.keys(this.sheets)) for (const r of this.sheets[k]) if (ids.includes(r.id)) r.batch = batch; }
  insert_events(src, line, p1, p2, date, type, wid, worker, seq) { this.events.push({ src, line, p1, p2, date, type, wid, worker, seq }); }
  replace_sps(rows) { this.sps = rows; }
  rebuild_state() {}
  field_rows() { return dump.field_rows; }
  last_events(rule) { return dump.last_events[rule]; }
  last_events_full(rule) { return dump.last_events_full[rule]; }
  totals() { return dump.totals; }
  export_history() { return dump.export_history; }
}
const readDb = () => ({ coords: null, read: (fn) => fn(new FakeRepo(true)), write: (fn) => fn(new FakeRepo(true)) });
const writeDb = () => { const repo = new FakeRepo(false); return { repo, coords: 0, read: (fn) => fn(repo), write: (fn) => fn(repo) }; };
RZ.reports = { coords: () => ({ schematic: dump.schematic, xy: (l, p) => dump.xy[l + ',' + p] }) };
RZ.svc_sheets = { party: () => dump.party };

// ---------------------------------------------------------------- кодировка
{
  const py = JSON.parse(execFileSync('python3', ['-c', `
import json
b = bytes(range(256))
print(json.dumps({"dec": b.decode("cp1251", "replace"), "enc": "".join(chr(c) for c in list(range(32, 0x500)) + [0x2116, 0x2122, 0x20ac]).encode("cp1251", "replace").hex()}))`]).toString());
  same(RZ.exporter.decode1251(Uint8Array.from({ length: 256 }, (_, i) => i)), py.dec, 'cp1251: декодирование всех байтов как в Python');
  const s = Array.from({ length: 0x500 - 32 }, (_, i) => String.fromCharCode(32 + i)).join('') + '\u2116\u2122\u20ac';
  same(hex(RZ.exporter.encode1251(s)), py.enc, 'cp1251: кодирование как в Python (неизвестное -> ?)');
  same(hex(RZ.exporter.encode1251('a😀b')), '613f62', 'cp1251: символ вне BMP -> один ?');
}

// ---------------------------------------------------------------- History
{
  for (const mode of ['428', '508']) {
    const want = rj(`out${mode}.json`);
    const rep = {};
    const r = RZ.exporter.station_history(readDb(), cfg, rd(`in${mode}.bin`), mode, rep);
    bytesEq(r.data, rd(`out${mode}.bin`), `History ${mode}: байты`);
    same([r.name, rep], [want.name, want.report], `History ${mode}: имя и отчёт`);
  }
  const r = RZ.exporter.station_history(readDb(), cfg, new TextEncoder().encode('"A"\t"B"\n"  "7B7"  "\tx\t1\t2\n'), '428', {});
  same(r.name, rj('out428b.json').name, 'History 428: суффикс из второй строки');
  // nan/inf/пусто: ключ не находится, не падает
  const t = RZ.exporter.station_history(readDb(), cfg, new TextEncoder().encode('h\r\nq,w,inf,5,e,r,t,y\r\nq,w,nan,5,e,r,t,y\r\n\r\n'), '508', {});
  same(new TextDecoder().decode(t.data), '"h",,,,,,,,Worker,Type of work\r\n"q",w,inf,5,"e",r,t,y,,\r\n"q",w,nan,5,"e",r,t,y,,\r\n', 'History: inf и nan');
  const e = RZ.exporter.station_history(readDb(), cfg, new Uint8Array(0), '508', {});
  same(new TextDecoder().decode(e.data), '\r\n', 'History: пустой файл');

  // пачка
  const pack = rd('pack.bin');
  const files = RZ.exporter.unpack_files(pack);
  bytesEq(RZ.exporter.pack_files(files), pack, 'pack_files(unpack_files(x)) == x');
  same(files.map((f) => f[0]), ['History 0512.txt', 'a/b\\History_0512.csv', '0512.TXT', '..', 'Файл:?*<1>.txt', '.hidden', 'history-', 'x.y.z'], 'unpack: имена');
  for (const mode of ['428', '508']) {
    const want = rj(`batch${mode}.json`);
    const b = await RZ.exporter.station_history_batch(readDb(), cfg, files, mode);
    same([b.name, b.report], [want.name, want.report], `batch ${mode}: имя архива и отчёт`);
    const z = await RZ.zip.read(b.data), pz = await RZ.zip.read(rd(`batch${mode}.zip`));
    same(z.names, pz.names, `batch ${mode}: имена в архиве`);
    for (const n of pz.names) bytesEq(await z.read(n), await pz.read(n), `batch ${mode}: ${n}`);
  }
  const bad = [new Uint8Array([0, 0, 0]), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), pack.subarray(0, pack.length - 5)];
  for (const b of bad) {
    let msg = null;
    try { RZ.exporter.unpack_files(b); } catch (e) { msg = e.message; }
    same(msg, 'Файлы переданы с ошибкой. Выберите их заново.', 'unpack: битые данные');
  }
  for (const f of [[], Array.from({ length: 501 }, () => ['a', new Uint8Array(0)])]) {
    let msg = null;
    try { await RZ.exporter.station_history_batch(readDb(), cfg, f, '508'); } catch (e) { msg = e.message; }
    ok(msg === 'Выберите файлы со станции.' || msg === 'Слишком много файлов за один раз: не больше 500.', 'batch: ограничения: ' + msg);
  }
  same(RZ.exporter._history_name('C:\\x\\История 1.csv', new Set()), 'history_История 1.csv', '_history_name: путь Windows');
}

// ---------------------------------------------------------------- таблицы
{
  for (const what of ['field', 'history']) {
    const r = RZ.exporter.table_csv(readDb(), what);
    bytesEq(r.data, rd(`csv_${what}.csv`), `CSV ${what}`);
    same(r.name, what === 'field' ? 'Оборудование на поле.csv' : 'История по пикетам.csv', `CSV ${what}: имя`);
  }
  // csv.writer: кавычки, переводы строк, пустые значения
  const evil = { read: (fn) => fn({ export_history: () => [['Дата', 'Линия', 'Пикет', 'ID старшего', 'ФИО старшего', 'Тип работ'],
    [['2026-01-02', 1, 2, null, 'a;b', 'x"y'], [null, 3, 4, 5, 'мн\nго\r\nстрок', ''], ['2026-12-31', 0, 0, 0, ' пробел ', 'ё']]] }) };
  const py = execFileSync('python3', ['-c', `
import csv, io, sys
buf = io.StringIO(); w = csv.writer(buf, delimiter=";", lineterminator="\\r\\n")
w.writerow(["Дата", "Линия", "Пикет", "ID старшего", "ФИО старшего", "Тип работ"])
w.writerow(["02.01.2026", 1, 2, None, "a;b", 'x"y'])
w.writerow(["", 3, 4, 5, "мн\\nго\\r\\nстрок", ""])
w.writerow(["31.12.2026", 0, 0, 0, " пробел ", "ё"])
sys.stdout.buffer.write(("\\ufeff" + buf.getvalue()).encode("utf-8"))`]);
  bytesEq(RZ.exporter.table_csv(evil, 'history').data, new Uint8Array(py), 'CSV: экранирование как csv.writer');
  let msg = null;
  try { RZ.exporter.table_csv(readDb(), 'zzz'); } catch (e) { msg = e.message; }
  same(msg, 'Неизвестная выгрузка', 'CSV: неизвестная выгрузка');

  // xlsx: части совпадают с Python (кроме «.0» у целых чисел и ширин - в JS число 20.0 неотличимо от 20)
  const norm = (s) => s.replace(/(<v>-?\d+)\.0(<\/v>)/g, '$1$2').replace(/(width="\d+)\.0"/g, '$1"');
  const cmpBook = async (got, wantBytes, label) => {
    const a = await RZ.zip.read(got), b = await RZ.zip.read(wantBytes);
    same(a.names, b.names, label + ': части');
    for (const n of b.names) {
      const x = await a.text(n), y = norm(await b.text(n));
      ok(x === y, `${label}: ${n} совпадает`);
      if (x !== y) { let i = 0; while (x[i] === y[i]) i++; console.log('   ', x.slice(Math.max(0, i - 60), i + 80), '\n   ', y.slice(Math.max(0, i - 60), i + 80)); }
    }
  };
  for (const what of ['field', 'history']) {
    const r = await RZ.exporter.table_xlsx(readDb(), what);
    await cmpBook(r.data, rd(`table_${what}.xlsx`), `XLSX ${what}`);
  }
  const j = await RZ.exporter.journal_xlsx(readDb());
  await cmpBook(j.data, rd('journal.xlsx'), 'Журнал XLSX');
  ok(/^Журнал_ГФО_\d\d_\d\d\.xlsx$/.test(j.name), 'имя журнала: ' + j.name);
  same(j.name, rj('names.json').journal_name, 'имя журнала как у Python');
}

// ---------------------------------------------------------------- импорт
function snapshot(db) {
  const r = db.repo, snap = {};
  for (const k of ['razm', 'podm', 'oo', 'snake', 'info', 'workers']) snap[k] = r.sheet_rows(k).map((x) => x[2]);
  snap.sps = r.sps;
  const where = new Map();
  for (const k of ['razm', 'podm']) r.sheets[k].forEach((row, i) => where.set(row.id, [k, i + 1]));
  const ev = [];
  for (const e of r.events) {
    const [sheet, pos] = where.get(e.src);
    for (let p = e.p1; p <= e.p2; p++) ev.push([e.line, p, e.date, e.type, e.wid, e.worker, e.seq, sheet, pos]);
  }
  ev.sort((a, b) => (a[7] < b[7] ? -1 : a[7] > b[7] ? 1 : a[8] - b[8] || a[1] - b[1]));
  snap.events = ev;
  return snap;
}
{
  const want = rj('import_journal.json');
  const db = writeDb();
  const res = await RZ.importer.import_journal(db, cfg, rd('journal.xlsx'));
  same(res, want.result, 'import_journal: результат');
  const snap = snapshot(db);
  for (const k of Object.keys(want.snap)) {
    if (k === 'sps') continue;
    same(snap[k], want.snap[k], `import_journal: данные ${k}`);
  }
  ok(snap.events.length > 1000, 'import_journal: события есть');
  ok(db.coords === null, 'import_journal: координаты сброшены');

  const wm = rj('import_macro.json');
  const dbm = writeDb();
  const rm = await RZ.importer.import_macro(dbm, cfg, rd('macro.xlsm'), false);
  same(rm, wm.result, 'import_macro: результат');
  const sm = snapshot(dbm);
  for (const k of Object.keys(wm.snap)) same(sm[k], wm.snap[k], `import_macro: данные ${k}`);
  const wt = rj('import_macro_tgo.json');
  const dbt = writeDb();
  const rt = await RZ.importer.import_macro(dbt, cfg, rd('macro.xlsm'), true);
  same(rt, wt.result, 'import_macro tgo_only: результат');
  same(dbt.repo.sps, wt.sps, 'import_macro tgo_only: SPS');

  // ошибки
  for (const [fn, args, text] of [
    [RZ.importer.import_journal, [rd('macro.xlsm')], 'В книге нет листов «Размотка» и «Подмотка». Проверьте, что выбран файл журнала.'],
    [RZ.importer.import_macro, [rd('journal.xlsx'), false], 'В книге нет листов: Таблица подмотки и размотки, ТГО'],
    [RZ.importer.import_macro, [rd('journal.xlsx'), true], 'В книге нет листов: ТГО'],
    [RZ.importer.import_journal, [new TextEncoder().encode('не книга')], 'Это не книга Excel (.xlsx или .xlsm).'],
  ]) {
    let msg = null, isVE = false;
    try { await fn(writeDb(), cfg, ...args); } catch (e) { msg = e.message; isVE = e instanceof RZ.ValidationError; }
    same([msg, isVE], [text, true], 'ошибка импорта: ' + text);
  }
  // round(x, 4) как в Python
  const py = JSON.parse(execFileSync('python3', ['-c', `
import json
v = [1.03125, 2.5, 0.00005, 1.00005, 1234.56785, -1.03125, -1.09375, 457982.123456, 0.1+0.2, 5704018.99995, 1e-9, 123456789.12345]
print(json.dumps([round(x, 4) for x in v]))`]).toString());
  // round4 не экспортируется: проверяем через книгу ТГО с теми же числами
  const vals = [1.03125, 2.5, 0.00005, 1.00005, 1234.56785, -1.03125, -1.09375, 457982.123456, 0.1 + 0.2, 5704018.99995, 1e-9, 123456789.12345];
  const rows = [[['Л', 1], ['П', 1], ['X', 1]]].concat(vals.map((v, i) => [i + 1, i + 1, v]));
  const xml = RZ.xlsx.sheet_xml([[['h', 1]]].concat(vals.map((v, i) => [0, 1, i + 1, v])), [5]);
  const bk = await RZ.xlsx.write_book([['ТГО', RZ.xlsx.sheet_xml(vals.map((v, i) => [null, 1, i + 1, v]), [5, 5, 5, 5])]]);
  const dbr = writeDb();
  await RZ.importer.import_macro(dbr, cfg, bk, true);
  same(dbr.repo.sps.map((r) => r[2]), py, 'ТГО: round(x, 4) как в Python');
}

// ---------------------------------------------------------------- сверка
{
  const sortRows = (r) => r.slice().sort((a, b) => JSON.stringify([a.date, a.type, a.line, a.p1, a.p2]) < JSON.stringify([b.date, b.type, b.line, b.p1, b.p2]) ? -1 : 1);
  for (const [file, json] of [['compare.xlsm', 'compare.json'], ['compare_hist.xlsm', 'compare_hist.json']]) {
    const want = rj(json);
    const got = await RZ.compare.compare(readDb(), cfg, rd(file));
    for (const k of ['rows_program', 'rows_book']) { got[k] = sortRows(got[k]); want[k] = sortRows(want[k]); }
    same(Object.keys(got).sort(), Object.keys(want).sort(), `compare ${file}: ключи`);
    for (const k of Object.keys(want)) same(got[k], want[k], `compare ${file}: ${k}`);
  }
  const ef = rj('excel_field.json');
  const m = RZ.compare.excel_field(ef.events);
  same(m.size, ef.field.length, 'excel_field: число пикетов');
  let bad = 0;
  for (const [l, p, v] of ef.field) { const g = m.get(l + ',' + p); if (!g || g[0] !== v[0] || g[1] !== v[1]) bad++; }
  same(bad, 0, 'excel_field: даты и типы совпадают');
  let msg = null;
  try { await RZ.compare.compare(readDb(), cfg, rd('journal.xlsx')); } catch (e) { msg = e.message; }
  same(msg, 'В книге нет листов «История подмотки и размотки» и «Оборудование на поле». Нужна книга «Контроль размотки».', 'compare: чужая книга');
}

console.log(`\nпройдено ${passed}, провалено ${failed}`);
process.exit(failed ? 1 : 0);
