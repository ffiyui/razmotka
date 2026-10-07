// Общая загрузка файлов engine в один vm-контекст (как в браузере: классические скрипты по порядку)
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine');

export function loadEngine(files, extra = {}) {
  const ctx = vm.createContext({
    console, TextDecoder, TextEncoder, DecompressionStream, CompressionStream, Blob, Response,
    ReadableStream, structuredClone, setTimeout, clearTimeout, Uint8Array, DataView, ...extra,
  });
  for (const f of files) {
    const file = path.join(ENGINE, f.endsWith('.js') ? f : f + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return ctx;
}
