// Читает файл проекта движком телефона и печатает journal.json (для tests/test_legacy.py).
// node tests/legacy_read.mjs файл.rzm [nostream] - nostream: как на старом Android без DecompressionStream
import fs from 'node:fs';
import { loadEngine } from './load.mjs';
const [file, mode] = process.argv.slice(2);
const extra = mode === 'nostream' ? { DecompressionStream: undefined, CompressionStream: undefined } : {};
const RZ = loadEngine(['gk', 'sheets-core', 'rules', 'validation', 'config', 'store', 'svc-sheets', 'reports', 'tasks', 'zip', 'xlsx', 'importer', 'compare', 'exporter', 'underlay', 'sqlite', 'project', 'api'], extra).RZ;
const cfg = RZ.config.from_saved(null);
const db = await RZ.Database.open(RZ.kv_memory(), cfg.rules.same_day);
const ctx = { db, cfg };
const bytes = new Uint8Array(fs.readFileSync(file));
const zip = await RZ.zip.read(bytes);
let journal;
if (zip.has('journal.json')) journal = JSON.parse(await zip.text('journal.json'));
else journal = RZ.sqlite.journal(await zip.read('razmotka.db'));
// и полный путь: проверка файла и загрузка его в пустой телефон
const call = RZ.api && RZ.api.call ? RZ.api.call : null;
let applied = null;
try {
  const rep = await RZ.project.inspect(db, cfg, [[file.split('/').pop(), bytes]]);
  const res = await RZ.project.apply(db, cfg, rep.token, 'replace', ['journal', 'sps', 'dxf', 'settings']);
  applied = { ok: !!res, summary: RZ.reports.summary(db, cfg) };
} catch (e) { applied = { error: String(e && e.message || e) }; }
console.log(JSON.stringify({ journal, applied }));
