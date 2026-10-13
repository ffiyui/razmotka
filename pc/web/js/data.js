/* Экран «Данные»: загрузка, выгрузки, правила, удаление */
async function importFile(btn,file,url,question,report){
  if(!file)return toast('Выберите файл книги Excel.');
  if(question&&!await ask('Заменить данные?','<p>'+question+'</p>','Заменить'))return;
  const label=btn.textContent;btn.disabled=true;btn.textContent='Загружаю…';
  let j;try{j=await api(url,{method:'POST',body:file})}catch(e){j={error:'Не удалось загрузить файл.'}}
  btn.disabled=false;btn.textContent=label;
  if(j.error)return toast(j.error);
  $('sFrom').dataset.set='';$('sFrom').value='';$('sTo').value='';
  await loadWorkers();await changed(true);
  ask('Загружено',report(j),'Хорошо',true);
}
const problemsHtml=j=>j.problems?'<p>Не распознано или оставлено черновиком: '+nf(j.problems)+'.</p><ul>'+j.examples.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'';
$('impJGo').onclick=()=>importFile($('impJGo'),$('impJFile').files[0],'/api/import/journal',
  'Все листы журнала в программе будут заменены листами из файла.',
  j=>'<ul>'+Object.entries(j.sheets).map(([k,n])=>'<li>'+esc(k)+': '+rowsWord(n)+'</li>').join('')+'</ul>'+problemsHtml(j));
$('impMGo').onclick=()=>{const only=$('impTgo').checked;importFile($('impMGo'),$('impMFile').files[0],'/api/import/macro?tgo_only='+(only?1:0),
  only?(S.sps?'Лист SPS будет заменён координатами из книги.':''):'Листы «Размотка», «Подмотка», «ID старших» и SPS будут заменены данными из книги с макросом.',
  j=>only?'<p>В лист SPS загружено пикетов: '+nf(j.tgo)+'. Карта на экране «Поле» теперь строится в координатах.</p>'
    :'<ul><li>Размотка: '+rowsWord(j.razm)+'</li><li>Подмотка: '+rowsWord(j.podm)+'</li><li>Старших: '+nf(j.workers)+'</li><li>Пикетов в SPS: '+nf(j.tgo)+'</li></ul>'+problemsHtml(j))};
const hMode=seg('hMode');
/* History для станции: один файл возвращается файлом, несколько - одним архивом .zip */
/* Сохранение файла. На компьютере - обычная загрузка. На iPhone и iPad загрузка из приложения «на экране Домой» ненадёжна,
   поэтому файл отдаётся через системное меню «Поделиться» (Сохранить в «Файлы», отправить, открыть в Excel).
   Меню можно открыть только по нажатию, поэтому после подготовки файла спрашиваем нажатием кнопки. */
const sizeText=n=>n<1024?n+' Б':n<1048576?(n/1024).toFixed(0)+' КБ':(n/1048576).toFixed(1).replace('.',',')+' МБ';
async function saveBlob(blob,name){
  if(window.NATIVE){                                   // приложение Android: файл кладётся во временную папку и отдаётся через «Поделиться»
    try{await NATIVE.saveFile(blob,name);return}catch(e){toast('Файл не сохранился: '+(e&&e.message||e));return}}
  const type=blob.type||'application/octet-stream',file=typeof File==='function'?new File([blob],name,{type}):null;
  const share=file&&navigator.canShare&&navigator.canShare({files:[file]})&&document.body.classList.contains('touch');
  if(share){
    const yes=await ask('Файл готов','<p><b>'+esc(name)+'</b><br>'+sizeText(blob.size)+'</p><p>Откроется меню: выберите «Сохранить в Файлы», отправьте себе или откройте в Excel.</p>','Сохранить…');
    if(!yes)return;
    try{await navigator.share({files:[file],title:name});return}catch(e){if(e&&e.name==='AbortError')return}
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),60000)}
const filesWord=n=>nf(n)+' '+plural(n,'файл','файла','файлов');
const hFiles=()=>[...$('hFile').files];
function hLabel(){const n=hFiles().length;$('hGo').textContent=n>1?'Получить архив':'Получить файл';$('hNote').textContent=n>1?'Выбрано: '+filesWord(n):''}
$('hFile').onchange=hLabel;
async function packFiles(files){const parts=[];
  for(const f of files){const name=new TextEncoder().encode(f.name),head=new DataView(new ArrayBuffer(4)),size=new DataView(new ArrayBuffer(8));
    head.setUint32(0,name.length);size.setBigUint64(0,BigInt(f.size));parts.push(head,name,size,f)}
  return new Blob(parts)}
$('hGo').onclick=async()=>{const files=hFiles(),btn=$('hGo');if(!files.length)return toast('Выберите файл со станции. Можно выбрать сразу несколько.');
  const wrong='Не удалось обработать '+(files.length>1?'файлы':'файл')+'. Проверьте, что выбран верный тип станции.';
  btn.disabled=true;btn.textContent='Обрабатываю…';
  try{
    if(files.length===1){
      const r=await fetch('/api/history?mode='+hMode(),{method:'POST',body:files[0]});if(!r.ok)return toast(wrong);
      saveBlob(await r.blob(),decodeURIComponent(r.headers.get('X-Filename')||'history.csv'));return}
    const r=await fetch('/api/history/batch?mode='+hMode(),{method:'POST',body:await packFiles(files)});
    if(!r.ok||!r.headers.get('X-Filename')){let j={};try{j=await r.json()}catch(e){}return toast(j.error||wrong)}
    saveBlob(await r.blob(),decodeURIComponent(r.headers.get('X-Filename')));
    let rep=null;try{rep=JSON.parse(decodeURIComponent(r.headers.get('X-Report')))}catch(e){}
    if(rep){const none=rep.empty_count?'<p>Файлов, в которых не нашлось ни одного пикета из журнала: '+nf(rep.empty_count)+' ('+rep.empty.map(esc).join(', ')+(rep.empty_count>rep.empty.length?' и другие':'')+
        '). Проверьте тип станции и то, что по этим пикетам есть размотка или подмотка.</p>':'';
      ask('Файлы обработаны','<ul><li>Файлов: '+nf(rep.files)+'</li><li>Строк: '+nf(rep.rows)+'</li><li>Из них со старшим и типом работ: '+nf(rep.found)+'</li></ul>'+none+
        '<p>Архив сохранён в папку загрузок. В нём по одному файлу на каждый исходный, имена начинаются с «history_».</p>','Хорошо',true)}
  }catch(e){toast(wrong)}finally{btn.disabled=false;hLabel()}};
$('cGo').onclick=async()=>{const types=[];if($('cP').checked)types.push(0);if($('cR').checked)types.push(1);const a=$('cFrom').value,b=$('cTo').value;
  if(!types.length)return toast('Выберите, что удалять: подмотку, размотку или оба типа.');
  if(!await ask('Удалить за период?','<p>Будет удалена '+types.map(t=>t?'размотка':'подмотка').join(' и ')+' с '+dru(a)+' по '+dru(b)+'. Строки журнала за эти даты будут удалены, вернуть их можно только повторным вводом.</p>','Удалить'))return;
  const j=await post('/api/cleanup',{from:a,to:b,types});if(j.error)return toast(j.error);toast('Удалено строк журнала: '+nf(j.deleted)+'.');changed(true)};
$('cAll').onclick=async()=>{if(!await ask('Удалить всю историю?','<p>Листы «Размотка» и «Подмотка» будут очищены полностью. Остальные листы, SPS и список старших останутся.</p>','Удалить всё'))return;
  await post('/api/clear',{});toast('Размотка и подмотка удалены.');changed(true)};

/* Выгрузки: журнал всегда книгой .xlsx, таблицы - в выбранном формате (выбор запоминается) */
async function download(url,opt,fallback){const r=await fetch(url,opt);if(!r.ok){toast('Не удалось подготовить файл.');return}
  saveBlob(await r.blob(),decodeURIComponent(r.headers.get('X-Filename')||fallback))}
const xFmt=seg('xFmt');
if(remember('xfmt')==='csv')[...$('xFmt').children].forEach(b=>b.classList.toggle('on',b.dataset.v==='csv'));
$('xFmt').addEventListener('change',()=>remember('xfmt',xFmt()));
$('exports').onclick=e=>{const b=e.target.closest('button');if(b)download('/api/export?what='+b.dataset.w+'&fmt='+xFmt(),{},'export.'+xFmt())};

/* Копия данных: всё содержимое программы одним файлом .json (журнал, SPS, настройки, подложки без картинок) */
$('bkSave').onclick=async()=>{const r=await fetch('/api/backup');if(!r.ok)return toast('Не удалось подготовить копию.');
  await saveBlob(await r.blob(),decodeURIComponent(r.headers.get('X-Filename')||'razmotka.json'));remember('lastbackup',String(Date.now()));backupNote()};
$('bkLoad').onclick=async()=>{const f=$('bkFile').files[0];if(!f)return toast('Выберите файл копии.');
  if(!await ask('Заменить все данные?','<p>Все данные в программе будут заменены данными из файла «'+esc(f.name)+'». Это нельзя отменить.</p>','Заменить'))return;
  let j;try{j=await api('/api/restore',{method:'POST',body:f})}catch(e){j={error:'Не удалось прочитать файл.'}}
  if(j.error)return toast(j.error);
  $('sFrom').dataset.set='';$('sFrom').value='';$('sTo').value='';
  await loadWorkers();await changed(true);ask('Данные восстановлены','<ul><li>Размотка: '+rowsWord(j.razm)+'</li><li>Подмотка: '+rowsWord(j.podm)+'</li><li>Пикетов в SPS: '+nf(j.sps)+'</li></ul>','Хорошо',true)};
function backupNote(){const t=+remember('lastbackup'),n=$('bkNote');if(!n)return;
  const parts=[];parts.push(t?'Последняя копия: '+new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Копии ещё не было');
  if(window.RZ&&RZ.volatile)parts.push('Хранилище браузера недоступно: данные пропадут при закрытии (закрытая вкладка?)');
  else if(window.RZ&&RZ.persisted===false)parts.push('Система может очистить данные при нехватке места: делайте копии');
  n.textContent=parts.join('. ')}
backupNote();if(window.RZ&&RZ.ready)RZ.ready.then(backupNote);

/* Система координат листа SPS: по ней GPS переводится в X и Y карты */
async function loadCrs(){let c={ellipsoid:'gsk2011',zone:10};try{const j=await api('/api/crs');if(j&&j.ellipsoid)c=j}catch(e){}
  $('crsEll').value=c.ellipsoid;$('crsZone').value=c.zone}
$('crsSave').onclick=async()=>{const j=await post('/api/crs',{ellipsoid:$('crsEll').value,zone:+$('crsZone').value});
  if(j.error)return toast(j.error);toast('Система координат сохранена.');if(window.geoReloadCrs)geoReloadCrs()};
loadCrs();

/* Правила учёта */
function fillRules(){const r=S.rules;$('rSame').value=r.same_day;$('rMax').value=r.max_interval;
  $('rTgo').checked=r.block_unknown_pickets;$('rConf').checked=r.block_conflicts;$('rFut').checked=r.block_future_dates}
$('rSave').onclick=async()=>{const j=await post('/api/settings',{same_day:$('rSame').value,max_interval:+$('rMax').value,
  block_unknown_pickets:$('rTgo').checked,block_conflicts:$('rConf').checked,block_future_dates:$('rFut').checked});
  if(j.error)return toast(j.error);toast(j.recalculated?'Правила сохранены, поле пересчитано.':'Правила сохранены.');changed()};

/* Завершение работы */
$('quit').onclick=async()=>{if(!await ask('Завершить работу?','<p>Программа остановится. Данные сохранены.</p>','Завершить'))return;
  await post('/api/quit',{});document.body.innerHTML='<div class="empty" style="padding-top:30vh">Программа остановлена. Это окно можно закрыть.</div>';window.close()};
