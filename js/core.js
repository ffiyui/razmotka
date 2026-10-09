/* Общие помощники: запросы к программе, сообщения, диалог, сводка */
const $=id=>document.getElementById(id);
const nf=n=>Number(n||0).toLocaleString('ru-RU');
const dru=s=>s?s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4):'';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
async function api(path,opt){const r=await fetch(path,opt);const j=await r.json();return j}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
let toastT;function toast(t){const e=$('toast');e.textContent=t;e.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>e.style.display='none',4200)}
function ask(title,bodyHtml,yes,infoOnly,wide){return new Promise(res=>{$('dTitle').textContent=title;$('dBody').innerHTML=bodyHtml;$('dYes').textContent=yes;
  $('dialog').classList.toggle('wide',!!wide);$('dYes').disabled=false;
  $('dNo').style.display=infoOnly?'none':'';$('veil').style.display='flex';$('dYes').focus();
  const done=v=>{$('veil').style.display='none';$('veil').onkeydown=null;res(v)};
  $('dYes').onclick=()=>done(true);$('dNo').onclick=()=>done(false);
  $('veil').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();done(false)}e.stopPropagation()}})}
function seg(id){const box=$(id);box.onclick=e=>{const b=e.target.closest('button');if(!b)return;[...box.children].forEach(x=>x.classList.toggle('on',x===b));box.dispatchEvent(new Event('change'))};
  return()=>box.querySelector('.on').dataset.v}

function plural(n,a,b,c){n=Math.abs(n)%100;const k=n%10;return n>10&&n<20?c:k===1?a:k>1&&k<5?b:c}

/* Сводка и признаки «данные изменились» для экранов */
let S=null, dirty={};
function markDirty(sheetsToo){for(const k of ['field','stats','check'])dirty[k]=true;
  if(sheetsToo)for(const k of ['razm','podm','razb','oo','snake','info','workers','topo','sps'])dirty[k]=true}
async function loadSummary(){S=await api('/api/summary');
  $('navbad').textContent=S.bad?nf(S.bad):'';
  $('nav-razm').textContent=S.drafts.razm?nf(S.drafts.razm):'';
  $('nav-podm').textContent=S.drafts.podm?nf(S.drafts.podm):'';
  if($('nav-razb'))$('nav-razb').textContent=S.drafts.razb?nf(S.drafts.razb):'';
  $('foot').textContent=S.date_max?'Последняя запись '+dru(S.date_max):'Данных пока нет';
  if(typeof homeBadges==='function')homeBadges();
  if(typeof fillRules==='function')fillRules();
  for(const [a,b] of [['sFrom','sTo'],['mFrom','mTo'],['cFrom','cTo']]){if(!$(a).value)$(a).value=S.date_max||today();if(!$(b).value)$(b).value=S.date_max||today()}
  if(!$('sFrom').dataset.set){$('sFrom').value=S.date_min||today();$('sFrom').dataset.set=1}
}
function changed(sheetsToo){markDirty(sheetsToo);return loadSummary().then(()=>show(location.hash.slice(1)))}

/* ---------- общая палитра: 9 оттенков по 6 тонов, от светлого к тёмному ---------- */
const PALETTE = (() => {
  const hex = (h, s, l) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0'); return '#' + f(0) + f(8) + f(4); };
  const hues = [[0, 0], [2, 88], [26, 96], [46, 96], [135, 62], [176, 72], [211, 96], [262, 78], [326, 80]], tones = [91, 80, 66, 52, 40, 27];
  const out = [];
  for (const l of tones) for (const [h, sat] of hues) out.push(hex(h, sat, sat ? l : l * .9 + (l < 30 ? -14 : 4)).toUpperCase());
  return out;
})();
const paletteHtml = current => '<div class="pal-grid">' + PALETTE.map(c =>
  `<button type="button" class="pal-c${current && c.toLowerCase() === String(current).toLowerCase() ? ' on' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('') + '</div>';
/* Всплывающая панель под кнопкой. Закрывается щелчком мимо или клавишей Esc. Возвращает {el, close}. */
function popover(anchor, html, cls) {
  document.querySelectorAll('.palette').forEach(p => p.remove());
  const el = document.createElement('div');
  el.className = 'palette' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  el.style.top = (r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', key, true); };
  const outside = e => { if (!el.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', key, true); });
  return {el, close};
}

/* ---------- цвет размотки и подмотки ---------- */
/* Один цвет задаёт всю тему листа: кнопку, строки-черновики, рамку выделения, а также цифры и диаграмму на экране «Учёт».
   Тёмный и светлый тона и цвет текста на кнопке подбираются по яркости. Хранится на сервере (data/prefs.json). */
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const THEME_DEFAULT = {razm: '#D29922', podm: '#58A6FF', razb: '#A371F7'}, THEME_VAR = {razm: 'razm', podm: 'blue', razb: 'razb'};
const THEME = {...THEME_DEFAULT};
function themeTones(color) {
  const v = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)), lin = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); };
  const lum = .2126 * lin(v[0]) + .7152 * lin(v[1]) + .0722 * lin(v[2]), light = lum > .43, k = light ? .5 : .74;
  return {on: light ? '#1D1D1F' : '#fff', dark: '#' + v.map(x => Math.round(x * k).toString(16).padStart(2, '0')).join(''), soft: `rgba(${v.join(',')},.16)`};
}
function applyTheme() {
  const root = document.documentElement.style;
  for (const k of Object.keys(THEME_DEFAULT)) {
    const name = '--' + THEME_VAR[k], same = THEME[k].toLowerCase() === THEME_DEFAULT[k].toLowerCase(), t = themeTones(THEME[k]);
    for (const [suffix, value] of [['', THEME[k]], ['-dark', t.dark], ['-soft', t.soft], ['-on', t.on], ['-ink', t.on === '#fff' ? THEME[k] : t.dark]])
      same ? root.removeProperty(name + suffix) : root.setProperty(name + suffix, value);
  }
}
let themeTimer = 0;
function setTheme(key, color, save) {
  THEME[key] = /^#[0-9a-f]{6}$/i.test(color || '') ? color : THEME_DEFAULT[key];
  applyTheme();
  if (save === false) return;
  remember('theme', JSON.stringify(THEME));
  clearTimeout(themeTimer); themeTimer = setTimeout(() => post('/api/prefs', {theme: THEME}).catch(() => {}), 400);
}
function loadTheme(saved) {                    // saved - из настроек на сервере; без него берётся копия из браузера
  try { saved = saved || JSON.parse(remember('theme') || '{}'); } catch (err) { saved = {}; }
  for (const k of Object.keys(THEME_DEFAULT)) setTheme(k, (saved || {})[k], false);
  remember('theme', JSON.stringify(THEME));
}
/* Окно выбора цвета темы под названием листа */
function openTheme(button, key) {
  const html = () => `<div class="pal-title">Цвет листа «${esc(button.textContent)}»</div>${paletteHtml(THEME[key])}` +
    `<div class="pal-row"><button type="button" class="pal-none">Как было</button><label class="pal-own">Свой<input type="color" value="${THEME[key]}"></label></div>`;
  const {el} = popover(button, html());
  const bind = () => { el.querySelector('input').oninput = e => setTheme(key, e.target.value); };
  bind();
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setTheme(key, b.classList.contains('pal-none') ? null : b.dataset.c);
    el.innerHTML = html(); bind();
  });
}

/* ---------- фигуры точек карты ---------- */
/* Фигура задана в единичном квадрате -1..1: многоугольник, круг или отрезки. stroke - рисуется контуром. */
const SHAPES = (() => {
  const ngon = (n, r, rot, r2) => Array.from({length: r2 ? n * 2 : n}, (_, i) => {
    const a = rot + i * Math.PI * 2 / (r2 ? n * 2 : n), rr = r2 && i % 2 ? r2 : r; return [Math.sin(a) * rr, -Math.cos(a) * rr]; });
  return {
    square: {title: 'Квадрат', poly: [[-.9, -.9], [.9, -.9], [.9, .9], [-.9, .9]]},
    circle: {title: 'Круг', circle: 1},
    diamond: {title: 'Ромб', poly: [[0, -1.2], [1.2, 0], [0, 1.2], [-1.2, 0]]},
    triangle: {title: 'Треугольник', poly: [[0, -1.15], [1.2, .95], [-1.2, .95]]},
    triangle_down: {title: 'Треугольник вниз', poly: [[0, 1.15], [1.2, -.95], [-1.2, -.95]]},
    pentagon: {title: 'Пятиугольник', poly: ngon(5, 1.15, 0)},
    hexagon: {title: 'Шестиугольник', poly: ngon(6, 1.12, Math.PI / 6)},
    star: {title: 'Звезда', poly: ngon(5, 1.35, 0, .56)},
    plus: {title: 'Плюс', lines: [[-1.1, 0, 1.1, 0], [0, -1.1, 0, 1.1]]},
    cross: {title: 'Крест', lines: [[-.95, -.95, .95, .95], [.95, -.95, -.95, .95]]},
    dash: {title: 'Штрих', lines: [[-1.25, 0, 1.25, 0]]},
    bar: {title: 'Столбик', lines: [[0, -1.25, 0, 1.25]]},
    ring: {title: 'Кольцо', circle: .82, stroke: true},
    box: {title: 'Рамка', poly: [[-.8, -.8], [.8, -.8], [.8, .8], [-.8, .8]], stroke: true},
  };
})();
/* Значок фигуры для легенды и окна выбора */
function shapeSvg(name, color, px) {
  const s = SHAPES[name] || SHAPES.square, line = s.lines || s.stroke, w = .46;
  const body = s.circle ? `<circle r="${s.circle}"/>` : s.poly ? `<polygon points="${s.poly.map(p => p.join(',')).join(' ')}"/>`
    : s.lines.map(l => `<line x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}"/>`).join('');
  return `<svg width="${px}" height="${px}" viewBox="-1.5 -1.5 3 3" ${line ? `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"` : `fill="${color}"`}>${body}</svg>`;
}
/* Та же фигура на холсте: центр в (0,0), полуразмер r */
function shapeDraw(g, name, r, color) {
  const s = SHAPES[name] || SHAPES.square;
  g.beginPath();
  if (s.circle) g.arc(0, 0, s.circle * r, 0, 6.2832);
  else if (s.poly) { s.poly.forEach((p, i) => i ? g.lineTo(p[0] * r, p[1] * r) : g.moveTo(p[0] * r, p[1] * r)); g.closePath(); }
  else for (const l of s.lines) { g.moveTo(l[0] * r, l[1] * r); g.lineTo(l[2] * r, l[3] * r); }
  if (s.lines || s.stroke) { g.strokeStyle = color; g.lineWidth = Math.max(1, r * .46); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); }
  else { g.fillStyle = color; g.fill(); }
}

/* ---------- скрытие бокового меню: остаются «три точки», которые его возвращают ---------- */
const remember = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (err) { /* не критично */ } return null; };
function setNav(hidden) {
  document.body.classList.toggle('nonav', hidden);
  remember('nonav', hidden ? '1' : '0');
  if (typeof resizeMap === 'function') setTimeout(resizeMap, 0);
  if (!hidden && typeof navFitBrand === 'function') navFitBrand();
}
$('navHide').onclick = () => setNav(true);
$('navShow').onclick = () => setNav(false);
if (remember('nonav') === '1') document.body.classList.add('nonav');
loadTheme();

/* Телефон на Android: тексты подсказок про установку, геолокацию и голос у него свои */
const ANDROID=/android/i.test(navigator.userAgent);
/* Android не знает расширения .rzm: с фильтром по типу файл в окне выбора бывает серым и не выбирается. Проверяется содержимое */
if(ANDROID)for(const i of document.querySelectorAll('input[type=file]'))i.removeAttribute('accept');
