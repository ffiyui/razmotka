#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Готовит офлайн-кэш: читает index.html, собирает список файлов оболочки и общий хэш их содержимого,
пишет версию и список в sw.js между маркерами /*VERSION*/…/*END*/ и /*FILES*/…/*END*/.
Запускать вручную перед каждой выдачей:  python3 tools/build_sw.py
Любое изменение любого файла из списка (и самого sw.js вне маркеров) меняет версию, телефон предложит обновиться."""
import hashlib
import json
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
if len(sys.argv) > 1:                                     # другая папка с приложением, например android/
    ROOT = os.path.abspath(sys.argv[1])
LINK_RELS = {'stylesheet', 'manifest', 'icon', 'apple-touch-icon', 'shortcut icon', 'preload', 'modulepreload'}


class Refs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.files = []

    def add(self, url):
        if not url or re.match(r'^(?:[a-z]+:)?//|^data:|^#', url, re.I):
            return                                          # чужие адреса и встроенные данные в кэш не идут
        url = url.split('#')[0].split('?')[0]
        if url and url not in self.files:
            self.files.append(url)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script':
            self.add(a.get('src'))
        elif tag == 'link' and set((a.get('rel') or '').lower().split()) & LINK_RELS:
            self.add(a.get('href'))


def main():
    index = os.path.join(ROOT, 'index.html')
    with open(index, encoding='utf-8') as f:
        p = Refs(); p.feed(f.read())
    files = ['./', 'index.html'] + p.files
    mf = os.path.join(ROOT, 'manifest.webmanifest')
    if os.path.isfile(mf):                                  # значки из манифеста
        with open(mf, encoding='utf-8') as f:
            for ic in json.load(f).get('icons', []):
                if ic.get('src') and ic['src'] not in files:
                    files.append(ic['src'])
    seen, out = set(), []
    for f in files:
        if f not in seen:
            seen.add(f); out.append(f)
    missing = [f for f in out if f != './' and not os.path.isfile(os.path.join(ROOT, f))]
    if missing:
        sys.exit('Нет файлов, на которые ссылается index.html: ' + ', '.join(missing))

    sw_path = os.path.join(ROOT, 'sw.js')
    with open(sw_path, encoding='utf-8') as f:
        sw = f.read()
    ver_re = re.compile(r"/\*VERSION\*/.*?/\*END\*/", re.S)
    files_re = re.compile(r"/\*FILES\*/.*?/\*END\*/", re.S)
    if not ver_re.search(sw) or not files_re.search(sw):
        sys.exit('В sw.js нет маркеров /*VERSION*/…/*END*/ и /*FILES*/…/*END*/')

    h = hashlib.sha256()
    for f in sorted(x for x in out if x != './'):
        h.update(f.encode('utf-8') + b'\0')
        with open(os.path.join(ROOT, f), 'rb') as fh:
            h.update(fh.read())
        h.update(b'\0')
    h.update(files_re.sub('/*FILES*//*END*/', ver_re.sub('/*VERSION*//*END*/', sw)).encode('utf-8'))   # сама логика sw.js
    h.update(json.dumps(out).encode('utf-8'))
    version = h.hexdigest()[:12]

    sw = ver_re.sub(lambda m: "/*VERSION*/'%s'/*END*/" % version, sw)
    sw = files_re.sub(lambda m: '/*FILES*/' + json.dumps(out, ensure_ascii=False, indent=2).replace('\n', '\n') + '/*END*/', sw)
    with open(sw_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(sw)
    print('Версия %s, файлов в кэше: %d' % (version, len(out)))


if __name__ == '__main__':
    main()
