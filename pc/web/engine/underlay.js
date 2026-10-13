/* Топографические подложки карты: картинки и координаты их углов. Порт app/services/underlay.py.
   Список с привязками лежит в хранилище («underlay:index»), сами картинки - в отдельном хранилище blobs.
   Углы идут по порядку: левый верхний, правый верхний, правый нижний, левый нижний. Координаты - как X и Y листа SPS. */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';
  const ValidationError = RZ.ValidationError;

  const TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif'};
  const MAX_BYTES = 120 * 1024 * 1024;       // телефону хватает: большие снимки браузер всё равно не покажет
  const MAX_COUNT = 30;
  const CORNERS = ['левый верхний', 'правый верхний', 'правый нижний', 'левый нижний'];
  const KEY = 'underlay:index';

  const ext_of = name => { const m = /\.[^./\\]*$/.exec(String(name || '')); return m ? m[0].toLowerCase() : ''; };
  const read = db => (db.get(KEY, []) || []).filter(i => i && typeof i === 'object');
  const write = (db, items) => db.set(KEY, items);

  function find(items, ident) {
    const id = parseInt(ident, 10);
    if (!Number.isFinite(id)) throw new ValidationError('Подложка не найдена.');
    const item = items.find(i => i.id === id);
    if (!item) throw new ValidationError('Подложка не найдена: обновите страницу.');
    return item;
  }

  /* Список подложек. Без привязки (углы не заданы) подложка в список не попадает */
  function load(db) {
    return {items: read(db).filter(i => i.corners).map(i => ({
      id: i.id, name: i.name || 'Подложка', corners: i.corners, opacity: i.opacity ?? 0.7, stamp: i.stamp || 0}))};
  }

  /* {data: Blob, ctype} */
  async function image(db, ident) {
    const item = find(read(db), ident);
    const blob = await db.kv.get_blob('u' + item.id);
    if (!blob) throw new ValidationError('Картинка подложки не найдена.');
    return {data: blob, ctype: TYPES[item.ext] || 'application/octet-stream'};
  }

  /* Принимает картинку. Без номера создаёт новую подложку, с номером заменяет картинку существующей */
  async function save_image(db, name, bytes, ident = null) {
    const ext = ext_of(name);
    if (ext === '.tif' || ext === '.tiff') throw new ValidationError('Формат TIFF браузер не показывает. Сохраните подложку как PNG или JPG и выберите её снова.');
    if (!TYPES[ext]) throw new ValidationError('Подложка должна быть картинкой PNG, JPG, BMP или WEBP.');
    const size = bytes.size ?? bytes.byteLength ?? bytes.length;
    if (!size || size > MAX_BYTES) throw new ValidationError('Файл подложки пустой или больше 120 МБ.');
    const items = read(db);
    let item = ident ? find(items, ident) : null;
    if (!item && items.length >= MAX_COUNT) throw new ValidationError(`Подложек уже ${MAX_COUNT}: уберите ненужные.`);
    if (!item) {
      item = {id: items.reduce((m, i) => Math.max(m, i.id), 0) + 1, corners: null, opacity: 0.7};
      items.push(item);
    }
    const base = String(name).replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').slice(0, 120);
    if (!item.name) item.name = base;
    item.ext = ext; item.stamp = Math.floor(Date.now() / 1000);
    await db.kv.put_blob('u' + item.id, bytes instanceof Blob ? bytes : new Blob([bytes], {type: TYPES[ext]}));
    write(db, items);
    return {ok: true, id: item.id};
  }

  /* Углы: список из четырёх пар [x, y] или null. Возвращает приведённый список либо ValidationError */
  function check_corners(raw) {
    if (!Array.isArray(raw) || raw.length !== 4) throw new ValidationError('Нужны координаты четырёх углов (часть можно оставить пустыми).');
    const corners = [];
    raw.forEach((item, k) => {
      const name = CORNERS[k];
      if (item === null || item === undefined || (Array.isArray(item) && ((item[0] === null && item[1] === null) || (item[0] === '' && item[1] === '')))) { corners.push(null); return; }
      if (!Array.isArray(item) || item.length !== 2) throw new ValidationError(`Угол «${name}»: нужны X и Y.`);
      const x = RZ.sh.parse_num(item[0]), y = RZ.sh.parse_num(item[1]);
      if (x === null || y === null) throw new ValidationError(`Угол «${name}»: X и Y должны быть числами (оба).`);
      corners.push([x, y]);
    });
    const given = corners.map((c, i) => (c ? i : -1)).filter(i => i >= 0);
    const key = given.join();
    if (given.length < 2 || (given.length === 2 && key !== '0,2' && key !== '1,3'))
      throw new ValidationError('Заполните два противоположных угла (если подложка не повёрнута) или не меньше трёх углов.');
    const pts = given.map(i => corners[i]);
    if (given.length === 2) {
      if (pts[0][0] === pts[1][0] || pts[0][1] === pts[1][1]) throw new ValidationError('Противоположные углы должны отличаться и по X, и по Y.');
    } else {
      const [[x1, y1], [x2, y2], [x3, y3]] = pts;
      if (Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)) < 1e-9) throw new ValidationError('Углы лежат на одной прямой: проверьте координаты.');
    }
    return corners;
  }

  const check = j => { check_corners(j.corners); return {ok: true}; };

  /* Привязка и название подложки. Можно передать только часть: например, одну прозрачность */
  function save_meta(db, j) {
    const items = read(db), item = find(items, j.id);
    if ('corners' in j) item.corners = check_corners(j.corners);
    if ('name' in j) item.name = String(j.name || '').trim().slice(0, 120) || 'Подложка';
    if ('opacity' in j) { const o = parseFloat(j.opacity); if (Number.isFinite(o)) item.opacity = Math.min(1, Math.max(0.05, o)); }
    write(db, items);
    return {ok: true};
  }

  async function remove(db, ident) {
    const items = read(db), item = find(items, ident);
    await db.kv.del_blob('u' + item.id);
    write(db, items.filter(i => i !== item));
    return {ok: true};
  }

  RZ.underlay = {load, image, save_image, check, save_meta, remove, check_corners, TYPES};
})(globalThis.RZ);
