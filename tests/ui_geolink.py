# -*- coding: utf-8 -*-
"""GeoLink на iPhone: журналы и свои листы, вкладки, барабан-фильтр, слои своих листов на карте, метки со значками,
учёт по журналам с ТОП лидеров, звуки нажатий, режим отладки. Запуск: python3 tests/ui_geolink.py"""
import functools, http.server, os, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.environ.get('UI_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.environ.get('UI_SHOTS', tempfile.mkdtemp()); os.makedirs(SHOTS, exist_ok=True)
bad = []


def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond:
        bad.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8806), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:8806/'

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(**p.devices['iPhone 14'])
    ctx.add_init_script("try{localStorage.setItem('installhint','1')}catch(e){}")
    if os.environ.get('UI_LITE') in ('0', '1'):
        ctx.add_init_script("try{localStorage.setItem('lite','%s')}catch(e){}" % os.environ['UI_LITE'])
    page = ctx.new_page(); errs = []
    page.set_default_timeout(15000)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'favicon' not in m.text and 'serviceWorker' not in m.text else None)
    shot = lambda name: page.screenshot(path=f'{SHOTS}/{name}.png')

    def go(tab, wait='true'):
        page.evaluate(f"location.hash='#{tab}'"); page.wait_for_function(f"document.querySelector('#p-{tab}.on') && ({wait})", timeout=15000); page.wait_for_timeout(400)

    page.goto(URL); page.wait_for_function("typeof S==='object' && S && !document.getElementById('splash')", timeout=20000); page.wait_for_timeout(500)
    page.evaluate("""(async()=>{const r=v=>v.map((x,k)=>({id:null,pos:k+1,idx:k,v:x}));
      const sps=[];for(const [k,l] of [[0,5001],[1,5009]])for(let i=0;i<40;i++)sps.push([l,1000+i,457000+25*i,5704000+200*k,120]);
      await post('/api/sheet/save',{name:'sps',rows:r(sps)});
      await post('/api/sheet/save',{name:'workers',rows:r([[1,'Иванов И. И.',null],[2,'Петров П. П.',null]])});
      await post('/api/sheet/save',{name:'razm',rows:r([['2026-10-07','Иванов И. И.',5009,1000,1019,null,null,null,null],['2026-10-08','Петров П. П.',5009,1020,1024,null,null,null,null]])});
      await post('/api/sheet/apply',{name:'razm',force:true});changed(true)})()""")
    page.wait_for_function("S.field===25", timeout=10000)
    # ---- GeoLink: журналы, свои листы, барабан, слои, метки, учёт, отладка
    page.evaluate("location.hash='#home'"); page.wait_for_timeout(600)
    ok('шапка GeoLink, название приложения', page.inner_text('#homeBrand .gl-name') == 'GeoLink' and page.title().startswith('GeoLink'), page.title())
    ok('журналы ГФО и ТГО — карточки с карандашом', page.evaluate("[...document.querySelectorAll('#homeMenu .jcard .jc-t b')].map(b=>b.textContent)")[:2] == ['Журнал ГФО', 'Журнал ТГО'] and page.locator('#homeMenu .jc-edit').count() >= 2)
    page.fill('#homeNote', 'строка 1\nстрока 2\nстрока 3\nстрока 4\nстрока 5\nстрока 6'); page.dispatch_event('#homeNote', 'input'); page.wait_for_timeout(200)
    ok('заметка выше 4 строк сворачивается, есть кнопка «вниз»', page.is_visible('#homeNoteMore'))
    page.click('#jAdd'); page.wait_for_selector('#niName'); page.fill('#niName', 'Геодезия'); page.click('#dYes')
    page.wait_for_function("location.hash.startsWith('#c') && Sheets.pages[location.hash.slice(1)] && Sheets.pages[location.hash.slice(1)].loaded", timeout=10000); page.wait_for_timeout(300)
    wid = page.evaluate("location.hash.slice(1)")
    ok('новый журнал: лист работ и лист ID во вкладках', page.evaluate(f"[...document.querySelectorAll('#p-{wid} .jtabs .jt span')].map(s=>s.textContent)") == ['Работы', 'ID исполнителей'])
    ids = page.evaluate(f"NAV.groups.find(g=>g.items.includes('{wid}')).items[1]")
    fp = [5001, 1000]
    page.evaluate(f"post('/api/sheet/save',{{name:'{ids}',rows:[{{id:null,pos:1000,idx:0,v:[31,'Вешкин В. В.',null]}}]}})")
    page.evaluate(f"post('/api/sheet/save',{{name:'{wid}',rows:[{{id:null,pos:1000,idx:0,v:['2026-10-09','Вешкин В. В.',{fp[0]},{fp[1]},{fp[1]+4},null,null,null]}}]}}).then(()=>post('/api/sheet/apply',{{name:'{wid}',force:true}})).then(()=>changed(true))")
    page.wait_for_function(f"S.done && S.done['{wid}']===5", timeout=10000)
    page.evaluate(f"Sheets.pages['{wid}'].loaded=false; location.hash='#razm'"); page.wait_for_timeout(300)
    page.evaluate(f"location.hash='#{wid}'"); page.wait_for_function(f"Sheets.pages['{wid}'].loaded", timeout=10000); page.wait_for_timeout(300)
    ok('кол-во выполненных пикетов — на вкладке вида работ', '5' in page.inner_text(f'#p-{wid} .sh-done'), page.inner_text(f'#p-{wid} .sh-done') if page.locator(f'#p-{wid} .sh-done').count() else '')
    page.evaluate(f"void Sheets.pages['{wid}'].wheelFilter(1)"); page.wait_for_selector('.wheel-veil.on')
    ok('барабан по заголовку столбца: значения столбца', page.evaluate("[...WHEEL.list.children].map(r=>r.textContent)") == ['Вешкин В. В.'])
    page.evaluate("document.getElementById('toast').style.display='none'"); shot('ios_wheel'); page.evaluate("document.getElementById('toast').style.display=''")
    page.evaluate("WHEEL.ok()"); page.wait_for_timeout(300)
    ok('фильтр барабаном включён, значок на заголовке', page.evaluate(f"Sheets.pages['{wid}'].filtered && Sheets.pages['{wid}'].grid.flt.has(1)"))
    page.evaluate(f"Sheets.pages['{wid}'].clearFilter()")
    page.evaluate("location.hash='#field'"); page.wait_for_function(f"document.querySelector('#p-field.on') && F.custom && F.custom['{wid}'] && F.custom['{wid}'].length===30", timeout=10000); page.wait_for_timeout(300)
    ok('карта — только карта: без заголовка с каналами', page.is_hidden('#fieldTitle') and page.is_hidden('#fieldLead'))
    ok('выполненное по своему листу — отдельный слой с разворачиваемой строкой', page.evaluate(f"!!document.querySelector('#lgCustom label[data-c={wid}] .lg-more')"))
    page.click('#sideShow'); page.wait_for_timeout(400)
    page.click(f'#lgCustom label[data-c={wid}] .lg-more'); page.wait_for_timeout(200)
    ok('строка слоя разворачивается: форма, размер, цвет', page.evaluate("!!document.querySelector('#lgCustom .lg-panel .shape-grid') && !!document.querySelector('#lgCustom .lg-panel .st-size')"))
    shot('ios_layers')
    page.click('#sideHide'); page.wait_for_timeout(400)
    page.click('#mMark'); box = page.locator('#map').bounding_box()
    page.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); page.wait_for_selector('#niName')
    page.fill('#niName', 'Лукойл'); page.click('#niIcon'); page.wait_for_selector('.ip-t[data-cat=fuel]'); page.click('.ip-t[data-cat=fuel]'); page.click('.ip-i[data-icon=barrel]'); page.click('#dYes')
    page.wait_for_selector('#niName'); page.wait_for_timeout(100); page.click('#dYes'); page.wait_for_timeout(400)
    ok('метка с значком из темы «Топливо»', page.evaluate("PREFS.marks && PREFS.marks.length===1 && PREFS.marks[0].icon==='barrel' && PREFS.marks[0].text==='Лукойл'"), page.evaluate("PREFS.marks"))
    shot('ios_mark')
    page.evaluate("location.hash='#stats'"); page.wait_for_function("document.querySelector('#p-stats.on') && document.querySelectorAll('#sTabs .jt').length>=3", timeout=10000); page.wait_for_timeout(400)
    page.click('#sAll'); page.wait_for_timeout(500)
    ok('учёт: вкладки по журналам, ТОП с кубками', page.evaluate("[...document.querySelectorAll('#sTabs .jt span')].map(s=>s.textContent)")[:3] == ['Журнал ГФО', 'Журнал ТГО', 'Геодезия'] and page.locator('#sTop ol.top li.p1 .cup').count() >= 1, page.evaluate("[[...document.querySelectorAll('#sTabs .jt span')].map(s=>s.textContent), $('sFrom').value, $('sTo').value, $('sTop').innerText.slice(0,300)]"))
    page.click('#sAll'); page.wait_for_timeout(300)
    page.click('#sTabs .jt:nth-child(3)'); page.wait_for_timeout(500)
    ok('ТОП по своему журналу, период «Всё»', 'Вешкин В. В.' in page.inner_text('#sTop') and page.is_hidden('#sGfo'))
    page.click('#s7'); page.wait_for_timeout(300)
    ok('период «Неделя» и «На поле по линиям» в учёте', page.evaluate("$('sFrom').value") != '' and page.evaluate("!!document.querySelector('#p-stats #lines')"))
    shot('ios_stats')
    page.click('#sTabs .jt:nth-child(1)')
    go('settings'); page.wait_for_timeout(200)
    ok('в настройках: звук нажатий, анимация, режим отладки', page.is_checked('#tapSnd') and page.is_checked('#animOn') and not page.is_checked('#godOn'))
    page.check('#sndOn'); page.wait_for_timeout(100)
    n = page.evaluate("ui.log.length"); page.click('#crsSave'); page.wait_for_timeout(150)
    ok('звук нажатия кнопки', page.evaluate(f"ui.log.slice({n}).includes('press')"), page.evaluate(f"ui.log.slice({n})"))
    page.check('#godOn'); page.wait_for_timeout(200)
    h = page.locator('#godCard h3').bounding_box()
    page.mouse.move(h['x'] + 10, h['y'] + h['height'] / 2); page.mouse.down(); page.wait_for_timeout(700); page.mouse.up()
    page.wait_for_selector('#godText'); page.fill('#godText', 'Режим бога'); page.click('#dYes'); page.wait_for_timeout(300)
    ok('режим отладки: текст изменён и сохранён', page.inner_text('#godCard h3') == 'Режим бога' and page.evaluate("PREFS.texts['Режим отладки']") == 'Режим бога')
    page.wait_for_timeout(1500); page.reload(); page.wait_for_function("typeof S==='object' && S && window.GOD", timeout=20000); page.wait_for_timeout(1200)
    ok('после перезапуска изменённый текст на месте', page.evaluate("document.querySelector('#godCard h3').textContent") == 'Режим бога')
    page.evaluate("GOD.setOn(false); post('/api/prefs',{god:false,texts:{}})")

    ok('ошибок в консоли нет', not errs, errs[:5])
    br.close()
srv.shutdown()
print('\nПровалено: %d' % len(bad), bad if bad else '')
sys.exit(1 if bad else 0)
