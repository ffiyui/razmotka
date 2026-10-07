/* Экран «Проверка»: сверка итогов и противоречия журнала со ссылкой на строку */
const CHECK_KIND = {razm: ['Повторная размотка', 't-razm'], podm: ['Подмотка без размотки', 't-podm']};
const SHEET_TITLE = {razm: 'Размотка', podm: 'Подмотка'};
async function loadCheck() {
  const j = await api('/api/check'), diff = j.razm - j.podm;
  $('checkFig').innerHTML =
    `<div><b class="t-razm">${nf(j.razm)}</b><span>размотано</span></div>` +
    `<div><b class="t-podm">${nf(j.podm)}</b><span>подмотано</span></div>` +
    `<div><b>${nf(diff)}</b><span>разность</span></div>` +
    `<div><b>${nf(j.field)}</b><span>на поле по журналу</span></div>`;
  $('checkWhy').textContent = j.items.length
    ? `На поле ${nf(j.field)} = ${nf(diff)} − ${nf(j.double_razm)} (повторные размотки) + ${nf(j.orphan_podm)} (подмотки без размотки). ` +
      'Пока эти строки не исправлены, число на поле не совпадает с разностью. Щёлкните по строке журнала, чтобы перейти к ней.'
    : (j.razm + j.podm ? 'Противоречий нет: число на поле равно разности размотанного и подмотанного.' : '');
  if (!j.items.length) {
    $('checkBox').innerHTML = '<div class="empty">' + (j.razm + j.podm ? 'Журнал согласован.' : 'В журнале пока нет проведённых строк.') + '</div>';
    return;
  }
  $('checkBox').innerHTML = '<table><tr><th>Что не так</th><th>Дата</th><th class="r">Линия</th><th class="r">ПП</th><th class="r">Пикетов</th><th>Строка журнала</th></tr>' +
    j.items.map(s => {
      const k = CHECK_KIND[s.kind];
      const link = s.sheet ? `<a href="#${s.sheet}" data-sheet="${s.sheet}" data-row="${s.row_id}">${SHEET_TITLE[s.sheet]}, строка ${nf(s.row)}</a>` : '';
      return `<tr><td class="${k[1]}">${k[0]}</td><td>${dru(s.date)}</td><td class="r">${s.line}</td>` +
        `<td class="r">${s.p1 === s.p2 ? s.p1 : s.p1 + '–' + s.p2}</td><td class="r">${nf(s.p2 - s.p1 + 1)}</td><td>${link}</td></tr>`;
    }).join('') + '</table>';
}
$('checkBox').onclick = e => {
  const a = e.target.closest('a[data-row]');
  if (!a) return;
  e.preventDefault();
  const page = Sheets.pages[a.dataset.sheet], id = +a.dataset.row;
  history.pushState(null, '', '#' + a.dataset.sheet);
  show(a.dataset.sheet).then(() => page.goto(id));
};

/* ---------- сверка с книгой Excel «Контроль размотки» ---------- */
const jumpLink = r => r.sheet ? `<a href="#${r.sheet}" data-sheet="${r.sheet}" data-row="${r.row_id}">${SHEET_TITLE[r.sheet]}, строка ${nf(r.row)}</a>` : '';
const ppText = r => r.p1 === r.p2 ? r.p1 : r.p1 + '–' + r.p2;
function renderCompare(j) {
  const P = j.program, B = j.book, diff = P.field - B.field;
  let h = `<div class="figures" style="margin-top:22px"><div><b>${nf(P.field)}</b><span>на поле в программе</span></div>` +
    `<div><b>${nf(B.field)}</b><span>на поле в книге</span></div>` +
    `<div><b class="${diff ? 't-razm' : ''}">${diff > 0 ? '+' : ''}${nf(diff)}</b><span>разница</span></div></div>`;
  if (!j.only_program && !j.only_book) {
    h += `<p class="lead">Расхождений нет: в программе и в книге на поле лежат одни и те же пикеты.</p>`;
  } else {
    h += `<p class="lead">Только в программе лежит ${nf(j.only_program)} ${plural(j.only_program, 'пикет', 'пикета', 'пикетов')}, только в книге ${nf(j.only_book)}: ` +
      `${nf(P.field)} − ${nf(j.only_program)} + ${nf(j.only_book)} = ${nf(B.field)}. Ниже причина по каждому месту.</p>`;
  }
  const notes = [];
  if (B.has_field_sheet && B.has_history && B.field !== B.by_history)
    notes.push(`В самой книге лист «Оборудование на поле» (${nf(B.field)}) не совпадает с её же историей (${nf(B.by_history)}): после последних правок макрос не пересчитал лист.`);
  if (P.razm !== B.razm || P.podm !== B.podm)
    notes.push(`Всего размотано: в программе ${nf(P.razm)}, в книге ${nf(B.razm)}. Подмотано: в программе ${nf(P.podm)}, в книге ${nf(B.podm)}.`);
  if (notes.length) h += '<p class="lead">' + notes.map(esc).join(' ') + '</p>';

  if (j.drafts.length) {
    h += `<h2>Не проведено в программе</h2><p class="lead">Эти строки внесены в журнал, но кнопка не нажата, поэтому на поле они не учтены: ` +
      `размотка ${nf(j.draft_channels.razm)} кан., подмотка ${nf(j.draft_channels.podm)} кан.</p>` +
      '<div class="card"><table><tr><th>Строка журнала</th><th>Дата</th><th class="r">Линия</th><th class="r">ПП</th><th class="r">Каналов</th></tr>' +
      j.drafts.map(r => `<tr><td>${jumpLink(r)}</td><td>${dru(r.date)}</td><td class="r">${r.line === null ? '' : r.line}</td>` +
        `<td class="r">${r.p1 === null || r.p2 === null ? 'не заполнено' : ppText(r)}</td><td class="r">${nf(r.channels)}</td></tr>`).join('') + '</table></div>';
  }
  const fieldRows = j.field_program.map(r => ['в программе', r]).concat(j.field_book.map(r => ['в книге', r]));
  if (fieldRows.length) {
    h += '<h2>Расхождения на поле</h2><div class="card"><table><tr><th>Лежит только</th><th class="r">Линия</th><th class="r">ПП</th><th class="r">Пикетов</th><th>Причина</th><th>Строка журнала</th></tr>' +
      fieldRows.map(([side, r]) => `<tr><td class="${side === 'в программе' ? 't-razm' : 't-podm'}">${side}</td><td class="r">${r.line}</td><td class="r">${ppText(r)}</td>` +
        `<td class="r">${nf(r.p2 - r.p1 + 1)}</td><td>${esc(r.reason)}</td><td>${jumpLink(r)}</td></tr>`).join('') + '</table>' +
      (j.field_more ? `<div class="empty">Показаны первые ${nf(fieldRows.length)} мест, ещё ${nf(j.field_more)} не поместились. Итоги выше посчитаны по всем.</div>` : '') + '</div>';
  }
  const rows = j.rows_program.map(r => ['в программе', r]).concat(j.rows_book.map(r => ['в книге', r]));
  if (rows.length) {
    h += '<h2>Записи журнала, которые есть только с одной стороны</h2>' +
      `<p class="lead">Только в программе: ${nf(j.rows_program_total)} ${plural(j.rows_program_total, 'запись', 'записи', 'записей')} ` +
      `(размотка ${nf(j.rows_program_channels.razm)} кан., подмотка ${nf(j.rows_program_channels.podm)} кан.). ` +
      `Только в книге: ${nf(j.rows_book_total)} (размотка ${nf(j.rows_book_channels.razm)} кан., подмотка ${nf(j.rows_book_channels.podm)} кан.).</p>` +
      '<div class="card"><table><tr><th>Есть только</th><th>Тип</th><th>Дата</th><th class="r">Линия</th><th class="r">ПП</th><th class="r">Каналов</th><th>Строка журнала</th></tr>' +
      rows.map(([side, r]) => `<tr><td class="${side === 'в программе' ? 't-razm' : 't-podm'}">${side}</td><td>${r.type ? 'Размотка' : 'Подмотка'}</td><td>${dru(r.date)}</td>` +
        `<td class="r">${r.line}</td><td class="r">${ppText(r)}</td><td class="r">${nf(r.p2 - r.p1 + 1)}</td><td>${jumpLink(r)}</td></tr>`).join('') + '</table>' +
      (j.rows_program_total + j.rows_book_total > rows.length ? `<div class="empty">Показаны первые ${nf(rows.length)} записей из ${nf(j.rows_program_total + j.rows_book_total)}.</div>` : '') + '</div>';
  } else if (!B.has_intervals) {
    h += '<p class="lead">Листа «Таблица подмотки и размотки» в книге нет, поэтому записи журнала не сравнивались.</p>';
  }
  $('cmpOut').innerHTML = h;
}
$('cmpGo').onclick = async () => {
  const f = $('cmpFile').files[0];
  if (!f) return toast('Выберите книгу «Контроль размотки» (.xlsm).');
  $('cmpGo').disabled = true; $('cmpGo').textContent = 'Сверяю, это займёт до минуты…';
  let j;
  try { j = await api('/api/compare', {method: 'POST', body: f}); } catch (err) { j = {error: 'Не удалось прочитать книгу.'}; }
  $('cmpGo').disabled = false; $('cmpGo').textContent = 'Сверить';
  if (j.error) return toast(j.error);
  renderCompare(j);
  $('cmpOut').scrollIntoView({behavior: 'smooth', block: 'start'});
};
$('cmpOut').onclick = $('checkBox').onclick;
