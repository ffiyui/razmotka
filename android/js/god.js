/* Режим отладки («режим бога»): включается в «Настройки» → «Режим отладки». Пока он включён, любой текст
   приложения можно изменить: удерживайте палец на тексте полсекунды - откроется окно правки.
   Замены хранятся в настройках телефона (PREFS.texts: исходный текст → новый) и действуют и после выключения режима.
   Применяются ко всем текстам страницы, в том числе появившимся позже (MutationObserver). */
(() => {
  'use strict';
  const G = {on: false, n: 0};
  window.GOD = G;
  const map = () => (PREFS && PREFS.texts && typeof PREFS.texts === 'object' ? PREFS.texts : {});
  const skip = el => !el || el.closest('script,style,textarea,input,select,canvas,svg,#god-badge');

  function fix(node) {
    if (node.nodeType !== 3 || node.data === node.__gs) return;
    const orig = node.data, key = orig.trim(), m = map();
    if (!key || !Object.prototype.hasOwnProperty.call(m, key) || skip(node.parentElement)) return;
    node.__go = orig; node.__gs = orig.replace(key, m[key]); node.data = node.__gs;
  }
  function walk(root) {
    if (root.nodeType === 3) return fix(root);
    if (root.nodeType !== 1 || skip(root)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) fix(n);
  }
  G.apply = () => walk(document.body);
  let pending = [], raf = 0;
  const mo = new MutationObserver(list => {
    if (!Object.keys(map()).length) return;
    for (const r of list) { if (r.type === 'characterData') pending.push(r.target); else for (const n of r.addedNodes) pending.push(n); }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const a = pending; pending = []; for (const n of a) if (n.isConnected) walk(n); });
  });

  function textAt(x, y, el) {
    let n = null;
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); n = r && r.startContainer; }
    else if (document.caretPositionFromPoint) { const r = document.caretPositionFromPoint(x, y); n = r && r.offsetNode; }
    if (n && n.nodeType === 3 && n.data.trim() && el.contains(n)) return n;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (t.data.trim()) return t;
    return null;
  }
  async function editNode(node) {
    const orig = (node.__go != null ? node.__go : node.data).trim(), now = node.data.trim();
    const p = ask('Изменить текст', `<p class="dnote2">Исходный: «${esc(orig)}»</p><textarea id="godText" rows="3" style="width:100%">${esc(now)}</textarea>` +
      `<label class="tick"><input type="checkbox" id="godBack"> Вернуть исходный текст</label>`, 'Сохранить');
    setTimeout(() => { const t = $('godText'); if (t) { t.focus(); t.select(); } }, 50);
    if (!await p) return;
    const m = {...map()}, v = $('godText').value.trim();
    if ($('godBack').checked || !v || v === orig) { delete m[orig]; node.__gs = undefined; node.data = node.__go != null ? node.__go : node.data; }
    else { m[orig] = v; node.__gs = undefined; node.data = node.__go != null ? node.__go : node.data; }
    PREFS.texts = m;
    post('/api/prefs', {texts: m}).catch(() => {});
    G.apply(); render();
  }

  // удержание пальца (или кнопки мыши) на тексте - правка; обычные касания работают как всегда
  let hold = null, eat = false;
  document.addEventListener('pointerdown', e => {
    if (!G.on || e.button > 0) return;
    const el = e.target;
    if (skip(el) || el.closest('#veil')) return;
    const x = e.clientX, y = e.clientY;
    hold = {x, y, t: setTimeout(() => {
      hold = null;
      const n = textAt(x, y, el.nodeType === 1 ? el : el.parentElement);
      if (!n) return;
      eat = true; setTimeout(() => { eat = false; }, 800);
      editNode(n);
    }, 550)};
  }, true);
  const cancel = e => { if (hold && (e.type !== 'pointermove' || Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8)) { clearTimeout(hold.t); hold = null; } };
  ['pointerup', 'pointercancel', 'pointermove'].forEach(t => document.addEventListener(t, cancel, true));
  document.addEventListener('click', e => { if (eat && !e.target.closest('#veil')) { e.preventDefault(); e.stopPropagation(); eat = false; } }, true);
  document.addEventListener('contextmenu', e => { if (G.on && !skip(e.target)) e.preventDefault(); }, true);

  function render() {
    const n = Object.keys(map()).length;
    if ($('godNote')) $('godNote').textContent = n ? 'Изменено текстов: ' + n : 'Тексты не менялись.';
    if ($('godReset')) $('godReset').disabled = !n;
    let b = $('god-badge');
    if (G.on && !b) { b = document.createElement('div'); b.id = 'god-badge'; b.textContent = 'Отладка: удерживайте текст, чтобы изменить'; document.body.appendChild(b); }
    if (!G.on && b) b.remove();
    document.body.classList.toggle('god', G.on);
  }
  function setOn(on) { G.on = on; render(); }
  G.setOn = setOn;
  (async () => {
    try { if (typeof colorsReady !== 'undefined') await colorsReady; } catch (e) { /* без настроек */ }
    G.on = !!(PREFS && PREFS.god);
    G.apply();
    mo.observe(document.body, {childList: true, subtree: true, characterData: true});
    const box = $('godOn');
    if (box) {
      box.checked = G.on;
      box.onchange = () => { PREFS.god = box.checked; post('/api/prefs', {god: box.checked}).catch(() => {}); setOn(box.checked); };
      $('godReset').onclick = async () => {
        if (!await ask('Вернуть все тексты?', '<p>Все изменённые в режиме отладки тексты станут исходными.</p>', 'Вернуть')) return;
        PREFS.texts = {}; post('/api/prefs', {texts: {}}).catch(() => {});
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let t = w.nextNode(); t; t = w.nextNode()) if (t.__go != null) { t.__gs = undefined; t.data = t.__go; t.__go = undefined; }
        render();
      };
    }
    render();
  })();
})();
