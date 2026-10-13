# -*- coding: utf-8 -*-
"""GeoLink для ПК: чтение контуров из файлов DXF (из прежней программы для ПК, без изменений логики).
Контуры из файлов DXF на карте: поля землепользователей, границы, любые линии.

Файл DXF читается напрямую, без сторонних библиотек. Понимаются штриховки (HATCH), полилинии, отрезки,
окружности, дуги, точки и подписи (TEXT, MTEXT). Координаты - в той же системе, что X и Y листа SPS.

Как получаются названия:
  слой на карте - название папки, в которой лежит файл («01_Аминов» - владелец); если папки нет -
                  слой чертежа DXF; если и он безымянный («0») - название, заданное при загрузке;
  контур        - подпись (TEXT) внутри контура; если её нет - слой чертежа; если и он безымянный -
                  имя файла («001» - номер поля).
Повторная загрузка того же файла в тот же слой заменяет прежние контуры с тем же названием."""
import io
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import zipfile



class ValidationError(Exception):
    """Ошибка в файле: текст понятен пользователю"""

MAX_FILES = 3000
MAX_BYTES = 300 * 1024 * 1024
MAX_POINTS = 400_000                     # точек в одном файле
MAX_LAYERS = 500
PLAIN_LAYERS = {"0", "defpoints", ""}    # слои чертежа, название которых ничего не говорит
DEFAULT_LAYER = "Контуры DXF"
COLORS = ("#34C759", "#FF9F0A", "#0A84FF", "#FF375F", "#BF5AF2", "#64D2FF", "#FFD60A", "#AC8E68", "#30B0C7", "#FF6482")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


# ---------------------------------------------------------------- чтение файла
def _decode(data):
    if data[:22].startswith(b"AutoCAD Binary DXF"):
        raise ValidationError("двоичный DXF не поддерживается: сохраните чертёж как текстовый DXF (ASCII)")
    if data[:4] in (b"AC10", b"AC11") and b"\x00" in data[:64]:
        raise ValidationError("это чертёж DWG: сохраните его в формате DXF")
    for enc in ("utf-8-sig", "cp1251"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode("cp1251", "replace")
    return re.sub(r"\\U\+([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), text)


def _pairs(text):
    """Файл DXF - пары строк: код и значение."""
    lines = text.splitlines()
    out = []
    for i in range(0, len(lines) - 1, 2):
        try:
            out.append((int(lines[i]), lines[i + 1].strip()))
        except ValueError:
            raise ValidationError("файл не похож на DXF: на месте кода стоит «%s»" % lines[i].strip()[:20])
    return out


def _num(value):
    try:
        v = float(value)
    except ValueError:
        return 0.0
    return v if math.isfinite(v) else 0.0


def _arc(cx, cy, r, a0, a1, ccw=True, steps=None):
    """Дуга ломаной: углы в градусах, от a0 к a1 против часовой стрелки (или по ней)."""
    if not ccw:
        a0, a1 = -a0, -a1
    while a1 <= a0:
        a1 += 360.0
    n = steps or max(2, int(math.ceil((a1 - a0) / 6.0)))
    out = []
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        out += (cx + r * math.cos(a), cy + (r * math.sin(a) if ccw else -r * math.sin(a)))
    return out


def _bulge(x0, y0, x1, y1, b):
    """Точки дуги между двумя вершинами полилинии (без первой вершины). b - «выпуклость» из DXF."""
    chord = math.hypot(x1 - x0, y1 - y0)
    if abs(b) < 1e-9 or chord < 1e-9:
        return [x1, y1]
    angle = 4 * math.atan(b)
    r = chord / (2 * math.sin(abs(angle) / 2))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    d = math.sqrt(max(r * r - (chord / 2) ** 2, 0.0)) * (1 if (abs(b) < 1) == (b > 0) else -1)
    cx, cy = mx - d * (y1 - y0) / chord, my + d * (x1 - x0) / chord
    a0 = math.atan2(y0 - cy, x0 - cx)
    n = max(2, int(math.ceil(abs(angle) / math.radians(6))))
    out = []
    for k in range(1, n + 1):
        a = a0 + angle * k / n
        out += (cx + r * math.cos(a), cy + r * math.sin(a))
    out[-2:] = [x1, y1]
    return out


def _poly_from_vertices(verts, closed):
    """verts: [(x, y, выпуклость)] -> [x, y, ...] с дугами, разложенными на отрезки."""
    if not verts:
        return []
    out = [verts[0][0], verts[0][1]]
    last = len(verts) if closed else len(verts) - 1
    for i in range(last):
        x0, y0, b = verts[i]
        x1, y1, _ = verts[(i + 1) % len(verts)]
        out += _bulge(x0, y0, x1, y1, b)
    if closed and len(out) >= 4 and out[:2] == out[-2:]:
        del out[-2:]
    return out


_MTEXT = re.compile(r"\\[ACFHQTWfacfhqtw][^;]*;|\\[LlOoKkNX~]|\\S[^;]*;|[{}]")


def _clean_text(s):
    s = s.replace("\\P", " ").replace("\\p", " ").replace("%%d", "°").replace("%%D", "°")
    s = _MTEXT.sub("", s).replace("\\\\", "\\")
    return re.sub(r"\s+", " ", s).strip()[:200]


def _hatch_paths(body):
    """Контуры штриховки. Каждый контур - замкнутая ломаная."""
    start = next((i for i, (c, _) in enumerate(body) if c == 91), None)
    if start is None:
        return []
    paths, i, total = [], start + 1, int(_num(body[start][1]))
    n = len(body)

    def read(code, default=0.0):
        nonlocal i
        if i < n and body[i][0] == code:
            i += 1
            return _num(body[i - 1][1])
        return default

    for _ in range(total):
        if i >= n or body[i][0] != 92:
            break
        flag = int(_num(body[i][1]))
        i += 1
        pts = []
        if flag & 2:                                          # контур задан полилинией
            has_bulge, closed = int(read(72)), int(read(73, 1))
            count, verts = int(read(93)), []
            for _ in range(count):
                x, y = read(10), read(20)
                verts.append((x, y, read(42) if has_bulge else 0.0))
            pts = _poly_from_vertices(verts, True)
        else:                                                 # контур задан цепочкой рёбер
            for _ in range(int(read(93))):
                kind = int(read(72))
                if kind == 1:
                    x0, y0, x1, y1 = read(10), read(20), read(11), read(21)
                    seg = [x0, y0, x1, y1]
                elif kind == 2:
                    cx, cy, r, a0, a1, ccw = read(10), read(20), read(40), read(50), read(51), int(read(73, 1))
                    seg = _arc(cx, cy, r, a0, a1, bool(ccw))
                elif kind == 3:
                    cx, cy, ax, ay, ratio = read(10), read(20), read(11), read(21), read(40)
                    a0, a1, ccw = read(50), read(51), int(read(73, 1))
                    seg, major, rot = [], math.hypot(ax, ay), math.atan2(ay, ax)
                    for px, py in zip(*[iter(_arc(0, 0, 1, a0, a1, bool(ccw)))] * 2):
                        ex, ey = px * major, py * major * ratio
                        seg += (cx + ex * math.cos(rot) - ey * math.sin(rot), cy + ex * math.sin(rot) + ey * math.cos(rot))
                elif kind == 4:
                    read(94), read(73), read(74)
                    knots, ctrl = int(read(95)), int(read(96))
                    for _ in range(knots):
                        read(40)
                    seg = []
                    for _ in range(ctrl):
                        seg += (read(10), read(20))
                        read(42)
                    fit = [(read(11), read(21)) for _ in range(int(read(97)))]
                    if fit:
                        seg = [v for p in fit for v in p]
                    read(12), read(22), read(13), read(23)
                else:
                    break
                if pts and seg[:2] == pts[-2:]:
                    seg = seg[2:]
                pts += seg
            if len(pts) >= 4 and pts[:2] == pts[-2:]:
                del pts[-2:]
        for _ in range(int(read(97))):                        # ссылки на исходные объекты
            read(330)
        if len(pts) >= 6:
            paths.append(pts)
    return paths


def parse(data):
    """Объекты чертежа: [{kind: poly | line | point | text, pts: [x, y, ...], layer, text}]."""
    pairs = _pairs(_decode(data))
    start = next((i for i in range(len(pairs) - 1) if pairs[i] == (0, "SECTION") and pairs[i + 1] == (2, "ENTITIES")), None)
    if start is None:
        if not any(p == (0, "EOF") for p in pairs[-3:]) and not any(p[0] == 0 and p[1] == "SECTION" for p in pairs[:50]):
            raise ValidationError("файл не похож на DXF")
        return []
    ents, cur = [], None
    for code, value in pairs[start + 2:]:
        if code == 0:
            if value == "ENDSEC":
                break
            cur = [value, []]
            ents.append(cur)
        elif cur is not None:
            cur[1].append((code, value))
    out, points = [], 0
    poly = None                                               # POLYLINE собирается из следующих за ней VERTEX

    def first(body, code, default=None):
        return next((v for c, v in body if c == code), default)

    def add(kind, pts, body, text=""):
        nonlocal points
        if first(body, 67) == "1":                            # пространство листа: это рамки и штампы, не карта
            return
        if _num(first(body, 230, "1")) < 0:                   # объект «с изнанки»: X отражён
            pts = [(-v if k % 2 == 0 else v) for k, v in enumerate(pts)]
        points += len(pts) // 2
        if points > MAX_POINTS:
            raise ValidationError("в файле слишком много точек (больше %d)" % MAX_POINTS)
        out.append({"kind": kind, "pts": [round(v, 2) for v in pts], "layer": first(body, 8, "0"), "text": text})

    for name, body in ents:
        if name == "VERTEX" and poly is not None:
            poly[1].append((_num(first(body, 10, "0")), _num(first(body, 20, "0")), _num(first(body, 42, "0"))))
            continue
        if name == "SEQEND" and poly is not None:
            closed = bool(int(_num(first(poly[0], 70, "0"))) & 1)
            pts = _poly_from_vertices(poly[1], closed)
            if len(pts) >= 4:
                add("poly" if closed and len(pts) >= 6 else "line", pts, poly[0])
            poly = None
            continue
        poly = None
        if name == "POLYLINE":
            poly = (body, [])
        elif name == "LWPOLYLINE":
            verts = []
            for c, v in body:
                if c == 10:
                    verts.append([_num(v), 0.0, 0.0])
                elif c == 20 and verts:
                    verts[-1][1] = _num(v)
                elif c == 42 and verts:
                    verts[-1][2] = _num(v)
            closed = bool(int(_num(first(body, 70, "0"))) & 1)
            pts = _poly_from_vertices([tuple(v) for v in verts], closed)
            if len(pts) >= 4:
                add("poly" if closed and len(pts) >= 6 else "line", pts, body)
        elif name == "HATCH":
            for pts in _hatch_paths(body):
                add("poly", pts, body)
        elif name == "LINE":
            add("line", [_num(first(body, 10, "0")), _num(first(body, 20, "0")), _num(first(body, 11, "0")), _num(first(body, 21, "0"))], body)
        elif name == "CIRCLE":
            pts = _arc(_num(first(body, 10, "0")), _num(first(body, 20, "0")), _num(first(body, 40, "0")), 0, 360, steps=72)[:-2]
            add("poly", pts, body)
        elif name == "ARC":
            add("line", _arc(_num(first(body, 10, "0")), _num(first(body, 20, "0")), _num(first(body, 40, "0")),
                             _num(first(body, 50, "0")), _num(first(body, 51, "0"))), body)
        elif name == "SPLINE":
            fit = [v for c, v in body if c in (11, 21)]
            src = fit if len(fit) >= 4 else [v for c, v in body if c in (10, 20)]
            pts = [_num(v) for v in src]
            closed = bool(int(_num(first(body, 70, "0"))) & 1)
            if len(pts) >= 4:
                add("poly" if closed and len(pts) >= 6 else "line", pts, body)
        elif name == "POINT":
            add("point", [_num(first(body, 10, "0")), _num(first(body, 20, "0"))], body)
        elif name in ("TEXT", "MTEXT", "ATTRIB"):
            raw = "".join(v for c, v in body if c == 3) + (first(body, 1, "") or "")
            text = _clean_text(raw)
            aligned = name == "TEXT" and (first(body, 72, "0") != "0" or first(body, 73, "0") != "0") and first(body, 11) is not None
            x, y = (first(body, 11), first(body, 21)) if aligned else (first(body, 10, "0"), first(body, 20, "0"))
            if text:
                add("text", [_num(x), _num(y or "0")], body, text)
    return out


# ---------------------------------------------------------------- геометрия
def _inside(pts, x, y):
    hit, n = False, len(pts)
    j = n - 2
    for i in range(0, n, 2):
        xi, yi, xj, yj = pts[i], pts[i + 1], pts[j], pts[j + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def area(pts):
    s, n = 0.0, len(pts)
    for i in range(0, n, 2):
        j = (i + 2) % n
        s += pts[i] * pts[j + 1] - pts[j] * pts[i + 1]
    return abs(s) / 2


# ---------------------------------------------------------------- архивы и названия
def _zip_name(info):
    """Имя файла в архиве zip. Русские имена из Windows лежат в кодировке cp866."""
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("cp866")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename


def _unzip(name, data):
    stem = os.path.splitext(os.path.basename(name))[0]
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValidationError(f"«{name}» не открывается как архив zip.")
    out = []
    for info in z.infolist():
        inner = _zip_name(info).replace("\\", "/")
        if info.is_dir() or not inner.lower().endswith(".dxf") or info.file_size > MAX_BYTES:
            continue
        out.append((stem + "/" + inner, z.read(info)))
    return out


RAR_TOOLS = (["tar", "-xf", "{src}", "-C", "{dst}"], ["bsdtar", "-xf", "{src}", "-C", "{dst}"],
             ["unrar", "x", "-y", "-inul", "{src}", "{dst}/"], ["7z", "x", "-y", "-o{dst}", "{src}"],
             [r"C:\Program Files\WinRAR\UnRAR.exe", "x", "-y", "-inul", "{src}", "{dst}\\"],
             [r"C:\Program Files\7-Zip\7z.exe", "x", "-y", "-o{dst}", "{src}"])


def _unrar(name, data, tools=RAR_TOOLS):
    """Архив rar распаковывается средствами системы: в Windows 10 и 11 это встроенная программа tar.
    Если распаковать нечем, просим распаковать архив и выбрать папку."""
    stem = os.path.splitext(os.path.basename(name))[0]
    tmp = tempfile.mkdtemp(prefix="rz_rar_")
    try:
        src, dst = os.path.join(tmp, "a.rar"), os.path.join(tmp, "out")
        os.makedirs(dst)
        with open(src, "wb") as f:
            f.write(data)
        for tool in tools:
            cmd = [part.format(src=src, dst=dst) for part in tool]
            if not (shutil.which(cmd[0]) or os.path.isfile(cmd[0])):
                continue
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except (OSError, subprocess.SubprocessError):
                continue
            out = []
            for folder, _, files in os.walk(dst):
                for fn in files:
                    if fn.lower().endswith(".dxf"):
                        full = os.path.join(folder, fn)
                        with open(full, "rb") as f:
                            out.append((stem + "/" + os.path.relpath(full, dst).replace("\\", "/"), f.read()))
            if out:
                return sorted(out)
        raise ValidationError(f"Архив «{name}» распаковать не удалось. Распакуйте его и выберите папку с файлами DXF "
                              "(кнопка «Папка») или сами файлы.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def expand(files):
    """Раскрывает архивы: на выходе только файлы DXF с путями «папка/файл.dxf»."""
    out = []
    for name, data in files:
        name = name.replace("\\", "/").lstrip("/")
        low = name.lower()
        if low.endswith(".zip"):
            out += _unzip(name, data)
        elif low.endswith(".rar"):
            out += _unrar(name, data)
        elif low.endswith(".dxf"):
            out.append((name, data))
    return out


def _named(layer):
    return (layer or "").strip().lower() not in PLAIN_LAYERS


def build(files, layer_name=""):
    """files: [(путь, содержимое)] -> ({название слоя: [объект]}, [(файл, почему пропущен)]).
    Объект: {name, kind, closed, pts, source}."""
    layers, skipped = {}, []
    layer_name = (layer_name or "").strip()[:80]
    for path, data in files:
        parts = [p for p in path.split("/") if p]
        stem = os.path.splitext(parts[-1])[0].strip() or "контур"
        folder = parts[-2].strip() if len(parts) > 1 else ""
        try:
            ents = parse(data)
        except ValidationError as e:
            skipped.append((path, str(e)))
            continue
        geoms = [e for e in ents if e["kind"] != "text"]
        texts = [e for e in ents if e["kind"] == "text"]
        if not geoms and not texts:
            skipped.append((path, "в файле нет контуров"))
            continue
        used = set()
        for e in geoms:
            name = ""
            if e["kind"] == "poly":
                for k, t in enumerate(texts):
                    if k not in used and _inside(e["pts"], t["pts"][0], t["pts"][1]):
                        used.add(k)
                        name = t["text"]
                        break
            if not name:
                name = e["layer"].strip() if _named(e["layer"]) and (folder or layer_name) else stem
            group = layer_name or folder or (e["layer"].strip() if _named(e["layer"]) else DEFAULT_LAYER)
            layers.setdefault(group[:80], []).append({"name": name[:120], "kind": e["kind"], "closed": int(e["kind"] == "poly"),
                                                      "pts": e["pts"], "source": path[-200:]})
        for k, t in enumerate(texts):                         # подписи, не попавшие ни в один контур, остаются подписями
            if k not in used:
                group = layer_name or folder or (t["layer"].strip() if _named(t["layer"]) else DEFAULT_LAYER)
                layers.setdefault(group[:80], []).append({"name": t["text"][:120], "kind": "text", "closed": 0,
                                                          "pts": t["pts"], "source": path[-200:]})
    return layers, skipped
