/* Таблица как в Excel: выделение мышью, копирование и вставка, правка ячеек, оформление, фильтр, отмена правок.
   Таблица ничего не знает о сервере: об изменениях она сообщает через o.onChange(изменённые, удалённые).

   rows - все строки листа; view - строки, которые сейчас показаны (при фильтре это часть rows).
   Номер строки на экране всегда относится к view; ниже показанных строк идут пустые строки для ввода. */
const GX = {ROW: 30, HEAD: 36, GUT: 54};
/* Размеры берутся из переменных --gx-row / --gx-head / --gx-gut в css/app.css: на сенсорных экранах строки крупнее (44 px) */
function gxMetrics() {
  const st = getComputedStyle(document.documentElement);
  for (const [k, v] of [['ROW', '--gx-row'], ['HEAD', '--gx-head'], ['GUT', '--gx-gut']]) {
    const n = parseFloat(st.getPropertyValue(v));
    if (n > 0) GX[k] = n;
  }
}
gxMetrics();
const gxCoarse = () => !!(window.matchMedia && matchMedia('(pointer:coarse)').matches);

function gxParseDate(text) {
  const s = String(text).trim().replace(/[,\s]+/g, '.');            // «5,10,26» и «5 10 26» = «5.10.26»
  let y, m, d, k;
  if ((k = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) { y = +k[1]; m = +k[2]; d = +k[3]; }
  else if ((k = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(s))) {
    d = +k[1]; m = +k[2]; y = k[3] ? +k[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
  } else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function gxParseInt(text) {
  const s = String(text).replace(/[\s\u00a0]/g, '').replace(/[.,]0+$/, '');
  return /^-?\d+$/.test(s) ? parseInt(s, 10) : null;
}

/* Число с запятой или точкой: «457982,96», «457 982.96» */
function gxParseNum(text) {
  const s = String(text).replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) && Math.abs(v) <= 1e12 ? Math.round(v * 1e4) / 1e4 : null;
}

/* Текст из буфера обмена (как его кладёт Excel) -> таблица строк */
function gxParseTSV(text) {
  const t = text.replace(/\r\n?/g, '\n'), rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function gxToTSV(matrix) {
  return matrix.map(r => r.map(c => /[\t\n"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join('\t')).join('\r\n');
}

class Grid {
  constructor(host, o) {
    this.o = o;
    this.sheet = o.sheet;
    this.cols = o.sheet.cols.map(c => ({...c}));
    this.ix = {};
    this.cols.forEach((c, i) => { this.ix[c.key] = i; });
    this.rows = [];
    this.view = this.rows;
    this.filterFn = null;
    this.a = {r: 0, c: 0};            // активная ячейка (начало выделения)
    this.f = {r: 0, c: 0};            // конец выделения
    this.undoStack = [];
    this.redoStack = [];
    this.editing = false;
    this.copyBox = null;
    this.selectMode = false;          // на сенсорном экране: касания растягивают выделение
    this._rf = 0; this._rl = -1;      // какие строки сейчас нарисованы
    this._loadWidths();
    host.innerHTML = '<div class="gx" tabindex="0"><div class="gx-canvas"><div class="gx-head"></div><div class="gx-rows"></div>' +
      '<div class="gx-range"></div><div class="gx-copy"></div><div class="gx-active"></div>' +
      '<input class="gx-edit" spellcheck="false" autocomplete="off"></div></div>';
    this.el = host.firstChild;
    const q = s => this.el.querySelector(s);
    this.canvas = q('.gx-canvas'); this.head = q('.gx-head'); this.body = q('.gx-rows');
    this.rangeEl = q('.gx-range'); this.copyEl = q('.gx-copy'); this.activeEl = q('.gx-active'); this.input = q('.gx-edit');
    this._bind();
    this.layout();
    Grid.all.add(this);
  }

  /* ---------- данные ---------- */
  setData(rows, keep) {
    const top = this.el.scrollTop;
    this.rows = rows;
    this.undoStack = []; this.redoStack = []; this.copyBox = null;
    this._refilter();
    this.layout();
    if (keep) this.el.scrollTop = top;
    else { this.a = {r: 0, c: 0}; this.f = {r: 0, c: 0}; }
    this._clamp();
    this.render(); this._emit();
  }
  total() { return this.view.length + this.sheet.blank; }
  isBlank(row) { return row.v.every((v, i) => v === null || this.cols[i].kind === 'calc'); }
  /* Номер строки в полном списке по номеру на экране (для пустых строк ниже данных - будущий номер) */
  realIndex(r) {
    if (this.view === this.rows) return r;
    return r < this.view.length ? this.rows.indexOf(this.view[r]) : this.rows.length + (r - this.view.length);
  }
  isLocked(r, c) { return c === this.sheet.locked_col && this.realIndex(r) < this.sheet.locked_rows; }

  /* ---------- фильтр ---------- */
  /* fn(строка) -> показывать ли её. null снимает фильтр. Возвращает число показанных строк. */
  setFilter(fn) {
    if (this.editing) this.commitEdit();
    this.setSelectMode(false);
    this.filterFn = fn;
    this._refilter();
    this.a = {r: 0, c: this.a.c}; this.f = {r: 0, c: this.a.c};
    this.el.scrollTop = 0;
    this.copyBox = null;
    this.render(); this._emit();
    return this.view.length;
  }
  _refilter() { this.view = this.filterFn ? this.rows.filter(this.filterFn) : this.rows; }
  _clamp() {
    const last = this.total() - 1;
    this.a.r = Math.min(this.a.r, last); this.f.r = Math.min(this.f.r, last);
  }

  /* Значение вычисляемого столбца - те же формулы, что в книге Excel */
  calc(row, c) {
    const col = this.cols[c], v = row.v;
    if (col.calc === 'channels') {
      const a = v[this.ix.p1], b = v[this.ix.p2];
      return a === null || b === null ? '--' : Math.abs(b - a) + 1;
    }
    if (col.calc === 'worker_id') {
      const name = v[this.ix.worker];
      if (name === null || String(name).trim() === '') return '--';
      const id = this.o.lookup().get(String(name).trim().toLowerCase());
      return id === undefined ? '#Н/Д' : id;
    }
    if (col.calc === 'same_id') return v[this.ix.id] === null ? (this.isBlank(row) ? '' : 0) : v[this.ix.id];
    return '';
  }
  value(row, c) { return this.cols[c].kind === 'calc' ? this.calc(row, c) : row.v[c]; }
  text(row, c) {
    if (!row) return '';
    const v = this.value(row, c);
    if (v === null || v === undefined) return '';
    if (this.cols[c].kind === 'date') return v.slice(8, 10) + '.' + v.slice(5, 7) + '.' + v.slice(0, 4);
    if (this.cols[c].kind === 'num') return String(v).replace('.', ',');
    return String(v);
  }

  /* Разбор введённого текста по правилам столбца. Те же правила проверяет сервер. */
  parse(c, text, r) {
    const col = this.cols[c], s = String(text === null || text === undefined ? '' : text).trim();
    if (s === '') return {ok: true, v: null};
    let kind = col.kind, lo = col.lo, hi = col.hi, title = col.err_title, err = col.err;
    if (kind === 'any' && this.o.cellRule) {
      const rule = this.o.cellRule(this.realIndex(r));
      if (rule) { kind = 'int'; [lo, hi, title, err] = rule; }
    }
    const bad = {ok: false, msg: (title ? title + ': ' : '') + (err || 'значение не подходит').replace(/\n/g, '; ')};
    if (kind === 'date') { const v = gxParseDate(s); return v ? {ok: true, v} : bad; }
    if (kind === 'int') { const v = gxParseInt(s); return v === null || v < lo || v > hi ? bad : {ok: true, v}; }
    if (kind === 'num') { const v = gxParseNum(s); return v === null ? bad : {ok: true, v}; }
    if (kind === 'any' && /^-?\d+$/.test(s.replace(/ /g, ''))) return {ok: true, v: parseInt(s.replace(/ /g, ''), 10)};
    if (s.length > 500) return {ok: false, msg: 'Слишком длинный текст (больше 500 знаков).'};
    return {ok: true, v: s};
  }

  /* ---------- геометрия и отрисовка ---------- */
  layout() {
    this.x = [0];
    this.cols.forEach(c => this.x.push(this.x[this.x.length - 1] + c.width));
    this.width = GX.GUT + this.x[this.cols.length];
    this.canvas.style.width = this.width + 'px';
    this.head.innerHTML = '<div class="gx-corner"></div>' + this.cols.map((c, i) =>
      `<div class="gx-h${c.kind === 'calc' ? ' calc' : ''}${c.note ? ' note' : ''}" style="width:${c.width}px"${c.note ? ` title="${esc(c.note)}"` : ''}>` +
      `<span>${esc(c.title)}</span><i class="gx-rs" data-c="${i}"></i></div>`).join('');
    this.render();
  }
  /* Оформление ячейки -> стиль. b жирный, l тонкий, i курсив, u подчёркнутый, c цвет текста, g заливка */
  _style(f) {
    let s = '';
    if (f.b) s += 'font-weight:700;'; else if (f.l) s += 'font-weight:300;';
    if (f.i) s += 'font-style:italic;';
    if (f.u) s += 'text-decoration:underline;';
    if (f.c) s += 'color:' + f.c + ';';
    if (f.g) s += 'background:' + f.g + ';';
    return s;
  }
  render() {
    const total = this.total();
    this.canvas.style.height = GX.HEAD + total * GX.ROW + 'px';
    const top = this.el.scrollTop, h = this.el.clientHeight || 600;
    const buf = gxCoarse() ? 24 : 8;                      // на телефоне прокрутка с инерцией: запас строк больше
    const first = Math.max(0, Math.floor(top / GX.ROW) - buf), last = Math.min(total - 1, Math.ceil((top + h) / GX.ROW) + buf);
    this._rf = first; this._rl = last;
    const work = this.sheet.kind === 'work', lookup = this.o.lookup(), lockable = this.sheet.locked_col >= 0;
    let html = '';
    for (let r = first; r <= last; r++) {
      const row = this.view[r], fmt = row && row.f;
      const cls = !row ? 'virt' : row.done ? 'done' : work && !this.isBlank(row) ? (row.from ? 'draft got' : 'draft') : '';
      html += `<div class="gx-r ${cls}" style="top:${r * GX.ROW}px;width:${this.width}px"><div class="gx-n">${r + 1}</div>`;
      for (let c = 0; c < this.cols.length; c++) {
        const col = this.cols[c], t = this.text(row, c);
        let k = 'gx-c k-' + col.kind;
        if (t === '#Н/Д') k += ' bad';
        else if (col.suggest && t && !lookup.has(t.trim().toLowerCase())) k += ' bad';
        if (lockable && this.isLocked(r, c)) k += ' lock';
        const st = fmt && fmt[c] ? this._style(fmt[c]) : '';
        html += `<div class="${k}" style="width:${col.width}px;${st}">${esc(t)}</div>`;
      }
      html += '</div>';
    }
    this.body.innerHTML = html;
    this._drawSel();
  }
  /* Видимые строки уже нарисованы с запасом: пока прокрутка не вышла за него, перерисовывать нечего */
  _outside() {
    const total = this.total(), top = this.el.scrollTop, h = this.el.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / GX.ROW) - 1), last = Math.min(total - 1, Math.ceil((top + h) / GX.ROW) + 1);
    return first < this._rf || last > this._rl;
  }
  box() {
    return {r0: Math.min(this.a.r, this.f.r), r1: Math.max(this.a.r, this.f.r), c0: Math.min(this.a.c, this.f.c), c1: Math.max(this.a.c, this.f.c)};
  }
  _place(el, b) {
    if (!b) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = GX.GUT + this.x[b.c0] + 'px';
    el.style.top = GX.HEAD + b.r0 * GX.ROW + 'px';
    el.style.width = this.x[b.c1 + 1] - this.x[b.c0] + 'px';
    el.style.height = (b.r1 - b.r0 + 1) * GX.ROW + 'px';
  }
  _drawSel() {
    const b = this.box();
    this._place(this.rangeEl, b.r0 === b.r1 && b.c0 === b.c1 ? null : b);
    this._place(this.activeEl, {r0: this.a.r, r1: this.a.r, c0: this.a.c, c1: this.a.c});
    this._place(this.copyEl, this.copyBox);
  }
  reveal(r, c) {
    const e = this.el, y = r * GX.ROW;
    if (y < e.scrollTop) e.scrollTop = y;
    else if (GX.HEAD + y + GX.ROW > e.scrollTop + e.clientHeight) e.scrollTop = GX.HEAD + y + GX.ROW - e.clientHeight;
    if (this.x[c] < e.scrollLeft) e.scrollLeft = this.x[c];
    else if (GX.GUT + this.x[c + 1] > e.scrollLeft + e.clientWidth) e.scrollLeft = GX.GUT + this.x[c + 1] - e.clientWidth;
  }
  select(r, c, r2, c2) {
    this.a = {r, c};
    this.f = {r: r2 === undefined ? r : r2, c: c2 === undefined ? c : c2};
    this.reveal(r, c); this._drawSel(); this._emit();
  }
  scrollToEnd() {
    const r = this.view.length;
    this.select(Math.min(r, this.total() - 1), 0);
    this.el.scrollTop = Math.max(0, (r + 3) * GX.ROW + GX.HEAD - this.el.clientHeight);
  }
  focus() { this.el.focus({preventScroll: true}); }

  /* Сводка по выделению: для строки состояния, как в Excel */
  _emit() {
    if (!this.o.onSelect) return;
    const b = this.box();
    let nums = 0, sum = 0, done = 0, real = 0;
    for (let r = b.r0; r <= Math.min(b.r1, this.view.length - 1); r++) {
      const row = this.view[r];
      real++; if (row.done) done++;
      for (let c = b.c0; c <= b.c1; c++) {
        if (this.cols[c].kind === 'date') continue;
        const v = this.value(row, c);
        if (typeof v === 'number') { nums++; sum += v; }
      }
    }
    const act = this.view[this.a.r];
    this.o.onSelect({cells: (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1), nums, sum, done, real,
                     fmt: (act && act.f && act.f[this.a.c]) || {}});
  }
  selectedRows() {
    const b = this.box();
    return this.view.slice(b.r0, b.r1 + 1);
  }

  /* ---------- мышь ---------- */
  _hit(e) {
    const rc = this.el.getBoundingClientRect(), vx = e.clientX - rc.left, vy = e.clientY - rc.top;
    const cx = vx + this.el.scrollLeft - GX.GUT, cy = vy + this.el.scrollTop - GX.HEAD;
    let c = 0;
    while (c < this.cols.length - 1 && cx >= this.x[c + 1]) c++;
    const r = Math.max(0, Math.min(this.total() - 1, Math.floor(cy / GX.ROW)));
    const zone = vy < GX.HEAD ? (vx < GX.GUT ? 'corner' : 'col') : vx < GX.GUT ? 'row' : 'cell';
    return {r, c: Math.max(0, c), zone, vx, vy, w: this.el.clientWidth, h: this.el.clientHeight};
  }
  _bind() {
    const el = this.el;
    let raf = 0;
    el.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (this._outside()) this.render(); }); });
    new ResizeObserver(() => this.render()).observe(el);

    el.addEventListener('mousedown', e => {
      if (this._ptype && this._ptype !== 'mouse') return;         // касание: обрабатывается ниже (pointer + click)
      if (e.button !== 0 || e.target === this.input) return;
      const h = this._hit(e);
      if (h.vx > h.w || h.vy > h.h) return;                       // полоса прокрутки
      e.preventDefault();
      if (this.editing) this.commitEdit();
      this.focus();
      if (e.target.classList.contains('gx-rs')) return this._resize(e, +e.target.dataset.c);
      const lastRow = Math.max(this.view.length - 1, 0), lastCol = this.cols.length - 1;
      let mode = h.zone;
      if (mode === 'corner') { this.a = {r: 0, c: 0}; this.f = {r: lastRow, c: lastCol}; }
      else if (mode === 'col') { if (!e.shiftKey) this.a = {r: 0, c: h.c}; this.f = {r: lastRow, c: h.c}; }
      else if (mode === 'row') { if (!e.shiftKey) this.a = {r: h.r, c: 0}; this.f = {r: h.r, c: lastCol}; }
      else { if (!e.shiftKey) this.a = {r: h.r, c: h.c}; this.f = {r: h.r, c: h.c}; }
      this._drawSel(); this._emit();
      if (mode === 'corner') return;

      // Тянем мышью: выделение растёт, у края таблица прокручивается сама
      let lastEvent = e;
      const update = () => {
        const p = this._hit(lastEvent);
        if (mode === 'col') this.f = {r: lastRow, c: p.c};
        else if (mode === 'row') this.f = {r: p.r, c: lastCol};
        else this.f = {r: p.r, c: p.c};
        this._drawSel(); this._emit();
      };
      const timer = setInterval(() => {
        const p = this._hit(lastEvent);
        let dy = 0, dx = 0;
        if (mode !== 'col') { if (p.vy < GX.HEAD) dy = -Math.min(60, GX.HEAD - p.vy + 8); else if (p.vy > p.h) dy = Math.min(60, p.vy - p.h + 8); }
        if (mode !== 'row') { if (p.vx < GX.GUT) dx = -Math.min(60, GX.GUT - p.vx + 8); else if (p.vx > p.w) dx = Math.min(60, p.vx - p.w + 8); }
        if (dy || dx) { el.scrollTop += dy; el.scrollLeft += dx; update(); }
      }, 40);
      const move = ev => { lastEvent = ev; update(); };
      const up = () => { clearInterval(timer); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    el.addEventListener('dblclick', e => { if (e.target !== this.input && this._hit(e).zone === 'cell') this.startEdit(null); });

    /* Касания. Прокрутка пальцем - обычная (touch-action), без случайного выделения. Тап по ячейке выделяет её,
       второй тап по выделенной открывает правку: startEdit вызывается прямо из click, иначе iOS не покажет клавиатуру.
       Долгое нажатие включает режим выделения: следующий тап по другой ячейке растягивает диапазон. */
    el.addEventListener('pointerdown', e => {
      this._ptype = e.pointerType;
      if (e.pointerType === 'mouse' || e.target === this.input) return;
      if (this._tp) clearTimeout(this._tp.timer);
      if (e.target.classList.contains('gx-rs')) { this._tp = null; return this._touchResize(e, +e.target.dataset.c); }
      const h = this._hit(e);
      const t = this._tp = {id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, long: false, h, timer: 0};
      if (h.zone === 'cell' && h.vx <= h.w && h.vy <= h.h) t.timer = setTimeout(() => this._longPress(t), 520);
    });
    el.addEventListener('pointermove', e => {
      const t = this._tp;
      if (!t || e.pointerId !== t.id || t.moved) return;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) { t.moved = true; clearTimeout(t.timer); }
    });
    const lift = e => {
      const t = this._tp;
      if (!t || e.pointerId !== t.id) return;
      clearTimeout(t.timer);
      this._last = {moved: t.moved || e.type === 'pointercancel', long: t.long, time: Date.now()};
      this._tp = null;
    };
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);
    el.addEventListener('click', e => {
      if (!this._ptype || this._ptype === 'mouse' || e.target === this.input) return;
      const l = this._last;
      if (l && (l.moved || l.long) && Date.now() - l.time < 800) return;           // это была прокрутка или долгое нажатие
      this._tap(e);
    });
    el.addEventListener('keydown', e => this._key(e));
    el.addEventListener('copy', e => { if (!this.editing) { e.preventDefault(); this._copy(e); } });
    el.addEventListener('cut', e => { if (!this.editing) { e.preventDefault(); this._copy(e); this.clearSelection(); } });
    el.addEventListener('paste', e => { if (!this.editing) { e.preventDefault(); this.paste(e.clipboardData.getData('text/plain')); } });
    this.input.addEventListener('blur', () => { if (this.editing) this.commitEdit(); });
  }
  _tap(e) {
    const h = this._hit(e);
    if (h.vx > h.w || h.vy > h.h) return;                       // полоса прокрутки
    if (this.editing) this.commitEdit();
    const lastRow = Math.max(this.view.length - 1, 0), lastCol = this.cols.length - 1, ext = this.selectMode;
    if (h.zone === 'corner') { this.a = {r: 0, c: 0}; this.f = {r: lastRow, c: lastCol}; }
    else if (h.zone === 'col') { if (!ext) this.a = {r: 0, c: h.c}; this.f = {r: lastRow, c: h.c}; }
    else if (h.zone === 'row') { if (!ext) this.a = {r: h.r, c: 0}; this.f = {r: h.r, c: lastCol}; }
    else {
      const one = this.a.r === this.f.r && this.a.c === this.f.c, same = one && this.a.r === h.r && this.a.c === h.c;
      if (ext && !this._anchor) { this.a = {r: h.r, c: h.c}; this.f = {r: h.r, c: h.c}; this._anchor = true; }      // первое касание в режиме - начало диапазона
      else if (ext) this.f = {r: h.r, c: h.c};
      else if (same) { this.startEdit(null); return; }          // второй тап по выделенной ячейке
      else { this.a = {r: h.r, c: h.c}; this.f = {r: h.r, c: h.c}; }
    }
    this.focus(); this._drawSel(); this._emit();
  }
  _longPress(t) {
    if (this._tp !== t || t.moved) return;
    t.long = true;
    this.setSelectMode(true);
    this._anchor = true;
    this.a = {r: t.h.r, c: t.h.c}; this.f = {r: t.h.r, c: t.h.c};
    this._drawSel(); this._emit();
    try { navigator.vibrate && navigator.vibrate(12); } catch (err) { /* не критично */ }
    this.o.notify('Выделение: коснитесь последней ячейки диапазона.');
  }
  setSelectMode(on) {
    this.selectMode = !!on; this._anchor = false;
    this.el.classList.toggle('selecting', this.selectMode);
    if (this.o.onMode) this.o.onMode(this.selectMode);
  }
  /* Ширина столбца пальцем: заголовок не пересоздаётся, иначе касание потеряется */
  _touchResize(e, c) {
    const handle = e.target, id = e.pointerId, start = e.clientX, w0 = this.cols[c].width, cell = handle.parentNode;
    try { handle.setPointerCapture(id); } catch (err) { /* не критично */ }
    const move = ev => {
      if (ev.pointerId !== id) return;
      const w = Math.max(48, Math.round(w0 + ev.clientX - start));
      this.cols[c].width = w; cell.style.width = w + 'px';
      this.x = [0]; this.cols.forEach(col => this.x.push(this.x[this.x.length - 1] + col.width));
      this.width = GX.GUT + this.x[this.cols.length]; this.canvas.style.width = this.width + 'px';
      this.render();
    };
    const up = ev => {
      if (ev.pointerId !== id) return;
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
      this._saveWidths();
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  }
  _resize(e, c) {
    const start = e.clientX, w0 = this.cols[c].width;
    const move = ev => { this.cols[c].width = Math.max(48, w0 + ev.clientX - start); this.layout(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); this._saveWidths(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  _loadWidths() {
    try {
      const w = JSON.parse(localStorage.getItem('gx-w-' + this.sheet.id) || 'null');
      if (Array.isArray(w) && w.length === this.cols.length) this.cols.forEach((c, i) => { if (w[i] >= 48) c.width = w[i]; });
    } catch (err) { /* ширины по умолчанию */ }
  }
  _saveWidths() {
    try { localStorage.setItem('gx-w-' + this.sheet.id, JSON.stringify(this.cols.map(c => c.width))); } catch (err) { /* не критично */ }
  }

  /* ---------- клавиатура ---------- */
  move(dr, dc, extend) {
    const t = extend ? this.f : this.a;
    const r = Math.max(0, Math.min(this.total() - 1, t.r + dr)), c = Math.max(0, Math.min(this.cols.length - 1, t.c + dc));
    if (extend) this.f = {r, c}; else { this.a = {r, c}; this.f = {r, c}; }
    this.reveal(r, c); this._drawSel(); this._emit();
  }
  _key(e) {
    const ctrl = e.ctrlKey || e.metaKey, n = this.cols.length, lastReal = Math.max(this.view.length - 1, 0);
    if (this.editing) {
      if (e.key === 'Enter') { e.preventDefault(); this.commitEdit(); this.move(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); this.commitEdit(); this._tab(e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.commitEdit(); this.move(e.key === 'ArrowUp' ? -1 : 1, 0); }
      // Как в Excel: если ввод начат набором с клавиатуры, стрелки влево и вправо тоже сохраняют ячейку и
      // переводят выделение. При правке по F2 или двойному щелчку они двигают курсор внутри текста.
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.typing) { e.preventDefault(); this.commitEdit(); this.move(0, e.key === 'ArrowLeft' ? -1 : 1); }
      return;
    }
    const page = Math.max(1, Math.floor((this.el.clientHeight - GX.HEAD) / GX.ROW) - 1);
    const go = (r, c) => { e.shiftKey ? (this.f = {r, c}) : (this.a = {r, c}, this.f = {r, c}); this.reveal(r, c); this._drawSel(); this._emit(); };
    const cur = e.shiftKey ? this.f : this.a;
    let done = true;
    switch (e.key) {
      case 'ArrowUp': ctrl ? go(0, cur.c) : this.move(-1, 0, e.shiftKey); break;
      case 'ArrowDown': ctrl ? go(cur.r < lastReal ? lastReal : this.total() - 1, cur.c) : this.move(1, 0, e.shiftKey); break;
      case 'ArrowLeft': ctrl ? go(cur.r, 0) : this.move(0, -1, e.shiftKey); break;
      case 'ArrowRight': ctrl ? go(cur.r, n - 1) : this.move(0, 1, e.shiftKey); break;
      case 'PageUp': this.move(-page, 0, e.shiftKey); break;
      case 'PageDown': this.move(page, 0, e.shiftKey); break;
      case 'Home': ctrl ? go(0, 0) : go(cur.r, 0); break;
      case 'End': ctrl ? go(lastReal, n - 1) : go(cur.r, n - 1); break;
      case 'Enter': this.move(e.shiftKey ? -1 : 1, 0); break;
      case 'Tab': this._tab(e.shiftKey); break;
      case 'F2': this.startEdit(null); break;
      case 'Delete': case 'Backspace': this.clearSelection(); break;
      case 'Escape': this.copyBox = null; this.setSelectMode(false); this._drawSel(); break;
      default: done = false;
    }
    if (!done && ctrl) {                      // по коду клавиши: работает и в русской раскладке
      done = true;
      if (e.code === 'KeyA') { this.a = {r: 0, c: 0}; this.f = {r: lastReal, c: n - 1}; this._drawSel(); this._emit(); }
      else if (e.code === 'KeyD') this.fillDown();
      else if (e.code === 'KeyZ' && !e.shiftKey) this.undo();
      else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) this.redo();
      else if (e.code === 'KeyF' && this.o.onFind) this.o.onFind();
      else if (this.o.formats && e.code === 'KeyB') this.toggleFormat('b');
      else if (this.o.formats && e.code === 'KeyI') this.toggleFormat('i');
      else if (this.o.formats && e.code === 'KeyU') this.toggleFormat('u');
      else done = false;
    }
    if (done) { e.preventDefault(); return; }
    if (e.key.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); this.startEdit(e.key); }
  }
  _tab(back) {
    let {r, c} = this.a;
    c += back ? -1 : 1;
    if (c >= this.cols.length) { c = 0; r++; } else if (c < 0) { c = this.cols.length - 1; r--; }
    r = Math.max(0, Math.min(this.total() - 1, r));
    this.a = {r, c}; this.f = {r, c};
    this.reveal(r, c); this._drawSel(); this._emit();
  }

  /* ---------- правка ячейки ---------- */
  async startEdit(initial) {
    const {r, c} = this.a, col = this.cols[c], row = this.view[r];
    if (col.kind === 'calc') return this.o.notify('Столбец «' + col.title + '» считается сам, как формула в Excel.');
    if (this.isLocked(r, c)) return this.o.notify('Название показателя менять нельзя.');
    if (row && row.done && !(await this.o.ensureEditable([row]))) return this.focus();
    this.f = {r, c};
    this.reveal(r, c); this._drawSel();
    const inp = this.input;
    inp.style.left = GX.GUT + this.x[c] + 'px';
    inp.style.top = GX.HEAD + r * GX.ROW + 'px';
    inp.style.width = col.width + 'px';
    inp.className = 'gx-edit k-' + col.kind;
    if (col.suggest) inp.setAttribute('list', 'gx-' + col.suggest); else inp.removeAttribute('list');
    // Клавиатура iOS по типу столбца: даты и числа - цифровая (даты принимают «,» и пробел вместо точки)
    const rule = col.kind === 'any' && this.o.cellRule && this.o.cellRule(this.realIndex(r));
    inp.inputMode = col.kind === 'date' || col.kind === 'num' ? 'decimal' : (col.kind === 'int' && !(col.lo < 0)) || rule ? 'numeric' : 'text';
    inp.enterKeyHint = 'next';
    inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocorrect', 'off'); inp.setAttribute('autocapitalize', col.suggest ? 'words' : 'off');
    this.editOrig = this.text(row, c);
    this.typing = initial !== null;
    inp.value = initial === null ? this.editOrig : initial;
    inp.style.display = 'block';
    this.editing = true;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    this._editEvent(true);
  }
  /* Сообщение для панели над клавиатурой (js/touch.js) */
  _editEvent(on) {
    const col = this.cols[this.a.c];
    document.dispatchEvent(new CustomEvent('gx-edit', {detail: {grid: this, on, title: on ? col.title + ', строка ' + (this.a.r + 1) : ''}}));
  }
  /* keep: правка продолжается в другой ячейке, поле остаётся в фокусе и клавиатура не прячется */
  commitEdit(keep) {
    if (!this.editing) return;
    this.editing = false;
    const text = this.input.value, {r, c} = this.a;
    if (!keep) { this.input.style.display = 'none'; this.focus(); this._editEvent(false); }
    if (text !== this.editOrig) this.setTexts([{r, c, text}], true);
  }
  cancelEdit() {
    this.editing = false;
    this.input.style.display = 'none';
    this.focus();
    this._editEvent(false);
  }
  /* Кнопки ‹ › ▲ ▼ над клавиатурой: сохранить ячейку и перейти к соседней, правка продолжается */
  touchStep(kind) {
    if (!this.editing) return;
    const n = this.cols.length;
    let {r, c} = this.a;
    this.commitEdit(true);
    const total = this.total(), ok = (rr, cc) => this.cols[cc].kind !== 'calc' && !this.isLocked(rr, cc);
    if (kind === 'up') r = Math.max(0, r - 1);
    else if (kind === 'down') r = Math.min(total - 1, r + 1);
    else {                                                       // вправо и влево пропускают вычисляемые и закреплённые ячейки
      const d = kind === 'next' ? 1 : -1;
      let rr = r, cc = c, found = false;
      for (let i = 0; i < n * 2 && !found; i++) {
        cc += d;
        if (cc >= n) { cc = 0; rr++; } else if (cc < 0) { cc = n - 1; rr--; }
        if (rr < 0 || rr >= total) break;
        if (ok(rr, cc)) { r = rr; c = cc; found = true; }
      }
    }
    this.a = {r, c}; this.f = {r, c};
    this.reveal(r, c); this._drawSel(); this._emit();
    if (ok(r, c)) { if (this.view[r] && this.view[r].done) this.input.style.display = 'none'; this.startEdit(null); }
    else { this.input.style.display = 'none'; this._editEvent(false); this.focus(); }
  }

  /* ---------- изменение данных ---------- */
  /* Запись в журнал отмены и сообщение наружу. entry: [{row, before, after, fb, fa}] -
     значения до и после (null = строки не было / не стало) и, если менялось, оформление до и после. */
  _commit(entry, removed) {
    this.undoStack.push(entry); this.redoStack = [];
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.copyBox = null;
    this.o.onChange(entry.filter(ch => ch.after !== null).map(ch => ch.row), removed || []);
    this._clamp();
    this.render(); this._emit();
  }
  _newRow() {
    const pos = (this.rows.length ? this.rows[this.rows.length - 1].pos : 0) + 1;
    const row = {id: null, pos, done: false, v: this.cols.map(() => null)};
    this.rows.push(row);
    if (this.view !== this.rows) this.view.push(row);
    return row;
  }
  _drop(rows) {
    const gone = new Set(rows);
    // Проведённая строка удаляется вместе со своим следом в учёте. Если удаление отменить (Ctrl+Z),
    // она вернётся черновиком: в учёт её снова вносит кнопка.
    rows.forEach(r => { r.wasDone = r.done; r.done = false; });
    const filtered = this.view !== this.rows;
    this.rows = this.rows.filter(r => !gone.has(r));
    this.view = filtered ? this.view.filter(r => !gone.has(r)) : this.rows;
  }
  /* Запись значений: правка, вставка и заполнение идут через него. */
  async setTexts(items, single) {
    const ops = [], bad = [];
    for (const it of items) {
      if (this.cols[it.c].kind === 'calc' || this.isLocked(it.r, it.c)) continue;
      const p = this.parse(it.c, it.text, it.r);
      if (!p.ok) { bad.push(p.msg); continue; }
      const row = this.view[it.r];
      if (!row && p.v === null) continue;                      // пустое в пустую строку
      if (row && row.v[it.c] === p.v) continue;
      ops.push({r: it.r, c: it.c, v: p.v});
    }
    if (bad.length) this.o.notify(single ? bad[0] : 'Не подошло ячеек: ' + bad.length + '. ' + bad[0]);
    if (!ops.length) return false;

    const doneRows = [...new Set(ops.map(op => this.view[op.r]).filter(row => row && row.done))];
    if (doneRows.length && !(await this.o.ensureEditable(doneRows))) return false;

    const before = new Map();
    for (const op of ops) {
      while (op.r >= this.view.length) before.set(this._newRow(), null);     // пишем ниже данных: строки создаются по пути
      const row = this.view[op.r];
      if (!before.has(row)) before.set(row, row.v.slice());
      row.v[op.c] = op.v;
    }
    this._commit([...before].map(([row, was]) => ({row, before: was, after: row.v.slice()})));
    return true;
  }
  /* Delete: очищает выделенные ячейки. Строка, в которой после этого ничего не осталось, удаляется целиком -
     выделил строки, нажал Delete, и их нет. На листах с закреплёнными строками очищаются только значения. */
  async clearSelection() {
    const b = this.box(), rows = this.view.slice(b.r0, b.r1 + 1);
    if (!rows.length) return false;
    const canDrop = !this.sheet.locked_rows, drop = [], edit = [];
    rows.forEach((row, k) => {
      const after = row.v.slice();
      let changed = false;
      for (let c = b.c0; c <= b.c1; c++) {
        if (this.cols[c].kind === 'calc' || this.isLocked(b.r0 + k, c) || after[c] === null) continue;
        after[c] = null; changed = true;
      }
      const empty = after.every((v, i) => v === null || this.cols[i].kind === 'calc');
      if (canDrop && empty) drop.push(row);
      else if (changed) edit.push({row, after});
    });
    if (!drop.length && !edit.length) return false;
    const doneRows = edit.map(e => e.row).filter(row => row.done);         // частичная правка проведённой строки
    if (doneRows.length && !(await this.o.ensureEditable(doneRows))) return false;
    const entry = edit.map(e => { const before = e.row.v.slice(); e.row.v = e.after; return {row: e.row, before, after: e.after.slice()}; })
      .concat(drop.map(row => ({row, before: row.v.slice(), after: null})));
    this._drop(drop);
    this._commit(entry, drop);
    return true;
  }
  fillDown() {
    const b = this.box(), items = [];
    const src = b.r0 === b.r1 ? b.r0 - 1 : b.r0, from = b.r0 === b.r1 ? b.r0 : b.r0 + 1;
    if (src < 0 || !this.view[src]) return;
    for (let r = from; r <= b.r1; r++)
      for (let c = b.c0; c <= b.c1; c++) items.push({r, c, text: this.text(this.view[src], c)});
    return this.setTexts(items);
  }
  async deleteSelectedRows() {
    if (this.sheet.locked_rows) return this.o.notify('Строки этого листа удалять нельзя.');
    const b = this.box(), rows = this.view.slice(b.r0, b.r1 + 1);
    if (!rows.length) return;
    const entry = rows.map(row => ({row, before: row.v.slice(), after: null}));
    this._drop(rows);
    const r = Math.min(b.r0, this.total() - 1);
    this.a = {r, c: this.a.c}; this.f = {r, c: this.a.c};
    this._commit(entry, rows);
  }

  /* ---------- оформление ячеек ---------- */
  /* change(оформление ячейки) меняет объект на месте; применяется ко всем выделенным ячейкам существующих строк.
     Оформление не влияет на учёт, поэтому доступно и для проведённых строк. */
  setFormat(change) {
    const b = this.box(), entry = [];
    for (let r = b.r0; r <= Math.min(b.r1, this.view.length - 1); r++) {
      const row = this.view[r], fb = JSON.stringify(row.f || {}), f = JSON.parse(fb);
      for (let c = b.c0; c <= b.c1; c++) {
        const cell = f[c] || {};
        change(cell);
        for (const k of Object.keys(cell)) if (!cell[k]) delete cell[k];
        if (Object.keys(cell).length) f[c] = cell; else delete f[c];
      }
      const fa = JSON.stringify(f);
      if (fa === fb) continue;
      row.f = f;
      entry.push({row, before: row.v.slice(), after: row.v.slice(), fb, fa});
    }
    if (!entry.length) return false;
    entry.fmtOnly = true;
    this._commit(entry);
    return true;
  }
  /* Жирный, курсив, подчёркнутый, тонкий: если всё выделение уже такое - снять, иначе поставить */
  toggleFormat(key) {
    const b = this.box();
    let all = true, any = false;
    for (let r = b.r0; r <= Math.min(b.r1, this.view.length - 1) && all; r++)
      for (let c = b.c0; c <= b.c1; c++) { any = true; if (!((this.view[r].f || {})[c] || {})[key]) { all = false; break; } }
    if (!any) return false;
    return this.setFormat(cell => {
      cell[key] = all ? 0 : 1;
      if (!all && key === 'b') cell.l = 0;                     // жирный и тонкий исключают друг друга
      if (!all && key === 'l') cell.b = 0;
    });
  }
  colorFormat(key, color) { return this.setFormat(cell => { cell[key] = color || 0; }); }
  clearFormat() { return this.setFormat(cell => { for (const k of Object.keys(cell)) delete cell[k]; }); }

  /* ---------- буфер обмена ---------- */
  _selText() {
    const b = this.box(), out = [];
    for (let r = b.r0; r <= Math.min(b.r1, Math.max(this.view.length - 1, b.r0)); r++) {
      const line = [];
      for (let c = b.c0; c <= b.c1; c++) line.push(this.text(this.view[r], c));
      out.push(line);
    }
    this.copyBox = {r0: b.r0, c0: b.c0, r1: b.r0 + out.length - 1, c1: b.c1};
    this._drawSel();
    return gxToTSV(out);
  }
  _copy(e) { e.clipboardData.setData('text/plain', this._selText()); }
  /* Кнопки «Копировать» и «Вставить» для сенсорного экрана (там нет Ctrl+C / Ctrl+V). Возвращают true, если получилось. */
  async copySel() {
    const text = this._selText();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (err) {                                              // нет доступа к буферу: старый способ через временное поле
      try {
        const t = document.createElement('textarea');
        t.value = text; t.readOnly = true; t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
        document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
        ok = document.execCommand('copy'); t.remove();
      } catch (err2) { ok = false; }
    }
    this.o.notify(ok ? 'Скопировано: ' + (this.copyBox.r1 - this.copyBox.r0 + 1) + ' × ' + (this.copyBox.c1 - this.copyBox.c0 + 1) + '.' : 'Не удалось скопировать.');
    return ok;
  }
  async pasteClip() {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch (err) { /* iOS спрашивает разрешение; при отказе - окно для вставки */ }
    if (text === null && this.o.pasteBox) text = await this.o.pasteBox();
    if (text === null || text === '') { if (text === null) this.o.notify('Вставка отменена.'); return false; }
    await this.paste(text);
    return true;
  }
  async paste(text) {
    const m = gxParseTSV(text);
    if (!m.length) return;
    const b = this.box(), items = [];
    let r1, c1;
    if (m.length === 1 && m[0].length === 1 && (b.r0 !== b.r1 || b.c0 !== b.c1)) {       // одно значение во всё выделение
      for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) items.push({r, c, text: m[0][0]});
      r1 = b.r1; c1 = b.c1;
    } else {
      const width = Math.max(...m.map(row => row.length));
      m.forEach((line, i) => line.forEach((cell, j) => { if (b.c0 + j < this.cols.length) items.push({r: b.r0 + i, c: b.c0 + j, text: cell}); }));
      r1 = b.r0 + m.length - 1; c1 = Math.min(b.c0 + width - 1, this.cols.length - 1);
    }
    if (await this.setTexts(items)) { this.a = {r: b.r0, c: b.c0}; this.f = {r: r1, c: c1}; this._drawSel(); this._emit(); }
  }

  /* ---------- отмена правок (Ctrl+Z) ---------- */
  _replay(entry, back) {
    const changed = [], removed = [];
    for (const ch of entry) {
      const target = back ? ch.before : ch.after, current = back ? ch.after : ch.before;
      if (target === null) {
        const i = this.rows.indexOf(ch.row);
        if (i >= 0) this.rows.splice(i, 1);
        removed.push(ch.row);
      } else {
        if (current === null && this.rows.indexOf(ch.row) < 0) {
          let i = this.rows.findIndex(row => row.pos > ch.row.pos);
          if (i < 0) i = this.rows.length;
          this.rows.splice(i, 0, ch.row);
        }
        ch.row.v = target.slice();
        if (ch.fb !== undefined) ch.row.f = JSON.parse(back ? ch.fb : ch.fa);
        changed.push(ch.row);
      }
    }
    this._refilter();
    this.o.onChange(changed, removed);
    this._clamp();
    this.render(); this._emit();
  }
  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (!entry.fmtOnly && entry.some(ch => ch.row.done)) { this.undoStack = []; return this.o.notify('Эти строки уже проведены: правку отменить нельзя.'); }
    this.redoStack.push(entry); this._replay(entry, true);
  }
  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry); this._replay(entry, false);
  }
}
Grid.all = new Set();
/* Переключились мышь/касание (например, iPad с клавиатурой): размеры таблицы пересчитываются */
if (window.matchMedia) {
  const mq = matchMedia('(pointer:coarse)'), again = () => { gxMetrics(); Grid.all.forEach(g => g.layout()); };
  if (mq.addEventListener) mq.addEventListener('change', again);
}
