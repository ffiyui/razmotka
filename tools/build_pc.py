#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Программа для ПК (папка pc/) = GeoLink, как на телефоне. Сценарий копирует страницу из корня репозитория
в pc/web/: index.html, css, engine, js, значки, шрифты, звуки, password.txt, манифест.
Запуск после правок версии для iPhone:  python3 tools/build_pc.py"""
import os
import shutil

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'pc', 'web')
DIRS = ['css', 'engine', 'js', 'icons', 'fonts', 'sounds']
FILES = ['index.html', 'password.txt', 'manifest.webmanifest']

if __name__ == '__main__':
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for d in DIRS:
        if os.path.isdir(os.path.join(ROOT, d)):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d), ignore=shutil.ignore_patterns('logo-src.png', '__pycache__'))
    for f in FILES:
        shutil.copy2(os.path.join(ROOT, f), os.path.join(OUT, f))
    print('pc/web обновлена из версии для iPhone.')
