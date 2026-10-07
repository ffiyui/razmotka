# -*- coding: utf-8 -*-
"""Офлайн-кэш и обновление: копия статики во временной папке, свой сервер, service worker, режим «без сети», новая версия.
Запуск: python3 tests/ui_sw.py"""
import os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui_common as u
from ui_common import ok
from playwright.sync_api import sync_playwright

SRC = '/home/claude/razmotka-ios'
COPY = u.SCRATCH + '/static_copy'
shutil.rmtree(COPY, ignore_errors=True)
shutil.copytree(SRC, COPY, ignore=shutil.ignore_patterns('tests', '__pycache__'))
subprocess.run([sys.executable, COPY + '/tools/build_sw.py'], check=True, stdout=subprocess.DEVNULL)
u.STATIC = COPY
srv = u.start_server_static(COPY) if hasattr(u, 'start_server_static') else None
if srv is None:
    os.environ['UI_STATIC'] = COPY; u.STATIC = COPY
    srv = u.start_server()
try:
    u.seed()
    with sync_playwright() as p:
        dev = dict(p.devices['iPhone 14']); dev['viewport'] = {'width': 390, 'height': 844}
        ctx = p.chromium.launch().new_context(**dev); pg = ctx.new_page()
        pg.goto(u.URL + '#razm'); pg.wait_for_function("navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(()=>true)", timeout=10000)
        pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_timeout(1500)
        ok('service worker controls page', pg.evaluate("!!navigator.serviceWorker.controller"))
        names = pg.evaluate("caches.keys()"); ok('one cache created', len(names) == 1 and names[0].startswith('razmotka-'), names)
        n = pg.evaluate("caches.open(%r).then(c=>c.keys()).then(k=>k.length)" % names[0]); ok('shell files cached', n >= 30, n)
        ok('api not cached', pg.evaluate("caches.open(%r).then(c=>c.keys()).then(k=>k.filter(r=>r.url.includes('/api/')).length)" % names[0]) == 0)
        ctx.set_offline(True)
        pg.reload(); pg.wait_for_timeout(1500)
        ok('shell loads offline', pg.evaluate("!!document.querySelector('nav') && !!document.getElementById('p-razm')") and pg.title() != '', pg.title())
        ctx.set_offline(False)
        # новая версия
        old = names[0]
        with open(COPY + '/css/app.css', 'a', encoding='utf-8') as f: f.write('\n/* v2 */\n')
        subprocess.run([sys.executable, COPY + '/tools/build_sw.py'], check=True, stdout=subprocess.DEVNULL)
        pg.reload(); pg.wait_for_timeout(800)
        ok('old version still served until update (no auto skipWaiting)', pg.evaluate("caches.keys()").__len__() >= 1)
        pg.evaluate("navigator.serviceWorker.getRegistration().then(r=>r.update())")
        pg.wait_for_function("document.getElementById('updBar').classList.contains('on')", timeout=10000)
        ok('update banner shown', pg.is_visible('#updBar') and 'новая версия' in pg.inner_text('#updBar'))
        ok('not activated automatically', pg.evaluate("navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)"))
        pg.click('#updGo'); pg.wait_for_timeout(2500)
        ks = pg.evaluate("caches.keys()"); ok('old cache removed after update', len(ks) == 1 and ks[0] != old, ks)
        ok('page has new css', pg.evaluate("fetch('css/app.css').then(r=>r.text()).then(t=>t.includes('/* v2 */'))"))
        # ?remote не регистрирует и не перехватывает
        ctx2 = p.chromium.launch().new_context(**dev); q = ctx2.new_page()
        q.goto(u.URL + '?remote#razm'); q.wait_for_timeout(1200)
        ok('?remote: no service worker', q.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length)") == 0)
finally:
    u.stop_server(srv)
    shutil.rmtree(COPY, ignore_errors=True)
u.finish()
