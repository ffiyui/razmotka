# -*- coding: utf-8 -*-
"""Карта-подложка из интернета: плитки подменяются «шахматной доской», проверяется привязка (угол плитки на экране
стоит там, где его координаты в системе листа SPS), работа с наклоном, сохранение участка и показ без сети.
Запуск: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 python3 tests/ui_tiles.py"""
import os, re, struct, sys, zlib, time, threading, http.server, functools, math
from playwright.sync_api import sync_playwright
ROOT = '/home/claude/razmotka-ios'
D = '/tmp/claude-0/-home-claude/52abce27-64ed-5652-a5bf-b5b8690429c7/scratchpad/xl/data'
SH = '/tmp/ui_scratch/shots'; os.makedirs(SH, exist_ok=True)
bad = []
def ok(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: bad.append(name)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8803), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:8803/'

def png(rgb, n=64):
    raw = b''.join(b'\x00' + bytes(rgb) * n for _ in range(n))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
RED, BLUE = png((230, 30, 30)), png((30, 30, 230))
hits = []; online = [True]
def tile(route):
    u = route.request.url
    if not online[0]: return route.abort()
    m = re.search(r'x=(\d+)&y=(\d+)&z=(\d+)', u)
    if m: a, b = int(m.group(1)), int(m.group(2))
    else:
        m = re.search(r'/(\d+)/(\d+)/(\d+)', u); a, b = int(m.group(2)), int(m.group(3))     # OSM z/x/y, Esri z/y/x: сумма та же
    hits.append(u)
    route.fulfill(status=200, content_type='image/png', headers={'Access-Control-Allow-Origin': '*'}, body=RED if (a + b) % 2 else BLUE)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(**p.devices['iPhone 14'])
    ctx.route(re.compile(r'https://(mt\d\.google\.com|server\.arcgisonline\.com|tile\.openstreetmap\.org)/.*'), tile)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.add_init_script("try{localStorage.setItem('installhint','1')}catch(e){}")
    page.goto(URL); page.wait_for_function('window.RZ && RZ.db', timeout=20000)
    page.evaluate("""async()=>{const rows=[];let n=0;const A=24*Math.PI/180;
      for(let k=0;k<14;k++)for(let i=0;i<120;i++){const x=457000+i*25*Math.cos(A)-k*200*Math.sin(A),y=5704000+i*25*Math.sin(A)+k*200*Math.cos(A);n++;
        rows.push({id:null,pos:n,idx:n-1,v:[5001+8*k,1000+i,+x.toFixed(1),+y.toFixed(1),120]})}
      await fetch('/api/sheet/save',{method:'POST',body:JSON.stringify({name:'sps',rows})})}""")
    page.goto(URL + '#field'); page.wait_for_function('F && F.sps.length>0 && window.GEO && GEO.proj', timeout=15000)
    ok('по умолчанию выключена, запросов нет', page.evaluate('TILES.src') == '' and not hits)
    opts = page.evaluate("[...document.getElementById('tSrc').options].map(o=>o.textContent)")
    ok('в списке Google, Esri и OSM', len(opts) == 6 and 'Google: спутник' in opts, opts)

    def check(label):
        page.wait_for_function("TILES.last && [...TILES.tiles.values()].filter(t=>t.ok).length>=4 && ![...TILES.tiles.values()].some(t=>t.busy)", timeout=10000); page.wait_for_timeout(500)
        r = page.evaluate("""()=>{const b=TILES.last,n=b.n,c0=GEO.calib||{dx:0,dy:0};let x=0,y=0,best=1e9;
          for(let i=b.x0;i<=b.x1+1;i++)for(let j=b.y0;j<=b.y1+1;j++){const q=GEO.proj.fwd(Math.atan(Math.sinh(Math.PI*(1-2*j/n)))*180/Math.PI,i/n*360-180),s=toScreen(q[0]+c0.dx,q[1]+c0.dy),
            dd=Math.hypot(s[0]-cv.clientWidth/2,s[1]-cv.clientHeight/2);if(dd<best){best=dd;x=i;y=j}}
          const lon=x/n*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
          const q=GEO.proj.fwd(lat,lon),c=GEO.calib||{dx:0,dy:0},s=toScreen(q[0]+c.dx,q[1]+c.dy),d=devicePixelRatio;
          const ang=V.deg*Math.PI/180+GEO.proj.convergence(lat,lon)*Math.PI/180;       // куда на экране смотрит «восток» плитки
          const px=(ex,sy)=>{const k=14,X=s[0]+k*(ex*Math.cos(ang)- -sy*Math.sin(ang)*-1),Y=s[1]+k*(ex*Math.sin(ang)*1+sy*Math.cos(ang));
            const p=cv.getContext('2d').getImageData(Math.round(X*d),Math.round(Y*d),1,1).data;return p[0]>p[2]?'R':'B'};
          return {z:b.z,x,y,odd:(x+y)%2,s:s.map(Math.round),q:[px(-1,-1),px(1,-1),px(-1,1),px(1,1)].join('')}}""")
        # вокруг общего угла четырёх плиток цвета идут крест-накрест; правая нижняя плитка - (x, y)
        want = 'RBBR' if r['odd'] else 'BRRB'
        ok(label + ': угол плитки на своём месте', r['q'] == want, r)
        return r

    page.evaluate("(()=>{const e=document.getElementById('tSrc');e.value='gsat';e.onchange()})()")
    r = check('Google, север вверху')
    ok('адрес плиток Google', 'lyrs=s' in hits[0] and 'scale=2' in hits[0], hits[0])
    page.screenshot(path=SH + '/tiles_gsat.png')
    page.evaluate('tilt(35)'); check('наклон 35°')
    page.evaluate('tilt(-120)'); check('наклон −120°')
    page.evaluate('tilt(0)')
    z0 = r['z']
    page.evaluate("(()=>{const r=cv.getBoundingClientRect();V.s*=4;V.ox=r.width/2-(r.width/2-V.ox)*4;V.oy=r.height/2-(r.height/2-V.oy)*4;draw()})()")
    r2 = check('после приближения ×4'); ok('уровень плиток вырос на 2', r2['z'] == z0 + 2, (z0, r2['z']))
    page.evaluate("GEO.calib={dx:300,dy:-200,line:1,picket:1,n:1};draw()"); check('со сдвигом привязки'); page.evaluate("GEO.calib=null;draw()")
    page.evaluate("(()=>{const e=document.getElementById('tSrc');e.value='osm';e.onchange()})()"); check('OpenStreetMap'); ok('адрес OSM', any('tile.openstreetmap.org' in h for h in hits))
    page.evaluate("(()=>{const e=document.getElementById('tSrc');e.value='esri';e.onchange()})()"); check('Esri')
    page.evaluate("(()=>{const e=document.getElementById('tSrc');e.value='gsat';e.onchange()})()"); page.wait_for_timeout(500)
    ok('выбор запомнен в настройках', page.evaluate("fetch('/api/prefs').then(r=>r.json()).then(p=>p.map_tiles.src)") == 'gsat')

    # сохранение участка и показ без сети
    n0 = len(hits); page.evaluate("document.getElementById('tSave').click()")
    page.wait_for_function("document.getElementById('tSave').textContent.startsWith('Сохранить') && /сохранено плиток: \\d+/.test(document.getElementById('tStat').textContent)", timeout=120000)
    cnt = page.evaluate("caches.open('rz-tiles-v1').then(c=>c.keys()).then(k=>k.length)")
    ok('участок сохранён в телефон', cnt > 50 and len(hits) > n0, (cnt, page.evaluate("document.getElementById('tStat').textContent")))
    sw = page.evaluate('!!(navigator.serviceWorker && navigator.serviceWorker.controller)')
    if sw:
        online[0] = False
        page.evaluate("TILES.tiles.clear();draw()")
        page.wait_for_function("[...TILES.tiles.values()].filter(t=>t.ok).length>=4", timeout=10000)
        ok('без сети плитки берутся из телефона', True)
        online[0] = True
    else:
        print('SKIP без сети: service worker не управляет страницей (http без sw в этой проверке)')
    page.evaluate("(()=>{const e=document.getElementById('tSrc');e.value='';e.onchange()})()"); page.wait_for_timeout(300)
    px = page.evaluate("(()=>{const p=cv.getContext('2d').getImageData(4,4,1,1).data;return p[3]})()")
    ok('выключение убирает подложку', page.evaluate('TILES.last') is None and px == 0, px)
    ok('нет ошибок js', not errs, errs[:3])
    br.close()
print('\nПровалено:', len(bad), bad)
sys.exit(1 if bad else 0)
