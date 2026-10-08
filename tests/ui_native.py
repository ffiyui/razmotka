# Приложение для Android: связка с оболочкой (подставной Capacitor с плагинами). Запуск: python3 tests/ui_native.py
import functools, http.server, threading, json, os
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'android')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8811), functools.partial(Q, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
MOCK = r"""
window.__calls=[];window.__watch=null;
const mk=(name,impl)=>new Proxy(impl,{get:(t,k)=>t[k]||(async(...a)=>{__calls.push([name,k,a]);return {}})});
window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'android',isPluginAvailable:()=>true,registerPlugin:n=>mk(n,{
  addWatcher:async(o,cb)=>{__calls.push([n,'addWatcher',[o]]);window.__watch=cb;return 'w1'},
  getSupportedVoices:async()=>({voices:[{name:'ru-ru-x-ruf-local',lang:'ru-RU'},{name:'ru-ru-x-ruc-local',lang:'ru-RU'}]}),
  speak:async(o)=>{__calls.push([n,'speak',[o]])},
  writeFile:async(o)=>{__calls.push([n,'writeFile',[{path:o.path,len:o.data.length,directory:o.directory}]]);return {uri:'file:///cache/'+o.path}},
  share:async(o)=>{__calls.push([n,'share',[o]])},
})};
try{localStorage.setItem('installhint','1')}catch(e){}
"""
ok = lambda n, c, x='': print(('OK   ' if c else 'FAIL ') + n + (' | ' + str(x) if x != '' else ''))
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(**p.devices['Pixel 7']); ctx.add_init_script(MOCK)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:8811/'); pg.wait_for_function("typeof S==='object' && S && window.VOICE", timeout=20000); pg.wait_for_timeout(1500)
    ok('NATIVE подключён, офлайн-кэш не регистрируется', pg.evaluate("!!window.NATIVE && !navigator.serviceWorker.controller"))
    pg.evaluate("geoStart()"); pg.wait_for_timeout(300)
    c = pg.evaluate("__calls.filter(c=>c[1]==='addWatcher')")
    ok('GPS через фоновую службу', len(c) == 1 and c[0][2][0]['backgroundTitle'] == 'Размотка СП10' and pg.evaluate("GEO.watch") == 'w1', c)
    pg.evaluate("__watch({latitude:51.4652,longitude:56.3954,accuracy:4,bearing:null,speed:null,time:Date.now()})"); pg.wait_for_timeout(200)
    ok('положение из службы доходит до карты', pg.evaluate("!!GEO.xy && GEO.fix.acc===4"))
    pg.evaluate("VOICE.say('Разбивка начата')"); pg.wait_for_timeout(200)
    sp = pg.evaluate("__calls.filter(c=>c[1]==='speak').map(c=>c[2][0])")
    ok('голос через системный синтез, мужской голос выбран', sp and sp[-1]['text'] == 'Разбивка начата' and sp[-1]['lang'] == 'ru-RU' and sp[-1]['voice'] == 1 and pg.evaluate("VOICE.male"), sp)
    pg.evaluate("location.hash='#data'"); pg.wait_for_timeout(800)
    ok('список голосов в настройках', pg.evaluate("[...document.querySelectorAll('#vcVoice option')].map(o=>o.value)") == ['ru-ru-x-ruf-local', 'ru-ru-x-ruc-local'])
    pg.evaluate("saveBlob(new Blob(['abc']),'Проба 08.10.2026.rzm')"); pg.wait_for_timeout(500)
    fs = pg.evaluate("__calls.filter(c=>c[1]==='writeFile'||c[1]==='share').map(c=>[c[1],c[2][0]])")
    ok('файл сохраняется через «Поделиться»', [f[0] for f in fs] == ['writeFile', 'share'] and fs[1][1]['files'] == ['file:///cache/Проба 08.10.2026.rzm'], fs)
    ok('ошибок нет', not errs, errs)
    br.close()
srv.shutdown()
