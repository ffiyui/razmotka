# -*- coding: utf-8 -*-
"""Общее для ui_*.py: запуск настоящего Python-сервера на нашей статике (в копии каталога), данные для проверки.
Запуск: python3 tests/ui_xxx.py. Рабочая копия сервера создаётся в UI_SCRATCH (по умолчанию /tmp/ui_scratch)."""
import json, math, os, shutil, subprocess, sys, time, urllib.request

ORIG = '/home/claude/razmotka'
STATIC = os.environ.get('UI_STATIC', '/home/claude/razmotka-ios')
SCRATCH = os.environ.get('UI_SCRATCH', '/tmp/ui_scratch')
SHOTS = os.environ.get('UI_SHOTS', SCRATCH + '/shots')
URL = 'http://127.0.0.1:8790/'
bad = []


def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond:
        bad.append(name)


def start_server():
    rz = SCRATCH + '/rz'
    shutil.rmtree(rz, ignore_errors=True)
    os.makedirs(SHOTS, exist_ok=True)
    shutil.copytree(ORIG, rz, ignore=shutil.ignore_patterns('data', 'logs', 'config.json', '__pycache__'))
    os.makedirs(rz + '/data'); os.makedirs(rz + '/logs')
    env = dict(os.environ, RAZ_STATIC=STATIC)
    srv = subprocess.Popen([sys.executable, 'run.py', '--no-window'], cwd=rz, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(URL + 'api/ping'); break
        except Exception:
            time.sleep(.25)
    return srv


def stop_server(srv):
    srv.terminate()
    try: srv.wait(5)
    except Exception: srv.kill()
    shutil.rmtree(SCRATCH + '/rz', ignore_errors=True)


def get(p):
    return json.loads(urllib.request.urlopen(URL + p).read())


def post(p, j):
    return json.loads(urllib.request.urlopen(urllib.request.Request(URL + p, data=json.dumps(j).encode(), headers={'Content-Type': 'application/json'})).read())


def seed():
    """14 профилей под углом 24 градуса, 2 старших, 12 строк размотки (проведены), черновик и подмотка."""
    rows = []; n = 0; A = math.radians(24)
    for k in range(14):
        for i in range(120):
            x = 457000 + i * 25 * math.cos(A) - k * 200 * math.sin(A); y = 5704000 + i * 25 * math.sin(A) + k * 200 * math.cos(A); n += 1
            rows.append({"id": None, "pos": n, "idx": n - 1, "v": [5001 + 8 * k, 1000 + i, round(x, 1), round(y, 1), 120]})
    post('api/sheet/save', {"name": "sps", "rows": rows})
    post('api/sheet/save', {"name": "workers", "rows": [{"id": None, "pos": 1, "idx": 0, "v": [7, "Иванов И. И.", None]}, {"id": None, "pos": 2, "idx": 1, "v": [9, "Петров П. П.", None]}]})
    rz = [["2026-10-0%d" % (1 + k % 5), "Иванов И. И." if k % 2 else "Петров П. П.", 5001 + 8 * k, 1000 + (k * 7) % 30, 1060 + (k * 11) % 55, None, None, None, None] for k in range(12)]
    post('api/sheet/save', {"name": "razm", "rows": [{"id": None, "pos": i + 1, "idx": i, "v": v} for i, v in enumerate(rz)]})
    post('api/sheet/apply', {"name": "razm", "force": True})
    post('api/sheet/save', {"name": "razm", "rows": [{"id": None, "pos": 20, "idx": 12, "v": ["2026-10-06", "Иванов И. И.", 5105, 1000, 1040, None, None, None, None]}]})
    post('api/sheet/save', {"name": "podm", "rows": [{"id": None, "pos": 1, "idx": 0, "v": ["2026-10-05", "Петров П. П.", 5009, 1007, 1030, None, None, None, None]}]})
    post('api/sheet/apply', {"name": "podm", "force": True})


def finish():
    print('\nПровалено: %d' % len(bad), bad if bad else '')
    sys.exit(1 if bad else 0)
