#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Доводит созданный Capacitor проект Android: разрешения (GPS в фоне, уведомление фоновой службы, микрофон),
подпись постоянным ключом (иначе новая версия не встанет поверх старой), номер версии, значок приложения."""
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, 'android', 'app')
RUN = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 1

# ---- разрешения и службы
mf = os.path.join(APP, 'src', 'main', 'AndroidManifest.xml')
s = open(mf, encoding='utf-8').read()
if 'xmlns:tools' not in s:
    s = s.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
perms = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION',
         'POST_NOTIFICATIONS', 'RECORD_AUDIO', 'WAKE_LOCK', 'INTERNET']
block = ''.join(f'    <uses-permission android:name="android.permission.{p}" />\n' for p in perms if f'android.permission.{p}"' not in s)
block += '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n'
block += ('    <queries>\n'
          '        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>\n'
          '        <intent><action android:name="android.speech.RecognitionService" /></intent>\n'
          '    </queries>\n')
s = s.replace('<application', block + '\n    <application', 1)
service = ('        <service android:name="com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService"\n'
           '            android:foregroundServiceType="location" android:exported="false"\n'
           '            tools:replace="android:foregroundServiceType" />\n')
s = s.replace('</application>', service + '    </application>', 1)
open(mf, 'w', encoding='utf-8').write(s)

# ---- подпись и номер версии
gr = os.path.join(APP, 'build.gradle')
g = open(gr, encoding='utf-8').read()
g = re.sub(r'versionCode\s+\d+', f'versionCode {RUN}', g)
g = re.sub(r'versionName\s+"[^"]*"', f'versionName "1.{RUN}"', g)
sign = ('    signingConfigs {\n        release {\n            storeFile file("../../razmotka.keystore")\n'
        '            storePassword "razmotka-sp10"\n            keyAlias "razmotka"\n            keyPassword "razmotka-sp10"\n        }\n    }\n')
g = g.replace('    buildTypes {', sign + '    buildTypes {', 1)
g = re.sub(r'(buildTypes\s*\{\s*release\s*\{)', r'\1\n            signingConfig signingConfigs.release', g, count=1)
open(gr, 'w', encoding='utf-8').write(g)

# ---- значок: картинки из native/res, фон адаптивного значка - цвет значка приложения
res = os.path.join(APP, 'src', 'main', 'res')
for d in os.listdir(os.path.join(HERE, 'res')):
    for f in os.listdir(os.path.join(HERE, 'res', d)):
        os.makedirs(os.path.join(res, d), exist_ok=True)
        shutil.copy2(os.path.join(HERE, 'res', d, f), os.path.join(res, d, f))
bg = os.path.join(res, 'values', 'ic_launcher_background.xml')
if os.path.isfile(bg):
    t = open(bg, encoding='utf-8').read()
    open(bg, 'w', encoding='utf-8').write(re.sub(r'#[0-9A-Fa-f]{6,8}', '#5AA8FC', t))

# ---- заставка при запуске: значок на светлом фоне вместо значка Capacitor
try:
    from PIL import Image
    icon = Image.open(os.path.join(HERE, '..', 'icons', 'icon-512.png')).convert('RGBA')
    for root, _, files in os.walk(res):
        for f in files:
            if f == 'splash.png':
                p = os.path.join(root, f)
                w, h = Image.open(p).size
                img = Image.new('RGBA', (w, h), (230, 234, 243, 255))
                n = max(48, min(w, h) // 4)
                img.alpha_composite(icon.resize((n, n), Image.LANCZOS), ((w - n) // 2, (h - n) // 2))
                img.convert('RGB').save(p)
except Exception as e:                                   # без Pillow останется заставка по умолчанию
    print('splash:', e)
print('Проект Android доведён: версия', RUN)
