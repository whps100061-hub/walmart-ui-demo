const $=id=>document.getElementById(id), names={LGBM:'LightGBM-Q',HW:'Holt-Winters',LSTM:'LSTM-Q'};
let page='overview',demo=false,rows=[];

const fmt=(v,n=0)=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:n,minimumFractionDigits:n}):'—';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').style.display='none',5000)}
function options(){for(const key of ['store','dept']){const field=key==='store'?'Store':'Dept',old=$(key).value;$(key).innerHTML='<option value="">全部'+(key==='store'?'分店':'部門')+'</option>'+[...new Set(rows.filter(r=>key!=='dept'||!$('store').value||r.Store===+ $('store').value).map(r=>r[field]))].sort((a,b)=>a-b).map(v=>`<option value="${v}">${field} ${String(v).padStart(2,'0')}</option>`).join('');$(key).value=[...$(key).options].some(o=>o.value===old)?old:''}const old=$('model').value;
const available=Object.keys(names).filter(m=>hasModel(rows,m));
$('model').innerHTML=Object.keys(names).map(m=>`<option value="${m}" ${available.includes(m)?'':'disabled'}>${names[m]}${available.includes(m)?'':'（未提供預測資料）'}</option>`).join('');
$('model').value=available.includes(old)?old:available[0]||'';
}
function hasModel(data,model) {
  return data.length>0 && data.every(row=>[10,50,90].every(q=>Number.isFinite(row[`P${q}_${model}`])));
}
function filtered(){return rows.filter(r=>(!$('store').value||r.Store===+$('store').value)&&(!$('dept').value||r.Dept===+$('dept').value)&&(!$('xyz').value||r.XYZ===$('xyz').value)).sort((a,b)=>a.Date.localeCompare(b.Date)||a.Store-b.Store||a.Dept-b.Dept)}
function metrics(rs,m){rs=rs.filter(r=>Number.isFinite(r.Weekly_Sales));let abs=0,pin=0,cov=0,mis=0;rs.forEach(r=>{let y=r.Weekly_Sales,p=r['P50_'+m],lo=r['P10_'+m],hi=r['P90_'+m];abs+=Math.abs(y-p);pin+=Math.abs(y-p)*.5;cov+=+(y>=lo&&y<=hi);mis+=hi-lo+10*Math.max(lo-y,0)+10*Math.max(y-hi,0)});return{mae:abs/rs.length,pin:pin/rs.length,cov:cov/rs.length*100,mis:mis/rs.length}}
function stat(label,value,sub,icon){return `<div class="stat"><div class="stat-label">${label}<i>${icon}</i></div><strong>${value}</strong><small>${sub}</small></div>`}
function groups(rs){const unique=[...new Map(rs.map(r=>[r.Store+'-'+r.Dept,r])).values()];return ['X','Y','Z'].map(g=>({g,n:unique.filter(r=>r.XYZ===g).length,total:unique.length}))}
function groupCard(rs){const gs=groups(rs),total=gs[0].total,a=gs[0].n/total*100||0,b=(gs[0].n+gs[1].n)/total*100||0;return `<div class="card"><div class="card-head"><h2>XYZ 需求分布</h2><span class="tag">Store × Dept</span></div><p>依需求波動程度，辨識不同銷售型態</p><div class="donut" style="background:conic-gradient(#37ae94 0 ${a}%,#efbd57 ${a}% ${b}%,#ab89d8 ${b}% 100%)"><div><strong>${total}</strong><small>銷售時序</small></div></div>${gs.map((x,i)=>`<div class="group-row"><span class="badge ${x.g}">${x.g}</span><span>${['平穩需求','中等波動','高波動需求'][i]}</span><strong>${x.n}</strong><span style="color:#9aa7b7">${fmt(x.n/total*100||0)}%</span></div>`).join('')}</div>`}
let historySize = 8, forecastSize = 4, cutoff = '';
function weeklyWindow(rs, model) {
  const weeks = new Map();
  for (const r of rs) {
    const week = weeks.get(r.Date) || {date:r.Date, actual:0, low:0, mid:0, high:0, count:0};
    week.actual = Number.isFinite(week.actual) && Number.isFinite(r.Weekly_Sales) ? week.actual+r.Weekly_Sales : null;
    week.low += r['P10_'+model];
    week.mid += r['P50_'+model];
    week.high += r['P90_'+model];
    week.count++;
    weeks.set(r.Date, week);
  }
  const all = [...weeks.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const selected = all.findIndex(w => w.date === cutoff);
  const future=all.findIndex(w=>w.actual===null);
  const split = selected >= 0 ? selected : future>=0 ? future : Math.max(1, all.length - forecastSize);
  return {all, past:all.slice(Math.max(0, split-historySize), split).filter(w=>Number.isFinite(w.actual)), next:all.slice(split, split+forecastSize)};
}
function decisionChart(past, next) {
  const data = [...past,...next];
  const values = [...past.map(w=>w.actual), ...next.flatMap(w=>[w.low,w.mid,w.high])];
  if(!values.length)return '<p>沒有可顯示的預測。</p>';
  const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi-lo)*0.15,1);
  const x = i => 78 + 640*i/Math.max(1,data.length-1);
  const y = v => 208 - (v-lo+pad)*157/(hi-lo+2*pad);
  const edge = past.length ? (x(past.length-1)+x(past.length))/2 : 75;
  const points = (list,key,start) => list.map((w,i)=>x(start+i)+','+y(w[key]));
  const stroke = (pts,color,dash='') => '<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="3" stroke-linejoin="round" stroke-dasharray="'+dash+'"/>';
  let svg = '<svg viewBox="0 0 752 253" role="img" aria-label="歷史實績與後續預測，金額為美元">';
  if(next.length) svg += `<rect x="${edge}" y="18" width="${738-edge}" height="198" fill="#f0f6ff"/><line x1="${edge}" x2="${edge}" y1="18" y2="216" stroke="#6997c6" stroke-dasharray="4 4"/>`;
  svg += '<text x="78" y="34">歷史實績</text>';
  if(next.length) svg += `<text x="${edge+6}" y="34" fill="#086ac2">預測期</text>`;
  for(let i=0;i<5;i++){
    const v=lo-pad+(hi-lo+2*pad)*i/4;
    svg += `<line x1="75" x2="738" y1="${y(v)}" y2="${y(v)}" stroke="#dce5ee"/><text x="68" y="${y(v)+3}" text-anchor="end">${fmt(v)}</text>`;
  }
  if(next.length){
    const start=past.length;
    svg += `<polygon points="${[...points(next,'low',start),...points(next,'high',start).reverse()].join(' ')}" fill="#bbd9ff"/>`;
    svg += stroke([...points(past.slice(-1),'actual',start-1),...points(next,'mid',start)],'#0874d8','6 4');
  }
  svg += stroke(points(past,'actual',0),'#334d65');
  data.forEach((w,i)=>{
    const history=i<past.length, v=history?w.actual:w.mid;
    svg += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${history?'#334d65':'#0874d8'}"><title>${w.date} · ${history?'實績':'P50'} $ ${fmt(v)}</title></circle>`;
    if(i===0 || i===data.length-1 || (i%Math.ceil(data.length/6)===0 && i<data.length-2)) svg += `<text x="${x(i)}" y="237" text-anchor="middle">${w.date.slice(5)}</text>`;
  });
  return svg+'</svg>';
}
function overview(rs,m){
  const {all,past,next}=weeklyWindow(rs,m);
  const mean=(ws,key)=>ws.reduce((s,w)=>s+w[key],0)/ws.length;
  const baseline=mean(past,'actual'), expected=mean(next,'mid');
  const peak=next.reduce((best,w)=>!best || w.mid>best.mid?w:best,null);
  const change=baseline>0 && peak ? (expected/baseline-1)*100 : NaN;
  const choices=(values,current)=>values.map(v=>`<option ${v===current?'selected':''}>${v}</option>`).join('');
  const controls=`<div class="period-controls"><label>歷史週數<select id="historySize">${choices([4,8,12],historySize)}</select></label><label>預測起始週<select id="cutoff">${all.map(w=>`<option ${w.date===next[0]?.date?'selected':''}>${w.date}</option>`).join('')}</select></label><label>預測週數<select id="forecastSize">${choices([2,4,8],forecastSize)}</select></label></div>`;
  return `<div class="stats">${stat('歷史平均週銷售','$'+fmt(baseline),past.length+' 週實績','＄')}${stat('預測平均週銷售',peak?'$'+fmt(expected):'—',next.length+' 週 · P50','⌁')}${stat('週均銷售變化',Number.isFinite(change)?(change>0?'+':'')+fmt(change,1)+'%':'—','預測週均相對於歷史週均','↗')}${stat('預測最高週',peak?peak.date.slice(5):'—',peak?'P50 · $'+fmt(peak.mid):'沒有後續週資料','▦')}</div>
  <div class="card outlook"><div class="card-head"><h2>銷售趨勢與預測區間</h2><span class="tag">${names[m]} · 每週 USD</span></div>${controls}
  <div class="legend"><span><b class="historical"></b>歷史實績</span><span><b></b>後續 P50</span><span><b class="band"></b>P10–P90</span></div>${decisionChart(past,next)}
  <div class="chart-note">依匯入資料的日期順序顯示，預設優先從實績空白的週開始。${m==='HW'?'HW 為固定起點多週預測。':'此模型逐週使用當時已知的歷史資料。'}多時序的分位數逐週加總，合計範圍僅供比較。</div></div>
  <div class="card"><div class="card-head"><h2>後續各週銷售預測</h2><span class="tag">${next.length} 週</span></div><div class="table-wrap"><table><thead><tr><th>週別</th><th>時序數</th><th>P10 下界</th><th>P50 中位值</th><th>P90 上界</th></tr></thead><tbody>${next.map(w=>`<tr><td>${w.date}</td><td>${w.count}</td><td>$${fmt(w.low)}</td><td><strong>$${fmt(w.mid)}</strong></td><td>$${fmt(w.high)}</td></tr>`).join('')}</tbody></table></div>${!peak?'<p>此範圍尚無後續週資料。</p>':''}</div>
`;
}
function table(rs,m,limit=10){return `<div class="table-wrap"><table><thead><tr>${['日期','分店 / 部門','需求分群','實際銷售','P10 下界','P50 中位值','P90 上界','節慶週'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rs.slice(0,limit).map(r=>`<tr><td>${esc(r.Date)}</td><td>Store ${r.Store} / Dept ${r.Dept}</td><td><span class="badge ${r.XYZ}">${r.XYZ} 類</span></td><td>$${fmt(r.Weekly_Sales)}</td><td>$${fmt(r['P10_'+m])}</td><td style="color:#0874d8;font-weight:600">$${fmt(r['P50_'+m])}</td><td>$${fmt(r['P90_'+m])}</td><td>${r.IsHoliday?'節慶週':'—'}</td></tr>`).join('')}</tbody></table></div>`}
function render(){if(typeof syncWorkspace==='function') syncWorkspace();if(page==='explore'){renderExplorer();return}const rs=filtered(),m=$('model').value,mt=metrics(rs,m),sum=rs.reduce((s,r)=>s+r['P50_'+m],0);const titles={overview:['需求預測總覽','掌握銷售趨勢與需求波動，探索更精準的預測。'],segments:['XYZ 需求分群','從需求穩定度出發，理解每一條銷售時序。'],models:['模型成效比較','在相同篩選與相同觀測樣本下，檢視預測誤差與區間品質。'],data:['預測資料管理','匯入 Notebook 輸出，讓研究成果成為可探索的資訊。'],flow:['從資料到決策','依照 Walmart 訓練 Notebook，串連完整研究流程。']};$('title').textContent=titles[page][0];$('subtitle').textContent=titles[page][1];$('crumb').textContent=titles[page][0];document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));let html='';if(!rs.length&&!['data','flow'].includes(page)){ $('content').innerHTML='<div class="card empty">尚無符合條件的預測資料。請匯入真實模型輸出，或調整門市、部門與分群篩選。<p><button class="primary" onclick="openImport()">匯入真實預測資料</button></p></div>';return}
if(page==='overview') html=overview(rs,m)+groupForecasts(m)+queryDetails(rs,m);
if(page==='segments'){html=`<div class="grid">${groupCard(rs)}<div class="card"><h2>以變異係數 CV 辨識需求特性</h2><p>分群沿用匯入資料中的 XYZ 標籤，不在介面重新計算。</p><div class="flow">${[['X','平穩需求','CV ≤ 全體 CV 第 40 百分位數'],['Y','中等波動','第 40 百分位數 < CV ≤ 第 70 百分位數'],['Z','高波動需求','CV > 全體 CV 第 70 百分位數']].map(a=>`<div class="step"><b class="badge ${a[0]}">${a[0]}</b><div><h3>${a[1]}</h3><p>${a[2]}</p></div></div>`).join('')}</div><p class="metric-hint">門檻依 Notebook 的訓練資料分布決定；高波動不一定由節慶造成。</p></div></div><div class="card"><h2>分群觀測明細</h2>${table(rs,m,30)}<p class="chart-note">最多顯示 30 筆，完整資料可由右上方匯出。</p></div>`}
if(page==='models'){const models=Object.keys(names).filter(m=>hasModel(rs,m));html=`<div class="card"><div class="card-head"><h2>預測品質對照</h2><span class="tag">${demo?'示範結果':'匯入資料計算'} · ${fmt(rs.length)} 筆</span></div><p>三項分位數完整時才納入比較。MAE、Pinball、覆蓋率及 MIS 僅計算實績非空白的列；未來週實績空白時顯示待評估。</p><div class="table-wrap"><table><thead><tr><th>模型</th><th>MAE ↓</th><th>Pinball P50 ↓</th><th>80% 覆蓋率</th><th>MIS80 ↓</th></tr></thead><tbody>${models.map(m=>{const t=metrics(rs,m);return `<tr><td>${names[m]}</td><td>$${fmt(t.mae,2)}</td><td>${fmt(t.pin,2)}</td><td>${fmt(t.cov,1)}%</td><td>${fmt(t.mis,2)}</td></tr>`}).join('')}</tbody></table></div><p class="metric-hint">覆蓋率應接近名目水準 80%，並非越高越好。MIS80 同時考量區間寬度與未覆蓋懲罰。<br>Notebook 中 HW 為多步預測，LightGBM／LSTM 為逐週預測；比較時需留意資訊條件不同。<br>LSTM：${models.includes('LSTM')?'已載入':'尚未提供；匯入 P10_LSTM、P50_LSTM、P90_LSTM 即可加入比較。'}</p></div>`}
if(page==='data'){html=`<div class="card"><h2>載入資料檔</h2><p>資料只在此瀏覽器頁面處理，不會隨匯入上傳到伺服器；重新整理後需重新匯入資料。</p><div class="upload-box"><div style="font-size:30px;color:#1877d4">↥</div><h3>將預測結果帶入工作台</h3><p>支援 XLSX、XLS、CSV、TSV、JSON。一般表格可自選分析欄位，Walmart 預測可使用下列模型欄位。</p><button class="primary" onclick="openImport()">選擇資料檔</button></div><h2>Walmart 預測模式必要欄位</h2><p>Store、Dept、Date、Weekly_Sales、IsHoliday、XYZ<br>P10_HW、P50_HW、P90_HW、P10_LGBM、P50_LGBM、P90_LGBM</p><p class="metric-hint">可選：P10_LSTM、P50_LSTM、P90_LSTM（須完整提供）。系統檢查日期、數值、分位數順序、分群一致性及重複鍵值。<br>目前來源：${demo?'尚未匯入':'已匯入 CSV'} · ${fmt(rows.length)} 筆</p><button style="margin-top:15px" onclick="download(true)">↓ 下載目前完整資料</button></div>`}
if(page==='flow'){html=`<div class="card"><h2>研究流程地圖</h2><p>本介面承接模型輸出的靜態結果；模型訓練於原 Notebook 執行。</p><div class="flow">${[['資料取得與探索','train.csv、stores.csv、features.csv → 合併資料與 EDA'],['特徵工程與解釋','Lag、Rolling、節慶標注 → XGBoost / SHAP 重要性'],['XYZ 需求分群','依銷售變異係數 CV 的 40% / 70% 分位數分類'],['多模型訓練','Holt-Winters、LightGBM 分位數預測、LSTM'],['評估與結果輸出','預測誤差、Pinball Loss、覆蓋率、MIS → predictions.csv'],['互動探索與報表','匯入結果 → 篩選時序 → 比較模型 → 下載結果']].map((s,i)=>`<div class="step"><b>${String(i+1).padStart(2,'0')}</b><div><h3>${s[0]}</h3><p>${s[1]}</p></div><span class="tag" style="margin-left:auto">${i===5?'本介面':'Notebook'}</span></div>`).join('')}</div><p class="metric-hint">補貨邏輯在原 Notebook 中列為後續 inventory.py 工作，初版尚未整合。</p></div>`}$('content').innerHTML=html}
function parseCSV(text,delimiter=','){let out=[],row=[],v='',quoted=false;text=text.replace(/^\uFEFF/,'');for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++}else quoted=!quoted}else if(c===delimiter&&!quoted){row.push(v);v=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(x=>x.trim()))out.push(row);row=[];v=''}else v+=c}if(quoted)throw Error('CSV 引號未正確閉合');row.push(v);if(row.some(x=>x.trim()))out.push(row);return out}
function validateCSV(text){const parsed=parseCSV(text),headers=parsed.shift()?.map(s=>s.trim());if(!headers||!parsed.length)throw Error('檔案沒有資料');if(new Set(headers).size!==headers.length)throw Error('欄位名稱重複');const req=['Store','Dept','Date','Weekly_Sales','IsHoliday','XYZ',...['HW','LGBM'].flatMap(m=>[10,50,90].map(p=>`P${p}_${m}`))];if(headers.some(h=>h.endsWith('_LSTM')))req.push('P10_LSTM','P50_LSTM','P90_LSTM');const missing=req.filter(k=>!headers.includes(k));if(missing.length)throw Error('缺少欄位：'+missing.join(', '));const seen=new Set(),groups=new Map();return parsed.map((values,i)=>{if(values.length!==headers.length)throw Error(`第 ${i+2} 列欄位數不符`);let r=Object.fromEntries(headers.map((h,j)=>[h,values[j].trim()]));for(const k of req.filter(k=>!['Date','XYZ','IsHoliday'].includes(k))){if(k==='Weekly_Sales' && r[k]===''){r[k]=null;continue}if(r[k]===''||!Number.isFinite(+r[k]))throw Error(`第 ${i+2} 列 ${k} 不是有效數字`);r[k]=+r[k]}if(![r.Store,r.Dept].every(v=>Number.isInteger(v)&&v>0))throw Error(`第 ${i+2} 列分店與部門須為正整數`);if(!/^\d{4}-\d{2}-\d{2}$/.test(r.Date)||isNaN(Date.parse(r.Date))||new Date(r.Date).toISOString().slice(0,10)!==r.Date)throw Error(`第 ${i+2} 列日期錯誤`);if(!['X','Y','Z'].includes(r.XYZ))throw Error(`第 ${i+2} 列 XYZ 須為 X、Y 或 Z`);let hol=String(r.IsHoliday).toLowerCase();if(!['true','false','1','0'].includes(hol))throw Error(`第 ${i+2} 列 IsHoliday 須為 True / False 或 1 / 0`);r.IsHoliday=+(hol==='true'||hol==='1');for(const m of ['HW','LGBM',...(req.includes('P10_LSTM')?['LSTM']:[])])if(r['P10_'+m]>r['P50_'+m]||r['P50_'+m]>r['P90_'+m])throw Error(`第 ${i+2} 列 ${m} 分位數交叉，請先確認來源`);let key=r.Store+'-'+r.Dept;if(groups.has(key)&&groups.get(key)!==r.XYZ)throw Error(`第 ${i+2} 列同一時序的 XYZ 不一致`);groups.set(key,r.XYZ);key+='-'+r.Date;if(seen.has(key))throw Error(`第 ${i+2} 列 Store / Dept / Date 重複`);seen.add(key);return Object.fromEntries(req.map(k=>[k,r[k]]))})}
function download(all=false){const data=all?rows:filtered();if(!data.length)return toast('目前沒有可匯出的資料');const cols=Object.keys(data[0]),text='\uFEFF'+[cols.join(','),...data.map(r=>cols.map(k=>r[k]).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=demo?'demo_predictions.csv':'predictions_filtered.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已下載 '+data.length+' 筆'+(demo?'示範資料':''))}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{page=b.dataset.page;render()});['store','dept','xyz','model'].forEach(k=>$(k).onchange=render);$('reset').onclick=()=>{['store','dept','xyz'].forEach(k=>$(k).value='');render()};$('import').onclick=()=>openImport();$('export').onclick=()=>download();options();render();

$('content').onchange = event => {
  const {id,value} = event.target;
  if(id==='historySize') historySize=Number(value);
  else if(id==='forecastSize') forecastSize=Number(value);
  else if(id==='cutoff') cutoff=value;
  else return;
  render();
  $(id)?.focus();
};





$('store').onchange=()=>{options();render()};

function scopeRows() {
  return rows.filter(r=>(!$('store').value || r.Store===Number($('store').value)) &&
    (!$('dept').value || r.Dept===Number($('dept').value)))
    .sort((a,b)=>a.Date.localeCompare(b.Date)||a.Store-b.Store||a.Dept-b.Dept);
}
function scopeForecasts(model) {
  const scope=scopeRows();
  const window=weeklyWindow(scope,model);
  const dates=new Set(window.next.map(w=>w.date));
  const future=scope.filter(r=>dates.has(r.Date));
  return ['全部','X','Y','Z'].map(group=>{
    const records=future.filter(r=>group==='全部'||r.XYZ===group);
    const weekly=weeklyWindow(records,model).all;
    return {group,records,weekly};
  });
}
function groupForecasts(model) {
  const forecasts=scopeForecasts(model);
  const selected=$('xyz').value||'全部';
  return '<section class="card formal-groups"><div class="card-head"><h2>整體與 XYZ 分類預測</h2><span class="tag">'+names[model]+'</span></div>'+
    '<p>範圍依目前門市、部門條件。四組使用同一預測起始週及週數，分類選擇可切換上方詳細圖表。</p>'+
    '<div class="forecast-grid">'+forecasts.map(({group,records,weekly})=>{
      const total=records.reduce((sum,r)=>sum+r['P50_'+model],0);
      return '<article class="forecast-group"><button class="'+(selected===group?'primary':'')+'" onclick="selectGroup(\''+group+'\')">'+(group==='全部'?'整體':group+' 類')+'</button>'+
        '<p>'+new Set(records.map(r=>r.Store+'-'+r.Dept)).size+' 條門市部門時序 · '+weekly.length+' 週</p>'+
        '<strong>'+ (records.length?'$'+fmt(total,2):'無資料')+'</strong><p>預測期間 P50 合計</p>'+
        (weekly.length?decisionChart([],weekly):'')+
        '<button '+(records.length?'':'disabled')+' onclick="downloadGroup(\''+group+'\')">下載逐週預測 CSV</button></article>';
    }).join('')+'</div><p class="chart-note">各分類由門市部門預測逐週加總。P10／P90 加總供比較，未估計跨時序相關性。模型誤差只使用已有實績的資料。</p></section>';
}
function selectGroup(group) {
  $('xyz').value=group==='全部'?'':group;
  detailOffset=0;
  render();
}
let detailOffset=0;
let detailKey='';
function queryDetails(records,model) {
  const key=[$('store').value,$('dept').value,$('xyz').value,model,cutoff,forecastSize,records.length].join('|');
  if(key!==detailKey){detailKey=key;detailOffset=0}
  const dates=new Set(weeklyWindow(records,model).next.map(w=>w.date));
  const selected=records.filter(r=>dates.has(r.Date));
  const start=detailOffset;
  const series=new Set(selected.map(r=>r.Store+'-'+r.Dept)).size;
  return '<section class="card details-grid"><div class="card-head"><h2>門市部門預測查詢</h2><button '+(selected.length?'':'disabled')+' onclick="downloadQuery()">下載此查詢 CSV</button></div>'+
    '<p>門市 '+esc($('store').value||'全部')+' ／ 部門 '+esc($('dept').value||'全部')+' ／ 分群 '+esc($('xyz').value||'全部')+
    ' · '+names[model]+' · '+series+' 條時序 · '+selected.length+' 筆預測。選擇單一門市與部門即可獨立查詢。</p>'+
    table(selected.slice(start,start+25),model,25)+
    '<div class="pager"><button '+(start?'':'disabled')+' onclick="detailOffset-=25;render()">上一頁</button><span>'+
    (selected.length?start+1:0)+'–'+Math.min(start+25,selected.length)+' / '+selected.length+
    '</span><button '+(start+25<selected.length?'':'disabled')+' onclick="detailOffset+=25;render()">下一頁</button></div></section>';
}
function saveForecastCSV(columns,records,name) {
  const url=URL.createObjectURL(new Blob([encodedTable(columns,records,'csv')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadGroup(group) {
  const model=$('model').value;
  const selected=scopeForecasts(model).find(g=>g.group===group);
  saveForecastCSV(['Date','XYZ','Model','Series_Count','P10_Sum','P50_Sum','P90_Sum'],
    selected.weekly.map(w=>[w.date,group,names[model],w.count,w.low,w.mid,w.high]),
    'forecast_'+group+'_'+model+'_store-'+($('store').value||'all')+'_dept-'+($('dept').value||'all')+'.csv');
}
function queryExport() {
  const model=$('model').value;
  const selected=filtered();
  const dates=new Set(weeklyWindow(selected,model).next.map(w=>w.date));
  const columns=['Store','Dept','Date','XYZ','Weekly_Sales','P10_'+model,'P50_'+model,'P90_'+model];
  return {columns,records:selected.filter(r=>dates.has(r.Date)).map(r=>columns.map(c=>r[c]))};
}
function downloadQuery() {
  const result=queryExport();
  saveForecastCSV(result.columns,result.records,
    'forecast_store-'+($('store').value||'all')+'_dept-'+($('dept').value||'all')+'_'+$('model').value+'.csv');
}
