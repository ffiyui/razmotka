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

  async function deflate(u8) {
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
      if (e.method === 8) return bytesStream(src).pipeThrough(new DecompressionStream('deflate-raw'));
      throw new Error('zip');
    }
    async function readEntry(name) {
      const e = find(name);
      const src = raw(e);
      let out;
      if (e.method === 0) out = src;
      else if (e.method === 8) out = await collect(stream(name), e.usize);
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
        if (z.length < data.length) { method = 8; body = z; }
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

  RZ.zip = { read, write, crc32, collect, deflate };
})();
