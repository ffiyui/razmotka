/* Экран «Учёт»: диаграмма и таблицы */
async function loadStats(){const a=$('sFrom').value,b=$('sTo').value;if(!a||!b)return;const j=await api(`/api/stats?from=${a}&to=${b}`);
  const r=j.days.reduce((s,d)=>s+d[1],0),p=j.days.reduce((s,d)=>s+d[2],0);
  $('sFig').innerHTML=`<div><b class="t-razm">${nf(r)}</b><span>размотано</span></div><div><b class="t-podm">${nf(p)}</b><span>подмотано</span></div><div><b>${nf(j.days.length)}</b><span>${plural(j.days.length,'рабочий день','рабочих дня','рабочих дней')}</span></div><div><b>${nf(S.field)}</b><span>на поле сейчас</span></div>`;
  chart(j.days,a,b);
  const tbl=(rows,h)=>rows.length?'<table><tr><th>'+h+'</th><th class="r">Размотка</th><th class="r">Подмотка</th></tr>'+rows.map(x=>`<tr><td>${esc(x[0])}</td><td class="r">${nf(x[1])}</td><td class="r">${nf(x[2])}</td></tr>`).join('')+'</table>':'<div class="empty">За этот период работ нет.</div>';
  $('sWorkers').innerHTML=tbl(j.workers,'Старший');$('sLines').innerHTML=tbl(j.lines,'Линия')}
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
