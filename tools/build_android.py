#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает копию приложения для Android в папке android/ этого же репозитория.
Код один и тот же: страница, стили, движок и скрипты копируются как есть (отличия Android - подсказки про установку,
геолокацию и голос - код выбирает сам по телефону). У копии свой манифест и свой офлайн-кэш, чтобы приложения
для iPhone и Android на одном адресе не стирали кэш друг друга.
Запускать после tools/build_sw.py перед каждой выдачей:  python3 tools/build_android.py"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'android')
PARTS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'engine', 'icons']


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for name in PARTS:
        src, dst = os.path.join(ROOT, name), os.path.join(OUT, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    mf = os.path.join(OUT, 'manifest.webmanifest')
    with open(mf, encoding='utf-8') as f:
        m = json.load(f)
    m['id'] = './'
    m['description'] = m.get('description', '') + ' Версия для Android.'
    with open(mf, 'w', encoding='utf-8') as f:
        json.dump(m, f, ensure_ascii=False, indent=2); f.write('\n')
    sw = os.path.join(OUT, 'sw.js')
    with open(sw, encoding='utf-8') as f:
        s = f.read()
    old = "const PREFIX = 'razmotka-';"
    if old not in s:
        sys.exit('В sw.js не найдена строка с именем кэша')
    with open(sw, 'w', encoding='utf-8') as f:
        f.write(s.replace(old, "const PREFIX = 'rzm-android-';"))
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'build_sw.py'), OUT])
    print('Копия для Android: android/')


if __name__ == '__main__':
    main()
