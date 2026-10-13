/* Подключается первым, в <head>. 1) Недостающее в старых встроенных браузерах Android (WebView): то, без чего
   приложение молча не работало. 2) Облегчённый режим для слабых телефонов: без размытия «стекла», зерна и
   анимаций, карта в меньшем разрешении. Включается сам на приложении Android и телефонах с памятью до 4 ГБ
   или до 4 ядер; вручную - «Данные» → «Скорость работы». */
(function () {
  'use strict';
  var C = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (C && !C.roundRect) {
    C.roundRect = function (x, y, w, h, r) {
      r = Math.max(0, Math.min(typeof r === 'number' ? r : (r && r[0]) || 0, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
    };
  }
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {value: function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; }, configurable: true, writable: true});
  if (!Array.prototype.findLast) Object.defineProperty(Array.prototype, 'findLast', {value: function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; }, configurable: true, writable: true});
  if (!Object.hasOwn) Object.hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  if (!String.prototype.replaceAll) Object.defineProperty(String.prototype, 'replaceAll', {value: function (a, b) { return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b); }, configurable: true, writable: true});
  if (typeof structuredClone !== 'function') window.structuredClone = function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
  if (window.crypto && !crypto.randomUUID) crypto.randomUUID = function () { var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join(''); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); };
  if (typeof queueMicrotask !== 'function') window.queueMicrotask = function (f) { Promise.resolve().then(f); };

  var saved = null;
  try { saved = localStorage.getItem('lite'); } catch (e) { /* без хранилища */ }
  var nat = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  window.LITE_AUTO = !!(nat || weak);
  window.LITE = saved === '1' ? true : saved === '0' ? false : window.LITE_AUTO;
  if (window.LITE) document.documentElement.classList.add('lite');
  /* Разрешение холста карты: на экранах с плотностью 2,6-3 рисовать каждый физический пиксель слишком дорого */
  window.mapDpr = function () { return Math.min(window.devicePixelRatio || 1, window.LITE ? 1.5 : 2); };
})();
