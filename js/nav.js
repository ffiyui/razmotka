/* Боковое меню: свои названия, порядок строк и папки.
   - двойной щелчок по названию программы, подписи, разделу или папке - переименовать;
   - перетащить строку на другую строку - собрать их в папку;
   - перетащить к верхнему или нижнему краю строки - поставить выше или ниже (так же строка вынимается из папки).
   Раскладка хранится на сервере (data/ui.json), поэтому не зависит от браузера.
   На телефоне (узкий экран) меню - выдвижная панель слева: «⋯» открывает, касание вне панели, свайп влево или выбор пункта закрывают.
   Переименование на сенсорном экране - двойное касание по названию. */
const NARROW_Q = '(max-width:820px), (pointer:coarse) and (max-height:500px)';     // тот же запрос, что в css/app.css
const isNarrow = () => window.matchMedia(NARROW_Q).matches;
const isTouch = () => window.matchMedia('(pointer:coarse)').matches;
const NAV_PAGES = {home: 'Главная', settings: 'Настройки', razm: 'Размотка', podm: 'Подмотка', razb: 'Разбивка', topo: 'ID топографов', tracks: 'Треки', oo: 'Оставленное оборудование', snake: 'Змейки и вылеты',
  info: 'Общая информация', workers: 'ID старших', field: 'Поле', stats: 'Учёт', check: 'Проверка', sps: 'SPS', data: 'Данные'};
const NAV_BADGE = {razm: 'nav-razm', podm: 'nav-podm', razb: 'nav-razb', check: 'navbad'};
const NAV_OLD_SUB = 'Журнал учёта работы ГФО';          // подпись прежних версий: заменяется новой
/* Журналы - разделы меню: у каждого своё название, значок и листы. Отчёты - отдельный раздел (report).
   Свои журналы и листы пользователь добавляет сам (js/journals.js). */
const navDefault = () => ({v: 2, brand: 'GeoLink', sp: 'СП10', sub: '', icons: {}, titles: {}, groups: [
  {id: 'gfo', title: 'Журнал ГФО', icon: 'reel', items: ['razm', 'podm', 'oo', 'snake', 'info', 'workers']},
  {id: 'tgo', title: 'Журнал ТГО', icon: 'flagpole', items: ['razb', 'topo']},
  {id: 'rep', title: 'Отчёты', icon: 'table', report: true, items: ['tracks', 'stats', 'check', 'sps']}]});
/* «Карта», «Данные» и «Настройки» - в нижней панели, в меню их нет */
const NAV_HIDDEN = new Set(['field', 'data', 'settings', 'home']);
const isCustomId = id => typeof id === 'string' && /^c[a-z0-9]{2,24}$/.test(id) && !Object.prototype.hasOwnProperty.call(NAV_PAGES, id);   // не «check» и не другие встроенные
let NAV = navDefault(), navDrag = null;

const navIsFolder = x => x !== null && typeof x === 'object';
const navText = (s, fallback) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 60) : fallback);

/* Сохранённая раскладка приводится к правильному виду: каждая страница ровно один раз, лишнее отбрасывается */
function navNormalize(saved) {
  const def = navDefault();
  if (!saved || !Array.isArray(saved.groups) || !saved.groups.length) return def;
  if (saved.v !== 2) return {...def, sp: navText(saved.sp, def.sp)};           // меню прежних версий: раскладка GeoLink, номер партии сохраняется
  const seen = new Set();
  const page = id => (typeof id === 'string' && (NAV_PAGES[id] || isCustomId(id)) && !NAV_HIDDEN.has(id) && !seen.has(id) ? (seen.add(id), id) : null);
  const out = {v: 2, brand: navText(saved.brand, def.brand), sp: typeof saved.sp === 'string' ? saved.sp.trim().slice(0, 40) : def.sp, sub: '',
               icons: saved.icons && typeof saved.icons === 'object' ? {...saved.icons} : {}, titles: saved.titles && typeof saved.titles === 'object' ? {...saved.titles} : {}, groups: []};
  saved.groups.slice(0, 12).forEach((g, k) => {
    const items = [];
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (navIsFolder(it)) {
        const inner = (Array.isArray(it.items) ? it.items : []).map(page).filter(Boolean);
        if (inner.length) items.push({title: navText(it.title, 'Папка'), open: it.open !== false, items: inner});
      } else { const id = page(it); if (id) items.push(id); }
    }
    const gid = typeof g.id === 'string' && g.id ? g.id.slice(0, 40) : 'g' + k;
    out.groups.push({id: gid, title: navText(g.title, 'Журнал'), icon: typeof g.icon === 'string' ? g.icon : 'journal', report: !!g.report, items});
  });
  for (const dg of def.groups) if (!out.groups.some(g => g.id === dg.id)) out.groups.push({...dg, items: []});   // встроенный журнал не теряется
  def.groups.forEach(g => g.items.forEach((id, n) => {              // новые страницы программы попадают в свой раздел,
    if (seen.has(id)) return;                                        // по возможности сразу за своей соседкой («Разбивка» - за «Подмоткой»)
    const items = out.groups.find(x => x.id === g.id).items, at = items.indexOf(g.items[n - 1]);
    if (at >= 0) items.splice(at + 1, 0, id); else items.push(id);
    seen.add(id);
  }));
  navTidy(out);
  return out;
}
function navTidy(nav) {                                            // папка из одной строки распадается
  for (const g of nav.groups) g.items = g.items.flatMap(it => navIsFolder(it) && it.items.length < 2 ? it.items : [it]);
}
function navFind(node) {
  for (const g of NAV.groups) {
    let i = g.items.indexOf(node);
    if (i >= 0) return {arr: g.items, i, folder: null};
    for (const it of g.items) if (navIsFolder(it) && (i = it.items.indexOf(node)) >= 0) return {arr: it.items, i, folder: it};
  }
  return null;
}
function navSave() { post('/api/ui', NAV).catch(() => {}); }

/* ---------- отрисовка ---------- */
/* Название страницы: своё (переименованная вкладка), иначе из листа или по умолчанию */
const navTitle = id => (NAV.titles && NAV.titles[id]) || (typeof Sheets !== 'undefined' && Sheets.pages[id] && Sheets.pages[id].meta.custom && Sheets.pages[id].meta.title) || NAV_PAGES[id] || '';
function navLink(id) {
  if (!navTitle(id)) return '';                                      // свой лист, которого на этом устройстве ещё нет
  const badge = NAV_BADGE[id] ? ` <span class="n" id="${NAV_BADGE[id]}"></span>` : ` <span class="n" id="nav-${id}"></span>`;
  return `<a href="#${id}" data-p="${id}" draggable="true">${esc(navTitle(id))}${badge}</a>`;
}
function navRender() {
  const keep = {};
  for (const id of Object.values(NAV_BADGE)) if ($(id)) keep[id] = $(id).textContent;
  const tip = 'title="Двойной щелчок — переименовать"';
  // Название программы, номер партии (отдельно редактируется) и подпись
  let html = `<div class="brand"><span data-edit="brand" ${tip}>${esc(NAV.brand)}</span> ` +
    `<span class="brand-sp" data-edit="sp" title="Двойной щелчок — вписать другую СП">${esc(NAV.sp)}</span></div>` +
    `<div class="brand-sub"><span data-edit="sub" ${tip}>${esc(NAV.sub)}</span></div>`;
  NAV.groups.forEach((g, gi) => {
    html += `<div class="navgroup" data-g="${gi}"><span data-edit="g${gi}" ${tip}>${esc(g.title)}</span></div>`;
    g.items.forEach((it, i) => {
      if (!navIsFolder(it)) { html += navLink(it); return; }
      html += `<div class="navfolder${it.open ? ' open' : ''}" data-f="${gi}.${i}"><div class="nf-head" draggable="true"><i class="nf-arrow"></i>` +
        `<span data-edit="f${gi}.${i}" ${tip}>${esc(it.title)}</span><span class="nf-count">${it.items.length}</span></div>` +
        `<div class="nf-body">${it.items.map(navLink).join('')}</div></div>`;
    });
  });
  $('navlist').innerHTML = html;
  for (const id in keep) if ($(id)) $(id).textContent = keep[id];
  document.title = NAV.brand + ' ' + NAV.sp;
  $('navreset').style.display = JSON.stringify(NAV) === JSON.stringify(navDefault()) ? 'none' : '';
  navFitBrand();
  navMark(location.hash.slice(1));
  homeRender();
}
/* Название программы с номером партии - одна строка. Если она не помещается (другой шрифт, своё длинное название),
   шрифт понемногу уменьшается; совсем длинное название переносится. Кнопка «скрыть меню» встаёт под названием. */
function navFitBrand() {
  const b = document.querySelector('#navlist .brand');
  if (!b || !b.clientWidth) return;
  b.classList.remove('wrap'); b.style.fontSize = '';
  let size = parseFloat(getComputedStyle(b).fontSize);
  while (b.scrollWidth > b.clientWidth && size > 14) { size -= .5; b.style.fontSize = size + 'px'; }
  if (b.scrollWidth > b.clientWidth) { b.style.fontSize = ''; b.classList.add('wrap'); }
  $('navHide').style.top = (b.offsetTop + b.offsetHeight + 4) + 'px';
}
/* Подсветка текущей страницы; папка с ней раскрывается */
function navMark(p) {
  document.querySelectorAll('#navlist a').forEach(a => a.classList.toggle('on', a.dataset.p === p));
  const f = navFind(p);
  if (f && f.folder && !f.folder.open) { f.folder.open = true; navRender(); }
}
function navNode(el) {                                             // элемент меню -> строка, папка или раздел
  if (!el) return null;
  if (el.matches('a')) return {node: el.dataset.p, el};
  if (el.matches('.nf-head')) { const [g, i] = el.parentNode.dataset.f.split('.'); return {node: NAV.groups[g].items[i], el}; }
  if (el.matches('.navgroup')) return {group: NAV.groups[el.dataset.g], el};
  return null;
}

/* ---------- переименование ---------- */
function navRename(span) {
  const key = span.dataset.edit, old = span.textContent;
  const target = key === 'brand' || key === 'sub' || key === 'sp' ? [NAV, key]
    : key[0] === 'g' ? [NAV.groups[+key.slice(1)], 'title']
    : [NAV.groups[+key.slice(1).split('.')[0]].items[+key.split('.')[1]], 'title'];
  span.contentEditable = 'true'; span.classList.add('editing'); span.focus();
  if (span.closest('.brand')) span.closest('.brand').classList.add('wrap');      // пока название правят, строка может переноситься
  getSelection().selectAllChildren(span);
  let cancelled = false;
  span.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
    else if (e.key === 'Escape') { cancelled = true; span.blur(); }
    e.stopPropagation();
  };
  span.onblur = () => {
    const text = span.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!cancelled && text && text !== old) { target[0][target[1]] = text; navSave(); }
    navRender();
  };
}

/* ---------- перетаскивание ---------- */
function navZone(e, el) {
  const r = el.getBoundingClientRect(), k = (e.clientY - r.top) / r.height;
  return k < 0.28 ? 'before' : k > 0.72 ? 'after' : 'into';
}
function navClearMarks() { document.querySelectorAll('#navlist .dz-before,#navlist .dz-after,#navlist .dz-into').forEach(x => x.classList.remove('dz-before', 'dz-after', 'dz-into')); }
function navDrop(drag, t, zone) {
  if (t.group) {                                                   // на название раздела: в конец раздела
    const f = navFind(drag); f.arr.splice(f.i, 1); t.group.items.push(drag);
    return null;
  }
  const target = t.node;
  if (target === drag || (navIsFolder(drag) && drag.items.includes(target))) return null;
  if (navIsFolder(drag) && zone === 'into') zone = 'after';        // папка в папку не кладётся
  let made = null;
  const from = navFind(drag); from.arr.splice(from.i, 1);
  if (zone === 'into' && navIsFolder(target)) { target.items.push(drag); target.open = true; }
  else {
    let f = navFind(target);
    if (zone === 'into' && !f.folder) { made = {title: 'Новая папка', open: true, items: [target, drag]}; f.arr[f.i] = made; }
    else {
      if (navIsFolder(drag) && f.folder) f = navFind(f.folder);    // папка встаёт рядом с папкой, а не внутрь
      f.arr.splice(f.i + (zone === 'before' ? 0 : 1), 0, drag);
    }
  }
  return made;
}

/* ---------- выдвижное меню (узкий экран) ---------- */
function navDrawer(open) {
  open = !!open && isNarrow();
  if (document.body.classList.contains('navopen') === open) return;
  document.body.classList.toggle('navopen', open);
  if (open) navFitBrand();
}
(function initDrawer() {
  const nav = document.querySelector('nav');
  // «⋯» и «‹» на узком экране открывают и закрывают панель, а не прячут меню насовсем (core.js ставит им свои обработчики раньше)
  const hideOld = $('navHide').onclick, showOld = $('navShow').onclick;
  $('navHide').onclick = e => (isNarrow() ? navDrawer(false) : hideOld(e));
  $('navShow').onclick = e => (isNarrow() ? navDrawer(true) : showOld(e));
  $('navScrim').onclick = () => navDrawer(false);
  $('navlist').addEventListener('click', e => { if (e.target.closest('a') && isNarrow()) navDrawer(false); });   // выбрали пункт - панель закрывается
  window.addEventListener('hashchange', () => navDrawer(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('navopen') && !document.querySelector('.editing')) navDrawer(false); });
  window.matchMedia(NARROW_Q).addEventListener('change', e => { if (!e.matches) navDrawer(false); });
  // свайп влево по панели
  let t0 = null;
  nav.addEventListener('touchstart', e => { t0 = e.touches.length === 1 ? {x: e.touches[0].clientX, y: e.touches[0].clientY} : null; }, {passive: true});
  nav.addEventListener('touchmove', e => {
    if (!t0 || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - t0.x, dy = e.touches[0].clientY - t0.y;
    if (dx < -56 && Math.abs(dx) > Math.abs(dy) * 1.6) { t0 = null; navDrawer(false); }
  }, {passive: true});
  nav.addEventListener('touchend', () => { t0 = null; }, {passive: true});
})();

async function initNav() {
  let saved = null;
  try { saved = await api('/api/ui'); } catch (err) { /* меню по умолчанию */ }
  NAV = navNormalize(saved);
  navRender();
  Splash.title(NAV.brand, NAV.sp, NAV.sub);
  const list = $('navlist');
  list.addEventListener('dblclick', e => { const s = e.target.closest('[data-edit]'); if (s && !s.isContentEditable) { e.preventDefault(); navRename(s); } });
  let tapped = {el: null, t: 0};
  list.addEventListener('click', e => {                            // двойное касание по названию - переименовать (dblclick на iOS не приходит)
    const span = e.target.closest('[data-edit]');
    if (!span || span.isContentEditable || !isTouch()) return;
    const now = Date.now();
    if (tapped.el === span && now - tapped.t < 450) { tapped = {el: null, t: 0}; navRename(span); } else tapped = {el: span, t: now};
  });
  list.addEventListener('click', e => {
    const head = e.target.closest('.nf-head');
    if (!head || e.target.isContentEditable) return;
    const [g, i] = head.parentNode.dataset.f.split('.'), folder = NAV.groups[g].items[i];
    folder.open = !folder.open; head.parentNode.classList.toggle('open', folder.open); navSave();
  });
  list.addEventListener('dragstart', e => {
    const t = navNode(e.target.closest('a,.nf-head'));
    if (!t || !t.node) return e.preventDefault();
    navDrag = t.node; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', NAV_PAGES[t.node] || t.node.title);
    t.el.classList.add('dragging');
  });
  list.addEventListener('dragover', e => {
    if (navDrag === null) return;
    const t = navNode(e.target.closest('a,.nf-head,.navgroup'));
    navClearMarks();
    if (!t || t.node === navDrag) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    let zone = t.group ? 'into' : navZone(e, t.el);
    if (navIsFolder(navDrag) && zone === 'into' && !t.group) zone = 'after';
    t.el.classList.add('dz-' + zone);
  });
  list.addEventListener('dragleave', e => { if (!list.contains(e.relatedTarget)) navClearMarks(); });
  list.addEventListener('drop', e => {
    const t = navNode(e.target.closest('a,.nf-head,.navgroup'));
    if (navDrag === null || !t) return;
    e.preventDefault();
    const made = navDrop(navDrag, t, t.group ? 'into' : navZone(e, t.el));
    navDrag = null;
    navTidy(NAV); navRender(); navSave();
    if (made) {                                                    // новой папке сразу предлагается дать имя
      const g = NAV.groups.findIndex(x => x.items.includes(made));
      const span = list.querySelector(`[data-edit="f${g}.${NAV.groups[g].items.indexOf(made)}"]`);
      if (span) navRename(span);
    }
  });
  list.addEventListener('dragend', () => { navDrag = null; navClearMarks(); document.querySelectorAll('#navlist .dragging').forEach(x => x.classList.remove('dragging')); });
  $('navreset').onclick = async () => {
    if (!await ask('Вернуть меню как было?', '<p>Названия, порядок строк и папки вернутся к исходным. Данные журнала это не затрагивает.</p>', 'Вернуть')) return;
    NAV = navDefault(); navRender(); navSave();
  };
}
