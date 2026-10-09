/* Набор значков GeoLink: для журналов, листов и меток на карте. Контурные, 24×24, цвет - currentColor.
   Разбиты по темам, чтобы нужный значок было легко найти. Логотипов компаний здесь нет: у топливных бочек -
   общий значок бочки, а название компании пишется подписью метки. */
const ICON_CATS = [
  ['work', 'Работы'], ['equip', 'Оборудование'], ['transport', 'Транспорт'], ['fuel', 'Топливо'],
  ['place', 'Местность'], ['signs', 'Знаки'], ['animals', 'Животные'],
];
const ICONS = {
  // ---- работы
  flagpole: ['work', 'Вешка с лентой', '<path d="M7 21V3"/><path d="M7 4c3-1.6 5 1.6 8 0v6c-3 1.6-5-1.6-8 0"/><path d="M5 21h4"/>'],
  reel: ['work', 'Размотка провода', '<circle cx="9" cy="12" r="6"/><circle cx="9" cy="12" r="2"/><path d="M15 12c2.5 0 3 3 6 3"/>'],
  rewind: ['work', 'Подмотка провода', '<circle cx="15" cy="12" r="6"/><circle cx="15" cy="12" r="2"/><path d="M9 12c-2.5 0-3-3-6-3"/><path d="M5 7L3 9l2 2"/>'],
  stake: ['work', 'Разбивка, колышек', '<path d="M12 21l-2-6h4z"/><path d="M12 15V4"/><path d="M12 4l5 2-5 2"/>'],
  survey: ['work', 'Тахеометр', '<rect x="8" y="3" width="8" height="6" rx="1"/><path d="M12 9v3"/><path d="M12 12l-6 9M12 12l6 9M12 12v9"/>'],
  route: ['work', 'Профиль, линия', '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h4a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"/>'],
  journal: ['work', 'Журнал', '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/>'],
  idcard: ['work', 'ID, люди', '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.5 1.7-2 3-2s2.4.5 3 2"/><path d="M14 10h4M14 13h3"/>'],
  team: ['work', 'Бригада', '<circle cx="8" cy="8" r="3"/><path d="M3 20c.6-3.5 2.6-5 5-5s4.4 1.5 5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15 15.5c.6-.3 1.3-.5 2-.5 2 0 3.6 1.3 4 4.5"/>'],
  table: ['work', 'Таблица', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11"/>'],
  check: ['work', 'Готово', '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9"/>'],
  // ---- оборудование
  geophone: ['equip', 'Геофон', '<rect x="8" y="3" width="8" height="8" rx="2"/><path d="M12 11v6"/><path d="M10 17h4l-2 4z"/><path d="M16 6c2 0 3 1 4 2"/>'],
  battery: ['equip', 'Аккумулятор', '<rect x="3" y="7" width="16" height="11" rx="2"/><path d="M19 10.5h2v4h-2"/><path d="M7 12.5h4M9 10.5v4"/><path d="M14 12.5h2"/>'],
  cable: ['equip', 'Провод', '<path d="M4 7h3v4H4z"/><path d="M17 13h3v4h-3z"/><path d="M7 9c6 0 4 6 10 6"/>'],
  station: ['equip', 'Станция', '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M8 13h8M8 16h5"/><path d="M12 9V5"/><path d="M8.5 4.5a5 5 0 0 1 7 0"/><path d="M6 2.5a8.5 8.5 0 0 1 12 0"/>'],
  antenna: ['equip', 'Антенна', '<path d="M12 21V9"/><path d="M8 21l4-12 4 12"/><path d="M8.5 6.5a5 5 0 0 1 7 0"/><path d="M6 4a8.5 8.5 0 0 1 12 0"/>'],
  box: ['equip', 'Ящик, склад', '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'],
  tools: ['equip', 'Ремонт', '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5"/><path d="M5 3l4 4-2 2-4-4"/>'],
  // ---- транспорт
  car: ['transport', 'Машина', '<path d="M3 15v-3l2-5h14l2 5v3"/><path d="M3 15h18v3H3z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/><path d="M6 12h12"/>'],
  truck: ['transport', 'Грузовик (КамАЗ)', '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/><path d="M15 9v4h6"/>'],
  tracked: ['transport', 'Вездеход', '<rect x="3" y="14" width="18" height="5" rx="2.5"/><path d="M5 14V9h9l3 5"/><path d="M7 9V6h5v3"/><circle cx="7" cy="16.5" r=".8"/><circle cx="12" cy="16.5" r=".8"/><circle cx="17" cy="16.5" r=".8"/>'],
  atv: ['transport', 'Квадроцикл', '<circle cx="6" cy="16" r="3"/><circle cx="18" cy="16" r="3"/><path d="M9 16h6l-2-5H9l-2 2"/><path d="M13 11l1-3h3"/>'],
  boat: ['transport', 'Лодка', '<path d="M3 15h18l-3 5H6z"/><path d="M12 15V4l6 9h-6"/>'],
  // ---- топливо (название компании - подписью метки)
  barrel: ['fuel', 'Топливная бочка', '<ellipse cx="12" cy="5" rx="6" ry="2"/><path d="M6 5v14c0 1.1 2.7 2 6 2s6-.9 6-2V5"/><path d="M6 10c0 1.1 2.7 2 6 2s6-.9 6-2"/><path d="M6 15c0 1.1 2.7 2 6 2s6-.9 6-2"/>'],
  canister: ['fuel', 'Канистра', '<path d="M6 7h12v14H6z"/><path d="M9 7V4h4l2 3"/><path d="M8.5 10.5l7 7M15.5 10.5l-7 7"/>'],
  pump: ['fuel', 'Заправка', '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3 21h12"/><path d="M6 8h6"/><path d="M14 11h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3"/>'],
  drop: ['fuel', 'Пятно, разлив', '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>'],
  // ---- местность
  ravine: ['place', 'Овраг', '<path d="M2 8h5l3 8h4l3-8h5"/><path d="M10 16l2-3 2 3"/>'],
  house: ['place', 'Дом', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'],
  base: ['place', 'База, лагерь', '<path d="M3 20l9-15 9 15z"/><path d="M12 5v15"/><path d="M9 20l3-5 3 5"/><path d="M12 5V2l4 1.5-4 1.5"/>'],
  tree: ['place', 'Лес', '<path d="M12 3l6 8h-3l4 6H5l4-6H6z"/><path d="M12 17v4"/>'],
  water: ['place', 'Вода, река', '<path d="M2 9c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/><path d="M2 14c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/><path d="M2 19c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/>'],
  bridge: ['place', 'Мост, переезд', '<path d="M2 9h20"/><path d="M4 9v10M20 9v10"/><path d="M4 16c3-4 13-4 16 0"/>'],
  swamp: ['place', 'Болото', '<path d="M3 17c2 0 2-1.5 4-1.5S9 17 11 17s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 2-1.5"/><path d="M8 14V8M12 14V5M16 14V9"/><path d="M12 5l-2 2M8 8l-2 1.5M16 9l2 1.5"/>'],
  hill: ['place', 'Высота', '<path d="M2 20l7-12 4 6 3-4 6 10z"/>'],
  road: ['place', 'Дорога', '<path d="M8 3L5 21M16 3l3 18"/><path d="M12 4v3M12 10v4M12 17v3"/>'],
  // ---- знаки
  warning: ['signs', 'Внимание', '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'],
  cross: ['signs', 'Крест', '<path d="M6 6l12 12M18 6L6 18"/>'],
  stop: ['signs', 'Запрет', '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'],
  question: ['signs', 'Вопрос', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7"/><path d="M12 17h.01"/>'],
  info: ['signs', 'Сведения', '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'],
  flag: ['signs', 'Флаг', '<path d="M5 21V4"/><path d="M5 4h12l-3 4 3 4H5"/>'],
  star: ['signs', 'Звезда', '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'],
  pin: ['signs', 'Точка', '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'],
  // ---- животные
  bear: ['animals', 'Медведь', '<circle cx="6.5" cy="6" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><path d="M5 12a7 7 0 0 1 14 0c0 4.4-3.1 8-7 8s-7-3.6-7-8z"/><ellipse cx="12" cy="15.5" rx="3" ry="2.2"/><path d="M12 14.5v1"/><path d="M9 11h.01M15 11h.01"/>'],
  lynx: ['animals', 'Рысь', '<path d="M5 3l2 6M19 3l-2 6"/><path d="M5 3v-.5M19 3v-.5"/><path d="M6 9a6 6 0 0 1 12 0v3c0 4-2.7 8-6 8s-6-4-6-8z"/><path d="M6 14l-3 1M18 14l3 1"/><path d="M10 12h.01M14 12h.01"/><path d="M11 16h2l-1 1z"/>'],
  moose: ['animals', 'Лось', '<path d="M3 4c0 3 2 4 5 4M21 4c0 3-2 4-5 4"/><path d="M5 3v2M19 3v2"/><path d="M8 8c1-1 2.3-1.5 4-1.5S15 7 16 8l-.5 7c-.3 3-1.6 5-3.5 5s-3.2-2-3.5-5z"/><path d="M10.5 18h3"/><path d="M10 11h.01M14 11h.01"/>'],
  deer: ['animals', 'Олень', '<path d="M8 8C6 6 5 3 6 2M8 5L6 4M16 8c2-2 3-5 2-6M16 5l2-1"/><path d="M8 9a4 4 0 0 1 8 0l-1 7c-.5 3-1.6 5-3 5s-2.5-2-3-5z"/><path d="M10 12h.01M14 12h.01"/><path d="M11 18h2"/>'],
  cow: ['animals', 'Корова', '<path d="M4 6c1 1 2.5 1.5 4 1M20 6c-1 1-2.5 1.5-4 1"/><path d="M7 8a5 5 0 0 1 10 0v4H7z"/><rect x="7.5" y="12" width="9" height="7" rx="3.5"/><path d="M10 15.5h.01M14 15.5h.01"/><path d="M10 10h.01M14 10h.01"/>'],
  fox: ['animals', 'Лиса', '<path d="M4 3l4 6h8l4-6"/><path d="M4 3l1 9 7 9 7-9 1-9"/><path d="M9 12h.01M15 12h.01"/><path d="M11 17h2l-1 1.2z"/>'],
  dog: ['animals', 'Собака', '<path d="M6 4L3 9l3 3M18 4l3 5-3 3"/><path d="M6 4h12v9a6 6 0 0 1-12 0z"/><path d="M10 10h.01M14 10h.01"/><path d="M10.5 15h3l-1.5 1.5z"/>'],
  cat: ['animals', 'Кот', '<path d="M5 4l3 4M19 4l-3 4"/><path d="M5 4v8a7 7 0 0 0 14 0V4"/><path d="M9.5 12h.01M14.5 12h.01"/><path d="M11 15h2l-1 1z"/><path d="M5 14l-3 .5M19 14l3 .5"/>'],
  bird: ['animals', 'Птица', '<path d="M3 12c3-1 5-4 8-4 2 0 3.5 1 4.5 2.5L21 9l-3 4c-1 4-4 6-8 6-3 0-5-2-5-4"/><path d="M14 10.5h.01"/><path d="M8 13c1 1.5 3 2 5 1"/>'],
  wolf: ['animals', 'Волк', '<path d="M4 3l3 5M20 3l-3 5"/><path d="M4 3l1 8 4 8h6l4-8 1-8"/><path d="M9 11h.01M15 11h.01"/><path d="M10 15l2 2 2-2"/>'],
  paw: ['animals', 'След зверя', '<ellipse cx="12" cy="16" rx="4" ry="3.5"/><circle cx="6" cy="10" r="1.8"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/>'],
};
const iconSvg = (name, size = 18, cls = '') => {
  const i = ICONS[name] || ICONS.pin;
  return `<svg class="ic${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i[2]}</svg>`;
};
/* Картинка значка для холста карты (кэш по имени, цвету и размеру) */
const iconImgCache = new Map();
function iconImage(name, color, px) {
  const key = name + color + px;
  if (iconImgCache.has(key)) return iconImgCache.get(key);
  const i = ICONS[name] || ICONS.pin;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${i[2]}</svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  img.onload = () => { if (typeof draw === 'function') draw(); };
  iconImgCache.set(key, img);
  return img;
}
/* Окно выбора значка: темы - вкладками сверху, значки - сеткой. Возвращает имя значка или null */
function pickIcon(current, title = 'Значок') {
  return new Promise(res => {
    let cat = (ICONS[current] || ICONS.pin)[0];
    const grid = () => Object.entries(ICONS).filter(([, v]) => v[0] === cat)
      .map(([k, v]) => `<button type="button" class="ip-i${k === current ? ' on' : ''}" data-icon="${k}" title="${esc(v[1])}">${iconSvg(k, 24)}<span>${esc(v[1])}</span></button>`).join('');
    const tabs = () => ICON_CATS.map(([k, t]) => `<button type="button" class="ip-t${k === cat ? ' on' : ''}" data-cat="${k}">${esc(t)}</button>`).join('');
    const p = ask(title, `<div class="ip"><div class="ip-tabs">${tabs()}</div><div class="ip-grid">${grid()}</div></div>`, 'Готово', false, true);
    $('dNo').textContent = 'Отмена';
    let chosen = current;
    const box = $('dBody').querySelector('.ip');
    box.onclick = e => {
      const t = e.target.closest('.ip-t'), i = e.target.closest('.ip-i');
      if (t) { cat = t.dataset.cat; box.querySelector('.ip-tabs').innerHTML = tabs(); box.querySelector('.ip-grid').innerHTML = grid(); return; }
      if (i) { chosen = current = i.dataset.icon; box.querySelectorAll('.ip-i').forEach(b => b.classList.toggle('on', b === i)); }
    };
    p.then(ok => res(ok ? chosen : null));
  });
}
