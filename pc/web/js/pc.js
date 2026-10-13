/* GeoLink для компьютера (папка pc/ репозитория, pc/geolink.py). Работает, только когда страницу отдаёт программа
   для ПК: она ставит window.GL_PC = true. На телефонах файл ничего не делает.
   - данные движка хранятся не в браузере, а в файлах программы (pc/data): хранилище RZ.kv_custom для engine/boot.js;
   - связь с программой: окно открыто - программа работает, закрыли окно - завершается;
   - в меню слева - Главная, Карта, Данные, Настройки (нижней панели на компьютере нет);
   - контуры из файлов DXF и перенос данных прежней программы для ПК (data/razmotka.db). */
(function () {
  'use strict';
  if (!window.GL_PC) return;
  document.documentElement.classList.add('pc');
  var RZ = window.RZ = window.RZ || {};

  // ---------------------------------------------------------------- хранилище в файлах
  /* Типизированные массивы (лист SPS хранится ими) в JSON - как base64 */
  function b64(u8) { var s = '', i, n = 0x8000; for (i = 0; i < u8.length; i += n) s += String.fromCharCode.apply(null, u8.subarray(i, i + n)); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var enc = function (v) {
    return JSON.stringify(v, function (k, x) {
      if (x && typeof x === 'object' && ArrayBuffer.isView(x) && !(x instanceof DataView)) return {$ta: x.constructor.name, b: b64(new Uint8Array(x.buffer, x.byteOffset, x.byteLength))};
      return x;
    });
  };
  var rev = function (k, x) {
    if (x && typeof x === 'object' && typeof x.$ta === 'string' && typeof x.b === 'string' && typeof window[x.$ta] === 'function') {
      var u = unb64(x.b); return new window[x.$ta](u.buffer, 0, u.byteLength / window[x.$ta].BYTES_PER_ELEMENT);
    }
    return x;
  };
  var ok = function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || ('ошибка ' + r.status)); }, function () { throw new Error('ошибка ' + r.status); }); return r; };
  RZ.kv_custom = function () {
    return {
      kind: 'pc',
      load: function () {
        return fetch('/pc/kv', {cache: 'no-store'}).then(ok).then(function (r) { return r.text(); }).then(function (t) {
          var o = JSON.parse(t, rev), m = new Map();
          Object.keys(o).forEach(function (k) { m.set(k, o[k]); });
          return m;
        });
      },
      put: function (entries, deletes) {
        var body = '{"put":{' + entries.map(function (e) { return JSON.stringify(e[0]) + ':' + enc(e[1] === undefined ? null : e[1]); }).join(',') + '},"del":' + JSON.stringify(deletes || []) + '}';
        return fetch('/pc/kv', {method: 'POST', body: body, headers: {'Content-Type': 'application/json'}, keepalive: body.length < 60000}).then(ok);
      },
      put_blob: function (key, blob) { return fetch('/pc/blob?key=' + encodeURIComponent(key), {method: 'POST', body: blob, headers: {'Content-Type': blob.type || 'application/octet-stream'}}).then(ok); },
      get_blob: function (key) { return fetch('/pc/blob?key=' + encodeURIComponent(key)).then(function (r) { return r.ok ? r.blob() : null; }); },
      del_blob: function (key) { return fetch('/pc/blob/del?key=' + encodeURIComponent(key), {method: 'POST'}).then(ok); },
      wipe: function () { return fetch('/pc/wipe', {method: 'POST'}).then(ok); },
    };
  };

  // ---------------------------------------------------------------- связь с программой
  var ping = function () { fetch('/pc/ping', {cache: 'no-store'}).catch(function () { /* программа закрыта */ }); };
  ping(); setInterval(ping, 3000);
  window.addEventListener('pagehide', function () {
    try { if (RZ.db) RZ.db.flush(); } catch (e) { /* сохранится по таймеру */ }
    try { navigator.sendBeacon('/pc/bye'); } catch (e) { /* не критично */ }
  });

  // ---------------------------------------------------------------- после загрузки страницы
  window.PC = {
    /* Контуры DXF: каждый файл (dxf, zip, rar) разбирает программа, слои складываются в проект */
    dxf: async function (files, layer) {
      var got = {}, skipped = [], n = 0;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var r = await fetch('/pc/dxf?name=' + encodeURIComponent(f.webkitRelativePath || f.name) + '&layer=' + encodeURIComponent(layer || ''), {method: 'POST', body: f});
        var j = await r.json();
        if (j.error) { skipped.push([f.name, j.error]); continue; }
        Object.keys(j.layers).forEach(function (k) { got[k] = (got[k] || []).concat(j.layers[k]); n += j.layers[k].length; });
        skipped = skipped.concat(j.skipped || []);
      }
      if (!n) return {error: skipped.length ? 'Контуров не нашлось: ' + skipped.map(function (s) { return s[0] + ' — ' + s[1]; }).slice(0, 5).join('; ') : 'Контуров не нашлось.'};
      var res = await post('/api/dxf/add', {layers: got});
      res.skipped = skipped;
      return res;
    },
    /* Данные прежней программы для ПК: data/razmotka.db в папке программы - один раз предлагается загрузить */
    legacy: async function () {
      var r = await fetch('/pc/legacy', {cache: 'no-store'});
      if (!r.ok) return false;
      var blob = await r.blob();
      if (!await ask('Данные прежней программы', '<p>В папке программы найдена база прежней программы для ПК (data/razmotka.db). Загрузить из неё журнал, SPS и контуры в GeoLink?</p>' +
        '<p class="dnote2">Предложение больше не появится; файл razmotka.db остаётся на месте.</p>', 'Загрузить')) { fetch('/pc/legacy/done', {method: 'POST'}); return false; }
      await fetch('/pc/legacy/done', {method: 'POST'});
      if (typeof loadProjectFiles === 'function') loadProjectFiles([new File([blob], 'Прежняя программа для ПК.rzm')]);
      return true;
    },
  };
  document.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('pcDxf');
    if (box) {
      var files = document.getElementById('pcDxfFiles'), dir = document.getElementById('pcDxfDir'), go = async function (list) {
        if (!list || !list.length) return;
        var note = document.getElementById('pcDxfNote'); note.textContent = 'Читаю файлы…';
        var j = await window.PC.dxf([].slice.call(list), document.getElementById('pcDxfLayer').value.trim());
        note.textContent = j.error ? j.error : 'Добавлено контуров: ' + j.items + ' (слоёв: ' + j.layers + ')' + (j.skipped && j.skipped.length ? '. Пропущено файлов: ' + j.skipped.length : '') + '. Они на карте.';
        if (!j.error && typeof dirty !== 'undefined') dirty.field = true;
        files.value = ''; dir.value = '';
      };
      files.onchange = function () { go(files.files); };
      dir.onchange = function () { go(dir.files); };
    }
  });
  window.addEventListener('load', function () {
    (window.APP_READY || Promise.resolve()).then(function () { setTimeout(function () { window.PC.legacy().catch(function () {}); }, 600); });
  });
})();
