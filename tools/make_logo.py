#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Значки GeoLink (PIL): минималистичный логотип в стиле GitHub - контурная метка на карте,
внутри два звена связи, на тёмном фоне Primer (#0D1117), акцент - синий #58A6FF.
Тот же рисунок, что и в шапке приложения (GL_LOGO в js/journals.js).
Запуск вручную: python3 tools/make_logo.py  ->  icons/*.png"""
import math, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
N = 1024
BG = (13, 17, 23); FG = (240, 246, 252); ACC = (88, 166, 255); RING = (48, 54, 61)


def art(scale, bg=True, rounded=True):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg:
        if rounded:
            d.rounded_rectangle([0, 0, N - 1, N - 1], radius=0, fill=BG + (255,))
        else:
            d.rectangle([0, 0, N, N], fill=BG + (255,))
    u = N / 24 * scale                     # единица сетки 24x24, как у SVG
    ox = oy = N / 2 - 12 * u
    P = lambda x, y: (ox + x * u, oy + y * u)
    w = max(2, int(1.5 * u))
    col = FG + (255,)
    dot = lambda q, cl=col: d.ellipse([q[0] - w / 2, q[1] - w / 2, q[0] + w / 2, q[1] + w / 2], fill=cl)
    # контур метки: дуга окружности r=7.5 вокруг (12, 9.1) и две касательные к острию (12, 21.5)
    cx, cy, r, tip = 12, 9.1, 7.5, (12, 21.5)
    a = math.degrees(math.acos(r / (tip[1] - cy)))
    s1, s2 = 90 + a, 90 - a                       # углы точек касания (ось y вниз)
    c0, c1 = P(cx - r, cy - r), P(cx + r, cy + r)
    rr = (r * u) - w / 2                           # PIL рисует ширину внутрь рамки: рамку расширяем на w/2
    box = [P(cx, cy)[0] - r * u - w / 2, P(cx, cy)[1] - r * u - w / 2, P(cx, cy)[0] + r * u + w / 2, P(cx, cy)[1] + r * u + w / 2]
    d.arc(box, start=s1, end=s2 + 360, fill=col, width=w)
    for ang in (s1, s2):
        t = math.radians(ang); q = P(cx + r * math.cos(t), cy + r * math.sin(t))
        d.line([q, P(*tip)], fill=col, width=w); dot(q)
    dot(P(*tip))
    # два звена связи
    for (x, cl) in ((9.2, FG), (14.8, ACC)):
        c = P(x, 9.2); R = 2.3 * u + w / 2
        d.ellipse([c[0] - R, c[1] - R, c[0] + R, c[1] + R], outline=cl + (255,), width=w)
    return im


def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).convert('RGB').save(os.path.join(OUT, name), optimize=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save(art(.78), 512, 'icon-512.png')
    save(art(.78), 192, 'icon-192.png')
    save(art(.62), 512, 'icon-maskable-512.png')
    save(art(.74), 180, 'apple-touch-icon.png')
    print('ok')
