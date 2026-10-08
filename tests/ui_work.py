# -*- coding: utf-8 -*-
"""Работа в поле на телефоне, от начала до конца (эмуляция iPhone, движок внутри страницы, без сервера):
файл проекта с ПК -> задания -> «На карте» -> «Начать разбивку» -> пикеты по GPS в круге 10 м -> пауза ->
«Завершить» -> журнал; трек; файл проекта, названный по исполнителю, -> табло на ПК.
Запуск: python3 tests/ui_work.py   Снимки кладутся в UI_SHOTS."""
import copy, functools, http.server, json, os, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.environ.get('UI_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.environ.get('UI_SHOTS', tempfile.mkdtemp()); os.makedirs(SHOTS, exist_ok=True)
sys.path.insert(0, os.environ.get('RAZ_PC', '/home/claude/razmotka'))
from app import config, paths
from app.services import project, reports
from app.services import sheets as svc
from app.storage.db import Database

bad = []


def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond:
        bad.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8803), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:8803/'


def chief_project(e0, n0):
    """Проект начальника отряда на ПК: SPS, исполнители, задания. Возвращает (база, настройки, файл проекта)."""
    d = tempfile.mkdtemp()
    paths.DATA_DIR, paths.BACKUP_DIR = d, os.path.join(d, 'backups')
    paths.UI_FILE, paths.PREFS_FILE = os.path.join(d, 'ui.json'), os.path.join(d, 'prefs.json')
    db, cfg = Database(os.path.join(d, 'razmotka.db')), copy.deepcopy(config.DEFAULTS)
    rows = lambda vs: [{"id": None, "pos": k + 1, "idx": k, "v": v} for k, v in enumerate(vs)]
    svc.save_rows(db, 'sps', rows([[l, 1000 + i, round(e0 + 25 * i, 1), round(n0 + 200 * k, 1), 120] for k, l in enumerate((5001, 5009, 5017)) for i in range(40)]))
    svc.save_rows(db, 'workers', rows([[1, 'Иванов И. И.', None]]))
    svc.save_rows(db, 'topo', rows([[11, 'Топоров Т. Т.', None], [12, 'Вешкин В. В.', None]]))
    svc.save_rows(db, 'razm', rows([['2026-10-07', 'Иванов И. И.', 5017, 1000, 1019, None, None, None, None]]))
    svc.apply(db, cfg, 'razm', True)
    svc.save_rows(db, 'razm', rows([['2026-10-08', 'Иванов И. И.', 5001, 1000, 1009, None, None, None, None]]))
    svc.save_rows(db, 'razb', rows([['2026-10-08', 'Топоров Т. Т.', 5009, 1000, 1019, None, None, None], ['2026-10-08', 'Топоров Т. Т.', 5025, 1000, 1004, None, None, None],
                                    ['2026-10-08', 'Вешкин В. В.', 5001, 1030, 1039, None, None, None]]))
    return db, cfg, d, project.export_project(db, cfg)[0]


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(**p.devices[os.environ.get('UI_DEVICE', 'iPhone 14')], accept_downloads=True, permissions=['geolocation'], geolocation={'latitude': 51.4652, 'longitude': 56.3954})
    ctx.add_init_script("try{localStorage.setItem('installhint','1')}catch(e){}")      # подсказка про установку здесь не нужна
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'favicon' not in m.text and 'serviceWorker' not in m.text else None)
    shot = lambda name: page.screenshot(path=f'{SHOTS}/{name}.png')
    ready = "typeof S==='object' && S && !document.getElementById('splash')"

    def go(tab, wait='true'):
        page.evaluate(f"location.hash='#{tab}'"); page.wait_for_function(f"document.querySelector('#p-{tab}.on') && ({wait})", timeout=15000); page.wait_for_timeout(400)

    def gps(line_k, i, dx=0, dy=0, acc=4):
        """Подставляет положение GPS: пикет i линии k со сдвигом в метрах."""
        page.evaluate(f"(()=>{{const q=GEO.proj.inv(BASE[0]+25*{i}+{dx},BASE[1]+200*{line_k}+{dy});geoInject({{lat:q[0],lon:q[1],acc:{acc}}})}})()")
        page.wait_for_timeout(60)

    page.goto(URL); page.wait_for_function("typeof S==='object' && S && typeof GEO==='object' && GEO.proj", timeout=20000); page.wait_for_timeout(1500)
    base = page.evaluate("window.BASE=GEO.proj.fwd(51.4652,56.3954).map(v=>Math.round(v))")
    ok('в меню «Разбивка», «ID топографов» и «Треки»', page.evaluate("['razb','topo','tracks'].every(p=>document.querySelector('#navlist a[data-p='+p+']'))"))
    db, cfg, d, chief = chief_project(*base)
    path = os.path.join(d, 'chief.rzm'); open(path, 'wb').write(chief)

    # ---- файл проекта с ПК
    go('data')
    page.set_input_files('#prjFile', path); page.click('#prjLoad'); page.wait_for_selector('#veil[style*=flex] #prjInner', timeout=15000)
    ok('пустому телефону предлагается замена проекта', page.is_checked('input[name=prjMode][value=replace]') and 'Разбивка: 3 строки' in page.inner_text('#prjInner'), page.inner_text('#prjInner')[:200])
    shot('ios_project_load')
    page.click('#dYes'); page.wait_for_function("document.getElementById('dTitle').textContent==='Проект загружен'", timeout=15000)
    ok('после загрузки кнопка ведёт к заданиям', page.inner_text('#dYes') == 'К заданиям')
    page.click('#dYes'); page.wait_for_function("document.querySelector('#p-razb.on') && Sheets.pages.razb.grid.rows.length===3", timeout=10000); page.wait_for_timeout(400)
    s = page.evaluate("S")
    ok('проект на телефоне тот же: поле 20, заданий 3 и 1', (s['field'], s['drafts']['razb'], s['drafts']['razm'], s['sps']) == (20, 3, 1, 120), (s['field'], s['drafts'], s['sps']))
    ok('страница «Журнал ТГО Разбивка»', 'Журнал ТГО' in page.inner_text('#p-razb h1') and page.inner_text('#p-razb [data-a=apply]') == 'Разбить')

    # ---- кто работает на этом телефоне
    go('topo', "Sheets.pages.topo.grid.rows.length===2")
    ok('на вкладке ID — галочка в каждой строке с фамилией, отдельного блока над таблицей нет', page.locator('#p-topo .gx-r .gx-me').count() == 2 and page.locator('#p-topo .mebox').count() == 0 and 'кто работает на этом телефоне' in page.inner_text('#p-topo .sh-status'))
    page.locator('#p-topo .gx-r', has_text='Топоров').locator('.gx-me').tap(); page.wait_for_timeout(500)
    ok('галочка стоит у выбранного, у остальных нет', page.evaluate("[...document.querySelectorAll('#p-topo .gx-r .gx-me')].map(e=>e.classList.contains('on'))") == [True, False])
    ok('галочка запоминает исполнителя', page.evaluate("PREFS.me.name") == 'Топоров Т. Т.' and page.evaluate("fetch('/api/prefs').then(r=>r.json()).then(j=>j.me.name)") == 'Топоров Т. Т.')
    shot('ios_me')
    go('razb', "Sheets.pages.razb.loaded")
    box = ' '.join(page.inner_text('#p-razb .tkbox summary').split())
    ok('в заданиях видно мои', 'Задания: 3' in box and 'мои: 2' in box, box)
    page.click('#p-razb .tkbox summary'); page.wait_for_timeout(300)
    rows = page.evaluate("[...document.querySelectorAll('#p-razb .tkrow')].map(r=>r.querySelector('b').textContent+'|'+!!r.querySelector('button'))")
    ok('в строке задания кнопка «На карте», показаны только мои', rows == ['Л 5009 · ПП 1000–1019|true', 'Л 5025 · ПП 1000–1004|true'], rows)
    shot('ios_tasks')

    # ---- задание без координат: место считается по соседним линиям
    page.locator('#p-razb .tkrow button').nth(1).click(); page.wait_for_function("document.querySelector('#p-field.on') && WORK.task && !document.getElementById('taskBar').hidden", timeout=10000); page.wait_for_timeout(500)
    est = page.evaluate("[WORK.task.est,WORK.task.points.slice(0,4),document.getElementById('tkSub').textContent]")
    ok('у линии без координат место посчитано', est[0] == 5 and est[1] == [base[0], base[1] + 600, 1000, 0] and 'примерно' in est[2], est)
    shot('ios_task_estimated')
    page.click('#tkClose'); page.wait_for_timeout(200)
    ok('задание убирается с карты', page.evaluate("WORK.task") is None and page.is_hidden('#taskBar'))

    # ---- «На карте»: диапазон светится, касание предлагает начать
    go('razb'); page.locator('#p-razb .tkrow button').nth(0).click()
    page.wait_for_function("document.querySelector('#p-field.on') && WORK.task && WORK.task.line===5009", timeout=10000); page.wait_for_timeout(500)
    inside = page.evaluate("(()=>{const p=WORK.task.points,w=cv.clientWidth,h=cv.clientHeight;let n=0;for(let i=0;i<p.length;i+=4){const s=toScreen(p[i],p[i+1]);if(s[0]>0&&s[1]>0&&s[0]<w&&s[1]<h)n++}return [n,p.length/4]})()")
    ok('карта показала диапазон задания', inside == [20, 20] and page.inner_text('#tkTitle') == 'Разбивка · Л 5009 · ПП 1000–1019' and page.inner_text('#tkGo') == 'Начать разбивку', inside)
    from PIL import Image
    import io
    mb = page.locator('#map').bounding_box()
    pt = page.evaluate("toScreen(WORK.task.points[40]+12.5,WORK.task.points[41])")
    k = page.evaluate("devicePixelRatio")
    px = Image.open(io.BytesIO(page.screenshot())).convert('RGB').getpixel((int((mb['x'] + pt[0]) * k), int((mb['y'] + pt[1] + 8) * k)))
    ok('на телефоне карта с заданием открыта во весь экран, плашка задания видна', page.evaluate("isFull()") and page.evaluate("(()=>{const r=document.getElementById('taskBar').getBoundingClientRect();return r.top>0&&r.bottom<=innerHeight})()"))
    ok('диапазон выделен свечением цвета разбивки', px[0] > px[1] + 15 and px[2] > px[1] + 25, px)
    shot('ios_task_glow')
    page.touchscreen.tap(mb['x'] + 60, mb['y'] + 90); page.wait_for_selector('#veil[style*=flex]', timeout=5000)
    ok('касание карты предлагает «Начать разбивку»', page.inner_text('#dYes') == 'Начать разбивку' and 'Л 5009' in page.inner_text('#dTitle'))
    page.click('#dYes'); page.wait_for_function("WORK.state==='run'", timeout=5000)
    ok('работа начата, GPS включён', page.evaluate("GEO.on") and page.is_visible('#tkEnd') and page.inner_text('#tkEnd') == 'Завершить разбивку')
    said = page.evaluate("VOICE.log[VOICE.log.length-1]")
    ok('голос при начале: «Разбивка начата»', said == 'Разбивка начата', said)
    ok('кнопка «Снять пикет здесь» на плашке', page.is_visible('#tkSnap') and page.evaluate("(()=>{const r=document.getElementById('taskBar').getBoundingClientRect();return r.top>0&&r.bottom<=innerHeight})()"))

    # ---- идём по пикетам: засчитывается только в круге 10 м
    page.wait_for_function("GEO.fix", timeout=8000); page.wait_for_timeout(400)       # первое положение от самого браузера уже пришло
    gps(1, 0, 0, 30)
    ok('в 30 метрах пикет не засчитан', page.evaluate("WORK.visited.size") == 0 and '30 м' in page.inner_text('#tkSub'), page.inner_text('#tkSub'))
    gps(1, 0, 6, 6)
    ok('в 8,5 м от пикета — засчитан', page.evaluate("[...WORK.visited]") == [1000])
    ok('голос называет точку парами цифр', page.evaluate("VOICE.log[VOICE.log.length-1]") == 'пятьдесят ноль девять, десять ноль ноль', page.evaluate("VOICE.log[VOICE.log.length-1]"))
    ok('пары цифр: 1497 и 5105', page.evaluate("[spokenNumber(1497),spokenNumber(5105),spokenNumber(1210)]") == ['четырнадцать девяносто семь', 'пятьдесят один ноль пять', 'двенадцать десять'])
    for i in range(1, 12):
        gps(1, i, 3, -2)
    gps(1, 11, 60, 80)                                         # отошёл в сторону: ничего не меняется
    sub = page.inner_text('#tkSub')
    ok('виден процент выполнения', page.evaluate("WORK.visited.size") == 12 and 'Пройдено 12 из 20 · 60 %' in sub, sub)
    shot('ios_task_running')
    page.click('#tkPause'); page.wait_for_timeout(100)
    gps(1, 13)
    ok('на паузе пикеты не засчитываются', page.evaluate("WORK.visited.size") == 12 and page.inner_text('#tkPause') == 'Продолжить')
    page.click('#tkPause'); gps(1, 15); gps(1, 16)
    ok('после паузы можно продолжить в другой точке', page.evaluate("[...WORK.visited].slice(-2)") == [1015, 1016])
    page.wait_for_timeout(700); page.reload(); page.wait_for_function("typeof WORK==='object' && WORK.task && WORK.visited.size===14", timeout=20000)
    ok('пройденное переживает перезапуск приложения (задание на паузе)', page.evaluate("WORK.state") == 'pause')
    page.evaluate("window.BASE=%s" % json.dumps(base))
    go('field', 'F && F.sps.length>0'); page.wait_for_timeout(300)

    # ---- завершение: не дошёл до конца, шёл кусками
    page.click('#tkEnd'); page.wait_for_selector('#veil[style*=flex]', timeout=5000)
    txt = page.inner_text('#dBody')
    ok('вопрос при завершении: откуда докуда прошёл', 'Вы прошли от 1000 до 1011, от 1015 до 1016 (14 из 20)' in txt and 'Внести изменения вашего задания в журнал?' in txt and page.inner_text('#dYes') == 'Да' and page.inner_text('#dNo') == 'Нет', txt)
    shot('ios_task_finish')
    ok('в вопросе можно выбрать исходный вид задания', page.is_visible('#tkOrig') and not page.is_checked('#tkOrig') and 'Непройденное заданием не останется' in txt)
    page.click('#dNo'); page.wait_for_timeout(300)
    ok('«Нет» — изменения не вносятся, работа остановлена', page.evaluate("[WORK.state, WORK.visited.size, S.staked]") == ['idle', 0, 0] and page.is_visible('#tkGo'), page.evaluate("[WORK.state, WORK.visited.size, S.staked]"))
    page.click('#tkGo'); page.wait_for_function("WORK.state==='run'")
    for i in list(range(0, 12)) + [15, 16]:
        gps(1, i)
    page.click('#tkEnd'); page.wait_for_selector('#veil[style*=flex]'); page.click('#dYes')
    page.wait_for_function("document.getElementById('toast').textContent.includes('Внесено в журнал')", timeout=10000)
    rows = page.evaluate("fetch('/api/sheet?name=razb').then(r=>r.json()).then(j=>j.rows.map(r=>[r[3][2],r[3][3],r[3][4],r[2]]))")
    ok('задание разбито на пройденные диапазоны, непройденное заданием не осталось',
       rows == [[5009, 1000, 1011, 1], [5009, 1015, 1016, 1], [5025, 1000, 1004, 0], [5001, 1030, 1039, 0]], rows)
    ok('разбитое на карте, плашка задания убрана', page.evaluate("[S.staked,F.staked.length/6,WORK.task]") == [14, 14, None] and page.is_hidden('#taskBar'))
    shot('ios_field_after')

    # ---- размотка по заданию: прошёл целиком
    go('razm', "Sheets.pages.razm.loaded"); page.click('#p-razm .tkbox summary'); page.wait_for_timeout(200)
    ok('на листе размотки своих заданий нет — показаны все', page.locator('#p-razm .tkrow').count() == 1)
    page.click('#p-razm .tkrow button'); page.wait_for_function("document.querySelector('#p-field.on') && WORK.task && WORK.task.sheet==='razm'", timeout=10000); page.wait_for_timeout(300)
    page.click('#tkGo'); page.wait_for_function("WORK.state==='run'")
    for i in range(10):
        gps(0, i)
    ok('все пикеты пройдены — подсказка завершить', 'Все пикеты задания пройдены' in page.inner_text('#toast') and '100 %' in page.inner_text('#tkSub'))
    page.click('#tkEnd'); page.wait_for_selector('#veil[style*=flex]')
    ok('полное выполнение', 'Задание пройдено полностью' in page.inner_text('#dBody'))
    page.click('#dYes'); page.wait_for_function("S.field===30", timeout=10000)
    ok('размотка по заданию попала на поле', page.evaluate("S.drafts.razm") == 0)
    ok('голос: «Размотка завершена»', page.evaluate("VOICE.log[VOICE.log.length-1]") == 'Размотка завершена')

    # ---- «Снять пикет здесь» и команды голосом
    go('razb', "Sheets.pages.razb.loaded"); page.locator('#p-razb .tkrow', has_text='5025').locator('button').click()
    page.wait_for_function("document.querySelector('#p-field.on') && WORK.task && WORK.task.line===5025", timeout=10000); page.wait_for_timeout(300)
    ok('до начала кнопки «Снять пикет здесь» нет', page.is_hidden('#tkSnap'))
    page.click('#tkGo'); page.wait_for_function("WORK.state==='run'")
    gps(3, 0, 40, 30)
    ok('в 50 м от расчётного места пикет сам не снят', page.evaluate("WORK.visited.size") == 0)
    page.click('#tkSnap'); page.wait_for_timeout(200)
    r = page.evaluate("[[...WORK.visited],WORK.task.points.slice(0,8),VOICE.log[VOICE.log.length-1]]")
    ok('кнопка сняла следующий пикет там, где стоит человек, остальные сдвинулись', r == [[1000], [base[0] + 40, base[1] + 630, 1000, 1, base[0] + 65, base[1] + 630, 1001, 0], 'пятьдесят двадцать пять, десять ноль ноль, готово'], r)
    shot('ios_snap')
    gps(3, 1, 40, 55)
    n = page.evaluate("VOICE.log.length")
    ok('без слова «626» команда не выполняется', page.evaluate("VOICE.hear('снять точку здесь')") is None and page.evaluate("WORK.visited.size") == 1)
    ok('«626» — «Слушаю»', page.evaluate("VOICE.hear('626')") == 'wake' and page.evaluate("VOICE.log[VOICE.log.length-1]") == 'Слушаю')
    ok('команда после «Слушаю»', page.evaluate("VOICE.hear('Снять точку здесь.')") == 'snap')
    r = page.evaluate("[[...WORK.visited],WORK.task.points.slice(4,12),VOICE.log[VOICE.log.length-1]]")
    ok('голосом снят следующий пикет', r == [[1000, 1001], [base[0] + 65, base[1] + 655, 1001, 1, base[0] + 90, base[1] + 655, 1002, 0], 'пятьдесят двадцать пять, десять ноль один, готово'], r)
    gps(3, 2, 42, 52)
    ok('дальше пикеты снимаются сами от нового места', page.evaluate("[...WORK.visited]") == [1000, 1001, 1002] and page.evaluate("VOICE.log[VOICE.log.length-1]") == 'пятьдесят двадцать пять, десять ноль два')
    ok('«шестьсот двадцать шесть, пауза»', page.evaluate("VOICE.hear('шестьсот двадцать шесть, пауза')") == 'pause' and page.evaluate("WORK.state") == 'pause' and page.is_hidden('#tkSnap'))
    ok('«626 продолжить»', page.evaluate("VOICE.hear('626 продолжить')") == 'resume' and page.evaluate("WORK.state") == 'run')
    page.wait_for_timeout(900); page.reload(); page.wait_for_function("typeof WORK==='object' && WORK.task && WORK.visited.size===3", timeout=20000)
    page.evaluate("window.BASE=%s" % json.dumps(base))
    ok('сдвинутые пикеты переживают перезапуск', page.evaluate("WORK.task.points.slice(12,16)") == [base[0] + 115, base[1] + 655, 1003, 0], page.evaluate("WORK.task.points.slice(8,16)"))
    go('data'); page.wait_for_timeout(200)
    ok('в настройках выключатель голоса, включён', page.is_checked('#vcOn'))
    page.uncheck('#vcOn'); page.wait_for_timeout(200)
    go('field', 'F && F.sps.length>0'); page.click('#tkPause'); page.wait_for_function("WORK.state==='run'")
    n = page.evaluate("VOICE.log.length"); gps(3, 3, 40, 55)
    ok('голос выключен: пикет снят молча', page.evaluate("WORK.visited.size") == 4 and page.evaluate("VOICE.log.length") == n and page.evaluate("fetch('/api/prefs').then(r=>r.json()).then(j=>j.voice)") is False)
    go('data'); page.check('#vcOn'); page.wait_for_timeout(200)
    go('field', 'F && F.sps.length>0'); page.click('#tkClose'); page.wait_for_selector('#veil[style*=flex]'); page.click('#dYes'); page.wait_for_timeout(300)

    # ---- размотка с нахлёстом, радиус ползунком, плашка прячется вниз
    rid = page.evaluate("post('/api/sheet/save',{name:'razm',rows:[{id:null,pos:5000,idx:9,v:['2026-10-08','Иванов И. И.',5001,1005,1012,null,null,null,null]}]}).then(j=>j.ids[0])")
    page.evaluate(f"changed(true).then(()=>showTask('razm',{rid}))")
    page.wait_for_function("WORK.task && WORK.task.sheet==='razm' && WORK.task.p1===1005", timeout=10000); page.wait_for_timeout(300)
    page.click('#tkGo'); page.wait_for_function("WORK.state==='run'")
    page.evaluate("(()=>{const r=document.getElementById('tkRad');r.value=20;r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'))})()"); page.wait_for_timeout(200)
    ok('радиус меняется ползунком и запоминается', page.evaluate("WORK.radius") == 20 and page.inner_text('#tkRadV') == '20 м' and page.evaluate("fetch('/api/prefs').then(r=>r.json()).then(j=>j.task_radius)") == 20)
    gps(0, 5, 0, 15)
    ok('в 15 м при радиусе 20 м пикет засчитан', page.evaluate("[...WORK.visited]") == [1005])
    for i in range(6, 13):
        gps(0, i)
    page.click('#tkMin'); page.wait_for_timeout(350)
    ok('плашка прячется вниз: видны только название и ход', page.evaluate("document.getElementById('taskBar').classList.contains('min')") and page.is_hidden('#tkRad') and page.is_hidden('#tkEnd'))
    shot('ios_task_min')
    page.click('#tkTitle'); page.wait_for_timeout(350)
    ok('касание спрятанной плашки возвращает её', not page.evaluate("document.getElementById('taskBar').classList.contains('min')") and page.is_visible('#tkEnd'))
    page.click('#tkEnd'); page.wait_for_selector('#veil[style*=flex]'); page.click('#dYes')
    page.wait_for_function("document.getElementById('dTitle').textContent==='Задание выполнено с нахлёстом'", timeout=8000)
    txt = page.inner_text('#dBody')
    ok('нахлёст: программа сообщает и предлагает выбор', '5 пикетов (ПП 1005–1009)' in txt and page.inner_text('#dYes') == 'С нахлёстом' and page.inner_text('#dNo') == 'Без нахлёста', txt)
    shot('ios_overlap')
    page.click('#dNo'); page.wait_for_function("document.getElementById('toast').textContent.includes('Внесено в журнал')", timeout=10000)
    ok('без нахлёста записаны только новые пикеты', page.evaluate("S.field") == 33, page.evaluate("S.field"))
    page.evaluate("(()=>{const r=document.getElementById('tkRad');r.value=10;r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'))})()")

    # ---- трек
    go('field', 'F && F.sps.length>0')
    gps(2, 0)
    page.click('#tRec'); page.wait_for_function("TRACKS.rec", timeout=5000)
    for i in range(1, 5):
        gps(2, i)
    gps(2, 4, 0, 60, acc=45)                                   # неточное положение: не пишется
    gps(2, 4, 900, 0)                                          # выброс на 900 м за секунду: не пишется
    gps(2, 4, 1, 1)                                            # дрожание на месте: не пишется
    ok('в трек не попали неточные положения, выбросы и дрожание на месте', page.evaluate("TRACKS.rec.pts.length/3") == 5, page.evaluate("TRACKS.rec.pts"))
    page.wait_for_timeout(1100)
    for i in range(5, 7):
        gps(2, i)
    page.reload(); page.wait_for_function("typeof TRACKS==='object' && TRACKS.rec", timeout=20000); page.wait_for_timeout(800)
    page.evaluate("window.BASE=%s" % json.dumps(base))
    ok('запись трека продолжается после перезапуска приложения', page.evaluate("TRACKS.rec.pts.length/3") == 7 and page.is_visible('#recNote'), page.evaluate("TRACKS.rec&&TRACKS.rec.pts.length"))
    go('field', 'F && F.sps.length>0')
    for i in range(7, 9):
        gps(2, i)
    ok('запись трека идёт', page.is_visible('#recNote') and '200 м' in page.inner_text('#recNote') and page.evaluate("TRACKS.rec.pts.length/3") == 9, page.inner_text('#recNote'))
    shot('ios_track_rec')
    page.click('#tRec'); page.wait_for_selector('#trNew'); name = page.input_value('#trNew')
    ok('имя трека предлагается по исполнителю', name.startswith('Топоров Т. Т. '), name)
    page.fill('#trNew', 'Обход линии 5017'); page.click('#dYes'); page.wait_for_function("TRACKS.items.length===1", timeout=5000)
    go('tracks'); page.wait_for_timeout(300)
    row = page.inner_text('#trList')
    ok('трек во вкладке «Треки»: имя, длина, время', 'Обход линии 5017' in row and '200 м' in row and page.is_checked('#trList input'), row)
    shot('ios_tracks')
    page.uncheck('#trList input'); page.wait_for_timeout(300)
    ok('галочка убирает трек с карты', page.evaluate("fetch('/api/tracks').then(r=>r.json()).then(j=>j.items[0].show)") is False)
    page.check('#trList input'); page.wait_for_timeout(300)

    # ---- поиск на карте
    go('field', 'F && F.sps.length>0')
    page.click('#mFind'); page.fill('#findRows .f-line', '5009'); page.fill('#findRows .f-p1', '1020'); page.fill('#findRows .f-p2', '1025')
    page.click('#findRows [data-add]'); page.fill('#findRows .find-row:nth-child(2) .f-p2', '1030'); page.click('#findGo'); page.wait_for_function("FIND.pts.length===28", timeout=5000)
    ok('поиск пикетов: два диапазона', page.inner_text('#findNote').startswith('Найдено: 7 пикетов'), page.inner_text('#findNote'))
    shot('ios_find'); page.click('#findClear'); page.click('#mFind')

    # ---- файл проекта, названный по исполнителю
    go('data'); page.wait_for_timeout(200)
    name = page.input_value('#prjName')
    import re
    ok('имя файла: ФИО, дата и время', re.fullmatch(r'Топоров Т\. Т\. \d\d\.\d\d\.\d{4} \d\dч\d\dм', name) is not None, name)
    ok('треки отмечены, «только задания» выключено', page.is_checked('#prjParts input[data-part=tracks]') and not page.is_checked('#prjOnly') and page.is_disabled('#prjTasks'))
    shot('ios_project_save')
    with page.expect_download() as dl:
        page.click('#prjSave')
    out = os.path.join(d, 'phone.rzm'); dl.value.save_as(out)
    ok('файл сохраняется с этим именем', dl.value.suggested_filename == name + '.rzm', dl.value.suggested_filename)
    page.check('#prjOnly'); page.select_option('#prjTasks', 'razb')
    with page.expect_download() as dl:
        page.click('#prjSave')
    only = os.path.join(d, 'tasks.rzm'); dl.value.save_as(only)
    import zipfile
    j = json.loads(zipfile.ZipFile(only).read('journal.json'))
    ok('«только задания: разбивка» — в файле лишь невыполненные задания', [len(j['sheets'][k]) for k in ('razb', 'razm')] == [2, 0] and all(not r['done'] for r in j['sheets']['razb']))
    page.fill('#prjName', ''); page.evaluate("PREFS.me=null")
    page.click('#prjSave'); page.wait_for_selector('#prjAsk', timeout=5000)
    ok('без отмеченного исполнителя имя спрашивается при сохранении', page.inner_text('#dTitle') == 'Имя файла')
    page.click('#dNo')

    # ---- ПК принимает файл с телефона: табло
    paths.DATA_DIR, paths.BACKUP_DIR = d, os.path.join(d, 'backups')
    rep = project.inspect(db, cfg, [(os.path.basename(out), open(out, 'rb').read())])
    work = {w['sheet']: w for w in rep['changes']['work']}
    ok('табло на ПК: кто сколько выполнил', (work['razb']['who'], work['razb']['tasks'], work['razm']['who']) ==
       ([{'name': 'Топоров Т. Т.', 'rows': 2, 'units': 14}], 0, [{'name': 'Иванов И. И.', 'rows': 2, 'units': 13}]), rep['changes']['work'])
    project.apply(db, cfg, os.path.join(d, 'config.json'), rep['token'], 'merge', ['journal'])
    s = reports.summary(db, cfg)
    ok('на ПК принятое ждёт кнопки', (s['staked'], s['field'], s['drafts']['razb'], s['drafts']['razm']) == (0, 20, 4, 2), (s['staked'], s['field'], s['drafts']))

    ok('ошибок в консоли нет', not errs, errs[:5])
    br.close()
srv.shutdown()
print('\nПровалено: %d' % len(bad), bad if bad else '')
sys.exit(1 if bad else 0)
