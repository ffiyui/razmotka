# -*- coding: utf-8 -*-
"""GeoLink для компьютера.

Программа - та же GeoLink, что на телефоне (папка web/ - копия версии для iPhone): весь учёт считает движок
внутри страницы. Эта часть на Python только:
  - отдаёт страницу и открывает её отдельным окном (Edge, Chrome или Яндекс в режиме приложения);
  - хранит данные в файлах на диске (папка data/: kv - данные, blobs - картинки подложек), а не в браузере;
  - перед каждым запуском кладёт копию данных в data/backups (последние 15);
  - читает контуры из файлов DXF (geolink_dxf.py);
  - переносит данные прежней программы для ПК: файл data/razmotka.db предлагается загрузить при первом запуске.
Закрыли окно - программа завершилась. Сторонние библиотеки не нужны, Python 3.8 или новее.
Запуск: start.bat (Windows) или  python geolink.py   (--no-window - без окна, --port N - свой порт)."""
import base64
import datetime
import io
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')
DATA = os.path.join(HERE, 'data')
KV = os.path.join(DATA, 'kv')
BLOBS = os.path.join(DATA, 'blobs')
BACKUPS = os.path.join(DATA, 'backups')
LEGACY_DB = os.path.join(DATA, 'razmotka.db')          # база прежней программы для ПК (папка data со старой программы)
LEGACY_DONE = os.path.join(DATA, 'razmotka.db.перенесено')
APP = 'geolink-pc'
PORT = 8795
KEEP_BACKUPS = 15
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
         '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
         '.ico': 'image/x-icon'}
LOCK = threading.Lock()
STATE = {'ping': 0.0, 'seen': False, 'bye': 0.0}


# ---------------------------------------------------------------- хранилище
def _fname(key):
    """Имя файла по ключу хранилища: буквы и цифры как есть, остальное - %XX (ключи вида rows:razm, blob:note:p:1:2)"""
    return urllib.parse.quote(key, safe='') .replace('%', '_') + '.json'


def _atomic(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.tmp-')
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def kv_load():
    """Все данные одним JSON: {"ключ": значение}. Значения уже лежат в файлах как JSON - склеиваются без разбора"""
    out = [b'{']
    first = True
    for name in sorted(os.listdir(KV)):
        if not name.endswith('.json') or name.startswith('.'):
            continue
        path = os.path.join(KV, name)
        with open(path, 'rb') as f:
            body = f.read()
        try:
            key = json.loads(body[:body.index(b'\n')])         # первая строка файла - ключ
        except ValueError:
            continue
        out.append((b'' if first else b',') + json.dumps(key, ensure_ascii=False).encode('utf-8') + b':' + body[body.index(b'\n') + 1:])
        first = False
    out.append(b'}')
    return b''.join(out)


def kv_put(body):
    j = json.loads(body.decode('utf-8'))
    with LOCK:
        for key, value in (j.get('put') or {}).items():
            path = os.path.join(KV, _fname(key))
            if value is None:
                if os.path.exists(path):
                    os.remove(path)
                continue
            _atomic(path, json.dumps(key, ensure_ascii=False).encode('utf-8') + b'\n' + json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        for key in j.get('del') or []:
            path = os.path.join(KV, _fname(key))
            if os.path.exists(path):
                os.remove(path)
    return {'ok': True}


def blob_path(key):
    return os.path.join(BLOBS, _fname(key)[:-5] + '.bin')


def wipe():
    with LOCK:
        backup('перед очисткой')
        for d in (KV, BLOBS):
            for name in os.listdir(d):
                os.remove(os.path.join(d, name))
    return {'ok': True}


def backup(why=''):
    """Копия папок kv и blobs в data/backups/ГГГГ-ММ-ДД_ЧЧ-ММ-СС; хранится последние KEEP_BACKUPS"""
    if not os.listdir(KV):
        return None
    name = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S') + (' ' + why if why else '')
    dst = os.path.join(BACKUPS, name)
    shutil.copytree(KV, os.path.join(dst, 'kv'))
    if os.listdir(BLOBS):
        shutil.copytree(BLOBS, os.path.join(dst, 'blobs'))
    old = sorted(d for d in os.listdir(BACKUPS) if os.path.isdir(os.path.join(BACKUPS, d)))
    for d in old[:-KEEP_BACKUPS]:
        shutil.rmtree(os.path.join(BACKUPS, d), ignore_errors=True)
    return dst


# ---------------------------------------------------------------- прежняя программа для ПК
def legacy_file():
    """База прежней программы - как файл проекта .rzm (движок GeoLink читает такие файлы): manifest + razmotka.db + настройки"""
    if not os.path.isfile(LEGACY_DB) or os.path.exists(LEGACY_DONE):
        return None
    tmp = tempfile.mktemp(suffix='.db')
    try:
        src = sqlite3.connect(LEGACY_DB)                       # копия через SQLite: изменения из журнала WAL попадают в файл
        dst = sqlite3.connect(tmp)
        src.backup(dst)
        dst.close(); src.close()
        with open(tmp, 'rb') as f:
            db = f.read()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    manifest = {'app': 'razmotka', 'format': 1, 'created': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'source': 'Прежняя программа для ПК', 'device': 'pc', 'parts': {'journal': True, 'sps': True, 'dxf': True}}
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
        z.writestr('razmotka.db', db)
        cfg = os.path.join(DATA, '..', 'config.json')
        if os.path.isfile(cfg):
            try:
                c = json.load(open(cfg, encoding='utf-8'))
                if c.get('rules') and c.get('crs'):
                    z.writestr('settings.json', json.dumps({'rules': c['rules'], 'crs': c['crs']}, ensure_ascii=False))
            except (ValueError, OSError):
                pass
    return out.getvalue()


# ---------------------------------------------------------------- контуры DXF
def dxf_parse(name, body, layer=''):
    import geolink_dxf
    try:
        layers, skipped = geolink_dxf.build(geolink_dxf.expand([(name, body)]), layer)
    except geolink_dxf.ValidationError as e:
        return {'error': str(e)}
    return {'layers': {k: [{'name': i['name'], 'kind': i['kind'], 'pts': i['pts']} for i in v] for k, v in layers.items()},
            'skipped': [[a, b] for a, b in skipped]}


# ---------------------------------------------------------------- сервер
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        path = urllib.parse.unquote(u.path)
        if path == '/pc/ping':
            STATE['ping'] = time.time(); STATE['seen'] = True; STATE['bye'] = 0.0
            return self._send(200, {'ok': True, 'app': APP})
        if path == '/pc/kv':
            return self._send(200, kv_load())
        if path == '/pc/blob':
            p = blob_path(q.get('key', ''))
            if not os.path.isfile(p):
                return self._send(404, {'error': 'нет'})
            with open(p, 'rb') as f:
                data = f.read()
            t = open(p + '.type', encoding='utf-8').read() if os.path.isfile(p + '.type') else 'application/octet-stream'
            return self._send(200, data, t)
        if path == '/pc/legacy':
            data = legacy_file()
            return self._send(200, data, 'application/zip') if data else self._send(404, {'error': 'нет'})
        return self._static(path)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        path = u.path
        try:
            if path == '/pc/kv':
                return self._send(200, kv_put(self._body()))
            if path == '/pc/blob':
                body = self._body(); p = blob_path(q.get('key', ''))
                with LOCK:
                    _atomic(p, body)
                    open(p + '.type', 'w', encoding='utf-8').write(self.headers.get('Content-Type') or 'application/octet-stream')
                return self._send(200, {'ok': True})
            if path == '/pc/blob/del':
                p = blob_path(q.get('key', ''))
                with LOCK:
                    for x in (p, p + '.type'):
                        if os.path.exists(x):
                            os.remove(x)
                return self._send(200, {'ok': True})
            if path == '/pc/wipe':
                return self._send(200, wipe())
            if path == '/pc/dxf':
                return self._send(200, dxf_parse(q.get('name', 'файл.dxf'), self._body(), q.get('layer', '')))
            if path == '/pc/legacy/done':
                open(LEGACY_DONE, 'w', encoding='utf-8').write(datetime.datetime.now().isoformat())
                return self._send(200, {'ok': True})
            if path == '/pc/bye':
                STATE['bye'] = time.time()                # окно закрыли (или перезагрузили): если связи не будет - завершение
                return self._send(200, {'ok': True})
        except Exception as e:                            # ошибка записи на диск - странице, чтобы она сказала о ней
            return self._send(500, {'error': 'Не удалось сохранить данные на диск: %s' % e})
        return self._send(404, {'error': 'Не найдено'})

    def _static(self, path):
        if path in ('', '/'):
            path = '/index.html'
        full = os.path.normpath(os.path.join(WEB, path.lstrip('/')))
        if not full.startswith(WEB) or not os.path.isfile(full):
            return self._send(404, b'Not found', 'text/plain')
        with open(full, 'rb') as f:
            data = f.read()
        if path == '/index.html':                           # страница узнаёт, что она в программе для ПК (js/pc.js)
            data = data.replace(b'<head>', b'<head><script>window.GL_PC=true</script>', 1)
        if path == '/sw.js':                                # офлайн-кэш в программе для ПК не нужен
            data = b"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));"
        self._send(200, data, TYPES.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'))


# ---------------------------------------------------------------- окно
def find_browser():
    cands = []
    for env in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
        base = os.environ.get(env)
        if base:
            cands += [os.path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                      os.path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                      os.path.join(base, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe')]
    cands += ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    for p in cands:
        if os.path.isfile(p):
            return p
    for n in ('msedge', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'):
        if shutil.which(n):
            return shutil.which(n)
    return None


def open_window(url):
    b = find_browser()
    if b:
        try:
            return subprocess.Popen([b, '--app=' + url, '--user-data-dir=' + os.path.join(DATA, 'window'), '--window-size=1440,900',
                                     '--no-first-run', '--no-default-browser-check'])
        except OSError:
            pass
    webbrowser.open(url)
    return None


def port_busy(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def ours(port):
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/pc/ping' % port, timeout=2) as r:
            return json.loads(r.read().decode('utf-8')).get('app') == APP
    except Exception:
        return False


def main():
    for d in (DATA, KV, BLOBS, BACKUPS):
        os.makedirs(d, exist_ok=True)
    port = PORT
    if '--port' in sys.argv:
        port = int(sys.argv[sys.argv.index('--port') + 1])
    headless = '--no-window' in sys.argv
    if port_busy(port):
        if ours(port):                                       # программа уже запущена - просто ещё одно окно
            if not headless:
                open_window('http://localhost:%d/' % port)
            return
        port = next(p for p in range(port + 1, port + 200) if not port_busy(p))
    copy = backup()
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = 'http://localhost:%d/' % port
    print('GeoLink запущен:', url, '· данные:', DATA, '· копия:', copy or 'нет данных')
    if headless:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            return
    open_window(url)
    # программа живёт, пока открыто окно: страница выходит на связь раз в 3 секунды (свёрнутое окно - реже,
    # поэтому без связи ждём 3 минуты); закрытое окно сообщает об этом - тогда завершение через 8 секунд
    t0 = time.time()
    while True:
        time.sleep(1)
        now = time.time()
        if STATE['bye'] and now - STATE['bye'] > 8 and STATE['ping'] < STATE['bye']:
            break
        if STATE['seen'] and now - STATE['ping'] > 180:
            break
        if not STATE['seen'] and time.time() - t0 > 600:     # окно так и не открылось
            break
    srv.shutdown()


if __name__ == '__main__':
    main()
