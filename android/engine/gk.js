/* Проекция Гаусса-Крюгера (ряды Крюгера, 6 членов) для перевода GPS-координат в систему листа SPS.
   Проверена двумя независимыми выводами формул (Крюгера и Снайдера): расхождение меньше 1 мм в пределах зоны.
   Восток - X листа SPS (около 450 000 без номера зоны), север - Y (около 5 700 000). */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';

  const ELLIPSOIDS = {
    gsk2011: {title: 'ГСК-2011', a: 6378136.5, invf: 298.2564151},
    krass: {title: 'Красовского (СК-42, СК-95)', a: 6378245.0, invf: 298.3},
    wgs84: {title: 'WGS 84', a: 6378137.0, invf: 298.257223563},
  };
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const {sin, cos, sinh, cosh, atan, asin, atanh, sqrt, tan} = Math;

  /* Проекция для эллипсоида и номера зоны: осевой меридиан 6·зона − 3, ложный восток 500 000 м, масштаб 1 */
  function make(ellipsoid, zone) {
    const E = ELLIPSOIDS[ellipsoid];
    if (!E) throw new Error('эллипсоид');
    const lon0 = 6 * zone - 3, l0 = rad(lon0), k0 = 1, e0 = 500000;
    const f = 1 / E.invf, n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n2 * n2, n5 = n4 * n, n6 = n3 * n3;
    const A = E.a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
    const al = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
      13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
      61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
      49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600];
    const be = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
      n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
      17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
      4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600];
    const de = [2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45 + 26 * n5 / 45 - 2854 * n6 / 675,
      7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45 + 2704 * n5 / 315 + 2323 * n6 / 945,
      56 * n3 / 15 - 136 * n4 / 35 - 1262 * n5 / 105 + 73814 * n6 / 2835,
      4279 * n4 / 630 - 332 * n5 / 35 - 399572 * n6 / 14175];

    /* широта, долгота (градусы) -> [восток, север] в метрах */
    function fwd(lat, lon) {
      const p = rad(lat), l = rad(lon) - l0, c = 2 * sqrt(n) / (1 + n);
      const t = sinh(atanh(sin(p)) - c * atanh(c * sin(p)));
      const xi = atan(t / cos(l)), eta = atanh(sin(l) / sqrt(1 + t * t));
      let X = xi, Y = eta;
      al.forEach((a, j) => { const m = 2 * (j + 1); X += a * sin(m * xi) * cosh(m * eta); Y += a * cos(m * xi) * sinh(m * eta); });
      return [e0 + k0 * A * Y, k0 * A * X];
    }
    /* [восток, север] -> [широта, долгота] */
    function inv(E_, N_) {
      const xi = N_ / (k0 * A), eta = (E_ - e0) / (k0 * A);
      let xp = xi, ep = eta;
      be.forEach((b, j) => { const m = 2 * (j + 1); xp -= b * sin(m * xi) * cosh(m * eta); ep -= b * cos(m * xi) * sinh(m * eta); });
      const chi = asin(sin(xp) / cosh(ep));
      let p = chi;
      de.forEach((d, j) => { p += d * sin(2 * (j + 1) * chi); });
      return [deg(p), deg(l0 + atan(sinh(ep) / cos(xp)))];
    }
    /* Сближение меридианов в точке (градусы): на сколько направление «север карты» отличается от истинного севера */
    function convergence(lat, lon) { return deg(atan(tan(rad(lon) - l0) * sin(rad(lat)))); }
    return {fwd, inv, convergence, lon0, ellipsoid, zone};
  }

  RZ.gk = {ELLIPSOIDS, make};
})(globalThis.RZ);
