// Тесты Excel-слоя: zip, xlsx (этап 1). Запуск: node tests/test_excel.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = '/tmp/claude-0/-home-claude/52abce27-64ed-5652-a5bf-b5b8690429c7/scratchpad/xl';
fs.mkdirSync(TMP, { recursive: true });
const HELPER = path.join(HERE, 'test_excel_helper.py');
const py = (...a) => execFileSync('python3', [HELPER, ...a], { stdio: 'inherit' });

let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('FAIL:', msg); } }
function eq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) passed++; else { failed++; console.log('FAIL:', msg, '\n  got ', x.slice(0, 300), '\n  want', y.slice(0, 300)); }
}
const sha = (u8) => crypto.createHash('sha256').update(u8).digest('hex');

const ctx = loadEngine(['zip', 'xlsx']);
const RZ = ctx.RZ;
class ValidationError extends Error {}
RZ.ValidationError = ValidationError;
const enc = new TextEncoder();

// ---------------------------------------------------------------- zip
{
  const d = path.join(TMP, 'zip'); fs.mkdirSync(d, { recursive: true });
  py('mkzips', d);
  const manifest = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
  // Python -> наш читатель
  for (const f of fs.readdirSync(d).filter((n) => n.startsWith('py_'))) {
    const z = await RZ.zip.read(new Uint8Array(fs.readFileSync(path.join(d, f))));
    eq([...z.names].sort(), Object.keys(manifest).sort(), f + ': имена');
    for (const n of z.names) {
      const data = await z.read(n);
      ok(sha(data) === manifest[n], f + ': содержимое ' + n);
      ok(data.length === z.size(n), f + ': size ' + n);
    }
    ok((await z.text('a.txt')) === 'hello', f + ': text');
  }
  // потоковое чтение большого файла
  {
    const z = await RZ.zip.read(new Uint8Array(fs.readFileSync(path.join(d, 'py_deflate.zip'))));
    const h = crypto.createHash('sha256');
    const r = z.stream('big.csv').getReader();
    for (;;) { const { done, value } = await r.read(); if (done) break; h.update(value); }
    ok(h.digest('hex') === manifest['big.csv'], 'stream big.csv');
  }
  // наш писатель -> Python
  const py0 = await RZ.zip.read(new Uint8Array(fs.readFileSync(path.join(d, 'py_deflate.zip'))));
  const files = [];
  for (const n of py0.names) files.push({ name: n, data: await py0.read(n) });
  fs.writeFileSync(path.join(d, 'js_deflate.zip'), await RZ.zip.write(files));
  fs.writeFileSync(path.join(d, 'js_store.zip'), await RZ.zip.write(files, { level: 0 }));
  const strFiles = files.slice(0, 1).concat([{ name: 'Ёж/ё.txt', data: 'строка' }]);
  const sm = await RZ.zip.write(strFiles);
  const back = await RZ.zip.read(sm);
  ok((await back.text('Ёж/ё.txt')) === 'строка', 'своя запись-чтение строки');
  py('checkzip', d);
  // пустой архив и мусор
  const empty = await RZ.zip.read(await RZ.zip.write([]));
  eq(empty.names, [], 'пустой архив');
  let thrown = false;
  try { await RZ.zip.read(enc.encode('не zip вообще, просто текст')); } catch (e) { thrown = e.message === 'zip'; }
  ok(thrown, 'не zip -> Error(zip)');
  eq(RZ.zip.crc32(enc.encode('123456789')), 0xCBF43926, 'crc32');
  console.log('zip: ok');
}

// ---------------------------------------------------------------- xlsx: писатель = Python
{
  const d = path.join(TMP, 'xlsx'); fs.mkdirSync(d, { recursive: true });
  const D = (iso) => ({ d: iso }), F = (f, c) => ({ f, c });
  const spec = { sheets: [
    { name: 'Лист & <1>', widths: [13, 10.5, 34.25], opts: { freeze_row: 4, filter_ref: 'A4:C8', heights: { 1: 24 } },
      rows: [[[F('"x"&A1', 'Строка & <тест>'), 3]], [], [['Подзаголовок', 4]], [['Дата', 1], ['Число', 1], ['Текст', 1]],
        [D('2024-02-29'), 5, 'a & b < c > d'], [null, 457982.25, '  пробелы  '], [[null, 5], [1.5, 5], ['', 2]],
        [D('1900-03-01'), -12, F('IF(A5="","--",1)', 7)], [true, false, F('A1', 2.5)], [0, 1e21, -0.001], [NaN, Infinity, 'я'],
        ['<tag>', 'multi\nline', 12345678901]] },
    { name: 'Пустой', widths: [5], opts: {}, rows: [] },
    { name: 'Без опций', widths: [8, 8], opts: { freeze_row: 1 }, rows: [[['A', 1], ['B', 1]], ['x', 2]] },
  ] };
  fs.writeFileSync(path.join(d, 'spec.json'), JSON.stringify(spec, (k, v) => (typeof v === 'number' && !isFinite(v) ? null : v)));
  // NaN/Infinity в json -> null; Python напишет пустую ячейку так же, как наш писатель для NaN
  py('xlsx', d);
  const X = RZ.xlsx;
  const dec = (c) => {
    if (c && typeof c === 'object' && !Array.isArray(c)) return 'd' in c ? new X.Date(c.d) : new X.Formula(c.f, c.c);
    if (Array.isArray(c)) return [dec(c[0]), c[1]];
    return c;
  };
  const sheets = spec.sheets.map((s) => [s.name, X.sheet_xml(s.rows.map((r) => r.map(dec)), s.widths, s.opts)]);
  // в JS-спеке сохраняем настоящие NaN/Infinity там, где Python получил null (пустая ячейка)
  sheets.forEach(([, xml], i) => {
    const want = fs.readFileSync(path.join(d, `py_sheet${i + 1}.xml`), 'utf8');
    ok(xml === want, `xml листа ${i + 1} совпадает с Python`);
    if (xml !== want) { fs.writeFileSync(path.join(d, `js_sheet${i + 1}.xml`), xml); }
  });
  const nanSheet = X.sheet_xml([[NaN, Infinity, -Infinity, [NaN, 1]]], [5]);
  ok(nanSheet.includes('<row r="1"><c r="D1" s="1"/></row>'), 'NaN/Infinity -> пустая ячейка');
  const book = await X.write_book(sheets);
  fs.writeFileSync(path.join(d, 'js_book.xlsx'), book);
  // тот же состав и содержимое частей, что у Python
  const pyZ = await RZ.zip.read(new Uint8Array(fs.readFileSync(path.join(d, 'py_book.xlsx'))));
  const jsZ = await RZ.zip.read(book);
  eq([...jsZ.names].sort(), [...pyZ.names].sort(), 'части книги');
  eq(jsZ.names, pyZ.names, 'порядок частей книги');
  for (const n of pyZ.names) ok((await pyZ.text(n)) === (await jsZ.text(n)), 'часть ' + n + ' совпадает');
  eq(await jsZ.text('xl/styles.xml'), X.STYLES, 'styles');
  // валидность XML и открытие Python-ом
  execFileSync('python3', ['-c', `
import sys, zipfile
from xml.dom import minidom
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
for n in z.namelist(): minidom.parseString(z.read(n))
print("xml ok", len(z.namelist()))`, path.join(d, 'js_book.xlsx')], { stdio: 'inherit' });

  // наш читатель на книге Python и на нашей
  for (const f of ['py_book.xlsx', 'js_book.xlsx']) {
    const wb = await X.open(new Uint8Array(fs.readFileSync(path.join(d, f))));
    eq(Object.keys(wb.sheets), ['Лист & <1>', 'Пустой', 'Без опций'], f + ': листы');
    const rows = await wb.rows('Лист & <1>', 'ABC');
    const m = Object.fromEntries(rows);
    eq(m[1], { A: 'Строка & <тест>' }, f + ': формула с t="str" (кэш)');
    eq(m[5], { A: '45351', B: '5', C: 'a & b < c > d' }, f + ': дата и текст');
    eq(m[6], { B: '457982.25', C: '  пробелы  ' }, f + ': пропуск пустой');
    eq(m[7], { B: '1.5' }, f + ': пустая строка со стилем');
    eq(m[8].A, '61', f + ': 1900-03-01');
    eq(m[11], { C: 'я' }, f + ': NaN');
    eq(m[12], { A: '<tag>', B: 'multi\nline', C: '12345678901' }, f + ': <>, перевод строки');
    eq(X.serial_to_iso(m[5].A), '2024-02-29', f + ': serial_to_iso');
    eq((await wb.rows('Пустой')).length, 0, f + ': пустой лист');
  }
  eq([RZ.xlsx.col_index('A'), RZ.xlsx.col_index('Z'), RZ.xlsx.col_index('AA'), RZ.xlsx.col_index('AZ')], [1, 26, 27, 52], 'col_index');
  eq([0, 25, 26, 27, 51, 52, 701, 702].map(X.col_letter), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'], 'col_letter');
  eq([X.serial_to_iso('45351.75'), X.serial_to_iso('1'), X.serial_to_iso('0')], ['2024-02-29', '1899-12-31', '1899-12-30'], 'serial_to_iso');
  console.log('xlsx writer: ok');
}

// ---------------------------------------------------------------- xlsx: читатель на рукописных частях
{
  const X = RZ.xlsx;
  const sst = '<?xml version="1.0"?><sst><si><t>Один &amp; два</t></si><si><r><t>Ча</t></r><r><t xml:space="preserve">сти</t></r></si><si><t>&#1103;&#x44F; &lt;b&gt;</t></si><si><t/></si></sst>';
  const sheetHead = '<?xml version="1.0"?><worksheet xmlns="x"><sheetData>';
  let body = '';
  body += '<row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c t="s" r="B1" s="3"><v>1</v></c><c s="2" r="C1" t="s"><v>2</v></c></row>';
  body += '<row r="2"><c r="A2"/><c r="B2" s="1"/><c r="C2" t="e"><v>#N/A</v></c><c r="D2"><v>42</v></c><c r="E2" t="inlineStr"><is><t>ин&amp;лайн</t></is></c><c r="F2" t="inlineStr"><is><r><t>а</t></r><r><t>б</t></r></is></c><c r="G2"><v></v></c><c r="H2" t="s"><v>3</v></c></row>';
  body += '<row r="3"/>';
  body += '<row r="4" ht="20"><c r="A4"><f>1+1</f><v>2</v></c><c r="I4"><v>9</v></c><c r="J4"><v>10</v></c></row>';
  // большой хвост: проверка разбиения на куски (> 4 МБ) со вставкой строк в разные места
  const N = 120000;
  for (let i = 0; i < N; i++) body += `<row r="${10 + i}"><c r="A${10 + i}"><v>${i}</v></c><c r="B${10 + i}" t="inlineStr"><is><t>строка номер ${i} ёё</t></is></c></row>`;
  const sheet = sheetHead + body + '</sheetData></worksheet>';
  ok(sheet.length > (1 << 22), 'лист больше одного куска');
  const mk = async (sheetXml) => X.open(await RZ.zip.write([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="Лист &amp; 1" sheetId="1" r:id="rId1"/><sheet sheetId="2" r:id="rId2" name="Второй"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Target="/xl/worksheets/s2.xml" Id="rId2"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: sst },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml }, { name: 'xl/worksheets/s2.xml', data: sheetHead + '<row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>' },
  ]));
  const wb = await mk(sheet);
  eq(wb.sheets, { 'Лист & 1': 'xl/worksheets/sheet1.xml', 'Второй': 'xl/worksheets/s2.xml' }, 'листы, атрибуты в разном порядке, абсолютный Target');
  const rows = await wb.rows('Лист & 1', 'ABCDEFGHI');
  eq(rows.length, 4 + N, 'число строк');
  eq(rows[0], [1, { A: 'Один & два', B: 'Часьти'.replace('сь', 'с'), C: 'яя <b>' }], 'общие строки, сущности, rich text');
  eq(rows[1], [2, { D: '42', E: 'ин&лайн', F: 'аб' }], 'пустые, ошибки, inline, пустой <v>, пустая общая строка');
  eq(rows[2], [3, {}], 'самозакрытая строка');
  eq(rows[3], [4, { A: '2', I: '9' }], 'отбор столбцов');
  eq(rows[4 + N - 1], [10 + N - 1, { A: String(N - 1), B: `строка номер ${N - 1} ёё` }], 'последняя строка');
  eq(rows[4 + 77777][1].B, `строка номер 77777 ёё`, 'строка из середины (кириллица на границе кусков)');
  eq(await (await mk(sheet)).rows('Второй', 'A'), [[1, { A: '7' }]], 'второй лист');
  eq((await wb.rows('Лист & 1', 'B')).slice(0, 1), [[1, { B: 'Часьти'.replace('сь', 'с') }]], 'один столбец');
  // ошибки
  for (const bad of [enc.encode('мусор'), await RZ.zip.write([{ name: 'a.txt', data: 'x' }])]) {
    let msg = null;
    try { await X.open(bad); } catch (e) { msg = e instanceof ValidationError ? e.message : 'другая: ' + e; }
    eq(msg, 'Это не книга Excel (.xlsx или .xlsm).', 'не книга');
  }
  eq([X.py_float(' 1e3 '), X.py_float('nan'), X.py_float('-inf'), X.py_float('1_0'), X.py_float(''), X.py_float('0x10'), X.py_float('1,5'), X.py_float('.5'), X.py_float('5.')], [1000, NaN, -Infinity, 10, undefined, undefined, undefined, 0.5, 5].map((v) => v), 'py_float');
  eq([X.py_int_float('2.9'), X.py_int_float('-2.9'), X.py_int_float('nan'), X.py_int_float('inf'), X.py_int_float('a')], [2, -2, undefined, undefined, undefined], 'py_int_float');
  console.log('xlsx reader: ok');
}

console.log(`\nпройдено ${passed}, провалено ${failed}`);
process.exit(failed ? 1 : 0);
