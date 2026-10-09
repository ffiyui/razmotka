#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Версия для Android живёт в папке android/ своей жизнью: с 09.10.2026 она больше НЕ копируется из версии
для iPhone (у iPhone свой дизайн и звуки вместо голоса, у Android - прежние). Правки для Android вносятся прямо
в android/. Этот сценарий только пересобирает офлайн-кэш android/sw.js после таких правок.
Приложение (APK) собирается на GitHub из android/ и native/ само (.github/workflows/android.yml).
Запуск:  python3 tools/build_android.py"""
import os
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'android')

if __name__ == '__main__':
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'build_sw.py'), OUT])
    print('Кэш android/ пересобран; файлы android/ не трогались.')
