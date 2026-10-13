/* xlsx: чтение книг Excel (zip + XML потоком) и запись простых книг */
globalThis.RZ = globalThis.RZ || {};
(function () {
  const NOT_BOOK = 'Это не книга Excel (.xlsx или .xlsm).';

  // ---------------------------------------------------------------- общее
  function col_index(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  }

  function col_letter(i) {
    let s = '';
    i += 1;
    while (i) {
      const r = (i - 1) % 26;
      i = Math.floor((i - 1) / 26);
      s = String.fromCharCode(65 + r) + s;
    }
    return s;
  }

  // html.unescape для того, что пишет Excel: пять именных и числовые сущности
  function unescape_xml(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, g) => {
      switch (g) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
      }
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return '�';
      return String.fromCodePoint(code);
    });
  }

  // Python float(s): число, NaN/Infinity или undefined, если Python бросил бы ValueError
  // пробельные символы Python str.strip() (отличаются от trim() в JS: есть \x1c-\x1f и \x85, нет \ufeff)
  const PYWS = '[\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const PYWS_RE = new RegExp('^' + PYWS + '+|' + PYWS + '+$', 'g');
  function py_strip(s) { return String(s).replace(PYWS_RE, ''); }

  const FLOAT_RE = /^[+-]?(?:(?:\d+(?:_\d+)*)(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?$/;
  function py_float(s) {
    const t = py_strip(s);
    if (FLOAT_RE.test(t)) return Number(t.replace(/_/g, ''));
    const m = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
    if (!m) return undefined;
    if (m[2].toLowerCase() === 'nan') return NaN;
    return m[1] === '-' ? -Infinity : Infinity;
  }

  // Python int(float(s)): целое или undefined (ValueError; для nan/inf тоже)
  function py_int_float(s) {
    const f = py_float(s);
    if (f === undefined || !isFinite(f)) return undefined;
    return Math.trunc(f);
  }

  function serial_to_iso(v) {
    const f = py_float(v);
    if (f === undefined || !isFinite(f)) throw new Error('не число: ' + v);
    const ms = Date.UTC(1899, 11, 30) + Math.trunc(f) * 86400000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    if (!(y >= 1 && y <= 9999)) throw new Error('дата вне диапазона');
    return d.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------- чтение
  const ROW = /<row r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  const CELL = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const V = /<v>([^<]*)<\/v>/;
  const INLINE = /<is>([\s\S]*?)<\/is>/;
  const TEXT = /<t[^>]*>([^<]*)<\/t>/g;
  const REF = /r="([A-Z]+)\d+"/;
  const PART = 1 << 22;

  function texts(xml) {
    let out = '';
    for (const m of xml.matchAll(TEXT)) out += m[1];
    return out;
  }

  class Workbook {
    constructor(zip) { this.zip = zip; this.strings = []; this.sheets = {}; }

    static async open(bytes) {
      let zip;
      try { zip = await RZ.zip.read(bytes); } catch (e) { throw new RZ.ValidationError(NOT_BOOK); }
      const book = new Workbook(zip);
      try {
        book.strings = await book._shared_strings();
        book.sheets = await book._sheet_parts();
      } catch (e) {
        throw new RZ.ValidationError(NOT_BOOK);
      }
      return book;
    }

    async _shared_strings() {
      if (!this.zip.names.includes('xl/sharedStrings.xml')) return [];
      const xml = await this.zip.text('xl/sharedStrings.xml');
      const out = [];
      for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push(unescape_xml(texts(m[1])));
      return out;
    }

    async _sheet_parts() {
      const rels = {};
      for (const tag of (await this.zip.text('xl/_rels/workbook.xml.rels')).match(/<Relationship [^>]*>/g) || []) {
        const target = /Target="([^"]*)"/.exec(tag)[1];
        rels[/Id="([^"]*)"/.exec(tag)[1]] = target.startsWith('/') ? target.replace(/^\/+/, '') : 'xl/' + target;
      }
      const sheets = {};
      for (const tag of (await this.zip.text('xl/workbook.xml')).match(/<sheet [^>]*>/g) || []) {
        const name = unescape_xml(/ name="([^"]*)"/.exec(tag)[1]);
        const part = rels[/r:id="([^"]*)"/.exec(tag)[1]];
        if (part === undefined) throw new Error('rel');
        sheets[name] = part;
      }
      return sheets;
    }

    // читает лист потоком и вызывает fn(номер, {буква: значение}) для каждой строки
    async each(sheet, columns, fn) {
      if (columns === undefined) columns = 'ABCDEFGHI';
      const wanted = new Set(columns);
      const reader = this.zip.stream(this.sheets[sheet]).getReader();
      const dec = new TextDecoder('utf-8');
      let tail = '';
      let pieces = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const s = dec.decode(value, { stream: true });
        pieces.push(s);
        size += s.length;
        if (size < PART) continue;
        tail += pieces.join('');
        pieces = []; size = 0;
        const last = tail.lastIndexOf('</row>');
        if (last < 0) continue;
        const part = tail.slice(0, last + 6);
        tail = tail.slice(last + 6);
        this._parse(part, wanted, fn);
      }
      tail += pieces.join('') + dec.decode();
      if (tail) this._parse(tail, wanted, fn);
    }

    // массив [номер_строки, {буква: значение}]
    async rows(sheet, columns) {
      const out = [];
      await this.each(sheet, columns, (n, row) => { out.push([n, row]); });
      return out;
    }

    _parse(xml, wanted, fn) {
      const strings = this.strings;
      for (const m of xml.matchAll(ROW)) {
        const row = {};
        for (const c of (m[2] || '').matchAll(CELL)) {
          const attrs = c[1], body = c[2];
          const ref = REF.exec(attrs);
          if (!ref || !wanted.has(ref[1]) || !body) continue;
          let value;
          if (attrs.includes('t="inlineStr"')) {
            const inner = INLINE.exec(body);
            value = inner ? unescape_xml(texts(inner[1])) : null;
          } else {
            const v = V.exec(body);
            if (!v || v[1] === '') continue;
            if (attrs.includes('t="e"')) continue;
            value = attrs.includes('t="s"') ? strings[parseInt(v[1], 10)] : unescape_xml(v[1]);
          }
          if (value !== undefined && value !== null && value !== '') row[ref[1]] = value;
        }
        fn(parseInt(m[1], 10), row);
      }
    }
  }

  // ---------------------------------------------------------------- запись
  // Стили: 0 обычный, 1 заголовок таблицы, 2 дата, 3 крупный заголовок листа, 4 подзаголовок, 5 по центру
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font>
<font><b/><sz val="14"/><name val="Arial"/></font><font><b/><sz val="12"/><color rgb="FF6B6A63"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF0EEE6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9D5C7"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf>
</cellXfs></styleSheet>`;

  const HEADER = 1, DATE = 2, TITLE = 3, SUBTITLE = 4, CENTER = 5;

  class XDate { constructor(iso) { this.iso = iso; } }
  class Formula { constructor(text, cached) { this.text = text; this.cached = cached; } }

  // xml.sax.saxutils.escape
  function escape(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function serial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error('Invalid isoformat string: ' + iso);
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso) throw new Error('Invalid isoformat string: ' + iso);
    return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
  }

  function num_text(x) { return String(x); }

  function cell(ref, value, style) {
    style = style || 0;
    const s = style ? ` s="${style}"` : '';
    if (value === null || value === undefined || value === '') return style ? `<c r="${ref}"${s}/>` : '';
    if (value instanceof XDate) return `<c r="${ref}" s="${DATE}"><v>${serial(value.iso)}</v></c>`;
    if (value instanceof Formula) {
      const c = value.cached;
      if (typeof c === 'number' || typeof c === 'boolean') {
        const t = typeof c === 'boolean' ? (c ? 'True' : 'False') : num_text(c);
        return `<c r="${ref}"${s}><f>${escape(value.text)}</f><v>${t}</v></c>`;
      }
      return `<c r="${ref}"${s} t="str"><f>${escape(value.text)}</f><v>${escape(c === null || c === undefined ? 'None' : c)}</v></c>`;
    }
    if (typeof value === 'boolean') return `<c r="${ref}"${s} t="inlineStr"><is><t>${value ? 'True' : 'False'}</t></is></c>`;
    if (typeof value === 'number') {
      if (!isFinite(value)) return style ? `<c r="${ref}"${s}/>` : '';
      return `<c r="${ref}"${s}><v>${num_text(value)}</v></c>`;
    }
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
  }

  // rows: массив строк, строка - массив ячеек; ячейка - значение или [значение, стиль]
  function sheet_xml(rows, widths, opts) {
    const { freeze_row, filter_ref, heights } = opts || {};
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
    let view = '<sheetViews><sheetView showGridLines="0" workbookViewId="0">';
    if (freeze_row) {
      view += `<pane ySplit="${freeze_row}" topLeftCell="A${freeze_row + 1}" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A${freeze_row + 1}" sqref="A${freeze_row + 1}"/>`;
    }
    out.push(view + '</sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"/>');
    out.push('<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
    out.push('<sheetData>');
    rows.forEach((row, ri) => {
      const r = ri + 1;
      const h = heights && heights[r] !== undefined && heights[r] !== null ? ` ht="${heights[r]}" customHeight="1"` : '';
      const cells = [];
      row.forEach((item, c) => {
        const pair = Array.isArray(item);
        cells.push(cell(`${col_letter(c)}${r}`, pair ? item[0] : item, pair ? item[1] : 0));
      });
      out.push(`<row r="${r}"${h}>` + cells.join('') + '</row>');
    });
    out.push('</sheetData>');
    if (filter_ref) out.push(`<autoFilter ref="${filter_ref}"/>`);
    out.push('</worksheet>');
    return out.join('');
  }

  // sheets: [[название, xml листа]] -> байты книги
  async function write_book(sheets) {
    const n = sheets.length;
    const range = Array.from({ length: n }, (_, i) => i + 1);
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        range.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map(([name], i) => `<sheet name="${escape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets><calcPr calcId="162913" fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        range.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('') +
        `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
    ];
    sheets.forEach(([, xml], i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml }));
    return RZ.zip.write(files);
  }

  RZ.xlsx = {
    open: (bytes) => Workbook.open(bytes), Workbook,
    serial_to_iso, col_index, col_letter, unescape: unescape_xml, py_float, py_int_float, py_strip,
    HEADER, DATE, TITLE, SUBTITLE, CENTER,
    Date: XDate, Formula, sheet_xml, write_book, STYLES,
  };
})();
