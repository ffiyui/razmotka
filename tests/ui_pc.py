# -*- coding: utf-8 -*-
"""GeoLink для ПК (pc/geolink.py): настоящий сервер программы, окно - Chromium 1440x900.
Перенос данных прежней программы (data/razmotka.db), данные в файлах (переживают перезапуск), меню без нижней панели,
контуры DXF, картинки (blob), резервные копии, завершение при закрытии окна. Запуск: python3 tests/ui_pc.py"""
import copy, os, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.environ.get('RAZ_PC', '/home/claude/razmotka'))
from app import config, paths
from app.services import sheets as svc
from app.storage.db import Database

bad = []
def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: bad.append(name)

T = tempfile.mkdtemp(); PC = os.path.join(T, 'GeoLink')
shutil.copytree(os.path.join(REPO, 'pc'), PC, ignore=shutil.ignore_patterns('data', '__pycache__'))
os.makedirs(PC + '/data')
# прежняя программа для ПК: база с журналом и SPS
paths.DATA_DIR, paths.BACKUP_DIR = T + '/old', T + '/old/b'; os.makedirs(T + '/old')
paths.UI_FILE, paths.PREFS_FILE = T + '/old/u.json', T + '/old/p.json'
db = Database(PC + '/data/razmotka.db', 'razm_last'); cfg = copy.deepcopy(config.DEFAULTS)
rows = lambda vs: [{"id": None, "pos": k + 1, "idx": k, "v": v} for k, v in enumerate(vs)]
svc.save_rows(db, 'sps', rows([[l, 1000 + i, 457000 + 25 * i, 5704000 + 200 * k, 120] for k, l in enumerate((5001, 5009)) for i in range(40)]))
svc.save_rows(db, 'workers', rows([[1, 'Иванов И. И.', None]]))
svc.save_rows(db, 'razm', rows([['2026-10-07', 'Иванов И. И.', 5009, 1000, 1019, None, None, None, None]]))
svc.apply(db, cfg, 'razm', True)
del db
PORT = 8831
URL = 'http://localhost:%d/' % PORT
start = lambda: subprocess.Popen([sys.executable, os.path.join(PC, 'geolink.py'), '--no-window', '--port', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def wait_up():
    for _ in range(50):
        try: urllib.request.urlopen(URL + 'pc/ping', timeout=1); return True
        except Exception: time.sleep(.2)
    return False
srv = start(); ok('программа запустилась', wait_up())
DXF = b'0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nPole\n90\n4\n70\n1\n10\n457000\n20\n5704000\n10\n457100\n20\n5704000\n10\n457100\n20\n5704100\n10\n457000\n20\n5704100\n0\nTEXT\n8\nPole\n10\n457050\n20\n5704050\n1\n001\n0\nENDSEC\n0\nEOF\n'
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 900})
        ctx.add_init_script("try{localStorage.setItem('gl_pass','1234')}catch(e){}")
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_function("typeof S==='object' && S && !document.getElementById('splash')", timeout=30000)
        ok('страница знает, что она в программе для ПК; хранилище - файлы', pg.evaluate("window.GL_PC===true && RZ.db.kv.kind==='pc' && document.documentElement.classList.contains('pc')"))
        pg.wait_for_selector('#dTitle:text("Данные прежней программы")', timeout=15000)
        ok('предложено перенести данные прежней программы', 'razmotka.db' in pg.inner_text('#dBody'))
        pg.click('#dYes'); pg.wait_for_selector('#veil[style*=flex] #prjInner', timeout=20000)
        pg.click('#dYes'); pg.wait_for_function("document.getElementById('dTitle').textContent==='Проект загружен'", timeout=20000); pg.click('#dYes'); pg.wait_for_timeout(800)
        ok('журнал и SPS прежней программы перенесены', pg.evaluate("[S.field, S.sps]") == [20, 80], pg.evaluate("[S.field, S.sps]"))
        ok('нижней панели нет, в меню - Карта, Данные, Настройки', pg.is_hidden('#tabbar') and pg.evaluate("['home','field','data','settings'].every(p=>document.querySelector('#navlist a[data-p='+p+']'))"))
        pg.click('#navlist a[data-p=field]'); pg.wait_for_function("document.querySelector('#p-field.on') && F.sps.length>0", timeout=15000)
        ok('карта открывается из меню', pg.evaluate("F.field.length/6") == 20)
        pg.wait_for_timeout(1200); pg.screenshot(path=os.environ.get('UI_SHOTS', T) + '/pc_field.png')
        ok('точки на карте нарисованы', pg.evaluate("(()=>{const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let n=0;for(let i=3;i<d.length;i+=40)if(d[i]>0)n++;return n})()") > 50)
        # контуры DXF
        pg.click('#navlist a[data-p=data]'); pg.wait_for_timeout(500)
        ok('блок «Контуры из DXF» есть только на ПК', pg.is_visible('#pcDxf'))
        pg.set_input_files('#pcDxfFiles', files=[{'name': 'Поле.dxf', 'mimeType': 'application/dxf', 'buffer': DXF}])
        pg.wait_for_function("document.getElementById('pcDxfNote').textContent.includes('Добавлено')", timeout=15000)
        r = pg.evaluate("api('/api/dxf').then(j=>j.layers.map(l=>[l.name,l.items.map(i=>i.name)]))")
        ok('контуры DXF загружены', r == [['Контуры DXF', ['001']]] or (len(r) == 1 and r[0][1] == ['001']), r)
        # изменения сохраняются в файлы
        pg.evaluate("post('/api/sheet/save',{name:'razm',rows:[{id:null,pos:5,idx:1,v:['2026-10-08','Иванов И. И.',5001,1000,1009,null,null,null,null]}]}).then(()=>post('/api/sheet/apply',{name:'razm',force:true})).then(()=>changed(true))")
        pg.wait_for_function("S.field===30", timeout=10000)
        pg.evaluate("RZ.db.kv.put_blob('utest', new Blob(['картинка'],{type:'image/png'}))"); pg.evaluate("RZ.db.flush()"); pg.wait_for_timeout(1500)
        ok('данные лежат в файлах программы', len(os.listdir(PC + '/data/kv')) > 5 and os.path.isfile(PC + '/data/razmotka.db.перенесено'), os.listdir(PC + '/data/kv')[:5])
        # перезапуск программы: всё на месте, перенос больше не предлагается, сделана резервная копия
        srv.terminate(); srv.wait(10); srv = start(); ok('перезапуск', wait_up())
        pg.reload(); pg.wait_for_function("typeof S==='object' && S && !document.getElementById('splash')", timeout=30000); pg.wait_for_timeout(2500)
        ok('после перезапуска данные на месте', pg.evaluate("[S.field, S.sps]") == [30, 80], pg.evaluate("[S.field, S.sps]"))
        ok('перенос больше не предлагается', pg.evaluate("$('veil').style.display") != 'flex')
        ok('картинка (подложка) хранится файлом', pg.evaluate("RZ.db.kv.get_blob('utest').then(b=>b&&b.text())") == 'картинка' and pg.evaluate("RZ.db.kv.get_blob('nope')") is None)
        ok('резервная копия при запуске', len(os.listdir(PC + '/data/backups')) >= 1, os.listdir(PC + '/data/backups'))
        ok('ошибок нет', not errs, errs[:3])
        pg.close()
        time.sleep(1)
        br.close()
finally:
    srv.terminate()
# окно закрыли - программа завершается (обычный запуск, без --no-window, окна в проверке нет: только сигнал страницы)
srv2 = subprocess.Popen([sys.executable, '-c', "import sys,os;sys.argv=['geolink.py','--port','%d'];sys.path.insert(0,%r);import geolink;geolink.open_window=lambda u:None;geolink.main()" % (PORT + 1, PC)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
u2 = 'http://localhost:%d/' % (PORT + 1)
for _ in range(50):
    try: urllib.request.urlopen(u2 + 'pc/ping', timeout=1); break
    except Exception: time.sleep(.2)
urllib.request.urlopen(urllib.request.Request(u2 + 'pc/bye', data=b'', method='POST'), timeout=2)
try: srv2.wait(20); ok('закрыли окно - программа завершилась', True)
except subprocess.TimeoutExpired: srv2.kill(); ok('закрыли окно - программа завершилась', False)
shutil.rmtree(T, ignore_errors=True)
print('\nПровалено: %d' % len(bad), bad if bad else '')
sys.exit(1 if bad else 0)
