/* Переходы между экранами и запуск */
const loaders={field:loadField,stats:loadStats,check:loadCheck,data:async()=>{}};
const START='razm';
/* Смена экрана с плавным переходом: прежний гаснет, новый проявляется. Если за это время выбран
   ещё один экран, показывается только последний выбранный. */
let showTurn=0;
const calm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
async function show(p){
  if(!loaders[p]&&!Sheets.pages[p])p=START;
  const turn=++showTurn,next=$('p-'+p),cur=document.querySelector('.page.on');
  navMark(p);
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
}
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

/* Подсказка про установку: в Safari без «На экран Домой» данные браузер может стереть через неделю без заходов */
(()=>{const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const app=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  if(ios&&!app&&!remember('installhint')){remember('installhint','1');
    setTimeout(()=>ask('Установите приложение','<p>Нажмите «Поделиться» <b>⎋</b> в Safari и выберите «На экран “Домой”». Тогда приложение работает без сети, запускается как обычное и Safari не стирает его данные.</p>','Понятно',true),2500)}})();
