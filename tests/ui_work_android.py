# -*- coding: utf-8 -*-
"""Версия для Android (папка android/) - та же, что для iPhone: прогоняются те же проверки работы в поле
и GeoLink (tests/ui_work.py, tests/ui_geolink.py), только страница берётся из android/.
Запуск: python3 tests/ui_work_android.py"""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
env = dict(os.environ, UI_ROOT=os.path.join(os.path.dirname(HERE), 'android'))
bad = 0
for t in ('ui_work.py', 'ui_geolink.py'):
    print('=== android:', t, flush=True)
    bad += subprocess.call([sys.executable, os.path.join(HERE, t)], env=env) != 0
print('\nПровалено: %d' % bad)
sys.exit(1 if bad else 0)
