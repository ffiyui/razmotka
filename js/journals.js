/* Журналы GeoLink: главная, вкладки листов, свои журналы и листы.
   - Журнал - раздел меню (NAV.groups в js/nav.js): название, значок, листы. «Журнал ГФО» и «Журнал ТГО» - встроенные,
     свои журналы создаёт пользователь: в новом журнале сразу есть лист ID и лист работ (как «Разбивка»).
   - На главной журналы - кнопки с карандашом (название и значок); ниже - «Отчёты».
   - На листе журнала сверху вкладки его листов: значок, название, карандаш у открытой, «+» - новый лист.
   Свои листы хранит движок (engine/sheets-core.js, register_custom; /api/custom), раскладку и значки - меню (/api/ui). */
const GL_LOGO = '<svg class="gl-logo" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 21.5s7.5-6.6 7.5-12.4a7.5 7.5 0 0 0-15 0c0 5.8 7.5 12.4 7.5 12.4z"/><circle cx="9.3" cy="9.2" r="1.7"/><circle cx="14.7" cy="9.2" r="1.7"/><path d="M11 9.2h2"/></svg>';
const PENCIL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z"/><path d="M9.5 4l2.5 2.5"/></svg>';
const BUILTIN_GROUPS = new Set(['gfo', 'tgo', 'rep']);
const PAGE_ICON = {razm: 'reel', podm: 'rewind', razb: 'stake', oo: 'box', snake: 'route', info: 'info', workers: 'idcard', topo: 'idcard',
  tracks: 'route', stats: 'star', check: 'check', sps: 'table'};
const pageIcon = id => (NAV.icons && NAV.icons[id]) || PAGE_ICON[id] ||
  (Sheets.pages[id] ? ({work: 'flagpole', workers: 'idcard'}[Sheets.pages[id].meta.kind] || 'table') : 'table');
const navGroupOf = id => NAV.groups.find(g => g.items.some(it => (navIsFolder(it) ? it.items.includes(id) : it === id))) || null;
const groupPages = g => g.items.flatMap(it => (navIsFolder(it) ? it.items : [it])).filter(id => navTitle(id));
const isWorkPage = id => !!(Sheets.pages[id] && Sheets.pages[id].work);

/* Свои листы, которых нет в меню (пришли с файлом проекта), - в журнал по их подписи */
function journalsSync() {
  let changed = false;
  for (const p of Object.values(Sheets.pages)) {
    if (!p.meta.custom || navGroupOf(p.name)) continue;
    let g = NAV.groups.find(x => x.id === p.meta.journal) || NAV.groups.find(x => !x.report && x.title === p.meta.prefix);
    if (!g) {
      g = {id: p.meta.journal || 'j' + Math.random().toString(36).slice(2, 9), title: p.meta.prefix || 'Журнал', icon: 'journal', items: []};
      NAV.groups.splice(NAV.groups.findIndex(x => x.report), 0, g);
    }
    g.items.push(p.name); changed = true;
  }
  for (const g of NAV.groups) {                                     // листы, которых больше нет
    const before = g.items.length;
    g.items = g.items.filter(it => navIsFolder(it) || !isCustomId(it) || Sheets.pages[it]);
    if (g.items.length !== before) changed = true;
  }
  if (changed) navSave();
  navRender();
}

// ---------------------------------------------------------------- главная
function homeRender() {
  if (!$('homeMenu')) return;
  $('homeBrand').innerHTML = `${GL_LOGO}<span class="gl-name">${esc(NAV.brand)}</span>` +
    `<span class="gl-tag${NAV.sp ? '' : ' empty'}">${esc(NAV.sp || 'надпись')}</span><button type="button" class="gl-edit" id="brandEdit" aria-label="Изменить надпись">${PENCIL}</button>`;
  const journals = NAV.groups.map((g, gi) => [g, gi]).filter(([g]) => !g.report);
  const reports = NAV.groups.filter(g => g.report);
  $('homeMenu').innerHTML = `<div class="gh-gt">Журналы</div><div class="jgrid">` +
    journals.map(([g, gi]) => {
      const pages = groupPages(g), first = pages[0] || '';
      return `<div class="jcard" data-g="${gi}"><a class="jc-main" href="${first ? '#' + first : '#home'}" data-p="${first}">` +
        `<span class="jc-i">${iconSvg(g.icon || 'journal', 22)}</span><span class="jc-t"><b>${esc(g.title)}</b><small>${pages.length} ${plural(pages.length, 'лист', 'листа', 'листов')}</small></span>` +
        `<span class="gh-n jc-n" data-journal="${gi}"></span></a>` +
        `<button type="button" class="jc-edit" data-g="${gi}" aria-label="Изменить журнал «${esc(g.title)}»">${PENCIL}</button></div>`;
    }).join('') +
    `<button type="button" class="jcard jc-add" id="jAdd"><span class="jc-i">+</span><span class="jc-t"><b>Новый журнал</b><small>лист ID и лист работ</small></span></button></div>` +
    reports.map(g => `<div class="gh-group"><div class="gh-gt">${esc(g.title)}</div><div class="gh-box">` +
      groupPages(g).map(id => `<a class="gh-row" href="#${id}" data-p="${id}"><span class="gh-i gh-ic">${iconSvg(pageIcon(id), 18)}</span><span class="gh-t">${esc(navTitle(id))}</span>` +
        (NAV_BADGE[id] ? `<span class="gh-n" data-badge="${NAV_BADGE[id]}"></span>` : '') +
        `<svg class="gh-arr" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg></a>`).join('') +
      `</div></div>`).join('');
  noteRender();
  homeBadges();
}
function homeBadges() {
  document.querySelectorAll('#homeMenu [data-badge]').forEach(b => { const src = $(b.dataset.badge); b.textContent = src ? src.textContent : ''; });
  document.querySelectorAll('#homeMenu [data-journal]').forEach(b => {        // сколько строк ждут кнопки во всём журнале
    const g = NAV.groups[+b.dataset.journal];
    const n = g && S && S.drafts ? groupPages(g).reduce((s, id) => s + (S.drafts[id] || 0), 0) : 0;
    b.textContent = n ? nf(n) : '';
  });
}
$('homeMenu').addEventListener('click', async e => {
  const ed = e.target.closest('.jc-edit');
  if (ed) { e.preventDefault(); return editJournal(+ed.dataset.g); }
  if (e.target.closest('#jAdd')) return newJournal();
});
$('homeBrand').addEventListener('click', async e => {
  if (!e.target.closest('#brandEdit,.gl-tag')) return;
  const v = await askText('Надпись рядом с GeoLink', NAV.sp, 'Например: СП10 или название партии', 40);
  if (v === null) return;
  NAV.sp = v; navSave(); navRender();
});

/* Поле для заметок под названием: растёт до 4 строк, длиннее - сворачивается, кнопка ⌄ раскрывает */
const NOTE_LINES = 4;
function noteRender() {
  const t = $('homeNote');
  if (!t) return;
  if (document.activeElement !== t) t.value = (PREFS && PREFS.home_note) || '';
  noteSize();
}
function noteSize() {
  const t = $('homeNote'), box = $('homeNoteBox');
  const line = parseFloat(getComputedStyle(t).lineHeight) || 20, pad = 16, max = line * NOTE_LINES + pad;
  t.style.height = 'auto';
  const full = t.scrollHeight, open = box.classList.contains('open');
  t.style.height = (open ? full : Math.min(full, max)) + 'px';
  $('homeNoteMore').hidden = full <= max + 2;
  $('homeNoteMore').setAttribute('aria-expanded', open);
}
let noteTimer = 0;
$('homeNote').addEventListener('input', () => {
  noteSize();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { PREFS.home_note = $('homeNote').value; post('/api/prefs', {home_note: PREFS.home_note}).catch(() => {}); }, 500);
});
$('homeNoteMore').onclick = () => { $('homeNoteBox').classList.toggle('open'); noteSize(); };

// ---------------------------------------------------------------- вкладки листов журнала
function jtabsRender(page) {
  let bar = page.el.querySelector('.jtabs');
  if (!bar) {
    bar = document.createElement('div'); bar.className = 'jtabs';
    page.el.insertBefore(bar, page.el.firstChild);
    bar.addEventListener('click', e => {
      const ed = e.target.closest('.jt-edit'), add = e.target.closest('.jt-add');
      if (ed) { e.preventDefault(); return editSheet(ed.dataset.p); }
      if (add) return newSheet(add.dataset.g);
    });
  }
  const g = navGroupOf(page.name);
  if (!g || g.report) { bar.hidden = true; return; }
  bar.hidden = false;
  const gi = NAV.groups.indexOf(g);
  bar.innerHTML = groupPages(g).map(id => `<a class="jt${id === page.name ? ' on' : ''}" href="#${id}" data-p="${id}">${iconSvg(pageIcon(id), 16)}<span>${esc(navTitle(id))}</span>` +
    (id === page.name ? `<button type="button" class="jt-edit" data-p="${id}" aria-label="Изменить лист">${PENCIL}</button>` : '') + `</a>`).join('') +
    `<button type="button" class="jt jt-add" data-g="${gi}" aria-label="Новый лист в журнале">+</button>`;
  const on = bar.querySelector('.jt.on');
  if (on && on.scrollIntoView) on.scrollIntoView({block: 'nearest', inline: 'nearest'});
}

// ---------------------------------------------------------------- окна
/* Ввод строки. null - отмена */
async function askText(title, value, placeholder = '', max = 60) {
  const p = ask(title, `<input id="askText" class="wide" style="width:100%" maxlength="${max}" placeholder="${esc(placeholder)}" value="${esc(value || '')}">`, 'Сохранить');
  setTimeout(() => { const i = $('askText'); if (i) { i.focus(); i.select(); } }, 50);
  const ok = await p;
  return ok ? $('askText').value.trim() : null;
}
/* Название и значок: окно с полем и кнопкой значка. Возвращает {title, icon, remove} или null */
async function askNameIcon(title, name, icon, removable, extra = '', restore = null) {
  let ic = icon;
  const html = () => `<label for="niName">Название</label><input id="niName" class="wide" style="width:100%" maxlength="60" value="${esc(name)}">` +
    `<div class="ni-row"><button type="button" class="btn" id="niIcon">${iconSvg(ic, 20)} <span>Значок</span></button>` +
    (removable ? `<button type="button" class="btn danger" id="niDel">Удалить</button>` : '') + `</div>` + extra;
  let removed = false;
  const p = ask(title, html(), 'Сохранить');
  const bind = () => {
    if (restore) restore();
    $('niIcon').onclick = async () => {
      name = $('niName').value;
      const kept = [...$('dBody').querySelectorAll('input:not(#niName),select')].map(el => [el, el.type === 'radio' || el.type === 'checkbox' ? el.checked : el.value]);
      const keys = kept.map(([el, v]) => [el.id ? '#' + el.id : `input[name="${el.name}"][value="${el.value}"]`, v, el.type === 'radio' || el.type === 'checkbox']);
      const v = await pickIcon(ic, 'Значок');
      if (v) ic = v;
      // окно выбора значка заменило собой это окно: открываем его заново, с тем, что было введено
      const again = await askNameIcon(title, name, ic, removable, extra, () => {
        for (const [sel, val, box] of keys) { const el = $('dBody').querySelector(sel); if (el) { if (box) el.checked = val; else el.value = val; } }
      });
      resolveOuter(again);
    };
    if ($('niDel')) $('niDel').onclick = () => { removed = true; $('dYes').click(); };
  };
  let resolveOuter;
  const outer = new Promise(r => { resolveOuter = r; });
  setTimeout(bind, 0);
  p.then(ok => { if (ok) resolveOuter({title: $('niName').value.trim(), icon: ic, remove: removed, form: $('dBody')}); else resolveOuter(null); });
  return outer;
}
async function editJournal(gi) {
  const g = NAV.groups[gi];
  if (!g) return;
  const custom = !BUILTIN_GROUPS.has(g.id);
  const r = await askNameIcon('Журнал', g.title, g.icon || 'journal', custom);
  if (!r) return;
  if (r.remove) {
    const own = groupPages(g).filter(isCustomId);
    if (groupPages(g).some(id => !isCustomId(id))) return toast('В журнале есть встроенные листы: его нельзя удалить.');
    if (!await ask('Удалить журнал?', `<p>Журнал «${esc(g.title)}» и его листы (${own.length}) удалятся вместе со строками. Отменить это нельзя.</p>`, 'Удалить')) return;
    for (const id of [...own].sort((a, b) => (Sheets.pages[a].meta.kind === 'workers') - (Sheets.pages[b].meta.kind === 'workers'))) {
      const j = await post('/api/custom', {remove: id});
      if (j.error) return toast(j.error);
    }
    NAV.groups.splice(gi, 1);
  } else {
    if (!r.title) return toast('Введите название журнала.');
    g.title = r.title; g.icon = r.icon;
    if (custom) await post('/api/custom', {prefix: {journal: g.id, title: r.title}});
  }
  navSave();
  await refreshSheets(); markDirty(true); await loadSummary();
  navRender();
}
async function newJournal() {
  const r = await askNameIcon('Новый журнал', '', 'flagpole', false);
  if (!r) return;
  if (!r.title) return toast('Введите название журнала.');
  const id = 'j' + Math.random().toString(36).slice(2, 9);
  const ids = await post('/api/custom', {add: {kind: 'workers', title: 'ID исполнителей', journal: id, prefix: r.title}});
  if (ids.error) return toast(ids.error);
  const work = await post('/api/custom', {add: {kind: 'work', title: 'Работы', journal: id, prefix: r.title, lookup: ids.id}});
  if (work.error) return toast(work.error);
  NAV.groups.splice(NAV.groups.findIndex(x => x.report), 0, {id, title: r.title, icon: r.icon, items: [work.id, ids.id]});
  NAV.icons[work.id] = r.icon; NAV.icons[ids.id] = 'idcard';
  navSave();
  await refreshSheets(); await loadSummary();
  navRender();
  toast('Журнал «' + r.title + '» создан: в нём лист работ и лист ID.');
  location.hash = '#' + work.id;
}
async function editSheet(id) {
  const p = Sheets.pages[id], custom = isCustomId(id);
  const r = await askNameIcon('Лист', navTitle(id), pageIcon(id), custom);
  if (!r) return;
  if (r.remove) {
    if (!await ask('Удалить лист?', `<p>Лист «${esc(navTitle(id))}» удалится вместе со строками${p && p.work ? ' и выполненным по нему' : ''}. Отменить это нельзя.</p>`, 'Удалить')) return;
    const j = await post('/api/custom', {remove: id});
    if (j.error) return toast(j.error);
    const g = navGroupOf(id);
    if (g) g.items = g.items.filter(x => x !== id);
    navSave(); await refreshSheets(); await loadSummary(); navRender();
    location.hash = '#' + ((g && groupPages(g)[0]) || 'home');
    return;
  }
  if (!r.title) return toast('Введите название листа.');
  if (custom) { const j = await post('/api/custom', {rename: {id, title: r.title}}); if (j.error) return toast(j.error); delete NAV.titles[id]; }
  else NAV.titles[id] = r.title;
  NAV.icons[id] = r.icon;
  navSave(); await refreshSheets(); navRender();
  if (p) p.show();
}
async function newSheet(gi) {
  const g = NAV.groups[+gi];
  if (!g) return;
  const idsHere = groupPages(g).filter(id => Sheets.pages[id] && Sheets.pages[id].meta.kind === 'workers');
  const extra = `<div class="ns-kind"><label>Вид листа</label>` +
    `<label class="tick"><input type="radio" name="nsKind" value="work" checked> Таблица работ — как «Разбивка»: линия, пикеты, кнопка «Провести»</label>` +
    `<label class="tick"><input type="radio" name="nsKind" value="workers"> Таблица ID исполнителей</label>` +
    `<label class="tick"><input type="radio" name="nsKind" value="plain"> Простая таблица: дата, линия, пикет, текст</label></div>` +
    `<label for="nsLookup">ID исполнителей для таблицы работ</label><select id="nsLookup">` +
      [...idsHere, ...['topo', 'workers'].filter(x => !idsHere.includes(x))].map(id => `<option value="${id}">${esc(navTitle(id))}</option>`).join('') + `</select>`;
  const r = await askNameIcon('Новый лист в журнале «' + g.title + '»', '', 'table', false, extra);
  if (!r) return;
  if (!r.title) return toast('Введите название листа.');
  const kind = (r.form.querySelector('input[name=nsKind]:checked') || {}).value || 'work';
  const lookup = r.form.querySelector('#nsLookup') ? r.form.querySelector('#nsLookup').value : 'topo';
  const j = await post('/api/custom', {add: {kind, title: r.title, journal: g.id, prefix: g.title, lookup}});
  if (j.error) return toast(j.error);
  g.items.push(j.id); NAV.icons[j.id] = r.icon;
  navSave(); await refreshSheets(); await loadSummary(); navRender();
  location.hash = '#' + j.id;
}
