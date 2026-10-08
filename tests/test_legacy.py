# -*- coding: utf-8 -*-
"""Файлы проекта любой версии читаются на всех платформах.
Программа для ПК делает файл: нынешний (база + journal.json), прежний (только база, формат 1), совсем старый
(база версии 4: у строк ещё нет постоянных номеров). Движок телефона читает каждый - со сжатием и без
DecompressionStream (старый Android WebView) - и получает те же строки и те же номера, что и ПК.
Файл телефона, записанный без сжатия (старый Android), читает ПК.
Запуск: python3 tests/test_legacy.py"""
import copy, io, json, os, sqlite3, subprocess, sys, tempfile, zipfile
sys.path.insert(0, os.environ.get('RAZ_PC', '/home/claude/razmotka'))
from app import config, paths
from app.services import project, reports, marks
from app.services import sheets as svc
from app.storage import db as storage
from app.storage.db import Database

HERE = os.path.dirname(os.path.abspath(__file__))
bad = []
def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra)[:400] if extra != '' else ''))
    if not cond: bad.append(name)

d = tempfile.mkdtemp()
paths.DATA_DIR, paths.BACKUP_DIR = d, os.path.join(d, 'backups')
paths.UI_FILE, paths.PREFS_FILE = os.path.join(d, 'ui.json'), os.path.join(d, 'prefs.json')
db, cfg = Database(os.path.join(d, 'razmotka.db')), copy.deepcopy(config.DEFAULTS)
rows = lambda vs: [{"id": None, "pos": k + 1, "idx": k, "v": v} for k, v in enumerate(vs)]
svc.save_rows(db, 'sps', rows([[l, 100 + i, 457000 + 25 * i + .5, 5704000 + 200 * k, 120] for k, l in enumerate((5001, 5009)) for i in range(400)]))
svc.save_rows(db, 'workers', rows([[1, 'Иванов И. И.', None], [2, 'Петров П. П.', None]]))
svc.save_rows(db, 'razm', rows([['2026-10-07', 'Иванов И. И.', 5001, 100, 150, None, None, None, None], ['2026-10-07', 'Иванов И. И.', 5001, 100, 150, None, None, None, None]]))
svc.apply(db, cfg, 'razm', True)
svc.save_rows(db, 'razb', rows([['2026-10-08', 'Петров П. П.', 5009, 100, 119, None, 'комментарий', None]]))
try:
    marks.save(db, {'x': 457100.5, 'y': 5704000, 'shape': 'flag', 'color': '#FF3B30', 'text': 'метка'})
    marks.save(db, {'x': 457200, 'y': 5704200.25, 'text': 'вторая'})
except Exception as e:
    print('метка не добавлена:', e)

def pc_rows(path):
    c = sqlite3.connect(path)
    out = {s: [(u, json.loads(v)) for u, v in c.execute("SELECT uid, data FROM sheet_rows WHERE sheet=? ORDER BY pos, id", (s,))] for s in ('razm', 'razb', 'workers')}
    c.close(); return out

def phone(path, mode=''):
    r = subprocess.run(['node', os.path.join(HERE, 'legacy_read.mjs'), path] + ([mode] if mode else []), capture_output=True, text=True)
    if r.returncode: return {'error': r.stderr[-800:]}
    return json.loads(r.stdout)

def same(j, want):
    got = {s: [(r['uid'], r['v']) for r in j['sheets'][s]] for s in want}
    return got == want, got

# ---- нынешний файл
cur = os.path.join(d, 'now.rzm'); open(cur, 'wb').write(project.export_project(db, cfg)[0])
want = pc_rows(os.path.join(d, 'razmotka.db'))
for mode in ('', 'nostream'):
    r = phone(cur, mode)
    good, got = same(r['journal'], want) if 'journal' in r else (False, r)
    ok('нынешний файл ПК читается телефоном' + (' без DecompressionStream' if mode else ''), good and r['applied'].get('summary', {}).get('field') == 51, r.get('applied', r))

# ---- файл формата 1: только база
def strip(src, dst, fmt=1, db_bytes=None):
    zi, zo = zipfile.ZipFile(src), zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
    for n in zi.namelist():
        if n == 'journal.json': continue
        data = zi.read(n)
        if n == 'manifest.json':
            m = json.loads(data); m['format'] = fmt; m.pop('parts', None); data = json.dumps(m, ensure_ascii=False).encode()
        if n == 'razmotka.db' and db_bytes is not None: data = db_bytes
        zo.writestr(n, data)
    zo.close()
LONG = 'длинный комментарий ' * 900                         # 34 КБ: запись не помещается в страницу базы
db1 = os.path.join(d, 'db1.db')
with zipfile.ZipFile(cur) as z: open(db1, 'wb').write(z.read('razmotka.db'))
c = sqlite3.connect(db1)
rid, data = c.execute("SELECT id, data FROM sheet_rows WHERE sheet='razb'").fetchone()
v = json.loads(data); v[6] = LONG; c.execute("UPDATE sheet_rows SET data=? WHERE id=?", (json.dumps(v, ensure_ascii=False), rid)); c.commit(); c.close()
old1 = os.path.join(d, 'old1.rzm'); strip(cur, old1, 1, open(db1, 'rb').read())
for mode in ('', 'nostream'):
    r = phone(old1, mode)
    good, got = same(r['journal'], pc_rows(db1)) if 'journal' in r else (False, r)
    ok('файл прежней версии (только база) читается телефоном' + (' без DecompressionStream' if mode else ''), good and r['applied'].get('summary', {}).get('field') == 51 and len(r['journal'].get('sps') or []) == 800, r.get('applied', r))
r = phone(old1)
ok('метки и длинный комментарий из базы (страницы переполнения)', len(r['journal'].get('marks') or []) == len(json.loads(zipfile.ZipFile(cur).read('journal.json')).get('marks') or [])
   and r['journal']['sheets']['razb'][0]['v'][6] == LONG, r['journal'].get('marks'))

# ---- база версии 4: без постоянных номеров; номера считаются по содержимому так же, как на ПК
v4 = os.path.join(d, 'v4.db')
with zipfile.ZipFile(cur) as z: open(v4, 'wb').write(z.read('razmotka.db'))
c = sqlite3.connect(v4)
c.execute("UPDATE sheet_rows SET uid=NULL, ts=NULL, origin=NULL"); c.execute("UPDATE marks SET uid=NULL")
for t in ('gone', 'dxf_layers', 'dxf_items', 'staked'): c.execute(f"DROP TABLE IF EXISTS {t}")
c.execute("PRAGMA user_version=4"); c.commit(); c.execute("VACUUM"); c.close()
old4 = os.path.join(d, 'old4.rzm'); strip(cur, old4, 1, open(v4, 'rb').read())
up = os.path.join(d, 'v4up.db'); open(up, 'wb').write(open(v4, 'rb').read()); Database(up)       # ПК обновляет базу сам
want4 = pc_rows(up)
c = sqlite3.connect(up); pc_marks = [u for (u,) in c.execute("SELECT uid FROM marks ORDER BY id")]; c.close()
for mode in ('', 'nostream'):
    r = phone(old4, mode)
    good, got = same(r['journal'], want4) if 'journal' in r else (False, r)
    ok('база версии 4: номера строк те же, что считает ПК' + (' без DecompressionStream' if mode else ''), good, (got, want4) if not good else '')
r = phone(old4)
ok('база версии 4: номера меток те же, что на ПК', [m[0] for m in r['journal'].get('marks') or []] == pc_marks, ([m[0] for m in r['journal'].get('marks') or []], pc_marks))
ok('ПК по-прежнему читает свои старые файлы', project.inspect(db, cfg, [('old4.rzm', open(old4, 'rb').read())])['files'][0]['name'] == 'old4.rzm')

# ---- файл телефона без сжатия (старый Android): ПК читает
r = subprocess.run(['node', '-e', f"""
import('{HERE}/load.mjs').then(async ({{loadEngine}}) => {{
  const RZ = loadEngine(['gk','sheets-core','rules','validation','config','store','svc-sheets','reports','tasks','zip','xlsx','importer','compare','exporter','underlay','sqlite','project','api'], {{CompressionStream: undefined, DecompressionStream: undefined}}).RZ;
  const cfg = RZ.config.from_saved(null), db = await RZ.Database.open(RZ.kv_memory(), cfg.rules.same_day);
  const bytes = new Uint8Array(require('fs').readFileSync('{cur}'));
  const rep = await RZ.project.inspect(db, cfg, [['now.rzm', bytes]]); RZ.project.apply(db, cfg, rep.token, 'replace', ['journal','sps']);
  const out = await RZ.project.export_project(db, cfg);
  require('fs').writeFileSync('{d}/phone_store.rzm', out.data);
}});"""], capture_output=True, text=True)
ok('телефон без CompressionStream сохраняет файл', r.returncode == 0 and os.path.exists(f'{d}/phone_store.rzm'), r.stderr[-400:])
if os.path.exists(f'{d}/phone_store.rzm'):
    zf = zipfile.ZipFile(f'{d}/phone_store.rzm')
    rep = project.inspect(db, cfg, [('phone.rzm', open(f'{d}/phone_store.rzm', 'rb').read())])
    ok('ПК читает файл телефона, записанный без сжатия', all(i.compress_type == 0 for i in zf.infolist()) and rep['files'][0]['source'] == 'телефон', rep['files'][0])

print('\nПровалено: %d' % len(bad), bad if bad else '')
sys.exit(1 if bad else 0)
