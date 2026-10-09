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
    /* Пикеты линии с координатами по возрастанию номера: [[пикет, x, y]] */
    line_points(line) {
      if (!this._lines) {
        this._lines = new Map();
        for (const [l, p, x, y] of this.list) { let a = this._lines.get(l); if (!a) this._lines.set(l, a = []); a.push([p, x, y]); }
        for (const a of this._lines.values()) a.sort((m, n) => m[0] - n[0]);
      }
      return this._lines.get(line) || [];
    }
    /* Общая зависимость координат от номеров: x = a0 + a1·линия + a2·пикет (и так же y), по наименьшим квадратам.
       Нужна, когда о линии ничего не известно: место пикета оценивается по соседним линиям */
    _fit() {
      if (this._model !== undefined) return this._model;
      const n = this.list.length, step = Math.max(1, Math.floor(n / 4000));
      let k = 0, sl = 0, sp = 0, L0 = 0, P0 = 0;
      for (let i = 0; i < n; i += step) { L0 += this.list[i][0]; P0 += this.list[i][1]; k++; }
      if (k < 3) return (this._model = null);
      L0 /= k; P0 /= k;
      let sll = 0, slp = 0, spp = 0, sx = 0, sy = 0, slx = 0, spx = 0, sly = 0, spy = 0;
      for (let i = 0; i < n; i += step) {
        const [l, p, x, y] = this.list[i], a = l - L0, b = p - P0;
        sll += a * a; slp += a * b; spp += b * b; sx += x; sy += y; slx += a * x; spx += b * x; sly += a * y; spy += b * y;
      }
      const det = sll * spp - slp * slp;
      if (!(Math.abs(det) > 1e-6)) return (this._model = null);       // все известные пикеты на одной линии
      const solve = (sl_, sp_, s0) => [s0 / k, (sl_ * spp - sp_ * slp) / det, (sp_ * sll - sl_ * slp) / det];
      return (this._model = {L0, P0, x: solve(slx, spx, sx), y: solve(sly, spy, sy)});
    }
    /* Где пикет стоит или стоял бы: [x, y, точно ли]. Точно - координаты есть в листе SPS. Иначе место считается:
       по двум ближайшим известным пикетам той же линии, а если линии в SPS нет - по общей зависимости от номеров.
       Так на карте видно задание на разбивку, у которого координат ещё нет */
    est(line, picket) {
      const exact = this.xy(line, picket);
      if (exact) return [exact[0], exact[1], true];
      if (this.schematic) return null;
      const a = this.line_points(line);
      if (a.length >= 2) {
        let i = 0;
        while (i < a.length - 2 && a[i + 1][0] < picket) i++;
        const p = a[i], q = a[i + 1], t = (picket - p[0]) / (q[0] - p[0]);
        return [round_to(p[1] + (q[1] - p[1]) * t, 1), round_to(p[2] + (q[2] - p[2]) * t, 1), false];
      }
      const m = this._fit();
      if (!m) return null;
      if (a.length === 1) return [round_to(a[0][1] + m.x[2] * (picket - a[0][0]), 1), round_to(a[0][2] + m.y[2] * (picket - a[0][0]), 1), false];
      const dl = line - m.L0, dp = picket - m.P0;
      return [round_to(m.x[0] + m.x[1] * dl + m.x[2] * dp, 1), round_to(m.y[0] + m.y[1] * dl + m.y[2] * dp, 1), false];
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
      o.done = {};                                     // проведено по листам работ: каналы размотки/подмотки, пикеты разбивки и своих листов
      for (const name of RZ.sh.WORK) o.done[name] = name === 'razm' ? o.razm : name === 'podm' ? o.podm : repo.staked_total(name);
      return o;
    });
    out.rules = cfg.rules;
    out.crs = cfg.crs;
    return out;
  }

  function field_map(db) {
    const custom_ids = RZ.sh.WORK.filter(n => RZ.sh.SHEETS[n].custom);
    const {c, rows, oo, staked_rows, tasks, custom_rows} = db.read(repo => ({c: coords(db, repo), rows: repo.field_rows(), oo: repo.sheet_rows('oo').map(r => r[2]),
      staked_rows: repo.staked_points(), tasks: repo.sheet_rows('razb').filter(r => r[3] === null).map(r => r[2]),
      custom_rows: Object.fromEntries(custom_ids.map(n => [n, repo.staked_points(n)]))}));
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
    const staked = [];                                // разбитые пикеты: слой «Разбито»
    for (const [line, picket, date, worker] of staked_rows) {
      const xy = c.est(line, picket);
      if (!xy) continue;
      if (!dates.has(date)) dates.set(date, dates.size);
      if (!names.has(worker)) names.set(worker, names.size);
      staked.push(xy[0], xy[1], line, picket, dates.get(date), names.get(worker));
    }
    const custom = {};                                // свои листы работ: выполненные пикеты, у каждого листа свой слой
    for (const [name, pts] of Object.entries(custom_rows)) {
      const out = custom[name] = [];
      for (const [line, picket, date, worker] of pts) {
        const xy = c.est(line, picket);
        if (!xy) continue;
        if (!dates.has(date)) dates.set(date, dates.size);
        if (!names.has(worker)) names.set(worker, names.size);
        out.push(xy[0], xy[1], line, picket, dates.get(date), names.get(worker));
      }
    }
    const plan = [], seen = new Set();                // задания на разбивку: место считается, если координат ещё нет
    for (const v of tasks) {
      if (v[2] === null || v[3] === null || v[4] === null || Math.abs(v[4] - v[3]) > 20000) continue;
      for (let p = Math.min(v[3], v[4]); p <= Math.max(v[3], v[4]); p++) {
        const k = v[2] * 1e6 + p, xy = seen.has(k) ? null : c.est(v[2], p);
        if (xy) { seen.add(k); plan.push(xy[0], xy[1], v[2], p); }
      }
    }
    return {
      staked, plan, custom,
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

  /* Поиск пикетов на карте. ranges: [{line, p1, p2}]. Один пикет в любой из ячеек - одна точка, оба пусты - вся линия */
  function find(db, ranges) {
    const VE = RZ.ValidationError, sh = RZ.sh, empty = v => v === null || v === undefined || String(v).trim() === '';
    if (!Array.isArray(ranges) || !ranges.length) throw new VE('Укажите линию и пикеты для поиска.');
    if (ranges.length > 200) throw new VE('Слишком много строк поиска за один раз: не больше 200.');
    const c = db.read(repo => coords(db, repo)), points = [], rows = [], seen = new Set();
    ranges.forEach((r, i) => {
      r = r && typeof r === 'object' ? r : {};
      const raw = [r.line, r.p1, r.p2], n = i + 1;
      if (raw.every(empty)) return;
      const [line, p1, p2] = raw.map(v => (empty(v) ? null : sh.parse_int(v)));
      if (line === null || line < 1) throw new VE(`Строка поиска ${n}: укажите номер линии целым числом.`);
      if ((p1 === null && !empty(raw[1])) || (p2 === null && !empty(raw[2]))) throw new VE(`Строка поиска ${n}: номер пикета должен быть целым числом.`);
      let pickets, want;
      if (p1 === null && p2 === null) {
        if (c.schematic) throw new VE(`Строка поиска ${n}: укажите пикет. Всю линию можно найти, когда заполнен лист SPS.`);
        pickets = c.line_points(line).map(p => p[0]); want = pickets.length;
      } else {
        let a = p1 !== null ? p1 : p2, b = p2 !== null ? p2 : p1;
        [a, b] = [Math.min(a, b), Math.max(a, b)];
        if (b - a > 100000 || a < 1) throw new VE(`Строка поиска ${n}: проверьте номера пикетов.`);
        pickets = []; for (let p = a; p <= b; p++) pickets.push(p);
        want = b - a + 1;
      }
      let found = 0;
      for (const p of pickets) {
        const xy = c.xy(line, p);
        if (!xy) continue;
        found++;
        const k = line * 1e6 + p;
        if (!seen.has(k)) { seen.add(k); points.push(xy[0], xy[1], line, p); }
      }
      rows.push({line, p1: p1 !== null ? p1 : p2, p2: p2 !== null ? p2 : p1, found, missing: want - found});
    });
    if (!rows.length) throw new VE('Укажите линию и пикеты для поиска.');
    return {points, rows};
  }

  const stats = (db, d1, d2) => db.read(repo => repo.stats(d1, d2));
  /* Лидеры за период: по каждому листу работ, по убыванию объёма */
  function leaders(db, d1, d2) {
    const got = db.read(repo => repo.leaders(d1 || '0000-00-00', d2 || '9999-99-99'));
    return {sheets: RZ.sh.WORK.map(n => {
      const s = RZ.sh.SHEETS[n];
      return {id: n, title: s.title, unit: s.unit, custom: !!s.custom, journal: s.journal || (s.prefix === 'Журнал ТГО' ? 'tgo' : 'gfo'), rows: got[n] || []};
    })};
  }

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

  RZ.reports = {find, Coords, coords, summary, field_map, period, stats, leaders, check, round_to, line_angle, picket_xy, nearest};
})(globalThis.RZ);
