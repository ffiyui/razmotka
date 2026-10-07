# -*- coding: utf-8 -*-
"""Python-сторона перекрёстных проверок Excel-слоя: python3 tests/test_excel_helper.py <команда> <каталог> ..."""
import hashlib
import io
import json
import os
import random
import sys
import zipfile

sys.path.insert(0, "/home/claude/razmotka")
from app.services import xlsx_writer as W  # noqa: E402


class Sink:
    """Поток без seek/tell: zipfile пишет data descriptor."""
    def __init__(self):
        self.buf = io.BytesIO()

    def write(self, b):
        return self.buf.write(b)

    def flush(self):
        pass


def mkzips(d):
    rnd = random.Random(7)
    text = ("Кириллица строка данных 1234567890\n" * 5000).encode()
    noise = bytes(rnd.getrandbits(8) for _ in range(300000))
    big = b"".join(b"%d;%d;abc\n" % (i, i * 7) for i in range(3_000_000))   # ~35 МБ
    files = {"a.txt": b"hello", "пусто.txt": b"", "папка/Файл №1.csv": text, "noise.bin": noise, "big.csv": big}
    manifest = {n: hashlib.sha256(v).hexdigest() for n, v in files.items()}
    json.dump(manifest, open(os.path.join(d, "manifest.json"), "w"))
    for tag, comp in (("deflate", zipfile.ZIP_DEFLATED), ("store", zipfile.ZIP_STORED)):
        with zipfile.ZipFile(os.path.join(d, f"py_{tag}.zip"), "w", comp) as z:
            for n, v in files.items():
                z.writestr(n, v)
            if tag == "deflate":
                z.comment = "комментарий в конце".encode()
    s = Sink()
    with zipfile.ZipFile(s, "w", zipfile.ZIP_DEFLATED) as z:
        for n, v in files.items():
            with z.open(n, "w") as f:
                f.write(v)
    open(os.path.join(d, "py_descriptor.zip"), "wb").write(s.buf.getvalue())
    with zipfile.ZipFile(os.path.join(d, "py_zip64.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        for n, v in files.items():
            with z.open(n, "w", force_zip64=True) as f:
                f.write(v)


def checkzip(d):
    manifest = json.load(open(os.path.join(d, "manifest.json")))
    for name in sorted(os.listdir(d)):
        if not name.startswith("js_"):
            continue
        with zipfile.ZipFile(os.path.join(d, name)) as z:
            assert z.testzip() is None, name
            got = {n: hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}
        assert got == manifest, (name, set(got) ^ set(manifest))
        print("ok", name)


def decode(c):
    if isinstance(c, dict):
        if "d" in c:
            return W.Date(c["d"])
        return W.Formula(c["f"], c["c"])
    if isinstance(c, list):
        return (decode(c[0]), c[1])
    return c


def xlsx(d):
    spec = json.load(open(os.path.join(d, "spec.json")))
    sheets = []
    for s in spec["sheets"]:
        rows = [[decode(c) for c in r] for r in s["rows"]]
        kw = dict(s["opts"])
        if "heights" in kw:
            kw["heights"] = {int(k): v for k, v in kw["heights"].items()}
        sheets.append((s["name"], W.sheet_xml(rows, s["widths"], **kw)))
    for i, (_, x) in enumerate(sheets, 1):
        open(os.path.join(d, f"py_sheet{i}.xml"), "w", encoding="utf8").write(x)
    open(os.path.join(d, "py_book.xlsx"), "wb").write(W.write_book(sheets))


# ---------------------------------------------------------------- этап 2: база, выгрузки, импорт, сверка
def mkdata(d):
    """Строит базу, прогоняет эталонные выгрузки Python и сбрасывает в каталог всё, что нужно JS-тесту."""
    import copy
    import datetime
    import tempfile
    from app import config
    from app.core import sheets as sh
    from app.services import compare, exporter, importer, reports
    from app.services import sheets as svc
    from app.storage.db import Database

    rnd = random.Random(11)
    tmp = tempfile.mkdtemp()
    db = Database(os.path.join(tmp, "t.db"))
    cfg = copy.deepcopy(config.DEFAULTS)
    names = [(1, "Иванов И. И."), (2, "Петров П. П."), (3, "Сидорова А. В."), (4, "Ёлкин Ю. Ё."), (7, 'Кузя "К." ; мл.')]
    svc.save_rows(db, "workers", [{"id": None, "pos": i, "idx": i - 1, "v": [a, b, None]} for i, (a, b) in enumerate(names, 1)])
    svc.load(db, "info")
    pos = [0]

    def put(sheet, rows):
        out = []
        for v in rows:
            pos[0] += 1
            out.append({"id": None, "pos": pos[0], "idx": pos[0], "v": v})
        return svc.save_rows(db, sheet, out)

    def row(day, worker, line, p1, p2, akb=None, note=None):
        date = (datetime.date(2026, 9, 1) + datetime.timedelta(days=day)).isoformat()
        return [date, worker, line, p1, p2, None, akb, note, None]

    def rnd_rows(n, d0, d1):
        rows = []
        for _ in range(n):
            a = rnd.randint(100, 400)
            rows.append(row(rnd.randint(d0, d1), rnd.choice(names)[1], rnd.randint(5001, 5010), a, a + rnd.randint(-5, 30),
                            rnd.choice([None, "АКБ-1", "акб №5"]), rnd.choice([None, "прим & <тест>", "ёж"])))
        return rows

    put("razm", rnd_rows(160, 0, 20))
    svc.apply(db, cfg, "razm", True)
    put("podm", rnd_rows(70, 10, 25))
    svc.apply(db, cfg, "podm", True)
    put("razm", rnd_rows(30, 22, 28))
    svc.apply(db, cfg, "razm", True)
    # черновики: годные и негодные
    bad = [row(3, "Неизвестный", 5001, 100, 105), row(3, "Иванов И. И.", 5001, None, 105),
           row(4, "Иванов И. И.", 99999, 100, 105, None, "линия"), row(5, "Петров П. П.", 5002, 100, 9000)]
    put("razm", rnd_rows(8, 26, 29) + bad[:2])
    put("podm", rnd_rows(6, 26, 29) + bad[2:3])
    put("razm", [[None] * 9])
    put("oo", [[5001, 120, 0, "утеряно", "прим", "2026-09-10"], [5002, 130, 1, None, None, None]])
    put("snake", [["2026-09-05", "Иванов И. И.", 5003, 10, 15, None, "змейка"]])
    with db.write() as repo:
        sps = []
        for line in range(5001, 5011):
            for p in range(100, 461):
                sps.append((line, p, 457000.0 + (p - 100) * 25, 5700000.0 + (line - 5001) * 200 + (p % 7) * 0.25, 120.5 + p % 3))
        repo.replace_sps(sps)
    db.coords = None

    same = cfg["rules"]["same_day"]
    dump = {"sheets": {}, "meta": {k: sh.SHEETS[k].meta() for k in sh.ORDER}, "info_rules": {str(k): list(v) for k, v in sh.INFO_RULES.items()},
            "last_events": {}, "last_events_full": {}}
    with db.read() as repo:
        for k in sh.ORDER:
            dump["sheets"][k] = [list(r) for r in repo.sheet_rows(k)]
        for rule in config.SAME_DAY_RULES:
            dump["last_events"][rule] = [list(r) for r in repo.last_events(rule)]
            dump["last_events_full"][rule] = [list(r) for r in repo.last_events_full(rule)]
        dump["field_rows"] = [list(r) for r in repo.field_rows()]
        dump["totals"] = repo.totals()
        head, rows = repo.export_history()
        dump["export_history"] = [head, [list(r) for r in rows]]
        c = reports.coords(db, repo)
        dump["schematic"] = c.schematic
        dump["xy"] = {f"{r[0]},{r[1]}": (list(c.xy(r[0], r[1])) if c.xy(r[0], r[1]) else None) for r in repo.field_rows()}
        dump["party"] = svc.party(repo)
    json.dump(dump, open(os.path.join(d, "dump.json"), "w"), ensure_ascii=False)
    json.dump(cfg, open(os.path.join(d, "cfg.json"), "w"), ensure_ascii=False)

    def w(name, data):
        open(os.path.join(d, name), "wb").write(data)

    # ---- History для станции
    last = {(r[0], r[1]) for r in dump["last_events"][same]}
    keys = sorted(last)
    def pick():
        return rnd.choice(keys) if rnd.random() < 0.8 else (rnd.randint(1, 9999), rnd.randint(1, 9999))
    def fio(): return rnd.choice(["Иванов", "Ёжик", "Щука ъ", "x\u4f60y", "plain", "Ѓ"])
    h428 = ["Line\tName\tX\tY\tZ\tA\tB\tC\tD\tE"]
    h508 = ["Line,Point,Name,X,Y,Z,A,B"]
    for i in range(120):
        l, p = pick()
        h428.append("\t".join(['"%s"' % (5000 + i), "п%d" % i, str(l) + rnd.choice(["", ".0", " ", "e0"]), str(p), fio(), "5", "6", "7", "кол-%d" % i, "x"][:rnd.choice([10, 10, 10, 9, 5])]))
        h508.append(",".join([fio(), str(i), str(l), rnd.choice([str(p), str(p) + ".0", " %d " % p, "abc", "nan", ""]), fio(), "1", "2", "3"][:rnd.choice([8, 8, 8, 3])]))
    def join(lines, seps):
        out = ""
        for ln in lines:
            out += ln + rnd.choice(seps)
        return out
    raw428 = join(h428[:2] + ["", "   "] + h428[2:], ["\r\n", "\n", "\r", "\r\n\r\n"]).replace("x\u4f60y", "x\u4f60y")
    raw508 = join(h508[:1] + [""] + h508[1:], ["\r\n", "\n", "\x0b", "\x0c", "\x1c", "\x85", "\u2028"])
    in428 = raw428.encode("cp1251", "replace") + b"\x98\r\n\x98,\xff\r\n"
    in508 = raw508.encode("cp1251", "replace") + b"\r\n\x98\x98"
    w("in428.bin", in428)
    w("in508.bin", in508)
    for mode, data in (("428", in428), ("508", in508)):
        rep = {}
        out, name = exporter.station_history(db, cfg, data, mode, rep)
        w(f"out{mode}.bin", out)
        json.dump({"name": name, "report": rep}, open(os.path.join(d, f"out{mode}.json"), "w"))
    # 428 с кавычкой в имени для суффикса
    rep = {}
    out, name = exporter.station_history(db, cfg, '"A"\t"B"\n"  "7B7"  "\tx\t1\t2\n'.encode(), "428", rep)
    json.dump({"name": name, "report": rep}, open(os.path.join(d, "out428b.json"), "w"))
    # пачка
    batch = [("History 0512.txt", in428), ("a/b\\History_0512.csv", in508), ("0512.TXT", in428), ("..", in508),
             ("Файл:?*<1>.txt", in508), (".hidden", in428), ("history-", in508), ("x.y.z", in428), ("", in508)]
    batch = [b for b in batch if b[0]]
    w("pack.bin", exporter.pack_files(batch))
    for mode in ("428", "508"):
        data, name, rep = exporter.station_history_batch(db, cfg, batch, mode)
        w(f"batch{mode}.zip", data)
        json.dump({"name": name, "report": rep}, open(os.path.join(d, f"batch{mode}.json"), "w"), ensure_ascii=False)
    # ---- таблицы
    for what in ("field", "history"):
        data, name = exporter.table_csv(db, what)
        w(f"csv_{what}.csv", data)
        data, name = exporter.table_xlsx(db, what)
        w(f"table_{what}.xlsx", data)
    data, name = exporter.journal_xlsx(db)
    w("journal.xlsx", data)
    json.dump({"journal_name": name}, open(os.path.join(d, "names.json"), "w"))

    # ---- импорт журнала: Python читает собственный файл в чистую базу
    def snapshot(db2):
        with db2.read() as repo:
            snap = {k: [r[2] for r in repo.sheet_rows(k)] for k in sh.JOURNAL}
            snap["sps"] = [r[2] for r in repo.sheet_rows("sps")]
            ev = repo.c.execute("SELECT e.line,e.picket,e.date,e.type,e.wid,e.worker,e.seq,r.sheet,"
                                "(SELECT COUNT(*) FROM sheet_rows q WHERE q.sheet=r.sheet AND (q.pos<r.pos OR (q.pos=r.pos AND q.id<r.id)))+1 "
                                "FROM events e JOIN sheet_rows r ON r.id=e.src ORDER BY 8,9,e.picket").fetchall()
            snap["events"] = [list(e) for e in ev]
        return snap

    def fresh():
        return Database(os.path.join(tempfile.mkdtemp(), "n.db"))
    jfile = os.path.join(d, "journal.xlsx")
    db2 = fresh()
    res = importer.import_journal(db2, cfg, jfile)
    json.dump({"result": res, "snap": snapshot(db2)}, open(os.path.join(d, "import_journal.json"), "w"), ensure_ascii=False)

    # ---- книга-макрос
    with db.read() as repo:
        events = repo.c.execute("SELECT DISTINCT date,line,picket,type,worker FROM events ORDER BY date,line,picket").fetchall()
        razm = [r[2] for r in repo.sheet_rows("razm")]
        podm = [r[2] for r in repo.sheet_rows("podm")]
    H = lambda t: (t, W.HEADER)
    inter = [[H("Дата"), H("Линия"), H("От"), H("До"), H("К"), H("ФИО"), H("К"), H("Тип")]]
    # лист макроса: A дата, B линия, C, D пикеты, F ФИО, H тип
    for typ, rows in (("Размотка", razm), ("Подмотка", podm)):
        for v in rows:
            if None in (v[0], v[2], v[3], v[4]):
                continue
            inter.append([W.Date(v[0]), v[2], v[3], v[4], None, v[1], None, typ])
    inter.append([W.Date("2026-09-30"), 5001, "abc", 4, None, "Иванов И. И.", None, "Размотка"])     # мусор: пропуск
    inter.append([W.Date("2026-09-30"), 5001, 10.0, 12, None, "Неизвестный", None, "Размотка"])       # черновик: нет в ID старших
    inter.append([W.Date("2026-09-30"), 5001, 10, 12, None, None, None, "Подмотка"])                   # черновик: нет ФИО
    inter.append([W.Date("2026-09-30"), 5001, 10, 12, None, "Иванов И. И.", None, "Другое"])          # пропуск
    tgo = [[H("№"), H("Линия"), H("Пикет"), H("X"), H("Y"), H("Z")]]
    for i, (line, p, x, y, z) in enumerate(sps[:600], 1):
        tgo.append([i, line, p, x + 0.123456 * (i % 3), y + 0.00005 * (i % 5) + 1 / 3, None if i % 11 == 0 else z])
    tgo.append([0, "x", 5, 1, 2, 3])
    tgo.append([0, 5011, 100, "н/д", 2.5, 1e3])
    wk = [[H("ID"), H("ФИО")]] + [[a, b] for a, b in names] + [["x", "нет"], [9, None]]
    book = W.write_book([("Таблица подмотки и размотки", W.sheet_xml(inter, [10] * 8)), ("ТГО", W.sheet_xml(tgo, [10] * 6)),
                         ("ID старших", W.sheet_xml(wk, [10, 20]))])
    w("macro.xlsm", book)
    dbm = fresh()
    res = importer.import_macro(dbm, cfg, os.path.join(d, "macro.xlsm"))
    with dbm.read() as repo:
        sp = [list(r[2]) for r in repo.sheet_rows("sps")]
    snap = snapshot(dbm)
    snap["sps"] = sp
    json.dump({"result": res, "snap": snap}, open(os.path.join(d, "import_macro.json"), "w"), ensure_ascii=False)
    dbt = fresh()
    res = importer.import_macro(dbt, cfg, os.path.join(d, "macro.xlsm"), True)
    with dbt.read() as repo:
        sp = [list(r[2]) for r in repo.sheet_rows("sps")]
    json.dump({"result": res, "sps": sp}, open(os.path.join(d, "import_macro_tgo.json"), "w"), ensure_ascii=False)

    # ---- сверка: книга «Контроль размотки» по состоянию базы с намеренными расхождениями
    field_rows = dump["field_rows"]
    hist = [[W.Date(e[0]), e[1], e[2], None, e[4], "Размотка" if e[3] == 1 else "Подмотка"] for e in events]
    hist = [h for i, h in enumerate(hist) if i % 41 != 0]                       # потеряны записи книги
    hist.append([W.Date("2026-09-28"), 5009, 450, None, "Иванов И. И.", "Размотка"])      # лишняя размотка
    hist.append([W.Date("2026-09-29"), 5010, 451, None, "Иванов И. И.", "Подмотка"])      # подмотка без размотки в программе
    hist.append([W.Date("2026-09-29"), 5010, 451, None, "Иванов И. И.", "Подмотка"])      # полный повтор
    hist.append([W.Date("2026-09-29"), 5010, 452, None, "x", "Разное"])                   # пропуск
    fld = [[H("Дата"), H("Линия"), H("Пикет"), H("G"), H("Старший")]]
    for i, (line, p, date, worker, wid) in enumerate(field_rows):
        if i % 17 == 0:
            continue
        fld.append([W.Date(date), line, p, None, worker])
    for p in range(300, 310):
        fld.append([W.Date("2026-09-20"), 5004, p, None, "Петров П. П."])
    fld.append([None, 5004, 320, None, "без даты"])
    ivs = []
    for typ, rows in (("Размотка", razm), ("Подмотка", podm)):
        for i, v in enumerate(rows):
            if None in (v[0], v[2], v[3], v[4]) or i % 13 == 0:
                continue
            ivs.append([W.Date(v[0]), v[2], v[3], v[4], None, None, None, typ])
    ivs.append([W.Date("2026-09-01"), 5001, 205, 200, None, None, None, "Подмотка"])
    cmpb = W.write_book([("История подмотки и размотки", W.sheet_xml([[H("Дата"), H("Л"), H("П"), H("Г"), H("Старший"), H("Тип")]] + hist, [10] * 6)),
                         ("Оборудование на поле", W.sheet_xml(fld, [10] * 5)),
                         ("Таблица подмотки и размотки", W.sheet_xml([[H("Дата")] + [H(" ")] * 7] + ivs, [10] * 8))])
    w("compare.xlsm", cmpb)
    json.dump(compare.compare(db, cfg, os.path.join(d, "compare.xlsm")), open(os.path.join(d, "compare.json"), "w"), ensure_ascii=False)
    # книга только с историей
    only = W.write_book([("История подмотки и размотки", W.sheet_xml([[H("Дата"), H("Л"), H("П"), H("Г"), H("Старший"), H("Тип")]] + hist[:300], [10] * 6))])
    w("compare_hist.xlsm", only)
    json.dump(compare.compare(db, cfg, os.path.join(d, "compare_hist.xlsm")), open(os.path.join(d, "compare_hist.json"), "w"), ensure_ascii=False)
    # excel_field
    ev = [list(e) for e in events]
    ef = compare.excel_field([tuple(e) for e in events])
    json.dump({"events": ev, "field": [[k[0], k[1], list(v)] for k, v in ef.items()]}, open(os.path.join(d, "excel_field.json"), "w"), ensure_ascii=False)
    print("данные готовы:", len(dump["field_rows"]), "на поле,", len(events), "событий")


if __name__ == "__main__":
    {"mkzips": mkzips, "checkzip": checkzip, "xlsx": xlsx, "mkdata": mkdata}[sys.argv[1]](sys.argv[2])
