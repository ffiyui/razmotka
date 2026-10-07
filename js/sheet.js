/* Листы журнала: панель с кнопками, таблица, сохранение, проведение и отмена */
const Sheets = {meta: null, pages: {}, workers: [], lookup: new Map()};

/* ФИО -> ID, как ВПР по листу «ID старших»: точное совпадение без учёта регистра, первое найденное */
function setWorkers(pairs) {
  Sheets.workers = pairs;
  Sheets.lookup = new Map();
  for (const [id, name] of pairs) {
    if (name === null || String(name).trim() === '') continue;
    const key = String(name).trim().toLowerCase();
    if (!Sheets.lookup.has(key)) Sheets.lookup.set(key, id === null ? 0 : id);
  }
  $('gx-workers').innerHTML = pairs.filter(p => p[1]).map(p => `<option value="${esc(p[1])}">`).join('');
}
async function loadWorkers() {
  const j = await api('/api/sheet?name=workers');
  setWorkers(j.rows.map(r => [r[3][0], r[3][1]]));
}

const whenText = ts => ts ? dru(ts.slice(0, 10)) + ' в ' + ts.slice(11, 16) : '';
const rowsWord = n => nf(n) + ' ' + plural(n, 'строка', 'строки', 'строк');
const chanWord = n => nf(n) + ' ' + plural(n, 'канал', 'канала', 'каналов');

class SheetPage {
  constructor(meta) {
    this.meta = meta;
    this.name = meta.id;
    this.work = meta.kind === 'work';
    this.dirtyRows = new Set();
    this.removedRows = new Set();
    this.flushing = null;
    this.loaded = false;
    this.action = null;
    this.sel = {cells: 1, nums: 0, sum: 0, done: 0, real: 0};
    this.done = this.work ? (meta.wtype ? 'размотано' : 'подмотано') : '';
    const el = this.el = $('p-' + meta.id);
    el.classList.add(meta.wtype === 1 ? 'acc-razm' : meta.wtype === 0 ? 'acc-podm' : 'acc-plain');
    el.innerHTML =
      `<div class="sh-top"><h1><span class="sh-h"></span>${!meta.heading ? '' : this.work
          ? ` <button type="button" class="sh-word" title="Цвет листа: щелчок — выбрать">${esc(meta.title)}</button>`
          : ` <span class="sh-word">${esc(meta.title)}</span>`}</h1>` +
        `${meta.hint ? `<p class="lead sh-hint">${esc(meta.hint)}</p>` : ''}</div>` +
      `<div class="sh-bar"><div class="sh-btns">` +
        (this.work ? `<button class="btn main" data-a="apply">${esc(meta.button)}</button>` +
                     `<button class="btn" data-a="undo">${esc(meta.undo)}</button>` +
                     `<button class="btn" data-a="unapply">Вернуть в черновик</button>` : '') +
        (meta.locked_rows ? '' : `<button class="btn" data-a="delrows">Удалить строки</button>`) +
        `</div><span class="sh-state"></span></div>` +
      `<div class="sh-tools"><div class="tb-row">` +
        // Только для сенсорных экранов (в CSS скрыто, пока pointer не coarse): у пальца нет мыши, Ctrl+C и Delete
        `<div class="tb-group tb-touch">` +
          `<button class="tb tb-wide" data-t="select" title="Выделить диапазон: коснитесь первой и последней ячеек">Выделить</button>` +
          `<button class="tb tb-wide" data-t="copy">Копировать</button><button class="tb tb-wide" data-t="paste">Вставить</button>` +
          `<button class="tb tb-wide" data-t="clear">Очистить</button><button class="tb tb-wide" data-t="down" title="Заполнить вниз значением верхней ячейки">Вниз</button>` +
          `<button class="tb" data-t="undo" title="Отменить правку" aria-label="Отменить правку">↶</button><button class="tb" data-t="redo" title="Повторить правку" aria-label="Повторить правку">↷</button></div>` +
        (this.work ? `<div class="tb-group" data-fmt>` +
            `<button class="tb" data-f="b" title="Жирный (Ctrl+B)"><b>Ж</b></button>` +
            `<button class="tb" data-f="l" title="Тонкий"><span style="font-weight:300">Т</span></button>` +
            `<button class="tb" data-f="i" title="Курсив (Ctrl+I)"><i>К</i></button>` +
            `<button class="tb" data-f="u" title="Подчёркнутый (Ctrl+U)"><u>Ч</u></button></div>` +
          `<div class="tb-group">` +
            `<button class="tb tb-color" data-pal="c" title="Цвет текста"><span>А</span><i class="bar"></i></button>` +
            `<button class="tb tb-color" data-pal="g" title="Заливка ячейки"><span class="bucket"></span><i class="bar"></i></button>` +
            `<button class="tb tb-wide" data-clear title="Убрать оформление с выделенных ячеек">Сбросить</button></div>` : '') +
        `</div><div class="tb-find"><select class="f-col" title="Где искать"><option value="">Все столбцы</option>` +
            meta.cols.map((c, i) => `<option value="${i}">${esc(c.title)}</option>`).join('') + `</select>` +
          `<input class="f-text" type="search" placeholder="Найти и отфильтровать (Ctrl+F)" spellcheck="false">` +
          (this.work ? `<select class="f-state" title="Какие строки показывать"><option value="">Все строки</option>` +
            `<option value="draft">Ждут кнопки</option><option value="done">${this.done[0].toUpperCase() + this.done.slice(1)}</option></select>` : '') +
          `<button class="tb tb-wide f-reset" title="Снять фильтр" hidden>Снять фильтр</button><span class="f-count"></span></div>` +
      `</div>` +
      `<div class="sh-grid card"></div>` +
      `<div class="sh-status"><span class="sh-sel"></span>` +
        (this.work ? `<span class="sh-legend"><i class="mk done"></i>${this.done}<i class="mk draft"></i>ждёт кнопки «${esc(meta.button)}»</span>` : '') +
        `<span class="sh-save"></span></div>`;
    this.grid = new Grid(el.querySelector('.sh-grid'), {
      sheet: meta,
      lookup: () => Sheets.lookup,
      cellRule: meta.id === 'info' ? r => Sheets.meta.info_rules[r] : null,
      notify: toast,
      onChange: (changed, removed) => this.queue(changed, removed),
      onSelect: s => { this.sel = s; this.updateBar(); },
      ensureEditable: rows => this.ensureEditable(rows),
      formats: this.work,
      onFind: () => { const t = el.querySelector('.f-text'); t.focus(); t.select(); },
      onMode: on => { const b = el.querySelector('.tb[data-t=select]'); if (b) b.classList.toggle('on', on); },
      pasteBox: () => this.pasteBox(),
    });
    this.colors = {c: '#D70015', g: '#FCE28A'};       // последний выбранный цвет текста и заливки
    this._bindTools();
    const word = el.querySelector('button.sh-word');           // название листа в заголовке открывает выбор цвета темы
    if (word) word.onclick = () => openTheme(word, meta.wtype === 1 ? 'razm' : 'podm');
    el.querySelector('.sh-bar').onclick = e => {
      const b = e.target.closest('button');
      if (b && !b.disabled) this[b.dataset.a]();
    };
  }

  /* ---------- панель инструментов: оформление и фильтр ---------- */
  _bindTools() {
    const tools = this.el.querySelector('.sh-tools'), g = this.grid;
    tools.addEventListener('mousedown', e => { if (e.target.closest('.tb')) e.preventDefault(); });   // выделение в таблице не теряется
    tools.addEventListener('click', e => {
      const b = e.target.closest('.tb');
      if (!b) return;
      if (b.dataset.t) return this.touchAction(b.dataset.t);
      if (b.dataset.f) g.toggleFormat(b.dataset.f);
      else if (b.dataset.pal) this.openPalette(b);
      else if ('clear' in b.dataset) g.clearFormat();
      else if (b.classList.contains('f-reset')) this.clearFilter();
      if (!b.dataset.pal) g.focus();
    });
    let timer = 0;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => this.applyFilter(), 180); };
    tools.querySelector('.f-text').addEventListener('input', later);
    tools.querySelector('.f-text').addEventListener('keydown', e => {
      if (e.key === 'Escape') { this.clearFilter(); g.focus(); }
      else if (e.key === 'Enter') { clearTimeout(timer); this.applyFilter(); g.focus(); }
    });
    tools.querySelector('.f-col').onchange = () => this.applyFilter();
    if (tools.querySelector('.f-state')) tools.querySelector('.f-state').onchange = () => this.applyFilter();
    this.paintColorButtons();
  }
  /* Кнопки сенсорной панели: выделение, буфер обмена, очистка, отмена */
  async touchAction(k) {
    const g = this.grid;
    if (k === 'select') g.setSelectMode(!g.selectMode);
    else if (k === 'copy') { await g.copySel(); g.setSelectMode(false); }
    else if (k === 'paste') { await g.pasteClip(); g.setSelectMode(false); }
    else if (k === 'clear') { await g.clearSelection(); g.setSelectMode(false); }
    else if (k === 'down') g.fillDown();
    else if (k === 'undo') g.undo();
    else if (k === 'redo') g.redo();
  }
  /* Если iOS не дал прочитать буфер (нет разрешения), текст можно вставить в окно обычным меню «Вставить» */
  async pasteBox() {
    const ok = await ask('Вставить из буфера', '<p>Нажмите в поле и выберите «Вставить» в меню iOS. Таблицу из Excel можно вставлять целиком.</p>' +
      '<textarea id="gxPasteBox" rows="6" style="width:100%" spellcheck="false" placeholder="Вставьте сюда"></textarea>', 'Вставить в таблицу');
    const t = $('gxPasteBox');
    return ok && t ? t.value : null;
  }
  paintColorButtons() {
    for (const k of ['c', 'g']) {
      const b = this.el.querySelector(`.tb[data-pal="${k}"] .bar`);
      if (b) b.style.background = this.colors[k];
    }
  }
  /* Палитра под кнопкой: общий набор цветов, свой цвет и «без цвета» */
  openPalette(button) {
    const key = button.dataset.pal;
    const {el, close} = popover(button, paletteHtml(this.colors[key]) +
      `<div class="pal-row"><button class="pal-none">${key === 'g' ? 'Без заливки' : 'Обычный цвет'}</button>` +
      `<label class="pal-own">Свой<input type="color" value="${this.colors[key]}"></label></div>`);
    const pick = (color, keep) => {
      if (color) { this.colors[key] = color; this.paintColorButtons(); }
      this.grid.colorFormat(key, color);
      if (!keep) { close(); this.grid.focus(); }
    };
    el.addEventListener('mousedown', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) pick(b.classList.contains('pal-none') ? null : b.dataset.c);
    });
    el.querySelector('input').addEventListener('input', e => pick(e.target.value, true));
    el.querySelector('input').addEventListener('change', () => { close(); this.grid.focus(); });
  }
  /* Фильтр: показываются строки, где текст найден в выбранном столбце (или в любом) и подходит состояние */
  applyFilter() {
    const q = s => this.el.querySelector(s), g = this.grid;
    const text = q('.f-text').value.trim().toLowerCase(), col = q('.f-col').value, state = q('.f-state') ? q('.f-state').value : '';
    const cols = col === '' ? g.cols.map((c, i) => i) : [+col];
    const active = !!(text || state);
    g.setFilter(!active ? null : row => {
      if (state === 'done' && !row.done) return false;
      if (state === 'draft' && (row.done || g.isBlank(row))) return false;
      return !text || cols.some(c => g.text(row, c).toLowerCase().includes(text));
    });
    this.filtered = active;
    q('.f-reset').hidden = !active;
    q('.f-text').classList.toggle('on', active);
    q('.f-count').textContent = active ? `Показано ${nf(g.view.length)} из ${nf(g.rows.length)}` : '';
    this.updateBar();
  }
  clearFilter() {
    const q = s => this.el.querySelector(s);
    if (!this.filtered && !q('.f-text').value) return;
    q('.f-text').value = ''; q('.f-col').value = '';
    if (q('.f-state')) q('.f-state').value = '';
    this.applyFilter();
  }

  title() {
    return this.meta.heading ? 'Журнал ГФО' : this.meta.title;      // номер партии теперь стоит в шапке меню
  }
  async show() {
    this.el.querySelector('.sh-h').textContent = this.title();
    if (!this.loaded || dirty[this.name]) { dirty[this.name] = false; await this.load(this.loaded); }
    else this.grid.render();
    this.grid.focus();
  }
  async load(keep) {
    const j = await api('/api/sheet?name=' + this.name);
    if (j.error) return toast(j.error);
    this.action = j.action || null;
    this.grid.setData(j.rows.map(r => ({id: r[0], pos: r[1], done: !!r[2], v: r[3], f: r[4] || undefined})), keep);
    if (this.filtered) this.el.querySelector('.f-count').textContent = `Показано ${nf(this.grid.view.length)} из ${nf(this.grid.rows.length)}`;
    if (this.name === 'workers') setWorkers(j.rows.map(r => [r[3][0], r[3][1]]));
    if (!this.loaded) { this.loaded = true; this.grid.scrollToEnd(); }
    this.setSave('');
    this.updateBar();
  }

  /* ---------- строка состояния и кнопки ---------- */
  drafts() {
    let rows = 0, channels = 0;
    const g = this.grid, c = g.ix.count;
    for (const row of g.rows) {
      if (row.done || g.isBlank(row)) continue;
      rows++;
      const n = g.calc(row, c);
      if (typeof n === 'number') channels += n;
    }
    return {rows, channels};
  }
  updateBar() {
    const q = s => this.el.querySelector(s), s = this.sel;
    q('.sh-sel').innerHTML = s.cells > 1
      ? `<span>Выделено ячеек: ${nf(s.cells)}</span>` + (s.nums ? `<span>Чисел: ${nf(s.nums)}</span><span>Сумма: <b>${nf(s.sum)}</b></span>` : '')
      : `<span>Строк в таблице: ${nf(this.grid.rows.length)}</span>`;
    if (this.filtered) q('.f-count').textContent = `Показано ${nf(this.grid.view.length)} из ${nf(this.grid.rows.length)}`;
    if (this.work) for (const b of this.el.querySelectorAll('.tb[data-f]')) b.classList.toggle('on', !!(s.fmt && s.fmt[b.dataset.f]));
    const del = q('[data-a=delrows]');
    if (del) del.disabled = !s.real;
    if (!this.work) { q('.sh-state').textContent = ''; return; }
    const d = this.drafts();
    q('[data-a=apply]').disabled = !d.rows;
    q('[data-a=undo]').disabled = !this.action;
    q('[data-a=undo]').title = this.action ? `Последнее действие: ${whenText(this.action.ts)}, ${rowsWord(this.action.rows)}, ${chanWord(this.action.channels)}` : 'Отменять нечего';
    q('[data-a=unapply]').disabled = !s.done;
    q('.sh-state').innerHTML = d.rows
      ? `Ждут кнопки «${esc(this.meta.button)}»: <b>${rowsWord(d.rows)}</b>, ${chanWord(d.channels)}`
      : (this.grid.rows.length ? 'Все строки проведены' : 'Таблица пуста. Вводите строки или загрузите журнал из Excel в разделе «Данные»');
    $('nav-' + this.name).textContent = d.rows ? nf(d.rows) : '';
  }
  setSave(state) {
    this.el.querySelector('.sh-save').textContent = state === 'pending' ? 'Сохраняю…' : state === 'saved' ? 'Сохранено' : '';
  }

  /* ---------- сохранение правок ---------- */
  queue(changed, removed) {
    for (const r of changed) { this.removedRows.delete(r); this.dirtyRows.add(r); }
    for (const r of removed) {
      this.dirtyRows.delete(r); this.removedRows.add(r);
      if (r.wasDone) { r.wasDone = false; this.recount = true; }     // учёт на поле изменился
    }
    if (this.name === 'sps' || this.name === 'oo' || this.name === 'info') dirty.field = true;   // от них зависит карта
    this.setSave('pending');
    this.updateBar();
    if (this.name === 'workers') { setWorkers(this.grid.rows.map(r => [r.v[0], r.v[1]])); this.grid.render(); }
    this.flush();
  }
  /* Правки уходят на сервер по очереди. Пока идёт сохранение, новые правки ждут своей очереди в том же проходе. */
  flush() {
    if (this.flushing) return this.flushing;
    const run = this._flush();
    this.flushing = run;
    run.finally(() => { if (this.flushing === run) this.flushing = null; });
    return run;
  }
  async _flush() {
      try {
        while (this.dirtyRows.size || this.removedRows.size) {
          const gone = [...this.removedRows].filter(r => r.id);
          this.removedRows.clear();
          if (gone.length) {
            const j = await post('/api/sheet/delete', {name: this.name, ids: gone.map(r => r.id)});
            if (j.error) throw j;
            gone.forEach(r => { r.id = null; });
          }
          const index = new Map(this.grid.rows.map((r, i) => [r, i]));
          const rows = [...this.dirtyRows].filter(r => index.has(r)).sort((a, b) => index.get(a) - index.get(b));
          this.dirtyRows.clear();
          if (rows.length) {
            const j = await post('/api/sheet/save', {name: this.name, rows: rows.map(r => ({id: r.id, pos: r.pos, idx: index.get(r), v: r.v, f: r.f || {}}))});
            if (j.error) throw j;
            rows.forEach((r, i) => { r.id = j.ids[i]; });
          }
        }
        this.setSave('saved');
        if (this.name === 'info') { await loadSummary(); this.el.querySelector('.sh-h').textContent = this.title(); }
        if (this.name === 'sps') loadSummary();
        if (this.recount) { this.recount = false; await this.syncAction(); }
        return true;
      } catch (j) {
        toast((j && j.error) || 'Не удалось сохранить. Таблица загружена заново.');
        this.dirtyRows.clear(); this.removedRows.clear();
        await this.load(true);
        return false;
      }
  }

  /* После изменения учёта без перезагрузки таблицы: обновить отчёты, сводку и сведения о последнем действии */
  async syncAction() {
    markDirty();
    const fresh = await api('/api/sheet?name=' + this.name + '&brief=1');
    this.action = fresh.action || null;
    this.updateBar();
    await loadSummary();
  }
  /* Перейти к строке по её номеру в базе (из экрана «Проверка») */
  async goto(rowId) {
    await this.show();
    this.clearFilter();
    const r = this.grid.rows.findIndex(row => row.id === rowId);
    if (r >= 0) { this.grid.select(r, 0, r, this.grid.cols.length - 1); this.grid.focus(); }
    else toast('Этой строки в журнале уже нет.');
  }

  /* ---------- размотать / подмотать и отмена ---------- */
  async refreshAfterAction() {
    markDirty();
    await this.load(true);
    await loadSummary();
  }
  async apply() {
    if (!(await this.flush())) return;
    let j = await post('/api/sheet/apply', {name: this.name, force: false});
    if (j.warnings) {
      const ok = await ask('Проверьте данные', '<p>В строках есть спорные места:</p><ul>' + j.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>', 'Всё равно ' + this.meta.button.toLowerCase());
      if (!ok) return this.grid.focus();
      j = await post('/api/sheet/apply', {name: this.name, force: true});
    }
    if (j.error) {
      toast(j.error);
      if (j.row_id) this.clearFilter();
      const r = this.grid.rows.findIndex(row => row.id === j.row_id);
      if (r >= 0) this.grid.select(r, j.col || 0);
      return this.grid.focus();
    }
    toast(`${this.done[0].toUpperCase() + this.done.slice(1)}: ${rowsWord(j.rows)}, ${chanWord(j.channels)}.`);
    await this.refreshAfterAction();
    this.grid.focus();
  }
  async undo() {
    const a = this.action;
    if (!a) return;
    if (!await ask(this.meta.undo + '?', `<p>Действие от ${esc(whenText(a.ts))}: ${rowsWord(a.rows)}, ${chanWord(a.channels)}. Строки вернутся в черновик, оборудование на поле пересчитается.</p>`, this.meta.undo)) return this.grid.focus();
    if (!(await this.flush())) return;
    const j = await post('/api/sheet/undo', {name: this.name});
    if (j.error) return toast(j.error);
    toast(`Отменено: ${rowsWord(j.rows)} снова в черновике.`);
    await this.refreshAfterAction();
    this.grid.focus();
  }
  async unapply() {
    const rows = this.grid.selectedRows().filter(r => r.done);
    if (rows.length && await this.ensureEditable(rows)) toast(`В черновик возвращено: ${rowsWord(rows.length)}.`);
    this.grid.focus();
  }
  /* Проведённые строки менять нельзя: сначала они возвращаются в черновик, и это всегда явное решение */
  async ensureEditable(rows) {
    const n = rows.length;
    const ok = await ask(n === 1 ? 'Строка уже проведена' : 'Строки уже проведены',
      `<p>${n === 1 ? 'Эта строка' : rowsWord(n)} ${n === 1 ? 'проведена' : 'проведены'} (${this.done}). Чтобы изменить, ${n === 1 ? 'её' : 'их'} нужно вернуть в черновик: в учёт на поле ${n === 1 ? 'она' : 'они'} не ${n === 1 ? 'попадёт' : 'попадут'}, пока вы снова не нажмёте «${esc(this.meta.button)}».</p>`,
      'Вернуть в черновик');
    if (!ok) return false;
    if (!(await this.flush())) return false;
    const j = await post('/api/sheet/unapply', {name: this.name, ids: rows.map(r => r.id)});
    if (j.error) { toast(j.error); return false; }
    rows.forEach(r => { r.done = false; });
    this.grid.render();
    await this.syncAction();
    return true;
  }
  delrows() { this.grid.deleteSelectedRows().then(() => this.grid.focus()); }
}

async function initSheets() {
  Sheets.meta = await api('/api/sheets');
  for (const m of Sheets.meta.sheets) Sheets.pages[m.id] = new SheetPage(m);
  await loadWorkers();
}
