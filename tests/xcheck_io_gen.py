# -*- coding: utf-8 -*-
"""Эталон Python для tests/test_engine_real.mjs: тот же журнал загружается в настоящую Python-базу, затем снимаются выгрузки.
Запуск: python3 tests/xcheck_io_gen.py <каталог с данными test_excel_io>"""
import json, os, sys, tempfile
sys.path.insert(0, "/home/claude/razmotka")
from app import config
from app.services import compare, exporter, importer
from app.storage.db import Database

D = sys.argv[1]
cfg = json.load(open(os.path.join(D, "cfg.json")))
dump = json.load(open(os.path.join(D, "dump.json")))
tmp = tempfile.mkdtemp()
db = Database(os.path.join(tmp, "x.db"), cfg["rules"]["same_day"])
res = importer.import_journal(db, cfg, os.path.join(D, "journal.xlsx"))
with db.write() as repo:
    repo.replace_sps([tuple(x[2]) for x in dump["sheets"]["sps"]])
db.coords = None
out = {"import": res}
with db.read() as repo:
    out["totals"] = repo.totals()
    out["field_rows"] = repo.field_rows()
    out["last_events"] = {r: repo.last_events(r) for r in config.SAME_DAY_RULES}
    out["last_events_full"] = {r: repo.last_events_full(r) for r in config.SAME_DAY_RULES}
    head, rows = repo.export_history(); out["export_history"] = [head, [list(r) for r in rows]]
for mode in ("428", "508"):
    data, name = exporter.station_history(db, cfg, open(os.path.join(D, f"in{mode}.bin"), "rb").read(), mode, rep := {})
    open(os.path.join(D, f"real_out{mode}.bin"), "wb").write(data); out[f"hist{mode}"] = [name, rep]
for what in ("field", "history"):
    open(os.path.join(D, f"real_csv_{what}.csv"), "wb").write(exporter.table_csv(db, what)[0])
out["compare"] = compare.compare(db, cfg, os.path.join(D, "compare.xlsm"))
json.dump(out, open(os.path.join(D, "real.json"), "w"), ensure_ascii=False, default=list)
print("ok", out["totals"])
