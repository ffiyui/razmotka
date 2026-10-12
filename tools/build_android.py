#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Версия для Android = версия для iPhone (GeoLink). Сценарий переносит страницу из корня репозитория в папку android/
целиком: index.html, css, engine, js, значки, шрифты, звуки, password.txt; в манифесте - описание для Android.
Затем пересобирает офлайн-кэш android/sw.js. Приложение (APK) собирается на GitHub из android/ и native/ само
(.github/workflows/android.yml); всё, что нужно только приложению (фоновый GPS, сохранение файлов через «Поделиться»,
открытие .rzm), включается само, когда страница работает внутри оболочки (js/native.js).
Запуск после правок версии для iPhone:  python3 tools/build_android.py"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'android')
DIRS = ['css', 'engine', 'js', 'icons', 'fonts', 'sounds']
FILES = ['index.html', 'password.txt', 'sw.js']

if __name__ == '__main__':
    for d in DIRS:
        shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
        if os.path.isdir(os.path.join(ROOT, d)):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d), ignore=shutil.ignore_patterns('logo-src.png', '__pycache__'))
    for f in FILES:
        shutil.copy2(os.path.join(ROOT, f), os.path.join(OUT, f))
    with open(os.path.join(ROOT, 'manifest.webmanifest'), encoding='utf-8') as fh:
        m = json.load(fh)
    m['description'] = m.get('description', '') + ' Версия для Android.'
    with open(os.path.join(OUT, 'manifest.webmanifest'), 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'build_sw.py'), OUT])
    print('android/ обновлена из версии для iPhone.')
