#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Рисует значки программы (PIL, без внешних шрифтов): профили поля, оранжевая точка разматывает линию.
Запуск вручную: python3 tools/make_icons.py  ->  icons/*.png"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
N = 1024                                   # рисуем крупно, потом уменьшаем
ORANGE = (242, 122, 10); BLUE_TOP = (64, 156, 255); BLUE_BOT = (0, 88, 214)


def gradient():
    """Мягкий диагональный переход синего: светлее сверху-слева, глубже снизу-справа, лёгкий тёплый отсвет в углу."""
    g = Image.new('RGB', (N, N))
    px = g.load()
    for y in range(N):
        for x in range(N):
            t = (x * .45 + y * .55) / N
            t = max(0, min(1, t))
            c = [BLUE_TOP[i] + (BLUE_BOT[i] - BLUE_TOP[i]) * t for i in range(3)]
            px[x, y] = tuple(int(v) for v in c)
    return g


def art(scale):
    """Профили поля: ряды пикетов (точки). Одна линия уже уложена (белая) и оранжевая точка ведёт её дальше.
    Прозрачный слой RGBA N x N; scale < 1 уменьшает рисунок (для maskable: в безопасной зоне)."""
    layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = cy = N / 2
    step = 62 * scale
    for j in (-2, -1, 0, 1, 2):
        y = cy + j * 118 * scale
        half = (330 - abs(j) * 14) * scale
        n = int(2 * half / step)
        xs = [cx - half + i * (2 * half / n) for i in range(n + 1)]
        xd = xs[int(n * .6)]                                                    # здесь сейчас оранжевая точка
        r = 17 * scale
        for x in xs:
            if j == 0 and x <= xd:
                continue
            if j == -1 and x <= xs[int(n * .86)]:
                d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 205))
            else:
                d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 105))
        if j == 0:                                                              # уложенная часть и оранжевая точка
            w = int(34 * scale)
            d.line([(xs[0], y), (xd, y)], fill=(255, 255, 255, 255), width=w)
            d.ellipse([xs[0] - w / 2, y - w / 2, xs[0] + w / 2, y + w / 2], fill=(255, 255, 255, 255))
            R = 62 * scale
            d.ellipse([xd - R - 15 * scale, y - R - 15 * scale, xd + R + 15 * scale, y + R + 15 * scale], fill=(255, 255, 255, 255))
            d.ellipse([xd - R, y - R, xd + R, y + R], fill=ORANGE + (255,))
    layer = layer.rotate(-9, resample=Image.BICUBIC, center=(cx, cy))
    shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    shadow.putalpha(layer.split()[3].point(lambda v: int(v * .3)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16)).transform((N, N), Image.AFFINE, (1, 0, 0, 0, 1, -16))
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    out.alpha_composite(shadow); out.alpha_composite(layer)
    return out


def tile(scale):
    base = gradient().convert('RGBA')
    # верхний блик
    hl = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([-N * .3, -N * .95, N * 1.3, N * .3], fill=(255, 255, 255, 40))
    base.alpha_composite(hl.filter(ImageFilter.GaussianBlur(110)))
    base.alpha_composite(art(scale))
    return base


def rounded(img, r):
    m = Image.new('L', (N * 2, N * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, N * 2 - 1, N * 2 - 1], radius=r * 2, fill=255)
    m = m.resize((N, N), Image.LANCZOS)
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0)); out.paste(img, (0, 0), m)
    return out


def save(img, name, size, alpha):
    im = img.resize((size, size), Image.LANCZOS)
    if not alpha:
        bg = Image.new('RGB', (size, size), (0, 88, 214)); bg.paste(im, (0, 0), im); im = bg
    im.save(os.path.join(OUT, name), optimize=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    full = tile(1.0)
    save(full, 'apple-touch-icon.png', 180, False)                 # iOS скругляет сам: полный квадрат без прозрачности
    save(rounded(full, 228), 'icon-192.png', 192, True)
    save(rounded(full, 228), 'icon-512.png', 512, True)
    save(tile(.74), 'icon-maskable-512.png', 512, False)            # рисунок внутри безопасной зоны 80%
    print('Значки записаны в', os.path.abspath(OUT))
