/* Фото и описание у точек карты (пикетов) и у меток (GeoLink).
   Касание точки или метки открывает маленькую плашку (фото сразу не всплывает); в ней кнопка открывает окно
   с фото и описанием: можно сделать или выбрать фото, порисовать на нём, написать описание.
   Хранится в памяти телефона: /api/notes (описания), /api/note/photo (фото), ключ p:линия:пикет или m:номер метки. */
(() => {
  'use strict';
  const N = {all: {}};
  window.NOTES = N;
  N.load = async () => { try { N.all = await api('/api/notes') || {}; } catch (e) { N.all = {}; } };
  N.key = (line, picket) => 'p:' + line + ':' + picket;
  const cam = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  // ---------------------------------------------------------------- плашка у точки
  /* o: {key, title, sub, x, y (экран), mark} */
  N.card = o => {
    const c = $('pCard'), n = N.all[o.key];
    const note = n ? `<div class="pc-n">${n.photo ? cam + ' ' : ''}${esc((n.text || (n.photo ? 'фото' : '')).slice(0, 80))}</div>` : '';
    c.innerHTML = `<div class="pc-t"><b>${esc(o.title)}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</div>${note}` +
      `<div class="pc-b"><button type="button" class="btn small main" data-a="open">${cam} ${n ? 'Фото и описание' : 'Добавить фото, описание'}</button>` +
      (o.mark ? '<button type="button" class="btn small" data-a="edit">Изменить метку</button>' : '') +
      '<button type="button" class="btn small pc-x" data-a="close" aria-label="Закрыть">✕</button></div>';
    c.hidden = false;
    const box = $('mapBox').getBoundingClientRect(), w = c.offsetWidth, h = c.offsetHeight;
    c.style.left = Math.max(8, Math.min(o.x - w / 2, box.width - w - 8)) + 'px';
    c.style.top = (o.y - h - 22 < 8 ? o.y + 22 : o.y - h - 22) + 'px';
    c.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      N.hide();
      if (b.dataset.a === 'open') N.open(o.key, o.title);
      if (b.dataset.a === 'edit' && o.mark) o.mark();
    };
  };
  N.hide = () => { $('pCard').hidden = true; };

  // ---------------------------------------------------------------- окно: фото и описание
  N.open = async (key, title) => {
    const n = N.all[key] || {text: '', photo: false};
    let photo = null, changed = false;                 // photo: data:-адрес, null - нет; changed - фото заменено или удалено
    if (n.photo) { try { photo = (await api('/api/note/photo?key=' + encodeURIComponent(key))).data || null; } catch (e) { photo = null; } }
    const body = () => `<div class="nt-ph">${photo ? `<img id="ntImg" src="${photo}" alt="Фото">` : '<div class="nt-none">Фото нет</div>'}</div>` +
      `<div class="ni-row"><label class="btn" for="ntCam">${cam} ${photo ? 'Новое фото' : 'Сделать фото'}</label><label class="btn" for="ntFile">Из галереи</label>` +
      `<input type="file" id="ntCam" accept="image/*" capture="environment" hidden><input type="file" id="ntFile" accept="image/*" hidden>` +
      (photo ? '<button type="button" class="btn" id="ntDraw">Рисовать на фото</button><button type="button" class="btn danger" id="ntDel">Удалить фото</button>' : '') + '</div>' +
      `<label for="ntText">Описание</label><textarea id="ntText" rows="4" style="width:100%" maxlength="4000" placeholder="Что здесь: состояние, что сделать…">${esc(n.text || '')}</textarea>` +
      (N.all[key] ? '<div class="ni-row"><button type="button" class="btn danger" id="ntRemove">Удалить фото и описание</button></div>' : '');
    let removeAll = false;
    const p = ask(title, body(), 'Сохранить', false, true);
    const bind = () => {
      $('ntCam').onchange = $('ntFile').onchange = async e => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const text = $('ntText').value;
        try { photo = await shrink(f); changed = true; } catch (err) { toast('Фото не открылось.'); return; }
        $('dBody').innerHTML = body(); $('ntText').value = text; bind();
        const drawn = await editPhoto(photo); if (drawn) { photo = drawn; $('ntImg').src = photo; }
      };
      if ($('ntDraw')) $('ntDraw').onclick = async () => { const drawn = await editPhoto(photo); if (drawn) { photo = drawn; changed = true; $('ntImg').src = photo; } };
      if ($('ntDel')) $('ntDel').onclick = () => { const text = $('ntText').value; photo = null; changed = true; $('dBody').innerHTML = body(); $('ntText').value = text; bind(); };
      if ($('ntRemove')) $('ntRemove').onclick = () => { removeAll = true; $('dYes').click(); };
    };
    bind();
    if (!await p) return;
    const req = removeAll ? {key, remove: true} : {key, text: $('ntText').value.trim(), ...(changed ? {photo} : {})};
    const j = await post('/api/note', req);
    if (j.error) return toast(j.error);
    await N.load(); draw();
    toast(removeAll ? 'Фото и описание удалены.' : 'Сохранено.');
  };

  /* Фото с камеры - в разумный размер (до 1600 px по длинной стороне), JPEG */
  function shrink(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- рисование на фото
  const PEN = ['#F85149', '#E3B341', '#3FB950', '#58A6FF', '#F0F6FC', '#0D1117'];
  function editPhoto(src) {
    return new Promise(res => {
      const ov = document.createElement('div');
      ov.className = 'ped';
      ov.innerHTML = `<div class="ped-bar"><button type="button" class="btn" data-a="cancel">Отмена</button>` +
        `<span class="ped-c">${PEN.map((c, i) => `<button type="button" class="ped-col${i ? '' : ' on'}" data-c="${c}" style="--c:${c}" aria-label="Цвет"></button>`).join('')}</span>` +
        `<span class="ped-w"><button type="button" data-w="4">тонко</button><button type="button" class="on" data-w="9">средне</button><button type="button" data-w="18">толсто</button></span>` +
        `<button type="button" class="btn" data-a="undo">↶</button><button type="button" class="btn main" data-a="ok">Готово</button></div>` +
        `<div class="ped-box"><canvas></canvas></div>`;
      document.body.appendChild(ov);
      const cv2 = ov.querySelector('canvas'), g = cv2.getContext('2d'), img = new Image();
      const strokes = []; let pen = PEN[0], width = 9, cur = null;
      const paint = () => {
        g.drawImage(img, 0, 0, cv2.width, cv2.height);
        g.lineCap = g.lineJoin = 'round';
        for (const s of [...strokes, ...(cur ? [cur] : [])]) {
          g.strokeStyle = s.c; g.lineWidth = s.w * cv2.width / 1000; g.beginPath();
          s.p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          if (s.p.length === 1) g.lineTo(s.p[0][0] + .1, s.p[0][1]);
          g.stroke();
        }
      };
      img.onload = () => { cv2.width = img.naturalWidth; cv2.height = img.naturalHeight; paint(); };
      img.src = src;
      const at = e => { const r = cv2.getBoundingClientRect(); return [(e.clientX - r.left) * cv2.width / r.width, (e.clientY - r.top) * cv2.height / r.height]; };
      cv2.addEventListener('pointerdown', e => { e.preventDefault(); cv2.setPointerCapture(e.pointerId); cur = {c: pen, w: width, p: [at(e)]}; paint(); });
      cv2.addEventListener('pointermove', e => { if (!cur) return; cur.p.push(at(e)); paint(); });
      const up = () => { if (cur) { strokes.push(cur); cur = null; paint(); } };
      cv2.addEventListener('pointerup', up); cv2.addEventListener('pointercancel', up);
      const done = v => { ov.remove(); res(v); };
      ov.querySelector('.ped-bar').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.c) { pen = b.dataset.c; ov.querySelectorAll('.ped-col').forEach(x => x.classList.toggle('on', x === b)); }
        else if (b.dataset.w) { width = +b.dataset.w; ov.querySelectorAll('.ped-w button').forEach(x => x.classList.toggle('on', x === b)); }
        else if (b.dataset.a === 'undo') { strokes.pop(); paint(); }
        else if (b.dataset.a === 'cancel') done(null);
        else if (b.dataset.a === 'ok') done(strokes.length ? cv2.toDataURL('image/jpeg', .85) : null);
      });
      N.editor = {canvas: cv2, ok: () => ov.querySelector('[data-a=ok]').click(), strokes};
    });
  }
  N.editPhoto = editPhoto;

  (async () => { try { await colorsReady; } catch (e) { /* без настроек */ } N.load(); })();
  document.addEventListener('pointerdown', e => { if (!$('pCard').hidden && !e.target.closest('#pCard')) N.hide(); }, true);
})();
