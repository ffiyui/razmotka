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
    # ---- пароль: первый запуск спрашивает, дальше нет; пароль сменили в файле - снова спрашивает
    pc = br.new_context(**p.devices['iPhone 14']); pp = pc.new_page()
    pp.goto(URL); pp.wait_for_selector('#passGate #passIn', timeout=20000)
    ok('пароль при первом запуске', pp.is_visible('#passGate'))
    pp.fill('#passIn', '0000'); pp.click('#passGate .btn'); pp.wait_for_timeout(200)
    ok('неверный пароль не пускает', pp.is_visible('#passGate') and 'Неверный' in pp.inner_text('#passErr'))
    pp.fill('#passIn', '1234'); pp.click('#passGate .btn'); pp.wait_for_timeout(200)
    ok('пароль 1234 из файла password.txt принят', pp.locator('#passGate').count() == 0 and pp.evaluate("localStorage.getItem('gl_pass')") == '1234')
    pp.reload(); pp.wait_for_function("window.PASS", timeout=20000); pp.evaluate("PASS.ready"); pp.wait_for_timeout(300)
    ok('второй запуск без пароля', pp.locator('#passGate').count() == 0)
    pp.route('**/password.txt*', lambda r: r.fulfill(status=200, body='5678\n', headers={'content-type': 'text/plain'}))
    pp.reload(); pp.wait_for_selector('#passGate #passIn', timeout=20000)
    ok('пароль в файле изменён — спрашивает снова', 'изменился' in pp.inner_text('#passGate'))
    pp.fill('#passIn', '5678'); pp.click('#passGate .btn'); pp.wait_for_timeout(200)
    ok('новый пароль принят', pp.locator('#passGate').count() == 0)
    pc.set_offline(True); pp.unroute('**/password.txt*')
    pp.evaluate("localStorage.setItem('gl_pass','9999')"); pp.evaluate("location.reload()"); pp.wait_for_timeout(2500)
    ok('без интернета пароль не спрашивается', pp.locator('#passGate').count() == 0)
    pc.close()

    ctx = br.new_context(**p.devices['iPhone 14'])
    ctx.add_init_script("try{localStorage.setItem('installhint','1');localStorage.setItem('gl_pass','1234')}catch(e){}")
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
      const ss=[];for(let i=0;i<20;i++)ss.push([7001,200+i,457010+50*i,5704100,120]);
      await post('/api/sheet/save',{name:'spss',rows:r(ss)});
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
    # ---- одна вкладка SPS: страницы R и S, добавить новую
    ok('в меню один пункт «SPS»', page.evaluate("[...document.querySelectorAll('#navlist a')].filter(a=>/SPS/.test(a.textContent)).map(a=>a.dataset.p)") == ['sps'])
    page.evaluate("location.hash='#sps'"); page.wait_for_function("document.querySelector('#p-sps.on') && Sheets.pages.sps.loaded", timeout=10000); page.wait_for_timeout(300)
    ok('на странице SPS вкладки R и S', page.evaluate("[...document.querySelectorAll('#p-sps .jtabs .jt span')].map(s=>s.textContent)") == ['R — пункты приёма', 'S — пункты возбуждения'])
    page.click('#p-sps .jtabs .jt:nth-child(2)'); page.wait_for_function("document.querySelector('#p-spss.on') && Sheets.pages.spss.loaded", timeout=10000)
    ok('страница S открывается вкладкой, в меню подсвечен «SPS»', page.evaluate("Sheets.pages.spss.grid.rows.filter(r=>r.v[0]!==null).length") == 20 and page.evaluate("!!document.querySelector('#navlist a.on[data-p=sps]')"))
    page.click('#p-spss .jtabs .jt-add'); page.wait_for_selector('#askText'); page.fill('#askText', 'SPS доп'); page.click('#dYes')
    page.wait_for_function("location.hash.startsWith('#c') && Sheets.pages[location.hash.slice(1)] && Sheets.pages[location.hash.slice(1)].meta.kind==='sps'", timeout=10000); page.wait_for_timeout(400)
    xid = page.evaluate("location.hash.slice(1)")
    page.wait_for_timeout(2500); shot('ios_sps')
    ok('новая страница SPS — третьей вкладкой', page.evaluate(f"[...document.querySelectorAll('#p-{xid} .jtabs .jt span')].map(s=>s.textContent)") == ['R — пункты приёма', 'S — пункты возбуждения', 'SPS доп'])
    page.evaluate(f"post('/api/sheet/save',{{name:'{xid}',rows:[{{id:null,pos:1,idx:0,v:[9001,1,457100,5704300,100]}},{{id:null,pos:2,idx:1,v:[9001,2,457125,5704300,100]}}]}}).then(()=>{{dirty.field=true}})")
    page.evaluate("location.hash='#home'"); page.wait_for_timeout(500); shot('ios_home')
    ok('знак GeoLink в шапке', page.evaluate("(()=>{const i=document.querySelector('#homeBrand img.gl-logo');return !!i && i.getAttribute('src')==='icons/logo-mark.png'})()"))
    page.evaluate("location.hash='#field'"); page.wait_for_function(f"document.querySelector('#p-field.on') && F.custom && F.custom['{wid}'] && F.custom['{wid}'].length===30", timeout=10000); page.wait_for_timeout(300)
    ok('на карте снова список размотанных линий с каналами', page.is_visible('#p-field #lines') and '5009' in page.inner_text('#lines') and 'каналов на поле: 25' in page.text_content('#linesTitle'), page.text_content('#linesTitle'))
    ok('проектные SPS: R и S отдельными слоями', page.evaluate("[F.sps.length/2, F.sps_s.length/2]") == [80, 20])
    page.click('#sideShow'); page.wait_for_timeout(400)
    tabs = page.evaluate("[...document.querySelectorAll('#lgTabs .jt')].map(b=>b.textContent)")
    ok('слои по вкладкам: «Проектные SPS» отдельно, дальше журналы', tabs[0] == 'Проектные SPS' and 'Журнал ГФО' in tabs and 'Геодезия' in tabs and tabs[-1] == 'Прочее', tabs)
    ok('в «Проектных SPS» включаются отдельно R и S', page.is_visible('#lSps') and page.is_visible('#lSpsS') and page.is_hidden('#lField'))
    ok('добавленная страница SPS — своим слоем там же', page.is_visible(f'#legend .lg-pane[data-pane=sps] label[data-c={xid}]') and page.evaluate(f"F.sps_x['{xid}'].length") == 4)
    page.uncheck('#lSpsS'); page.wait_for_timeout(150)
    ok('S выключается отдельно', page.evaluate("$('lSps').checked && !$('lSpsS').checked")); page.check('#lSpsS')
    page.click("#lgTabs .jt:text('Геодезия')"); page.wait_for_timeout(150)
    ok('выполненное по своему листу — в вкладке своего журнала, строка разворачивается', page.is_visible(f'#legend label[data-c={wid}]') and page.is_hidden('#lSps'))
    page.click(f'#legend label[data-c={wid}] .lg-more'); page.wait_for_timeout(200)
    ok('строка слоя разворачивается: форма, размер, цвет', page.evaluate("!!document.querySelector('#legend .lg-panel .shape-grid') && !!document.querySelector('#legend .lg-panel .st-size')"))
    shot('ios_layers')
    opts = page.evaluate("[...document.querySelectorAll('#mKind option')].map(o=>o.textContent)")
    ok('период на карте — по виду работ', opts[:2] == ['Размотка и подмотка', 'Разбивка'] and 'Работы' in opts, opts)
    page.select_option('#mKind', wid); page.fill('#mFrom', '2026-10-10'); page.fill('#mTo', '2026-10-11'); page.dispatch_event('#mTo', 'change'); page.wait_for_timeout(300)
    ok('вне периода выполненное своего листа не показывается', page.evaluate(f"perArr('{wid}', F.custom['{wid}']).length") == 0 and 'Работы' in page.inner_text('#mCount') or page.evaluate(f"perArr('{wid}', F.custom['{wid}']).length") == 0, page.inner_text('#mCount'))
    page.fill('#mFrom', '2026-10-01'); page.dispatch_event('#mFrom', 'change'); page.wait_for_timeout(300)
    ok('за период — 5 пикетов', page.evaluate(f"perArr('{wid}', F.custom['{wid}']).length/6") == 5 and '5 пикетов' in page.inner_text('#mCount'), page.inner_text('#mCount'))
    page.select_option('#mKind', 'gfo'); page.dispatch_event('#mKind', 'change')
    page.click('#sideHide'); page.wait_for_timeout(400)
    # касание точки: плашка, фото с рисованием и описание
    pt = page.evaluate(f"(()=>{{const a=F.custom['{wid}'],p=toScreen(a[0],a[1]),r=cv.getBoundingClientRect();return [p[0]+r.left,p[1]+r.top]}})()")
    page.touchscreen.tap(pt[0], pt[1]); page.wait_for_timeout(300)
    ok('касание точки — маленькая плашка, фото сразу не открывается', page.is_visible('#pCard') and 'Линия 5001' in page.inner_text('#pCard') and page.locator('#ntText').count() == 0 or (page.is_visible('#pCard') and not page.is_visible('#ntText')), page.inner_text('#pCard'))
    page.click('#pCard [data-a=open]'); page.wait_for_selector('#ntText')
    import base64, struct, zlib
    def png(w, h):
        raw = b''.join(b'\x00' + b'\x80\x90\xa0' * w for _ in range(h))
        ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
    page.set_input_files('#ntFile', files=[{'name': 'photo.png', 'mimeType': 'image/png', 'buffer': png(320, 240)}])
    page.wait_for_selector('.ped canvas'); page.wait_for_timeout(300)
    cb = page.locator('.ped canvas').bounding_box()
    page.mouse.move(cb['x'] + 20, cb['y'] + 20); page.mouse.down(); page.mouse.move(cb['x'] + cb['width'] - 30, cb['y'] + cb['height'] - 30, steps=8); page.mouse.up()
    ok('на фото можно рисовать', page.evaluate("NOTES.editor.strokes.length") == 1)
    shot('ios_draw')
    page.click('.ped [data-a=ok]'); page.wait_for_timeout(300)
    page.fill('#ntText', 'Колышек сбит, нужна замена'); page.click('#dYes'); page.wait_for_timeout(500)
    ok('фото и описание точки сохранены', page.evaluate("(()=>{const n=NOTES.all['p:5001:1000'];return !!n && n.photo && n.text==='Колышек сбит, нужна замена'})()"), page.evaluate("NOTES.all"))
    page.touchscreen.tap(pt[0], pt[1]); page.wait_for_timeout(300)
    ok('в плашке видно, что есть фото и описание', 'Колышек' in page.inner_text('#pCard'))
    page.click('#pCard [data-a=open]'); page.wait_for_selector('#ntImg')
    ok('по кнопке открывается фото и описание', page.evaluate("$('ntImg').naturalWidth") == 320 and page.input_value('#ntText').startswith('Колышек'))
    shot('ios_note')
    page.click('#dNo'); page.wait_for_timeout(200)
    # расстояние до точки
    page.evaluate("geoInject({lat:51.4652,lon:56.3954,acc:4})") if page.evaluate("typeof geoInject==='function'") else None
    page.evaluate("GEO.xy=[457000,5703900]; GEO.fix={acc:4}")
    page.click('#mDist'); page.wait_for_timeout(500)
    page.evaluate("GEO.xy=[457000,5703900]; GEO.fix={acc:4}")
    page.touchscreen.tap(pt[0], pt[1]); page.wait_for_timeout(300)
    ok('расстояние до выбранной точки', page.is_visible('#distChip') and 'ПП 1000' in page.inner_text('#distChip') and ' м' in page.inner_text('#distChip'), page.inner_text('#distChip'))
    page.evaluate("FIND.pts=[457000,5703950,5001,1000,457025,5703950,5001,1001]; DIST.manual=null; draw()")
    ok('диапазон: сначала до первого пикета', 'ПП 1000' in page.inner_text('#distChip') and '50 м' in page.inner_text('#distChip'), page.inner_text('#distChip'))
    page.evaluate("GEO.xy=[457000,5703948]; draw()")
    ok('дошли до первого — указатель на следующий', 'ПП 1001' in page.inner_text('#distChip'), page.inner_text('#distChip'))
    shot('ios_dist')
    page.click('#mDist'); page.evaluate("FIND.pts=[]; draw()")
    # трек: остановить без сохранения
    page.evaluate("T.rec={t0:Date.now()-60000,pts:[457000,5703900,0,457010,5703900,5,457020,5703900,10],len:20}")
    page.click('#tRec'); page.wait_for_selector('#trDrop'); page.click('#trDrop'); page.wait_for_timeout(200)
    page.click('#dYes'); page.wait_for_timeout(300)
    ok('запись трека остановлена без сохранения', page.evaluate("TRACKS.rec===null && TRACKS.items.length===0"), page.evaluate("[!!TRACKS.rec, TRACKS.items.length]"))
    page.click('#mMark'); box = page.locator('#map').bounding_box()
    page.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2 + 60); page.wait_for_selector('#niName')
    page.fill('#niName', 'Лукойл'); page.click('#niIcon'); page.wait_for_selector('.ip-t[data-cat=fuel]'); page.click('.ip-t[data-cat=fuel]'); page.click('.ip-i[data-icon=barrel]'); page.click('#dYes')
    page.wait_for_selector('#niName'); page.wait_for_timeout(100); page.click('#dYes'); page.wait_for_timeout(400)
    ok('метка с значком из темы «Топливо»', page.evaluate("PREFS.marks && PREFS.marks.length===1 && PREFS.marks[0].icon==='barrel' && PREFS.marks[0].text==='Лукойл'"), page.evaluate("PREFS.marks"))
    mp = page.evaluate("(()=>{const m=PREFS.marks[0],p=toScreen(m.x,m.y),r=cv.getBoundingClientRect();return [p[0]+r.left,p[1]+r.top]})()")
    page.touchscreen.tap(mp[0], mp[1]); page.wait_for_timeout(300)
    ok('касание метки — плашка с кнопками фото и изменения', page.is_visible('#pCard') and 'Лукойл' in page.inner_text('#pCard') and page.locator('#pCard [data-a=edit]').count() == 1)
    shot('ios_mark')
    page.click('#pCard [data-a=close]')
    page.evaluate("location.hash='#stats'"); page.wait_for_function("document.querySelector('#p-stats.on') && document.querySelectorAll('#sTabs .jt').length>=3", timeout=10000); page.wait_for_timeout(400)
    page.click('#sAll'); page.wait_for_timeout(500)
    ok('учёт: у каждого журнала своя вкладка', page.evaluate("[...document.querySelectorAll('#sTabs .jt span')].map(s=>s.textContent)")[:3] == ['Журнал ГФО', 'Журнал ТГО', 'Геодезия'])
    ok('ГФО: виды работ отдельно, показан один — размотка', page.evaluate("[...document.querySelectorAll('#sKinds .st-k')].map(b=>b.textContent)")[:2] == ['Размотка', 'Подмотка'] and page.evaluate("document.querySelector('#sKinds .st-k.on').dataset.k") == 'razm' and page.text_content('#sFig').startswith('25Размотка, каналов'), page.text_content('#sFig'))
    ok('ТОП лидеров с кубками', page.locator('#sTop ol.top li.p1 .cup').count() == 1 and page.locator('#sTop ol.top li.p2 .cup').count() == 1)
    page.click('#sKinds .st-k[data-k=podm]'); page.wait_for_timeout(400)
    ok('подмотка — своя статистика', page.text_content('#sFig').startswith('0Подмотка, каналов'), page.text_content('#sFig'))
    page.click('#sTabs .jt:nth-child(3)'); page.wait_for_timeout(500)
    ok('свой журнал: ТОП и линии', 'Вешкин В. В.' in page.inner_text('#sTop') and '5001' in page.inner_text('#sLines'))
    page.click('#s7'); page.wait_for_timeout(300)
    ok('период «Неделя»', page.evaluate("$('sFrom').value") != '')
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
