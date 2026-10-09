/* Экран «Учёт»: диаграмма и таблицы */
async function loadStats(){const a=$('sFrom').value,b=$('sTo').value;if(!a||!b)return;const j=await api(`/api/stats?from=${a}&to=${b}`);
  const r=j.days.reduce((s,d)=>s+d[1],0),p=j.days.reduce((s,d)=>s+d[2],0);
  $('sFig').innerHTML=`<div><b class="t-razm">${nf(r)}</b><span>размотано</span></div><div><b class="t-podm">${nf(p)}</b><span>подмотано</span></div><div><b>${nf(j.days.length)}</b><span>${plural(j.days.length,'рабочий день','рабочих дня','рабочих дней')}</span></div><div><b>${nf(S.field)}</b><span>на поле сейчас</span></div>`+(S.staked?`<div><b class="t-razb">${nf(S.staked)}</b><span>разбито пикетов</span></div>`:'');
  const st=j.staked||[];$('sStakeBox').hidden=!st.length;
  $('sStake').innerHTML=st.length?'<table><tr><th>Топограф</th><th class="r">Разбито пикетов</th></tr>'+st.map(x=>`<tr><td>${esc(x[0])}</td><td class="r">${nf(x[1])}</td></tr>`).join('')+'</table>':'';
  chart(j.days,a,b);
  const tbl=(rows,h)=>rows.length?'<table><tr><th>'+h+'</th><th class="r">Размотка</th><th class="r">Подмотка</th></tr>'+rows.map(x=>`<tr><td>${esc(x[0])}</td><td class="r">${nf(x[1])}</td><td class="r">${nf(x[2])}</td></tr>`).join('')+'</table>':'<div class="empty">За этот период работ нет.</div>';
  $('sWorkers').innerHTML=tbl(j.workers,'Старший');$('sLines').innerHTML=tbl(j.lines,'Линия');loadTop()}
function chart(days,a,b){const box=$('chart');if(!days.length){box.innerHTML='<div class="empty">За этот период работ нет.</div>';return}
  const W=Math.max(box.clientWidth,320),H=280,L=46,R=8,T=10,M=24,d0=Date.parse(a),n=Math.round((Date.parse(b)-d0)/864e5)+1;
  const maxR=Math.max(1,...days.map(d=>d[1])),maxP=Math.max(1,...days.map(d=>d[2])),inner=H-T-M,hr=inner*maxR/(maxR+maxP),zero=T+hr,bw=(W-L-R)/n;
  const nice=m=>{const p=Math.pow(10,Math.floor(Math.log10(m)));const k=m/p;return(k>5?5:k>2?2:1)*p};
  let s=`<svg width="${W}" height="${H}" role="img" aria-label="Размотка и подмотка по дням">`;
  const gr=nice(maxR),gp=nice(maxP);
  for(const [v,y] of [[gr,zero-hr*gr/maxR],[0,zero],[gp,zero+(inner-hr)*gp/maxP]])s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="${v?'rgba(60,60,67,.14)':'rgba(60,60,67,.55)'}" stroke-width="1"/><text x="${L-8}" y="${y+4}" text-anchor="end">${nf(v)}</text>`;
  for(const [dt,r,p] of days){const x=L+Math.round((Date.parse(dt)-d0)/864e5)*bw,w=Math.max(bw-(bw>4?1.5:0),1);
    const t=`<title>${dru(dt)}: размотка ${nf(r)}, подмотка ${nf(p)}</title>`;
    if(r)s+=`<rect x="${x}" y="${zero-hr*r/maxR}" width="${w}" height="${hr*r/maxR}" style="fill:var(--razm)" rx="${Math.min(2,w/2)}">${t}</rect>`;
    if(p)s+=`<rect x="${x}" y="${zero}" width="${w}" height="${(inner-hr)*p/maxP}" style="fill:var(--blue)" rx="${Math.min(2,w/2)}">${t}</rect>`}
  const mn=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];let last=-1e9;
  for(let i=0;i<n;i++){const d=new Date(d0+i*864e5),x=L+i*bw;if((n>45?d.getUTCDate()===1:true)&&x-last>58&&x<W-44){s+=`<text x="${x}" y="${H-6}">${n>45?mn[d.getUTCMonth()]+' '+String(d.getUTCFullYear()).slice(2):String(d.getUTCDate()).padStart(2,'0')+'.'+String(d.getUTCMonth()+1).padStart(2,'0')}</text>`;last=x}}
  box.innerHTML=s+'</svg>'}
$('sFrom').onchange=$('sTo').onchange=loadStats;
$('sAll').onclick=()=>{$('sFrom').value=S.date_min||today();$('sTo').value=S.date_max||today();loadStats()};
$('s30').onclick=()=>{const e=S.date_max||today();$('sTo').value=e;$('sFrom').value=new Date(Date.parse(e)-29*864e5).toISOString().slice(0,10);loadStats()};

$('s7').onclick=()=>{const e=S.date_max||today();$('sTo').value=e;$('sFrom').value=new Date(Date.parse(e)-6*864e5).toISOString().slice(0,10);loadStats()};

/* GeoLink: статистика по вкладкам журналов (ГФО, ТГО и свои журналы) и ТОП лидеров с кубками.
   Период - те же поля «С» и «По»: всё, месяц, неделя или любой выбранный диапазон */
const ST={tab:'gfo'};
const CUP=['#E3B341','#C9D1D9','#D18B47'],CUPN=['Золото','Серебро','Бронза'];
const cupSvg=c=>`<svg class="cup" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" fill="${c}" fill-opacity=".25"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/></svg>`;
function statGroups(){return (typeof NAV!=='undefined'&&NAV.groups?NAV.groups:[]).filter(g=>!g.report)}
function statTabs(){
  const gs=statGroups();if(!gs.some(g=>g.id===ST.tab))ST.tab=gs.length?gs[0].id:'gfo';
  $('sTabs').innerHTML=gs.map(g=>`<button type="button" class="jt${g.id===ST.tab?' on':''}" data-g="${esc(g.id)}">${typeof iconSvg==='function'?iconSvg(g.icon||'journal',16):''}<span>${esc(g.title)}</span></button>`).join('');
  $('sTabs').hidden=gs.length<2;
  $('sGfo').hidden=ST.tab!=='gfo';
}
$('sTabs').onclick=e=>{const b=e.target.closest('.jt');if(!b)return;ST.tab=b.dataset.g;statTabs();loadTop()};
const unitWord=(u,n)=>u==='пикет'?plural(n,'пикет','пикета','пикетов'):plural(n,'канал','канала','каналов');
async function loadTop(){
  statTabs();
  const a=$('sFrom').value,b=$('sTo').value,g=statGroups().find(x=>x.id===ST.tab);
  if(!g){$('sTop').innerHTML='';return}
  let j;try{j=await api(`/api/leaders?from=${a}&to=${b}`)}catch(e){$('sTop').innerHTML='';return}
  const pages=new Set(typeof groupPages==='function'?groupPages(g):[]),sheets=(j.sheets||[]).filter(s=>pages.has(s.id));
  if(ST.tab==='gfo')statLines();
  if(!sheets.length){$('sTop').innerHTML=`<div class="card pad empty">В журнале «${esc(g.title)}» нет листов с выполненными работами. Добавьте лист вида «Работы» — пикеты из него попадут сюда и на карту.</div>`;return}
  const tot=s=>s.rows.reduce((t,r)=>t+r[1],0);
  $('sTop').innerHTML=(ST.tab!=='gfo'?'<div class="figures">'+sheets.map(s=>`<div><b>${nf(tot(s))}</b><span>${esc(typeof navTitle==='function'&&navTitle(s.id)||s.title)}, ${unitWord(s.unit,tot(s))}</span></div>`).join('')+'</div>':'')+
    '<h2>ТОП лидеров</h2><div class="top-grid">'+sheets.map(s=>{
      const t=esc(typeof navTitle==='function'&&navTitle(s.id)||s.title);
      const rows=s.rows.length?'<ol class="top">'+s.rows.slice(0,10).map((r,i)=>`<li class="${i<3?'p'+(i+1):''}"><span class="top-n">${i<3?cupSvg(CUP[i]):i+1}</span><span class="top-w">${esc(r[0])}</span><b>${nf(r[1])}</b></li>`).join('')+'</ol>'
        :'<div class="empty">За этот период работ нет.</div>';
      return `<div class="card top-card"><h3>${typeof iconSvg==='function'?iconSvg(typeof pageIcon==='function'?pageIcon(s.id):'table',16):''} ${t} <span class="top-u">${s.unit==='пикет'?'пикетов':'каналов'}</span></h3>${rows}</div>`}).join('')+'</div>';
}
/* «На поле по линиям» (раньше было под картой): из данных карты, если она уже загружена */
async function statLines(){
  let f=typeof F!=='undefined'&&F&&F.segments&&F.segments.length?F:null;
  if(!f){try{f=await api('/api/field')}catch(e){return}}
  const by={};for(const [l,a,b] of f.segments||[])(by[l]=by[l]||[]).push([a,b]);
  const keys=Object.keys(by);
  $('lines').innerHTML=keys.length?keys.map(l=>{const n=by[l].reduce((s,x)=>s+x[1]-x[0]+1,0);
    return `<div class="ln"><b>${l}</b><span>${by[l].map(x=>x[0]===x[1]?x[0]:x[0]+'–'+x[1]).join(', ')}</span><i>${nf(n)}</i></div>`}).join(''):'<div class="empty">На поле ничего нет.</div>';
}
