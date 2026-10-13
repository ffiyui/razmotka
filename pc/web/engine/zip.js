/* zip: чтение и запись архивов .zip (store и deflate) без библиотек */
globalThis.RZ = globalThis.RZ || {};
(function () {
  const CHUNK = 1 << 20;
  const enc = new TextEncoder();

  // таблица CRC32
  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }

  function crc32(u8, crc) {
    let c = ~(crc || 0);
    for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  }

  // поток из байтов без копирования: отдаёт куски-подмассивы
  function bytesStream(u8) {
    let pos = 0;
    return new ReadableStream({
      pull(ctrl) {
        if (pos >= u8.length) { ctrl.close(); return; }
        ctrl.enqueue(u8.subarray(pos, pos + CHUNK));
        pos += CHUNK;
      },
    });
  }

  async function collect(readable, size) {
    const reader = readable.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
    if (parts.length === 1 && parts[0].length === total) return parts[0];
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /* Старые телефоны (Android WebView до версии 103) не умеют CompressionStream / DecompressionStream('deflate-raw'):
     тогда архив читается своим распаковщиком (inflateRaw), а пишется без сжатия (store) - такой .zip читают все */
  const HAS_INFLATE = (() => { try { new DecompressionStream('deflate-raw'); return true; } catch (e) { return false; } })();
  const HAS_DEFLATE = (() => { try { new CompressionStream('deflate-raw'); return true; } catch (e) { return false; } })();

  // ---- распаковка deflate (RFC 1951) на чистом JS: таблицы кодов Хаффмана целиком, без побитового поиска
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function huff(lengths) {
    let max = 0;
    for (const l of lengths) if (l > max) max = l;
    const cnt = new Uint16Array(16), next = new Uint16Array(16);
    for (const l of lengths) cnt[l]++;
    cnt[0] = 0;
    for (let b = 1, code = 0; b <= 15; b++) { code = (code + cnt[b - 1]) << 1; next[b] = code; }
    const size = 1 << max, t = new Int32Array(size || 1);
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (!len) continue;
      let c = next[len]++, r = 0;
      for (let k = 0; k < len; k++) { r = (r << 1) | (c & 1); c >>= 1; }
      for (let j = r; j < size; j += 1 << len) t[j] = (sym << 4) | len;
    }
    return {t, max};
  }
  let FIXED = null;
  function inflateRaw(src) {
    let pos = 0, buf = 0, cnt = 0, op = 0;
    let out = new Uint8Array(Math.max(1 << 16, src.length * 4));
    const room = n => { if (op + n <= out.length) return; let m = out.length * 2; while (m < op + n) m *= 2; const o = new Uint8Array(m); o.set(out.subarray(0, op)); out = o; };
    const fill = n => { while (cnt < n) { buf |= (pos < src.length ? src[pos] : 0) << cnt; pos++; cnt += 8; } };
    const bits = n => { if (!n) return 0; fill(n); const v = buf & ((1 << n) - 1); buf >>>= n; cnt -= n; return v; };
    const sym = h => { fill(h.max); const v = h.t[buf & ((1 << h.max) - 1)]; const len = v & 15; if (!len) throw new Error('zip'); buf >>>= len; cnt -= len; return v >> 4; };
    let last = 0;
    while (!last) {
      if (pos > src.length + 4) throw new Error('zip');
      last = bits(1);
      const type = bits(2);
      if (type === 0) {                                     // без сжатия
        pos -= cnt >> 3; buf = 0; cnt = 0;
        const len = src[pos] | (src[pos + 1] << 8); pos += 4;
        if (pos + len > src.length) throw new Error('zip');
        room(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
        continue;
      }
      let lit, dist;
      if (type === 1) {
        if (!FIXED) {
          const l = new Uint8Array(288);
          l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
          FIXED = [huff(l), huff(new Uint8Array(30).fill(5))];
        }
        [lit, dist] = FIXED;
      } else if (type === 2) {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
        const ch = huff(cl), lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const c = sym(ch);
          if (c < 16) lens[i++] = c;
          else {
            let rep = 0, val = 0;
            if (c === 16) { if (!i) throw new Error('zip'); val = lens[i - 1]; rep = 3 + bits(2); }
            else if (c === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > lens.length) throw new Error('zip');
            lens.fill(val, i, i + rep); i += rep;
          }
        }
        lit = huff(lens.subarray(0, hlit)); dist = huff(lens.subarray(hlit));
      } else throw new Error('zip');
      for (;;) {
        const c = sym(lit);
        if (c < 256) { room(1); out[op++] = c; continue; }
        if (c === 256) break;
        const k = c - 257;
        if (k >= 29) throw new Error('zip');
        const len = LBASE[k] + bits(LEXT[k]), dc = sym(dist);
        if (dc >= 30) throw new Error('zip');
        const d = DBASE[dc] + bits(DEXT[dc]);
        if (d > op) throw new Error('zip');
        room(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - d];
      }
    }
    return out.subarray(0, op);
  }

  async function deflate(u8) {
    if (!HAS_DEFLATE) return null;                          // без сжатия: write() запишет как есть
    const cs = new CompressionStream('deflate-raw');
    const done = collect(cs.readable);
    const w = cs.writable.getWriter();
    const writing = (async () => {
      for (let i = 0; i < u8.length; i += CHUNK) await w.write(u8.subarray(i, i + CHUNK));
      await w.close();
    })();
    const [out] = await Promise.all([done, writing]);
    return out;
  }

  // ---------------------------------------------------------------- чтение
  async function read(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = bytes.length;
    let eocd = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip');
    let count = dv.getUint16(eocd + 10, true);
    let cdSize = dv.getUint32(eocd + 12, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {   // ZIP64
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z = Number(dv.getBigUint64(loc + 8, true));
        if (z + 56 <= n && dv.getUint32(z, true) === 0x06064b50) {
          count = Number(dv.getBigUint64(z + 32, true));
          cdSize = Number(dv.getBigUint64(z + 40, true));
          cdOff = Number(dv.getBigUint64(z + 48, true));
        }
      }
    }
    const utf8 = new TextDecoder('utf-8');
    const entries = new Map();
    const names = [];
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (p + 46 > n || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      let csize = dv.getUint32(p + 20, true);
      let usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      let off = dv.getUint32(p + 42, true);
      if (p + 46 + nlen + elen > n) throw new Error('zip');
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nlen));
      if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || off === 0xFFFFFFFF) {
        let e = p + 46 + nlen;
        const end = e + elen;
        while (e + 4 <= end) {
          const id = dv.getUint16(e, true), len = dv.getUint16(e + 2, true);
          if (id === 1) {
            let q = e + 4;
            if (usize === 0xFFFFFFFF) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (csize === 0xFFFFFFFF) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (off === 0xFFFFFFFF) { off = Number(dv.getBigUint64(q, true)); q += 8; }
          }
          e += 4 + len;
        }
      }
      if (!entries.has(name)) names.push(name);
      entries.set(name, { name, flags, method, crc, csize, usize, off });
      p += 46 + nlen + elen + clen;
    }

    function find(name) {
      const e = entries.get(name);
      if (!e) throw new Error('zip');
      return e;
    }
    // сжатые данные записи: размер берём из центрального каталога (data descriptor не мешает)
    function raw(e) {
      const o = e.off;
      if (o + 30 > n || dv.getUint32(o, true) !== 0x04034b50) throw new Error('zip');
      const start = o + 30 + dv.getUint16(o + 26, true) + dv.getUint16(o + 28, true);
      if (start + e.csize > n) throw new Error('zip');
      return bytes.subarray(start, start + e.csize);
    }
    function stream(name) {
      const e = find(name);
      const src = raw(e);
      if (e.method === 0) return bytesStream(src);
      if (e.method === 8) return HAS_INFLATE ? bytesStream(src).pipeThrough(new DecompressionStream('deflate-raw')) : bytesStream(inflateRaw(src));
      throw new Error('zip');
    }
    async function readEntry(name) {
      const e = find(name);
      const src = raw(e);
      let out;
      if (e.method === 0) out = src;
      else if (e.method === 8) out = HAS_INFLATE ? await collect(stream(name), e.usize) : inflateRaw(src);
      else throw new Error('zip');
      if (out.length !== e.usize || crc32(out) !== e.crc) throw new Error('zip');
      return out;
    }
    return {
      names,
      has: (name) => entries.has(name),
      size: (name) => find(name).usize,
      stream,
      read: readEntry,
      async text(name) { return new TextDecoder('utf-8').decode(await readEntry(name)); },
    };
  }

  // ---------------------------------------------------------------- запись
  const DOS_TIME = 0, DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;   // фиксированная дата 2020-01-01

  async function write(files, opts) {
    const level = opts && opts.level !== undefined ? opts.level : 6;
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      let method = 0, body = data;
      if (level !== 0 && data.length > 0) {
        const z = await deflate(data);
        if (z && z.length < data.length) { method = 8; body = z; }
      }
      if (body.length >= 0xFFFFFFFF || offset >= 0xFFFFFFFF) throw new Error('zip: слишком большой файл');
      const head = new Uint8Array(30 + nameBytes.length);
      const h = new DataView(head.buffer);
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);
      h.setUint16(8, method, true);
      h.setUint16(10, DOS_TIME, true);
      h.setUint16(12, DOS_DATE, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, body.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, nameBytes.length, true);
      head.set(nameBytes, 30);
      chunks.push(head, body);
      central.push({ nameBytes, method, crc, csize: body.length, usize: data.length, off: offset });
      offset += head.length + body.length;
    }
    let cdSize = 0;
    for (const c of central) {
      const rec = new Uint8Array(46 + c.nameBytes.length);
      const d = new DataView(rec.buffer);
      d.setUint32(0, 0x02014b50, true);
      d.setUint16(4, 20, true);
      d.setUint16(6, 20, true);
      d.setUint16(8, 0x0800, true);
      d.setUint16(10, c.method, true);
      d.setUint16(12, DOS_TIME, true);
      d.setUint16(14, DOS_DATE, true);
      d.setUint32(16, c.crc, true);
      d.setUint32(20, c.csize, true);
      d.setUint32(24, c.usize, true);
      d.setUint16(28, c.nameBytes.length, true);
      d.setUint32(42, c.off, true);
      rec.set(c.nameBytes, 46);
      chunks.push(rec);
      cdSize += rec.length;
    }
    if (central.length > 0xFFFF) throw new Error('zip: слишком много файлов');
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, central.length, true);
    e.setUint16(10, central.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, offset, true);
    chunks.push(end);
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  RZ.zip = { read, write, crc32, collect, deflate, inflateRaw };
})();
