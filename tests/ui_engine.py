# -*- coding: utf-8 -*-
"""Приложение целиком, без Python-сервера: движок работает внутри страницы (IndexedDB), как на iPhone.
Проверяет загрузку данных, сохранение между запусками, работу без сети, выгрузки, GPS и привязку на пикете.
Запуск: python3 tests/ui_engine.py"""
import json, os, subprocess, sys, time, threading, http.server, functools
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright

ROOT = os.environ.get('UI_ROOT', '/home/claude/razmotka-ios')
PREFIX = os.environ.get('UI_PREFIX', '')            # например /razmotka/: проверка размещения не в корне сайта
D = '/tmp/claude-0/-home-claude/52abce27-64ed-5652-a5bf-b5b8690429c7/scratchpad/xl/data'
SH = '/tmp/ui_scratch/shots'; os.makedirs(SH, exist_ok=True)
bad = []
def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: bad.append(name)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8801), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:8801/' + PREFIX.lstrip('/')

sys.path.insert(0, '/home/claude/razmotka-ios/tests')
# координаты по проекции ГСК-2011 зона 10 (эталон Python из проверки проекции)
sys.path.insert(0, '/tmp/claude-0/-home-claude/52abce27-64ed-5652-a5bf-b5b8690429c7/scratchpad')
from gk import GK
G = GK(6378136.5, 298.2564151, 57)

with sync_playwright() as p:
    dev = p.devices['iPhone 14']
    br = p.chromium.launch()
    ctx = br.new_context(**dev, permissions=['geolocation'], geolocation={'latitude': 51.4652, 'longitude': 56.3954}, accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.goto(URL); page.wait_for_function('document.getElementById("splash")===null || getComputedStyle(document.getElementById("splash")).display==="none" || !document.getElementById("splash").classList.contains("on")', timeout=20000)
    page.wait_for_function('window.RZ && RZ.db', timeout=20000)
    ok('движок запущен без сервера', page.evaluate('!!RZ.db && !!RZ.ctx'))
    ok('нет ошибок при запуске', not errs, errs[:3])

    # --- загрузка журнала и координат через интерфейс
    page.goto(URL + '#data'); page.wait_for_selector('#impJFile', state='attached')
    page.set_input_files('#impJFile', D + '/journal.xlsx'); page.click('#impJGo')
    page.wait_for_selector('#veil[style*="flex"]'); page.click('#dYes')           # «Заменить данные?»
    page.wait_for_function('document.getElementById("dTitle").textContent==="Загружено"', timeout=30000)
    ok('журнал загружен', 'Размотка' in page.inner_text('#dBody'), page.inner_text('#dBody')[:80].replace('\n', ' '))
    page.click('#dYes')
    page.set_input_files('#impMFile', D + '/macro.xlsm'); page.check('#impTgo'); page.click('#impMGo')
    page.wait_for_selector('#veil[style*="flex"]'); page.click('#dYes')
    page.wait_for_function('document.getElementById("dTitle").textContent==="Загружено"', timeout=30000)
    ok('координаты (ТГО) загружены', 'пикетов' in page.inner_text('#dBody'), page.inner_text('#dBody')[:100].replace('\n', ' '))
    page.click('#dYes')
    s = page.evaluate("fetch('/api/summary').then(r=>r.json())")
    ok('сводка из движка', s['field'] > 1000 and s['sps'] > 500, {k: s[k] for k in ('field', 'razm', 'podm', 'sps')})

    # --- данные переживают перезапуск
    page.evaluate('RZ.db.flush()'); time.sleep(.6)
    page.reload(); page.wait_for_function('window.RZ && RZ.db', timeout=20000)
    s2 = page.evaluate("fetch('/api/summary').then(r=>r.json())")
    ok('данные сохранились в IndexedDB после перезапуска', s2['field'] == s['field'] and s2['sps'] == s['sps'], s2['field'])

    # --- карта с данными
    page.goto(URL + '#field'); page.wait_for_function('F && F.field.length>0 && F.sps.length>0', timeout=15000)
    page.screenshot(path=SH + '/eng_field.png')
    ok('карта получила точки поля и SPS', True, f"{len(page.evaluate('F.field'))//6} на поле")

    # --- GPS: встаём на пикет SPS
    pk = page.evaluate("fetch('/api/nearest?x=1&y=1').then(r=>r.json())")                 # без точки рядом: пусто
    ok('ближайший пикет вдалеке не найден', pk == {} , pk)
    pt = page.evaluate("(()=>{const a=F.sps;const i=Math.floor(a.length/4/2)*2;return [a[i],a[i+1]]})()")
    lat, lon = G.inv(pt[0], pt[1])
    ctx.set_geolocation({'latitude': lat, 'longitude': lon, 'accuracy': 6})
    page.click('#sideShow') if page.is_visible('#sideShow') else None
    page.evaluate('document.getElementById("gLocate").click()')
    page.wait_for_function('GEO.xy', timeout=10000)
    xy = page.evaluate('GEO.xy')
    ok('GPS переведён в координаты листа SPS (ошибка меньше 0,2 м)', abs(xy[0] - pt[0]) < .2 and abs(xy[1] - pt[1]) < .2, [round(xy[0] - pt[0], 3), round(xy[1] - pt[1], 3)])
    page.wait_for_function('GEO.near', timeout=8000)
    near = page.evaluate('GEO.near')
    ok('найден ближайший пикет', near['dist'] < 15, near)
    page.evaluate('document.getElementById("sideHide").click()'); page.evaluate('setFull(true)'); time.sleep(.6)
    page.screenshot(path=SH + '/eng_gps.png')

    # --- привязка: GPS «уехал» на 18 м востока и 7 м севера; встаём на известный пикет
    kn = page.evaluate(f"fetch('/api/picket?line={near['line']}&picket={near['picket']}').then(r=>r.json())")
    lat2, lon2 = G.inv(kn['x'] + 18, kn['y'] + 7)
    ctx.set_geolocation({'latitude': lat2, 'longitude': lon2, 'accuracy': 5}); time.sleep(.5)
    page.evaluate('geoInject({lat:%f,lon:%f,acc:5})' % (lat2, lon2))
    page.evaluate('GEO.recent.length=0;GEO.recent.push([GEO.raw[0],GEO.raw[1],Date.now()])')
    page.evaluate('document.getElementById("gCalib").click()')
    page.wait_for_selector('#gcLine'); page.fill('#gcLine', str(near['line'])); page.fill('#gcPick', str(near['picket'])); page.click('#dYes')
    page.wait_for_function('GEO.calib', timeout=5000)
    xy = page.evaluate('GEO.xy')
    ok('после привязки точка совпадает с пикетом', abs(xy[0] - kn['x']) < .2 and abs(xy[1] - kn['y']) < .2, [round(xy[0] - kn['x'], 3), round(xy[1] - kn['y'], 3)])
    pr = page.evaluate("fetch('/api/prefs').then(r=>r.json())")
    ok('привязка записана в настройки', pr.get('geo_calib', {}).get('line') == near['line'])
    # курс: идём на восток
    page.evaluate('document.getElementById("gCourse").checked=true;document.getElementById("gCourse").dispatchEvent(new Event("change"))')
    page.evaluate('geoInject({lat:%f,lon:%f,acc:5,heading:90,speed:1.4})' % (lat2, lon2))
    deg = page.evaluate('V.deg')
    ok('карта повёрнута по ходу движения (на восток: около -90°)', -96 < deg < -84, deg)
    time.sleep(.3); page.screenshot(path=SH + '/eng_course.png')
    page.evaluate('setFull(false)'); page.evaluate('document.getElementById("gLocate").click()')

    # --- выгрузка
    page.goto(URL + '#data')
    with page.expect_download(timeout=20000) as dl:
        page.click('#exports button[data-w=journal]')
        if page.is_visible('#dYes') and 'Файл готов' in page.inner_text('#dTitle'): page.click('#dYes')
    path = dl.value.path(); head = open(path, 'rb').read(4)
    ok('журнал выгружен как настоящий xlsx', head == b'PK\x03\x04' and dl.value.suggested_filename.endswith('.xlsx'), dl.value.suggested_filename)

    # --- копия и восстановление
    with page.expect_download(timeout=20000) as dl:
        page.click('#bkSave')
        if page.is_visible('#dYes') and 'Файл готов' in page.inner_text('#dTitle'): page.click('#dYes')
    bk = json.load(open(dl.value.path()))
    ok('копия данных создана', bk['format'] == 'razmotka-backup' and len(bk['rows']['razm']) > 100, dl.value.suggested_filename)
    page.evaluate("fetch('/api/clear',{method:'POST',body:'{}'})")
    s3 = page.evaluate("fetch('/api/summary').then(r=>r.json())")
    ok('всё удалено', s3['field'] == 0, s3['field'])
    page.set_input_files('#bkFile', dl.value.path()); page.click('#bkLoad')
    page.wait_for_selector('#veil[style*="flex"]'); page.click('#dYes')
    page.wait_for_function('document.getElementById("dTitle").textContent==="Данные восстановлены"', timeout=20000); page.click('#dYes')
    s4 = page.evaluate("fetch('/api/summary').then(r=>r.json())")
    ok('данные восстановлены из копии', s4['field'] == s['field'] and s4['razm'] == s['razm'], s4['field'])

    # --- без сети
    page.evaluate('RZ.db.flush()'); time.sleep(.6)
    page.evaluate("navigator.serviceWorker.ready.then(()=>1)"); time.sleep(1.5)
    ctx.set_offline(True)
    page.goto(URL + '#stats'); page.wait_for_function('window.RZ && RZ.db', timeout=20000)
    st = page.evaluate("fetch('/api/summary').then(r=>r.json())")
    ok('работает без сети', st['field'] == s['field'], st['field'])
    page.screenshot(path=SH + '/eng_offline.png')
    ok('нет ошибок JS за весь прогон', not [e for e in errs if 'Failed to load resource' not in e], errs[:4])
    br.close()
srv.shutdown()
print('\nПровалено:' if bad else '\nВсе проверки пройдены', bad if bad else '')
sys.exit(1 if bad else 0)
