/* Данные для экранов «Поле», «Учёт», «Проверка». Порт app/services/reports.py */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';

  const round_to = (v, n) => RZ.sh.round_half_even(v, n);
  const num_of = (v, dflt) => {
    const f = typeof v === 'number' ? v : (v === null || v === undefined ? undefined : RZ.xlsx.py_float(v));
    return f !== undefined && f > 0 ? f : dflt;
  };

  /* Направление профилей в градусах против часовой стрелки от оси X, от -90 до 90.
     У каждой линии берётся отрезок от первого пикета до последнего; направления усредняются с весом по длине */
  function line_angle(ends) {
    let sx = 0, sy = 0;
    for (const [, a, , b] of ends) {
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length) { const angle = 2 * Math.atan2(dy, dx); sx += length * Math.cos(angle); sy += length * Math.sin(angle); }
    }
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return 0;
    const deg = round_to(Math.atan2(sy, sx) / 2 * 180 / Math.PI, 2);
    return deg <= -90 ? 90 : deg + 0;
  }

  /* Откуда карта берёт координаты пикета. Если лист SPS заполнен - из него. Если пуст - схема по номерам
     линий и пикетов: расстояния берутся из «Общей информации» */
  class Coords {
    constructor(repo) {
      this.points = new Map();
      this.list = [];                                           // [линия, пикет, x, y] для поиска ближайшего пикета
      this.grid = null;
      this.background = [];
      const ends = new Map();                                   // линия -> [мин. пикет, его xy, макс. пикет, его xy]
      for (const [line, picket, x, y] of repo.sps_points()) {
        const key = line * 1e6 + picket;
        if (!this.points.has(key)) {                            // как ВПР: берётся первое совпадение
          this.points.set(key, [round_to(x, 1), round_to(y, 1)]);
          this.list.push([line, picket, x, y]);
          let e = ends.get(line);
          if (!e) ends.set(line, e = [picket, [x, y], picket, [x, y]]);
          if (picket < e[0]) { e[0] = picket; e[1] = [x, y]; }
          if (picket > e[2]) { e[2] = picket; e[3] = [x, y]; }
        }
        this.background.push(round_to(x, 1), round_to(y, 1));
      }
      this.line_angle = line_angle(ends.values());
      this.schematic = this.points.size === 0;
      const info = repo.sheet_rows('info').map(r => r[2]);
      const value = (index, dflt) => num_of(info[index] ? info[index][1] : undefined, dflt);
      this.picket_step = value(13, 25.0);                       // Шаг ПП, м
      this.line_step = value(11, 200.0) / value(15, 8.0);       // Шаг ЛПП, м / шаг нумерации ЛПП
    }
    /* Ближайший пикет листа SPS к точке карты: [линия, пикет, расстояние, м] или null, если дальше max_dist */
    nearest(x, y, max_dist = 500) {
      if (this.schematic || !this.list.length) return null;
      const C = 50;                                             // сетка ячеек по 50 м: поиск кольцами вокруг точки
      if (!this.grid) {
        this.grid = new Map();
        for (const p of this.list) { const k = Math.floor(p[2] / C) * 1e7 + Math.floor(p[3] / C); let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(p); }
      }
      const cx = Math.floor(x / C), cy = Math.floor(y / C), rings = Math.ceil(max_dist / C) + 1;
      let best = null, bq = max_dist * max_dist;
      for (let r = 0; r <= rings; r++) {
        for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          const a = this.grid.get(i * 1e7 + j);
          if (!a) continue;
          for (const p of a) { const q = (p[2] - x) ** 2 + (p[3] - y) ** 2; if (q < bq) { bq = q; best = p; } }
        }
        if (best && Math.sqrt(bq) <= r * C) break;              // дальше кольца заведомо хуже
      }
      return best ? [best[0], best[1], Math.sqrt(bq)] : null;
    }
    xy(line, picket) {
      if (this.schematic) return [round_to(picket * this.picket_step, 1), round_to(line * this.line_step, 1)];
      return this.points.get(line * 1e6 + picket) || null;
    }
  }

  function coords(db, repo) {
    if (!db.coords) db.coords = new Coords(repo);
    return db.coords;
  }

  // ---------------------------------------------------------------- экраны
  function summary(db, cfg) {
    const out = db.read(repo => {
      const o = repo.totals(), bad = repo.anomaly_counts();
      o.bad = bad.razm + bad.podm;
      o.bad_razm = bad.razm; o.bad_podm = bad.podm;
      o.sps = repo.sps_count();
      o.party = RZ.svc_sheets.party(repo);
      o.drafts = RZ.svc_sheets.draft_counts(repo);
      o.draft_channels = RZ.svc_sheets.draft_channels(repo);
      return o;
    });
    out.rules = cfg.rules;
    return out;
  }

  function field_map(db) {
    const {c, rows, oo} = db.read(repo => ({c: coords(db, repo), rows: repo.field_rows(), oo: repo.sheet_rows('oo').map(r => r[2])}));
    const points = [], dates = new Map(), names = new Map();
    let no_xy = 0;
    for (const [line, picket, date, worker] of rows) {
      const xy = c.xy(line, picket);
      if (!xy) { no_xy++; continue; }
      if (!dates.has(date)) dates.set(date, dates.size);
      if (!names.has(worker)) names.set(worker, names.size);
      points.push(xy[0], xy[1], line, picket, dates.get(date), names.get(worker));
    }
    const left = [], lost = [];                       // «Оставленное оборудование»: статус 1 - оставлено, 0 - утеряно
    for (const v of oo) {
      if (v[0] === null || v[1] === null || (v[2] !== 0 && v[2] !== 1)) continue;
      const xy = c.xy(v[0], v[1]);
      if (xy) (v[2] === 1 ? left : lost).push(xy[0], xy[1], v[0], v[1]);
    }
    return {
      sps: c.schematic ? [] : c.background, schematic: c.schematic, field: points, dates: [...dates.keys()], names: [...names.keys()],
      segments: RZ.rules.segments(rows.map(r => [r[0], r[1], 0])).map(s => s.slice(0, 3)),
      no_xy, left, lost, line_angle: c.schematic ? 0 : c.line_angle,
    };
  }

  function period(db, d1, d2) {
    const out = {1: [], 0: []};
    db.read(repo => {
      const c = coords(db, repo);
      for (const [wtype, line, picket] of repo.period_points(d1, d2)) {
        const xy = c.xy(line, picket);
        if (xy) out[wtype].push(xy[0], xy[1], line, picket);
      }
    });
    return {razm: out[1], podm: out[0]};
  }

  /* Координаты пикета и ближайший пикет к точке: для GPS на карте */
  function picket_xy(db, line, picket) {
    const xy = db.read(repo => coords(db, repo)).xy(parseInt(line, 10), parseInt(picket, 10));
    return xy ? {x: xy[0], y: xy[1]} : {};
  }
  function nearest(db, x, y) {
    const c = db.read(repo => coords(db, repo)), n = c.nearest(+x, +y);
    return n ? {line: n[0], picket: n[1], dist: Math.round(n[2] * 10) / 10} : {};
  }

  const stats = (db, d1, d2) => db.read(repo => repo.stats(d1, d2));

  /* Противоречия истории и сверка итогов. Каналов на поле = размотано - подмотано - повторных размоток + подмоток без размотки */
  function check(db) {
    const {rows, totals, where} = db.read(repo => {
      const where = new Map();
      for (const name of ['razm', 'podm']) repo.sheet_rows(name).forEach(([rid], n) => where.set(rid, [name, n + 1]));
      return {rows: repo.anomalies(), totals: repo.totals(), where};
    });
    const out = [];
    for (const [line, picket, date, kind, src] of rows) {
      const last = out[out.length - 1];
      if (last && last[0] === line && last[2] === picket - 1 && last[3] === date && last[4] === kind && last[5] === src) last[2] = picket;
      else out.push([line, picket, picket, date, kind, src]);
    }
    const result = out.map(([line, p1, p2, date, kind, src]) => {
      const [sheet, row] = where.get(src) || [null, null];
      return {line, p1, p2, date, kind, sheet, row, row_id: src};
    });
    const razm = rows.filter(r => r[3] === 'razm').length;
    return {items: result, razm: totals.razm, podm: totals.podm, field: totals.field, double_razm: razm, orphan_podm: rows.length - razm};
  }

  RZ.reports = {Coords, coords, summary, field_map, period, stats, check, round_to, line_angle, picket_xy, nearest};
})(globalThis.RZ);
