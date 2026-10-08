# -*- coding: utf-8 -*-
"""Обмен файлом проекта между настольной программой и телефоном (движок телефона запускается в Node).
Начальник отряда на ПК вносит задания и сохраняет файл; «телефон» загружает его, выполняет задание частично
и сохраняет свой файл; ПК показывает табло и принимает изменения.  Запуск: python3 tests/xproject.py"""
import copy, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.environ.get('RAZ_PC', '/home/claude/razmotka'))
from app import config, paths
from app.services import dxf, exporter, project, reports
from app.services import sheets as svc
from app.storage.db import Database

bad = []


def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond:
        bad.append(name)


d = tempfile.mkdtemp()
paths.DATA_DIR, paths.BACKUP_DIR = d, os.path.join(d, 'backups')
paths.UI_FILE, paths.PREFS_FILE = os.path.join(d, 'ui.json'), os.path.join(d, 'prefs.json')
db, cfg, cfile = Database(os.path.join(d, 'razmotka.db')), copy.deepcopy(config.DEFAULTS), os.path.join(d, 'config.json')
rows = lambda vs: [{"id": None, "pos": k + 1, "idx": k, "v": v} for k, v in enumerate(vs)]
svc.save_rows(db, 'sps', rows([[l, 100 + i, 457000 + 25 * i, 5704000 + 200 * k, 120] for k, l in enumerate((5001, 5009)) for i in range(60)]))
svc.save_rows(db, 'workers', rows([[1, 'Иванов И. И.', None]]))
svc.save_rows(db, 'topo', rows([[11, 'Топоров Т. Т.', None]]))
svc.save_rows(db, 'razm', rows([['2026-10-07', 'Иванов И. И.', 5001, 100, 109, None, None, None, None]]))
svc.apply(db, cfg, 'razm', True)
svc.save_rows(db, 'razb', rows([['2026-10-08', 'Топоров Т. Т.', 5001, 100, 119, None, None, None], ['2026-10-08', 'Топоров Т. Т.', 5009, 100, 109, None, None, None]]))
edges = [(457000, 5704000), (457100, 5704000), (457100, 5704200), (457000, 5704200)]
body = ''.join(f"72\n1\n10\n{a[0]}\n20\n{a[1]}\n11\n{b[0]}\n21\n{b[1]}\n" for a, b in zip(edges, edges[1:] + edges[:1]))
hatch = ("0\nSECTION\n2\nENTITIES\n0\nHATCH\n8\n0\n10\n0.0\n20\n0.0\n30\n0.0\n2\nSOLID\n70\n1\n71\n0\n91\n1\n92\n1\n93\n4\n" + body + "97\n0\n75\n0\n76\n1\n98\n0\n0\nENDSEC\n0\nEOF\n").encode()
dxf.upload(db, exporter.pack_files([('01_Аминов/001.dxf', hatch)]))
before = reports.summary(db, cfg)

chief, phone = os.path.join(d, 'chief.rzm'), os.path.join(d, 'phone.rzm')
with open(chief, 'wb') as f:
    f.write(project.export_project(db, cfg)[0])
out = subprocess.run(['node', os.path.join(HERE, 'test_project.mjs'), chief, phone], capture_output=True, text=True)
tail = [l for l in out.stdout.splitlines() if l.startswith(('FAIL', 'PC->phone', 'Провалено'))]
ok('движок телефона прочитал файл с ПК и выполнил свои проверки', out.returncode == 0, tail)
ok('на телефоне проект тот же: поле, задания, контуры', '"field":10' in out.stdout and '"razb":2' in out.stdout and '"dxf":1' in out.stdout, tail[:2])

rep = project.inspect(db, cfg, [('Топоров Т. Т. 08.10.2026 22ч55м.rzm', open(phone, 'rb').read())])
work = {w['sheet']: w for w in rep['changes']['work']}
ok('ПК читает файл с телефона: табло', (work['razb']['rows'], work['razb']['units'], work['razb']['who'], work['razm']['units'], work['razm']['who'][0]['name'])
   == (1, 12, [{'name': 'Топоров Т. Т.', 'rows': 1, 'units': 12}], 10, 'Иванов И. И.'), rep['changes']['work'])
ok('непройденный остаток заданием не приходит', work['razb']['tasks'] == 0, work['razb'])
ok('файл с телефона назван по исполнителю', rep['files'][0]['name'].startswith('Топоров Т. Т.') and rep['files'][0]['source'] == 'телефон')
ok('проверка ничего не меняет', reports.summary(db, cfg) == before)
res = project.apply(db, cfg, cfile, rep['token'], 'merge', ['journal'])
got = [(r[3][2], r[3][3], r[3][4], r[2], len(r) > 5) for r in svc.load(db, 'razb')['rows']]
ok('задание заменено фактом', got == [(5001, 100, 111, 0, True), (5009, 100, 109, 0, False)], got)
s = reports.summary(db, cfg)
ok('на поле и карту принятое не попало', (s['field'], s['staked'], s['drafts']['razm'], s['drafts']['razb']) == (10, 0, 1, 2), (s['field'], s['staked'], s['drafts']))
svc.apply(db, cfg, 'razm', True)
svc.apply(db, cfg, 'razb', True, [r[0] for r in svc.load(db, 'razb')['rows'] if len(r) > 5])
s = reports.summary(db, cfg)
ok('после кнопок всё в учёте', (s['field'], s['staked']) == (20, 12), (s['field'], s['staked']))

# файл с телефона годится и для замены проекта на чистом компьютере
d2 = tempfile.mkdtemp()
paths.DATA_DIR, paths.BACKUP_DIR = d2, os.path.join(d2, 'backups')
paths.UI_FILE, paths.PREFS_FILE = os.path.join(d2, 'ui.json'), os.path.join(d2, 'prefs.json')
db2, cfg2 = Database(os.path.join(d2, 'razmotka.db')), copy.deepcopy(config.DEFAULTS)
res = project.import_project(db2, cfg2, os.path.join(d2, 'config.json'), phone)
s = reports.summary(db2, cfg2)
ok('замена проекта файлом с телефона: выполненное остаётся выполненным', (res['rows']['sps'], s['field'], s['staked'], s['drafts']['razb'], res['dxf']) == (120, 20, 12, 1, 1), (res['rows'], s['field'], s['staked'], s['drafts']))

# только задания одного вида работ
tasks, name = project.export_project(db, cfg, ['journal'], 'razb')
rep = project.inspect(db2, cfg2, [(name, tasks)])
ok('файл «только задания»', name.startswith('Задания_Разбивка_') and rep['files'][0]['partial'] and rep['files'][0]['rows'].get('razm', 0) == 0 and not rep['single'], (name, rep['files'][0]['rows']))
try:
    project.apply(db2, cfg2, os.path.join(d2, 'config.json'), rep['token'], 'replace')
    ok('файлом с заданиями проект не заменить', False)
except Exception as e:
    ok('файлом с заданиями проект не заменить', 'только задания' in str(e), e)
print('\nПровалено: %d' % len(bad), bad if bad else '')
sys.exit(1 if bad else 0)
