# -*- coding: utf-8 -*-
"""Перекрёстная проверка JS-движка и Python-версии: генерирует случайный сценарий работы с журналом,
выполняет его на настоящей Python-программе и сохраняет ожидаемые ответы. Тот же сценарий выполняет tests/xcheck.mjs.
Запуск: python3 tests/xcheck_gen.py <каталог> <seed> <schematic 0|1>"""
import json, os, random, sys, tempfile, datetime
sys.path.insert(0, "/home/claude/razmotka")
from app.core.models import ValidationError
from app import config
from app.storage.db import Database
from app.web import api, server

out_dir, seed, schematic = sys.argv[1], int(sys.argv[2]), sys.argv[3] == "1"
rnd = random.Random(seed)

NAMES = ["Иванов И.И.", "Петров П.П.", "Сидоров С.С.", "Кузнецов К.К.", "Смирнов А.А.", "Попов В.В.", "Ёлкин Е.Е.", "Яковлев Я.Я."]
DAYS = ["%02d.10.2026" % d for d in range(1, 13)]
LINES = list(range(1, 7))

def rows_work(n):
    out = []
    for _ in range(n):
        line = rnd.choice(LINES)
        a = rnd.randint(1, 40); b = min(40, a + rnd.randint(0, 9))
        if rnd.random() < .1: a, b = b, a
        name = rnd.choice(NAMES + (["Левый Л.Л."] if rnd.random() < .05 else []))
        v = [rnd.choice(DAYS), name, line, a, b, None, rnd.choice([None, "1", "2"]), rnd.choice([None, "заметка"]), None]
        if rnd.random() < .04: v[rnd.choice([0, 2, 3, 4])] = None          # недозаполнено
        if rnd.random() < .03: v[3] = "ъ"                                   # не число
        out.append(v)
    return out

ops = []
ops.append({"t": "load", "sheet": "info"})
ops.append({"t": "save", "sheet": "workers", "rows": [[i + 1, n, None] for i, n in enumerate(NAMES)]})
if not schematic:
    sps = []
    for l in LINES:
        for p in range(1, 41):
            if rnd.random() < .03: continue
            sps.append([l, p, round(457000 + p * 25 + l * 0.7 + rnd.random(), 2), round(5704000 + l * 200 - p * 0.5 + rnd.random(), 2), round(100 + rnd.random() * 9, 1)])
    ops.append({"t": "save", "sheet": "sps", "rows": sps})
else:
    ops.append({"t": "save", "sheet": "info", "edit": [[13, 25], [11, 200], [15, 8]]})
ops.append({"t": "save", "sheet": "info", "edit": [[4, 10]]})
for step in range(int(sys.argv[4]) if len(sys.argv) > 4 else 140):
    r = rnd.random()
    sheet = rnd.choice(["razm", "podm"])
    if r < .30:
        ops.append({"t": "save", "sheet": sheet, "rows": rows_work(rnd.randint(1, 6))})
    elif r < .52:
        ops.append({"t": "apply", "sheet": sheet, "force": rnd.random() < .7})
    elif r < .60:
        ops.append({"t": "undo", "sheet": sheet})
    elif r < .68:
        ops.append({"t": "unapply", "sheet": sheet, "pick": [rnd.random() for _ in range(rnd.randint(1, 4))]})
    elif r < .74:
        ops.append({"t": "delete", "sheet": sheet, "pick": [rnd.random() for _ in range(rnd.randint(1, 3))]})
    elif r < .80:
        ops.append({"t": "edit", "sheet": sheet, "pick": rnd.random(), "col": rnd.choice([0, 1, 2, 3, 4, 6, 7]),
                    "val": rnd.choice([rnd.choice(DAYS), rnd.choice(NAMES), rnd.randint(1, 6), rnd.randint(1, 40), "x", "", "12;5"])})
    elif r < .84:
        d1, d2 = sorted(rnd.sample(DAYS, 2)); ops.append({"t": "cleanup", "from": d1, "to": d2, "types": rnd.choice([[0], [1], [0, 1], []])})
    elif r < .88:
        ops.append({"t": "settings", "changes": rnd.choice([{"same_day": "razm_last"}, {"same_day": "podm_last"}, {"same_day": "entry_order"},
                    {"block_conflicts": rnd.random() < .3}, {"block_unknown_pickets": rnd.random() < .3}, {"max_interval": rnd.choice([5, 5000, 0])}])})
    elif r < .91:
        ops.append({"t": "save", "sheet": "oo", "rows": [[rnd.choice(LINES), rnd.randint(1, 40), rnd.choice([0, 1, 2]), "причина", None, rnd.choice(DAYS)]]})
    elif r < .93:
        ops.append({"t": "save", "sheet": "snake", "rows": [[rnd.choice(DAYS), "Иванов", rnd.choice(LINES), 3, 9, None, None]]})
    elif r < .94:
        ops.append({"t": "clear"})
    else:
        ops.append({"t": "snap"})
    if step % 9 == 8: ops.append({"t": "snap"})
ops.append({"t": "snap"})
json.dump(ops, open(os.path.join(out_dir, "ops.json"), "w"), ensure_ascii=False)

# ---- выполнение на Python ------------------------------------------------------
tmp = tempfile.mkdtemp()
cfg = json.loads(json.dumps(config.DEFAULTS))
db = Database(os.path.join(tmp, "x.db"), cfg["rules"]["same_day"])
ctx = server.Context(db, cfg, os.path.join(tmp, "config.json"), tmp)

def call(kind, path, arg):
    try:
        v = (api.GET if kind == "GET" else api.POST)[path](ctx, arg)
        if isinstance(v, api.Download): return {"download": v.data.decode("utf-8-sig") if path == "/api/export" else None, "name": v.name}
        return json.loads(json.dumps(v))
    except ValidationError as e:
        return {"error": str(e), "col": getattr(e, "col", None)}

def sheet_rows(name):
    return call("GET", "/api/sheet", {"name": name}).get("rows", [])

def run(op):
    t = op["t"]
    if t == "load": return call("GET", "/api/sheet", {"name": op["sheet"]})
    if t == "save":
        name = op["sheet"]; cur = sheet_rows(name)
        if "edit" in op:
            rows = []
            for i, val in op["edit"]:
                row = cur[i]; v = list(row[3]); v[1] = val
                rows.append({"id": row[0], "pos": row[1], "idx": i, "v": v})
            return call("POST", "/api/sheet/save", {"name": name, "rows": rows})
        rows = [{"id": None, "pos": len(cur) + k + 1, "idx": len(cur) + k, "v": v} for k, v in enumerate(op["rows"])]
        return call("POST", "/api/sheet/save", {"name": name, "rows": rows})
    cur = sheet_rows(op.get("sheet", "razm"))
    ids = lambda: sorted({cur[int(p * len(cur))][0] for p in op["pick"]}) if cur else []
    if t == "apply": return call("POST", "/api/sheet/apply", {"name": op["sheet"], "force": op["force"]})
    if t == "undo": return call("POST", "/api/sheet/undo", {"name": op["sheet"]})
    if t == "unapply": return call("POST", "/api/sheet/unapply", {"name": op["sheet"], "ids": ids()})
    if t == "delete": return call("POST", "/api/sheet/delete", {"name": op["sheet"], "ids": ids()})
    if t == "edit":
        if not cur: return None
        row = cur[int(op["pick"] * len(cur))]; v = list(row[3]); v[op["col"]] = op["val"]
        return call("POST", "/api/sheet/save", {"name": op["sheet"], "rows": [{"id": row[0], "pos": row[1], "idx": cur.index(row), "v": v}]})
    if t == "cleanup": return call("POST", "/api/cleanup", {"from": op["from"], "to": op["to"], "types": op["types"]})
    if t == "settings": return call("POST", "/api/settings", op["changes"])
    if t == "clear": return call("POST", "/api/clear", {})
    if t == "snap":
        s = {"summary": call("GET", "/api/summary", {}), "field": call("GET", "/api/field", {}), "check": call("GET", "/api/check", {}),
             "stats": call("GET", "/api/stats", {"from": "2026-10-01", "to": "2026-10-31"}),
             "stats2": call("GET", "/api/stats", {"from": "2026-10-03", "to": "2026-10-08"}),
             "period": call("GET", "/api/period", {"from": "2026-10-03", "to": "2026-10-09"}),
             "export_field": call("GET", "/api/export", {"what": "field", "fmt": "csv"}),
             "export_history": call("GET", "/api/export", {"what": "history", "fmt": "csv"}),
             "razm": call("GET", "/api/sheet", {"name": "razm"}), "podm": call("GET", "/api/sheet", {"name": "podm"})}
        return s
    raise ValueError(t)

res = [run(op) for op in ops]
json.dump(res, open(os.path.join(out_dir, "expected.json"), "w"), ensure_ascii=False)
print("ops:", len(ops), "snapshots:", sum(1 for o in ops if o["t"] == "snap"))
