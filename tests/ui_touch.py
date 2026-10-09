# -*- coding: utf-8 -*-
"""Проверка сенсорного интерфейса (iPhone 14, iPhone SE, iPad) на настоящем Python-сервере со статикой iOS-версии.
Запуск: python3 tests/ui_touch.py   Скриншоты: UI_SHOTS (по умолчанию /tmp/ui_scratch/shots). Жесты - эмуляция CDP, не настоящий iOS."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui_common as u
from ui_common import ok
from playwright.sync_api import sync_playwright


def page_for(p, name, w=None, h=None, landscape=False):
    dev = dict(p.devices[name])
    vp = dict(dev['viewport'])
    if w: vp = {'width': w, 'height': h}
    if landscape: vp = {'width': vp['height'], 'height': vp['width']}
    dev['viewport'] = vp; dev['has_touch'] = True; dev['is_mobile'] = True
    ctx = p.chromium.launch().new_context(**dev, permissions=['clipboard-read', 'clipboard-write'])
    ctx.add_init_script("try{localStorage.setItem('installhint','1')}catch(e){}")      # подсказка про установку мешала бы кликам
    pg = ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    return ctx, pg


def touch(cdp, kind, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def go(pg, h):
    pg.goto(u.URL + '?remote#' + h); pg.wait_for_timeout(1300)


with sync_playwright() as p:
    srv = u.start_server()
    try:
        u.seed()
        # ---- 1. нет горизонтальной прокрутки страницы ----
        for name, w, h, land in [('iPhone SE', 375, 667, False), ('iPhone 14', 390, 844, False), ('iPhone 14', 390, 844, True), ('iPad (gen 7)', 820, 1180, False), ('iPad (gen 7)', 820, 1180, True)]:
            ctx, pg = page_for(p, name, w, h, land)
            tag = '%s %dx%d' % (name, pg.viewport_size['width'], pg.viewport_size['height'])
            for pgname in ['home', 'razm', 'podm', 'field', 'stats', 'check', 'data', 'settings', 'sps']:
                go(pg, pgname)
                if pgname == 'field': pg.evaluate("document.querySelector('#mPresets [data-range=all]').click()"); pg.wait_for_timeout(500)
                sw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
                ok('no hscroll %s #%s' % (tag, pgname), sw[0] <= pg.viewport_size['width'] and sw[1] == pg.viewport_size['width'], sw)
            pg.screenshot(path=u.SHOTS + '/t_%s_%d.png' % (name.split()[0] + name.split()[1][:3], pg.viewport_size['width']))
            ok('no js errors ' + tag, not pg.errs, pg.errs)
            ctx.browser.close()

        # ---- 2. iPhone: меню на главной и нижняя панель вместо выдвижного меню ----
        ctx, pg = page_for(p, 'iPhone 14', 390, 844)
        cdp = ctx.new_cdp_session(pg)
        go(pg, 'razm')
        ok('no burger on phone', not pg.is_visible('#navShow'))
        ok('tab bar visible', pg.is_visible('#tabbar') and pg.evaluate("document.getElementById('tabbar').getBoundingClientRect().bottom") <= 844)
        pg.tap('#tabbar a[data-tab=home]'); pg.wait_for_timeout(700)
        ok('home tab opens main menu', pg.evaluate("location.hash") == '#home' and pg.is_visible('#homeMenu .gh-row[data-p=stats]'))
        pg.tap('#homeMenu .gh-row[data-p=stats]'); pg.wait_for_timeout(700)
        ok('menu row navigates, home tab stays lit', pg.evaluate("location.hash") == '#stats' and pg.evaluate("document.querySelector('#tabbar a[data-tab=home]').classList.contains('on')"))
        pg.tap('#tabbar a[data-tab=data]'); pg.wait_for_timeout(700)
        ok('data tab', pg.evaluate("location.hash") == '#data' and pg.evaluate("document.querySelector('#tabbar a[data-tab=data]').classList.contains('on')"))
        ok('quit hidden on touch', not pg.is_visible('#quit') and pg.evaluate("!!document.getElementById('quit')"))

        # ---- 3. таблица ----
        go(pg, 'razm')
        hh = pg.evaluate("[GX.ROW, GX.HEAD]"); ok('rows >= 44px on touch', hh[0] >= 44 and hh[1] >= 44, hh)
        box = pg.evaluate("(()=>{const r=document.querySelector('#p-razm .gx').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        g = lambda: pg.evaluate("(()=>{const g=Sheets.pages.razm.grid;return {a:g.a,f:g.f,ed:g.editing,act:document.activeElement.className,view:g.view.length}})()")
        def cell_xy(r, c):
            return pg.evaluate("([r,c])=>{const g=Sheets.pages.razm.grid,b=g.el.getBoundingClientRect();return [b.left+GX.GUT+g.x[c]-g.el.scrollLeft+g.cols[c].width/2, b.top+GX.HEAD+r*GX.ROW-g.el.scrollTop+GX.ROW/2]}", [r, c])
        # свернуть вверх, чтобы строки 3-4 были видны
        pg.evaluate("Sheets.pages.razm.grid.scrollToEnd()"); pg.wait_for_timeout(300)
        x, y = cell_xy(12, 1); pg.touchscreen.tap(x, y); pg.wait_for_timeout(150)
        s = g(); ok('tap selects cell', s['a'] == {'r': 12, 'c': 1} and not s['ed'], s)
        pg.touchscreen.tap(x, y); pg.wait_for_timeout(200)
        s = g(); ok('second tap opens editor (activeElement is input)', s['ed'] and 'gx-edit' in s['act'], s)
        ok('accessory bar shown', pg.is_visible('#gxAcc'))
        ok('input >= 16px', pg.evaluate("parseFloat(getComputedStyle(document.querySelector('#p-razm .gx-edit')).fontSize)") >= 16)
        ok('inputmode text for name', pg.evaluate("document.querySelector('#p-razm .gx-edit').inputMode")=='text')
        # кнопка «›» сохраняет и переходит к следующей ячейке, фокус остаётся
        pg.keyboard.type('Иванов И. И.')
        bx = pg.locator('#gxAcc [data-k=next]').bounding_box(); pg.touchscreen.tap(bx['x'] + 5, bx['y'] + 5); pg.wait_for_timeout(250)
        s = g(); ok('next button moves, editor stays focused', s['a']['c'] == 2 and s['ed'] and 'gx-edit' in s['act'], s)
        ok('inputmode numeric for line', pg.evaluate("document.querySelector('#p-razm .gx-edit').inputMode")=='numeric')
        bx = pg.locator('#gxAcc [data-k=done]').bounding_box(); pg.touchscreen.tap(bx['x'] + 5, bx['y'] + 5); pg.wait_for_timeout(250)
        ok('done closes editor and bar', not g()['ed'] and not pg.is_visible('#gxAcc'))
        # дата через запятую
        pg.evaluate("Sheets.pages.razm.grid.select(g=Sheets.pages.razm.grid.view.length,0)") if False else None
        n = g()['view']; x, y = cell_xy(n, 0)
        pg.evaluate("Sheets.pages.razm.grid.scrollToEnd()"); pg.wait_for_timeout(250)
        x, y = cell_xy(n, 0); pg.touchscreen.tap(x, y); pg.touchscreen.tap(x, y); pg.wait_for_timeout(200)
        ok('date input decimal keyboard', pg.evaluate("document.querySelector('#p-razm .gx-edit').inputMode")=='decimal')
        pg.keyboard.type('7,10,26'); bx = pg.locator('#gxAcc [data-k=done]').bounding_box(); pg.touchscreen.tap(bx['x'] + 5, bx['y'] + 5); pg.wait_for_timeout(500)
        ok('date with commas parsed', pg.evaluate("Sheets.pages.razm.grid.view[%d] && Sheets.pages.razm.grid.view[%d].v[0]" % (n, n)) == '2026-10-07')
        # прокрутка пальцем не выделяет и не открывает правку
        before = g()['a']
        touch(cdp, 'touchStart', [(200, 600)]); [touch(cdp, 'touchMove', [(200, 600 - 30 * k)]) for k in range(1, 8)]; touch(cdp, 'touchEnd', []); pg.wait_for_timeout(300)
        s = g(); ok('swipe scroll does not select/edit', s['a'] == before and not s['ed'] and not pg.evaluate("Sheets.pages.razm.grid.selectMode"), s)
        # режим «Выделить»
        pg.wait_for_timeout(1500)                                   # инерция прокрутки после свайпа
        pg.evaluate("Sheets.pages.razm.grid.el.scrollTop=0"); pg.wait_for_function("Sheets.pages.razm.grid.el.scrollTop===0"); pg.wait_for_timeout(500)
        pg.tap('#p-razm .tb[data-t=select]'); pg.wait_for_timeout(400); pg.evaluate("Sheets.pages.razm.grid.el.scrollTop=0"); pg.wait_for_timeout(300)
        x1, y1 = cell_xy(1, 0); pg.touchscreen.tap(x1, y1); pg.wait_for_timeout(350); x2, y2 = cell_xy(3, 1); pg.touchscreen.tap(x2, y2); pg.wait_for_timeout(250)
        s = g(); ok('select mode extends range', s['a'] == {'r': 1, 'c': 0} and s['f'] == {'r': 3, 'c': 1}, s)
        pg.tap('#p-razm .tb[data-t=copy]'); pg.wait_for_timeout(300)
        clip = pg.evaluate("navigator.clipboard.readText()")
        ok('copy button puts TSV in clipboard', clip.count('\n') == 2 and '\t' in clip, repr(clip))
        pg.screenshot(path=u.SHOTS + '/t_grid_sel.png')
        ctx.browser.close()

        # ---- 4. карта ----
        ctx, pg = page_for(p, 'iPhone 14', 390, 844)
        cdp = ctx.new_cdp_session(pg)
        go(pg, 'field'); pg.evaluate("document.querySelector('#mPresets [data-range=all]').click()"); pg.wait_for_timeout(700)
        pg.evaluate("document.getElementById('mapBox').scrollIntoView()"); pg.wait_for_timeout(200)
        r = pg.evaluate("(()=>{const r=cv.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        cx, cy = r[0] + r[2] / 2, r[1] + r[3] / 2
        ok('canvas touch-action none', pg.evaluate("getComputedStyle(cv).touchAction") == 'none')
        s0 = pg.evaluate("V.s")
        touch(cdp, 'touchStart', [(cx - 40, cy), (cx + 40, cy)])
        for k in range(1, 9): touch(cdp, 'touchMove', [(cx - 40 - 6 * k, cy), (cx + 40 + 6 * k, cy)])
        touch(cdp, 'touchEnd', []); pg.wait_for_timeout(200)
        s1 = pg.evaluate("V.s"); ok('pinch changes V.s', s1 > s0 * 1.8, (s0, s1))
        # точка под центром пальцев остаётся на месте
        import math
        w0 = pg.evaluate("toWorld(%f,%f)" % (cx - r[0], cy - r[1]))
        d0 = pg.evaluate("V.deg")
        touch(cdp, 'touchStart', [(cx - 60, cy), (cx + 60, cy)])
        for k in range(1, 13):
            a = math.radians(3 * k); touch(cdp, 'touchMove', [(cx - 60 * math.cos(a), cy - 60 * math.sin(a)), (cx + 60 * math.cos(a), cy + 60 * math.sin(a))])
        touch(cdp, 'touchEnd', []); pg.wait_for_timeout(200)
        d1 = pg.evaluate("V.deg"); ok('two-finger rotation changes V.deg (cw)', d1 != d0 and 28 <= d1 - d0 <= 36, (d0, d1))
        ok('tilt slider in sync', pg.evaluate("+document.getElementById('mTilt').value") == d1)
        w1 = pg.evaluate("toWorld(%f,%f)" % (cx - r[0], cy - r[1]))
        ok('rotation around gesture center', abs(w1[0] - w0[0]) < 3 / pg.evaluate("V.s") and abs(w1[1] - w0[1]) < 3 / pg.evaluate("V.s"), (w0, w1))
        # сдвиг одним пальцем
        o0 = pg.evaluate("[V.ox,V.oy]")
        touch(cdp, 'touchStart', [(cx, cy)]); [touch(cdp, 'touchMove', [(cx + 10 * k, cy + 4 * k)]) for k in range(1, 9)]; touch(cdp, 'touchEnd', []); pg.wait_for_timeout(150)
        o1 = pg.evaluate("[V.ox,V.oy]"); ok('one-finger pan', abs(o1[0] - o0[0] - 80) < 3 and abs(o1[1] - o0[1] - 32) < 3, (o0, o1))
        # двойной тап
        s0 = pg.evaluate("V.s"); pg.touchscreen.tap(cx, cy); pg.wait_for_timeout(60); pg.touchscreen.tap(cx, cy); pg.wait_for_timeout(500)
        ok('double tap zooms in', pg.evaluate("V.s") > s0 * 1.8, (s0, pg.evaluate("V.s")))
        # тап по точке и по пустому месту
        pg.evaluate("setAngle(0);fit()"); pg.wait_for_timeout(300)
        pt = pg.evaluate("(()=>{const p=toScreen(F.field[0],F.field[1]),r=cv.getBoundingClientRect();return [p[0]+r.left,p[1]+r.top]})()")
        pg.touchscreen.tap(pt[0] + 3, pt[1] + 3); pg.wait_for_timeout(250)
        ok('tap on point shows tip', pg.evaluate("getComputedStyle(tip).display") == 'block' and 'Линия' in pg.inner_text('#tip'), pg.inner_text('#tip'))
        pg.wait_for_timeout(500); pg.touchscreen.tap(r[0] + 8, r[1] + r[3] - 60); pg.wait_for_timeout(250)
        ok('tap on empty closes tip', pg.evaluate("getComputedStyle(tip).display") == 'none')
        # шторка инструментов
        pg.tap('#sideShow'); pg.wait_for_timeout(500)
        ok('bottom sheet opens', pg.evaluate("document.getElementById('fieldWrap').classList.contains('sheet-open')") and pg.evaluate("document.getElementById('mapSide').getBoundingClientRect().bottom") <= 844 + 2)
        pg.touchscreen.tap(200, 80); pg.wait_for_timeout(500)
        ok('bottom sheet closes by scrim', not pg.evaluate("document.getElementById('fieldWrap').classList.contains('sheet-open')"))
        # псевдополноэкран
        fs = []; pg.evaluate("(()=>{window.__fs=0; document.documentElement.requestFullscreen=()=>{window.__fs++;return Promise.resolve()}})()")
        pg.tap('#mFull'); pg.wait_for_timeout(400)
        fr = pg.evaluate("(()=>{const r=document.getElementById('fieldWrap').getBoundingClientRect();return [r.left,r.top,r.width,r.height,document.body.classList.contains('mapfull'),window.__fs]})()")
        ok('pseudo-fullscreen covers window, no requestFullscreen', fr[0] == 0 and fr[1] == 0 and fr[2] == 390 and fr[3] == 844 and fr[4] and fr[5] == 0, fr)
        pg.screenshot(path=u.SHOTS + '/t_map_full.png')
        pg.tap('#mFull'); pg.wait_for_timeout(300); ok('exit pseudo-fullscreen', not pg.evaluate("document.body.classList.contains('mapfull')"))
        # поворот устройства
        pg.set_viewport_size({'width': 844, 'height': 390}); pg.wait_for_timeout(500)
        cs = pg.evaluate("[cv.width/mapDpr(), document.getElementById('mapBox').getBoundingClientRect().width]")
        ok('canvas follows rotation', abs(cs[0] - cs[1]) < 1, cs)
        pg.screenshot(path=u.SHOTS + '/t_map_land.png')
        ok('no js errors (map)', not pg.errs, pg.errs)
        ctx.browser.close()
    finally:
        u.stop_server(srv)
u.finish()
