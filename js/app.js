/* Переходы между экранами и запуск */
const loaders={home:async()=>{if(typeof homeRender==='function')homeRender()},settings:async()=>{},field:loadField,stats:loadStats,check:loadCheck,data:async()=>{if(typeof prjFill==='function')prjFill()},tracks:async()=>{await loadTracks();tracksRender()}};
const START='home';
/* Смена экрана с плавным переходом: прежний гаснет, новый проявляется. Если за это время выбран
   ещё один экран, показывается только последний выбранный. */
let showTurn=0;
const calm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
async function show(p){
  if(!loaders[p]&&!Sheets.pages[p])p=START;
  const turn=++showTurn,next=$('p-'+p),cur=document.querySelector('.page.on');
  navMark(p);
  document.querySelectorAll('#tabbar a').forEach(a=>a.classList.toggle('on',a.dataset.tab===p||(a.dataset.tab==='home'&&p!=='field'&&p!=='data'&&p!=='settings')));
  if(cur&&cur!==next&&!calm){
    cur.classList.add('leaving');
    await new Promise(r=>setTimeout(r,130));
    if(turn!==showTurn)return;
  }
  document.querySelectorAll('.page').forEach(e=>{e.classList.remove('leaving','entering');e.classList.toggle('on',e===next)});
  if(cur!==next){next.classList.add('entering');next.addEventListener('animationend',()=>next.classList.remove('entering'),{once:true})}
  document.querySelector('main').classList.toggle('wide',!!Sheets.pages[p]||p==='field');
  if(Sheets.pages[p])return Sheets.pages[p].show();
  if(dirty[p]!==false){dirty[p]=false;await loaders[p]()}
  if(p==='field')resizeMap();
  accentTitles();
}
/* Один цветной акцент в заголовке: число («На поле 20 каналов») или первая буква */
function accentTitles(){for(const h of document.querySelectorAll('.page>h1')){if(h.querySelector('.h-t')||h.children.length)continue;const t=h.textContent,m=t.match(/\d[\d\s\u00a0]*\d|\d/);
  h.innerHTML='<span class="h-t">'+(m?esc(t.slice(0,m.index))+'<span class="h-acc n">'+esc(m[0])+'</span>'+esc(t.slice(m.index+m[0].length)):'<span class="h-acc">'+esc(t.charAt(0))+'</span>'+esc(t.slice(1)))+'</span>'}}
window.onhashchange=()=>show(location.hash.slice(1));

markDirty();
Splash.step('Читаю настройки',.15);
initNav()
  .then(()=>{Splash.step('Считаю оборудование на поле',.45);return loadSummary()})
  .then(()=>{Splash.step('Открываю журнал',.75);return initSheets()})
  .then(()=>show(location.hash.slice(1)))
  .then(()=>{Splash.step('Готово',1);Splash.done()},()=>Splash.done());

/* Связь с программой (настольная версия): пока окно открыто, она работает; закрыли окно - завершается.
   В приложении для iPhone сервера нет, а движок работает внутри страницы, поэтому связь не нужна. */
if(/[?&]remote\b/.test(location.search)){
  const ping=()=>fetch('/api/ping').catch(()=>{});ping();setInterval(ping,2000);
  window.addEventListener('pagehide',()=>navigator.sendBeacon('/api/bye'))}

/* Подсказка про установку. iPhone: в Safari без «На экран Домой» данные браузер может стереть через неделю без заходов.
   Android: Chrome сам умеет установить приложение - кнопка в подсказке вызывает его окно установки */
(()=>{const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const app=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  if(app||window.NATIVE||remember('installhint'))return;
  if(ios){remember('installhint','1');
    setTimeout(()=>ask('Установите приложение','<p>Нажмите «Поделиться» <b>⎋</b> в Safari и выберите «На экран “Домой”». Тогда приложение работает без сети, запускается как обычное и Safari не стирает его данные.</p>','Понятно',true),2500)}
  else if(ANDROID){let ev=null,shown=false;
    const hint=()=>{if(shown)return;shown=true;remember('installhint','1');
      ask('Установите приложение',ev?'<p>Приложение можно поставить на главный экран: оно работает без сети и запускается как обычное.</p>'
        :'<p>Откройте меню браузера <b>⋮</b> и выберите «Установить приложение» или «Добавить на главный экран». Тогда приложение работает без сети и запускается как обычное.</p>',ev?'Установить':'Понятно',!ev)
        .then(ok=>{if(ok&&ev){try{ev.prompt()}catch(e){}}})};
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();ev=e;setTimeout(hint,1500)});
    setTimeout(hint,6000)}})();

/* Облегчённый вид (js/compat.js): переключатель в «Данные» → «Скорость работы»; меняется после перезапуска страницы */
(()=>{const box=$('liteOn');if(!box)return;box.checked=!!window.LITE;
  $('liteNote').textContent=window.LITE_AUTO?'На этом телефоне включается сам: он относится к слабым или это приложение для Android.':'';
  box.onchange=()=>{try{localStorage.setItem('lite',box.checked?'1':'0')}catch(e){}location.reload()}})();
