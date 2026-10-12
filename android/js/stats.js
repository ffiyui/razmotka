/* Экран «Учёт»: у каждого журнала своя страница (вкладки сверху), на странице - один вид работ (кнопки под вкладками):
   итог за период, график по дням, ТОП лидеров с кубками и разбивка по линиям. Период - всё, месяц, неделя или свои даты */
const ST = {tab: 'gfo', kind: {}};
const CUP = ['#E3B341', '#C9D1D9', '#D18B47'];
const cupSvg = c => `<svg class="cup" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" fill="${c}" fill-opacity=".25"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/></svg>`;
const KIND_COLOR = {razm: 'var(--razm, #D29922)', podm: 'var(--c-blue)', razb: 'var(--c-purple)'};
const statGroups = () => (typeof NAV !== 'undefined' && NAV.groups ? NAV.groups : []).filter(g => !g.report);
const statKinds = g => (typeof groupPages === 'function' ? groupPages(g) : []).filter(id => Sheets.pages[id] && Sheets.pages[id].work);
const unitWord = (u, n) => (u === 'пикет' ? plural(n, 'пикет', 'пикета', 'пикетов') : plural(n, 'канал', 'канала', 'каналов'));
const kindTitle = id => (typeof navTitle === 'function' && navTitle(id)) || (Sheets.pages[id] && Sheets.pages[id].meta.title) || id;

function statTabs() {
  const gs = statGroups();
  if (!gs.some(g => g.id === ST.tab)) ST.tab = gs.length ? gs[0].id : 'gfo';
  $('sTabs').innerHTML = gs.map(g => `<button type="button" class="jt${g.id === ST.tab ? ' on' : ''}" data-g="${esc(g.id)}">${typeof iconSvg === 'function' ? iconSvg(g.icon || 'journal', 16) : ''}<span>${esc(g.title)}</span></button>`).join('');
  const g = gs.find(x => x.id === ST.tab), kinds = g ? statKinds(g) : [];
  if (!kinds.includes(ST.kind[ST.tab])) ST.kind[ST.tab] = kinds[0];
  $('sKinds').innerHTML = kinds.map(id => `<button type="button" class="chip st-k${id === ST.kind[ST.tab] ? ' on' : ''}" data-k="${id}">${typeof iconSvg === 'function' ? iconSvg(typeof pageIcon === 'function' ? pageIcon(id) : 'table', 14) : ''}${esc(kindTitle(id))}</button>`).join('');
  $('sKinds').hidden = kinds.length < 2;
  return {g, kind: ST.kind[ST.tab]};
}
$('sTabs').onclick = e => { const b = e.target.closest('.jt'); if (!b) return; ST.tab = b.dataset.g; loadStats(); };
$('sKinds').onclick = e => { const b = e.target.closest('.st-k'); if (!b) return; ST.kind[ST.tab] = b.dataset.k; loadStats(); };

async function loadStats() {
  const a = $('sFrom').value, b = $('sTo').value, {g, kind} = statTabs();
  if (!g) { $('sBody').innerHTML = ''; return; }
  if (!kind) { $('sBody').innerHTML = `<div class="card pad empty">В журнале «${esc(g.title)}» нет листов с выполненными работами. Добавьте лист вида «Работы» — его статистика появится здесь.</div>`; return; }
  let j;
  try { j = await api(`/api/stats/sheet?name=${encodeURIComponent(kind)}&from=${a}&to=${b}`); } catch (e) { $('sBody').innerHTML = ''; return; }
  if (j.error) { $('sBody').innerHTML = `<div class="card pad empty">${esc(j.error)}</div>`; return; }
  const u = j.unit, days = j.days.length, avg = days ? Math.round(j.total / days) : 0, title = esc(kindTitle(kind));
  const top = j.workers.length ? '<ol class="top">' + j.workers.slice(0, 10).map((r, i) => `<li class="${i < 3 ? 'p' + (i + 1) : ''}"><span class="top-n">${i < 3 ? cupSvg(CUP[i]) : i + 1}</span><span class="top-w">${esc(r[0])}</span><b>${nf(r[1])}</b></li>`).join('') + '</ol>'
    : '<div class="empty">За этот период работ нет.</div>';
  const lines = j.lines.length ? '<table><tr><th>Линия</th><th class="r">' + (u === 'пикет' ? 'Пикетов' : 'Каналов') + '</th></tr>' + j.lines.map(r => `<tr><td>${r[0]}</td><td class="r">${nf(r[1])}</td></tr>`).join('') + '</table>'
    : '<div class="empty">За этот период работ нет.</div>';
  $('sBody').innerHTML = `<div class="figures" id="sFig"><div><b>${nf(j.total)}</b><span>${title}, ${u === 'пикет' ? 'пикетов' : 'каналов'}</span></div>` +
    `<div><b>${nf(days)}</b><span>${plural(days, 'рабочий день', 'рабочих дня', 'рабочих дней')}</span></div>` +
    `<div><b>${nf(j.workers.length)}</b><span>${plural(j.workers.length, 'исполнитель', 'исполнителя', 'исполнителей')}</span></div>` +
    `<div><b>${nf(avg)}</b><span>в среднем за день</span></div></div>` +
    `<div class="card pad"><div class="st-cap">${title}, ${u === 'пикет' ? 'пикетов' : 'каналов'} в день</div><div id="chart"></div></div>` +
    `<div class="grid2"><div><h2>ТОП лидеров</h2><div class="card top-card" id="sTop">${top}</div></div>` +
    `<div><h2>По линиям</h2><div class="card scroll" id="sLines">${lines}</div></div></div>`;
  const da = a || (j.days[0] || [])[0], db = b || (j.days[j.days.length - 1] || [])[0];
  chart(j.days, da, db, KIND_COLOR[kind] || 'var(--c-green)', title);
}
/* Столбики по дням периода: один вид работ */
function chart(days, a, b, color, title) {
  const box = $('chart');
  if (!days.length) { box.innerHTML = '<div class="empty">За этот период работ нет.</div>'; return; }
  const W = Math.max(box.clientWidth, 300), H = 220, L = 46, R = 8, T = 10, M = 24, d0 = Date.parse(a), n = Math.max(1, Math.round((Date.parse(b) - d0) / 864e5) + 1);
  const max = Math.max(1, ...days.map(d => d[1])), inner = H - T - M, bw = (W - L - R) / n;
  const nice = m => { const p = Math.pow(10, Math.floor(Math.log10(m))); const k = m / p; return (k > 5 ? 5 : k > 2 ? 2 : 1) * p; };
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="${title} по дням">`;
  const g = nice(max);
  for (const v of [0, g]) { const y = T + inner - inner * v / max; s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${nf(v)}</text>`; }
  for (const [dt, v] of days) {
    const x = L + Math.round((Date.parse(dt) - d0) / 864e5) * bw, w = Math.max(bw - (bw > 4 ? 1.5 : 0), 1), h = inner * v / max;
    s += `<rect x="${x}" y="${T + inner - h}" width="${w}" height="${h}" style="fill:${color}" rx="${Math.min(2, w / 2)}"><title>${dru(dt)}: ${nf(v)}</title></rect>`;
  }
  const mn = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  let last = -1e9;
  for (let i = 0; i < n; i++) {
    const d = new Date(d0 + i * 864e5), x = L + i * bw;
    if ((n > 45 ? d.getUTCDate() === 1 : true) && x - last > 58 && x < W - 44) {
      s += `<text x="${x}" y="${H - 6}">${n > 45 ? mn[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2) : String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0')}</text>`;
      last = x;
    }
  }
  box.innerHTML = s + '</svg>';
}
const statPreset = days => { const e = S.date_max || today(); $('sTo').value = e; $('sFrom').value = days === null ? (S.date_min || e) : new Date(Date.parse(e) - days * 864e5).toISOString().slice(0, 10); loadStats(); };
$('sFrom').onchange = $('sTo').onchange = loadStats;
$('sAll').onclick = () => statPreset(null);
$('s30').onclick = () => statPreset(29);
$('s7').onclick = () => statPreset(6);
