#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Значки GeoLink по эталону icons/logo-src.png (белый знак «< / >»: вешка, вбитая в землю, на чёрном).
Эталон увеличивается в 4 раза со сглаживанием и порогом - края получаются ровными, затем уменьшается до нужного размера.
Получаются: icon-192/512 (скруглённый чёрный квадрат), icon-maskable-512 (знак в безопасной зоне), apple-touch-icon
(чёрный квадрат во весь размер: iPhone скругляет сам) и logo-mark.png (белый знак без фона - для шапки приложения).
Запуск вручную: python3 tools/make_logo.py  ->  icons/*.png"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')
BIG = 2048


def mark():
    """Белый знак (маска L, BIG x BIG): эталон, увеличенный и сглаженный"""
    src = Image.open(os.path.join(OUT, 'logo-src.png')).convert('L')
    m = src.resize((BIG, BIG), Image.BICUBIC).filter(ImageFilter.GaussianBlur(BIG / 441 * .9))
    return m.point(lambda v: 255 if v > 128 else 0)


def icon(size, rounded=True, scale=1.0):
    m = mark()
    if scale != 1.0:                                   # знак меньше - для maskable (безопасная зона)
        k = int(BIG * scale); s = m.resize((k, k), Image.LANCZOS)
        m = Image.new('L', (BIG, BIG), 0); m.paste(s, ((BIG - k) // 2, (BIG - k) // 2))
    bg = Image.new('L', (BIG, BIG), 0)
    if rounded: ImageDraw.Draw(bg).rounded_rectangle([0, 0, BIG - 1, BIG - 1], radius=int(BIG * .055), fill=255)
    else: bg = Image.new('L', (BIG, BIG), 255)
    out = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', (BIG, BIG), (0, 0, 0, 255)), (0, 0), bg)
    out.paste(Image.new('RGBA', (BIG, BIG), (255, 255, 255, 255)), (0, 0), m)
    return out.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    icon(512).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    icon(192).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    icon(512, rounded=False, scale=.82).convert('RGB').save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    icon(180, rounded=False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    m = mark().resize((256, 256), Image.LANCZOS)
    w = Image.new('RGBA', (256, 256), (255, 255, 255, 0)); w.putalpha(m)
    w.crop(w.getbbox()).save(os.path.join(OUT, 'logo-mark.png'), optimize=True)
    print('ok')
