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
const navDefault = () => ({brand: 'Контроль размотки', sp: 'СП10', sub: 'Журнал учёта оборудования и работ бригад ГФО', groups: [
  {title: 'Журнал', items: ['razm', 'podm', 'razb', 'oo', 'snake', 'info', 'workers', 'topo']},
  {title: 'Отчёты', items: ['tracks', 'stats', 'check', 'sps']}]});
/* «Карта», «Данные» и «Настройки» - в нижней панели, в меню их нет */
const NAV_HIDDEN = new Set(['field', 'data', 'settings', 'home']);
let NAV = navDefault(), navDrag = null;

const navIsFolder = x => x !== null && typeof x === 'object';
const navText = (s, fallback) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 60) : fallback);

/* Сохранённая раскладка приводится к правильному виду: каждая страница ровно один раз, лишнее отбрасывается */
function navNormalize(saved) {
  const def = navDefault();
  if (!saved || !Array.isArray(saved.groups) || !saved.groups.length) return def;
  const seen = new Set();
  const page = id => (typeof id === 'string' && NAV_PAGES[id] && !NAV_HIDDEN.has(id) && !seen.has(id) ? (seen.add(id), id) : null);
  const out = {brand: navText(saved.brand, def.brand), sp: navText(saved.sp, def.sp),
               sub: saved.sub === NAV_OLD_SUB ? def.sub : navText(saved.sub, def.sub), groups: []};
  saved.groups.slice(0, 12).forEach((g, k) => {
    const items = [];
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (navIsFolder(it)) {
        const inner = (Array.isArray(it.items) ? it.items : []).map(page).filter(Boolean);
        if (inner.length) items.push({title: navText(it.title, 'Папка'), open: it.open !== false, items: inner});
      } else { const id = page(it); if (id) items.push(id); }
    }
    out.groups.push({title: navText(g.title, def.groups[k] ? def.groups[k].title : 'Раздел'), items});
  });
  out.groups = out.groups.filter((g, k) => g.items.length || k < def.groups.length);   // раздел, от которого ничего не осталось, убирается
  def.groups.forEach((g, k) => g.items.forEach((id, n) => {         // новые страницы программы попадают в свой раздел,
    if (seen.has(id)) return;                                        // по возможности сразу за своей соседкой («Разбивка» - за «Подмоткой»)
    const items = (out.groups[k] || out.groups[out.groups.length - 1]).items, at = items.indexOf(g.items[n - 1]);
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
function navLink(id) {
  const badge = NAV_BADGE[id] ? ` <span class="n" id="${NAV_BADGE[id]}"></span>` : '';
  return `<a href="#${id}" data-p="${id}" draggable="true">${esc(NAV_PAGES[id])}${badge}</a>`;
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
/* ---------- главная: меню разделов в духе GitHub (список строк со значком, счётчиком и стрелкой) ---------- */
const HOME_ICON = {
  razm: '<path d="M8 2v9M4.5 7.5L8 11l3.5-3.5"/><path d="M2.5 13.5h11"/>',
  podm: '<path d="M8 14V5M4.5 8.5L8 5l3.5 3.5"/><path d="M2.5 2.5h11"/>',
  razb: '<path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z"/><circle cx="8" cy="6.5" r="1.6"/>',
  oo: '<path d="M2.5 5l5.5-3 5.5 3v6l-5.5 3-5.5-3z"/><path d="M2.5 5L8 8l5.5-3M8 8v6"/>',
  snake: '<path d="M2 11c2-4 4-4 6 0s4 4 6 0"/><path d="M2 6c2-4 4-4 6 0s4 4 6 0"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.5v4M8 5h.01"/>',
  workers: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 14c.5-2.6 2.3-4 4.5-4s4 1.4 4.5 4"/><path d="M11 3.2a2.4 2.4 0 0 1 0 4.6M12.5 10.2c1.2.6 1.9 2 2 3.8"/>',
  topo: '<circle cx="8" cy="5" r="2.6"/><path d="M3 14.5c.6-3 2.6-4.6 5-4.6s4.4 1.6 5 4.6"/>',
  tracks: '<circle cx="3.5" cy="12.5" r="1.5"/><circle cx="12.5" cy="3.5" r="1.5"/><path d="M5 12.5h4.5a2.5 2.5 0 0 0 0-5h-3a2.5 2.5 0 0 1 0-5H11"/>',
  stats: '<path d="M2.5 13.5h11"/><path d="M4.5 11V8M8 11V4M11.5 11V6"/>',
  check: '<path d="M8 1.8l5.5 2v4.3c0 3.3-2.4 5.4-5.5 6.2-3.1-.8-5.5-2.9-5.5-6.2V3.8z"/><path d="M5.5 8l1.8 1.8L10.8 6"/>',
  sps: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6h12M6 6v7.5"/>',
};
const homeIcon = id => `<svg class="gh-i" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${HOME_ICON[id] || HOME_ICON.sps}</svg>`;
const homeRow = id => `<a class="gh-row" href="#${id}" data-p="${id}">${homeIcon(id)}<span class="gh-t">${esc(NAV_PAGES[id])}</span>` +
  (NAV_BADGE[id] ? `<span class="gh-n" data-badge="${NAV_BADGE[id]}"></span>` : '') + `<svg class="gh-arr" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg></a>`;
function homeRender() {
  if (!$('homeMenu')) return;
  $('homeBrand').innerHTML = `${esc(NAV.brand)} <span class="gh-accent">${esc(NAV.sp)}</span>`;
  $('homeSub').textContent = NAV.sub;
  $('homeMenu').innerHTML = NAV.groups.map(g => {
    const rows = g.items.flatMap(it => (navIsFolder(it) ? [`<div class="gh-folder">${esc(it.title)}</div>`, ...it.items.map(homeRow)] : [homeRow(it)]));
    return rows.length ? `<div class="gh-group"><div class="gh-gt">${esc(g.title)}</div><div class="gh-box">${rows.join('')}</div></div>` : '';
  }).join('');
  homeBadges();
}
function homeBadges() {
  document.querySelectorAll('#homeMenu [data-badge]').forEach(b => { const src = $(b.dataset.badge); b.textContent = src ? src.textContent : ''; });
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
