/* The notebook service runs real models; no client-side replacement forecasts. */
const stages=[['preprocess','多檔匯入與預處理'],['features','特徵分析'],['xyz','XYZ 分類'],['hw','STL + HW'],['lgbm','LightGBM-Q'],['lstm','LSTM-Q']];
const workflow={stage:'idle',tables:[],health:null,result:null,error:'',job:null,token:'',reading:0};
const legacyRender=render, legacyImport=openImport;
names.HW='STL + Holt-Winters';
function stageStrip(){
  const index=stages.findIndex(s=>s[0]===workflow.stage),done=workflow.stage==='done';
  return '<div class="pipeline-strip">'+stages.map(([key,label],i)=>`<div class="pipeline-step ${done||i<index?'complete':i===index?'current':''}"><span>${done||i<index?'✓':i+1}</span><b>${label}</b><small>${done||i<index?'已完成':i===index?'執行中':'待執行'}</small></div>`).join('')+'</div>';
}
function roleFor(table){const has=keys=>keys.every(k=>table.columns.includes(k));return has(['Store','Dept','Date','Weekly_Sales','IsHoliday'])?'train':has(['Store','Dept','Date','IsHoliday'])&&!table.columns.includes('Weekly_Sales')?'test':has(['Store','Type','Size'])?'stores':has(['Store','Date','Temperature','Fuel_Price','MarkDown1','MarkDown2','MarkDown3','MarkDown4','MarkDown5','CPI','Unemployment'])?'features':'unknown'}
function inspectBatch(tables){
  const counts={train:0,stores:0,features:0,test:0},seen={train:new Set(),stores:new Set(),features:new Set(),test:new Set()};
  for(const t of tables){const role=roleFor(t);if(role==='unknown')throw Error(t.name+' 缺少原專題欄位，無法識別資料類型。');
    const keys=['train','test'].includes(role)?['Store','Dept','Date']:role==='stores'?['Store']:['Store','Date'];
    for(const row of t.records){const values=keys.map(k=>String(row[t.columns.indexOf(k)]??'').trim());if(values.some(v=>!v))throw Error(t.name+' 識別鍵不得空白。');const key=JSON.stringify(values);if(seen[role].has(key))throw Error(t.name+' 有跨檔重複鍵：'+values.join(' / '));seen[role].add(key)}counts[role]+=t.records.length;
  }return counts;
}
openImport=function(){
  ++workflow.reading;
  showDialog('整批匯入原始資料',`<p>一次選取 train、stores、features，可一併選取 test（不含 Weekly_Sales 的待預測清單），亦可匯入多個互不重疊的分批檔案。支援 CSV、TSV、JSON、XLSX、XLS；Excel 可逐檔選工作表。整批上限 80 MB／30 檔。</p><input id="batch-files" type="file" multiple accept=".csv,.tsv,.json,.xlsx,.xls"><label>文字編碼<select id="batch-encoding"><option value="utf-8">UTF-8</option><option value="big5">Big5</option><option value="utf-16le">UTF-16</option></select></label><div id="batch-preview"></div><button id="batch-apply" class="primary" disabled>確認這批資料</button><p>只有按下「執行原專題流程」才會將資料傳至運算服務。</p><button id="legacy-import">匯入已完成的預測結果／一般表格</button>`);
  $('batch-files').onchange=()=>readBatch($('batch-files').files);
  $('batch-encoding').onchange=()=>readBatch($('batch-files').files);
  $('legacy-import').onclick=()=>legacyImport();
  $('batch-apply').onclick=()=>{try{inspectBatch(workflow.pending);workflow.tables=workflow.pending;workflow.error='';page='data';render();$('wizard').close()}catch(e){$('dialog-error').textContent=e.message}};
};
async function readBatch(files){
  const revision=++workflow.reading; $('batch-apply').disabled=true;$('dialog-error').textContent='';$('batch-preview').textContent='正在讀取…';
  try{
    if(!files.length||files.length>30)throw Error('請選擇 1–30 份檔案。');
    if([...files].reduce((s,f)=>s+f.size,0)>80*1024*1024)throw Error('整批檔案超過 80 MB。');
    const loaded=await Promise.all([...files].map(async file=>{const buffer=await file.arrayBuffer(),ext=file.name.split('.').pop().toLowerCase();if(['xls','xlsx'].includes(ext)){const book=XLSX.read(buffer,{type:'array'});return {file,book,table:workbookTable(book,book.SheetNames[0],file.name)}}return {file,table:decodeTable(new TextDecoder($('batch-encoding').value,{fatal:true}).decode(buffer),file.name)}}));
    if(revision!==workflow.reading||!$('wizard').open)return;
    function preview(){workflow.pending=loaded.map(item=>item.table);try{inspectBatch(workflow.pending);$('dialog-error').textContent='';$('batch-apply').disabled=false}catch(e){$('dialog-error').textContent=e.message;$('batch-apply').disabled=true}
      $('batch-preview').innerHTML=loaded.map((item,i)=>`<div class="batch-item"><strong>${esc(item.file.name)}</strong>${item.book?`<select aria-label="${esc(item.file.name)} 工作表" data-sheet="${i}">${item.book.SheetNames.map((name,j)=>`<option value="${j}" ${item.table.name.endsWith(' · '+name)?'selected':''}>${esc(name)}</option>`).join('')}</select>`:''}<span>${roleFor(item.table)} · ${fmt(item.table.records.length)} 列</span><small>${item.table.columns.map(esc).join(' · ')}</small></div>`).join('');
      document.querySelectorAll('[data-sheet]').forEach(select=>select.onchange=()=>{try{const item=loaded[+select.dataset.sheet];item.table=workbookTable(item.book,item.book.SheetNames[+select.value],item.file.name);preview()}catch(e){$('dialog-error').textContent=e.message;$('batch-apply').disabled=true}});
    }preview();
  }catch(e){if(revision===workflow.reading){$('batch-preview').textContent='尚未載入這批資料';$('dialog-error').textContent=e.message}}
}
async function checkService(){try{const response=await fetch('api/health',{cache:'no-store'});const value=await response.json();workflow.health=value.pipeline==='walmart-original-v3'?value:null}catch{workflow.health=null}render()}
async function service(path,options={}){const response=await fetch('api/'+path,{...options,headers:{'Content-Type':'application/json',...(workflow.token?{'Authorization':'Bearer '+workflow.token}:{}),...options.headers}});let value;try{value=await response.json()}catch{throw Error('運算服務無回應，請從 Python 服務網址開啟介面。')}if(!response.ok)throw Error(value.error||'運算請求失敗');return value}
async function runPipeline(){
  try{const counts=inspectBatch(workflow.tables);if(['train','stores','features'].some(role=>!counts[role]))throw Error('請同時匯入 train、stores、features 三類資料。');
    if(!workflow.health?.ready)throw Error('運算服務尚未就緒。');
    workflow.token=$('training-token')?.value||workflow.token;workflow.error='';workflow.stage='queued';render();
    const job=await service('jobs',{method:'POST',body:JSON.stringify({tables:workflow.tables})});workflow.job=job.id;pollJob();
  }catch(e){workflow.stage='error';workflow.error=e.message;render()}
}
async function pollJob(){
  try{const state=await service('jobs/'+workflow.job);workflow.stage=state.stage;if(state.stage==='error')throw Error(state.error);
    if(state.stage==='done'){const result=await service('jobs/'+workflow.job+'/result');loadPipelineResult(result);return}render();setTimeout(pollJob,3000);
  }catch(e){workflow.stage='error';workflow.error=e.message;render()}
}
function loadPipelineResult(result){
  if(!Array.isArray(result.predictions)||!result.predictions.length)throw Error('模型未返回預測資料。');
  const cols=Object.keys(result.predictions[0]);const valid=validateCSV(encodedTable(cols,result.predictions.map(r=>cols.map(c=>r[c])),'csv'));
  workflow.result=result;rows=valid;demo=false;workflow.stage='done';walmartSource='原專題流程運算 · '+rows.length+' 筆共同樣本';
  cutoff=rows.map(r=>r.Date).sort()[0];['store','dept','xyz'].forEach(id=>$(id).value='');options();page='overview';render();
}
function scopeHistory(records){return (workflow.result?.history||records).filter(r=>(!$('store').value||r.Store===+$('store').value)&&(!$('dept').value||r.Dept===+$('dept').value)&&(!$('xyz').value||r.XYZ===$('xyz').value))}
function bandWeeks(records,model){const map=new Map();for(const r of records){let w=map.get(r.Date);if(!w){w={date:r.Date,actual:0,low:0,mid:0,high:0,holiday:false,count:0};map.set(r.Date,w)}w.actual=Number.isFinite(w.actual)&&Number.isFinite(r.Weekly_Sales)?w.actual+r.Weekly_Sales:null;w.low+=r['P10_'+model];w.mid+=r['P50_'+model];w.high+=r['P90_'+model];w.holiday=w.holiday||!!r.IsHoliday;w.count++}return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date))}
function ribbonChart(records,model,historyRecords=records){
  const weeks=bandWeeks(records,model),start=cutoff||weeks[0]?.date;
  const future=weeks.filter(w=>w.date>=start).slice(0,forecastSize);
  const past=bandWeeks(historyRecords,model).filter(w=>w.date<start).slice(-historySize);
  const data=[...past,...future];if(!future.length)return '<div class="chart-empty">此範圍沒有預測樣本</div>';
  const values=data.flatMap(w=>[w.actual,...(future.includes(w)?[w.low,w.high]:[])]).filter(Number.isFinite);
  let min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.14,1);min-=pad;max+=pad;
  const x=i=>82+i*800/Math.max(1,data.length-1),y=v=>242-(v-min)/(max-min)*180;
  const line=(items,key,offset,color,dash='')=>`<polyline points="${items.filter(w=>Number.isFinite(w[key])).map(w=>`${x(data.indexOf(w))},${y(w[key])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}"/>`;
  const colors={HW:'#376bc4',LGBM:'#b27417',LSTM:'#138a75'},color=colors[model];
  let svg=`<svg viewBox="0 0 920 285" role="img" aria-label="${names[model]} P10 至 P90 帶狀區間圖，含 P50、實績、預測起點及節慶節點"><title>${names[model]} 80% 名目區間</title>`;
  for(let i=0;i<5;i++){const v=min+(max-min)*i/4;svg+=`<line x1="82" x2="890" y1="${y(v)}" y2="${y(v)}" stroke="#e5ebf1"/><text x="73" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`}
  const offset=past.length;
  svg+=`<polygon points="${[...future.map((w,i)=>`${x(offset+i)},${y(w.low)}`),...future.map((w,i)=>`${x(offset+i)},${y(w.high)}`).reverse()].join(' ')}" fill="${color}" fill-opacity=".19"/>`;
  if(future.length===1)svg+=`<rect x="${x(offset)-8}" y="${y(future[0].high)}" width="16" height="${y(future[0].low)-y(future[0].high)}" fill="${color}" fill-opacity=".2"/>`;
  svg+=line(data,'actual',0,'#334155')+line(future,'mid',offset,color,'5 3');
  const edge=x(offset);svg+=`<line x1="${edge}" x2="${edge}" y1="45" y2="246" stroke="${color}" stroke-dasharray="4 4"/><text x="${Math.min(edge+7,780)}" y="32">預測起點 ${future[0].date}</text>`;
  data.forEach((w,i)=>{const f=i>=offset,v=f?w.mid:w.actual;if(!Number.isFinite(v))return;svg+=`<circle tabindex="0" cx="${x(i)}" cy="${y(v)}" r="${w.holiday?5:3}" fill="${w.holiday?'#d04469':f?color:'#334155'}"><title>${w.date}${w.holiday?' · 節慶週':''} · 實績 ${fmt(w.actual)}${f?' · P10 '+fmt(w.low)+' · P50 '+fmt(w.mid)+' · P90 '+fmt(w.high):''}</title></circle>`;if(i===0||i===data.length-1||i%Math.ceil(data.length/6)===0)svg+=`<text x="${x(i)}" y="270" text-anchor="middle">${w.date.slice(2)}</text>`});
  return svg+'</svg>';
}
function scopeBadge(records){const labels=[...new Set(records.map(r=>r.XYZ))];return `<div class="scope-heading"><div><small>目前查詢範圍</small><h2>${$('store').value?'門市 '+esc($('store').value):'全部門市'} / ${$('dept').value?'部門 '+esc($('dept').value):'全部部門'}</h2></div><div>${labels.map(g=>`<span class="badge ${g}">${g} 類</span>`).join(' ')}<small>${labels.length>1?'跨門市或部門包含多種分類':'依門市 × 部門時序分類'}</small></div></div>`}
function classificationNode(){
  const result=workflow.result;if(!result||!$('store').value||!$('dept').value)return '';
  const item=result.classification.find(r=>r.Store===+$('store').value&&r.Dept===+$('dept').value);
  if(!item)return '<div class="classification-node">此時序未通過原程式平均銷售 ≥ 100 的分群門檻，依原流程回填 X；不代表已驗證為穩定需求。</div>';
  const a=result.audit,max=Math.max(a.q70*1.4,item.CV*1.15,.01),pos=v=>Math.min(100,v/max*100);
  return `<div class="classification-node"><b>${item.XYZ} 類 · CV ${fmt(item.CV,4)}</b><div class="cv-track" style="background:linear-gradient(to right,#d3eee5 0 ${pos(a.q40)}%,#ffebba ${pos(a.q40)}% ${pos(a.q70)}%,#e6d9f6 ${pos(a.q70)}% 100%)"><i style="left:${pos(item.CV)}%" title="此門市部門 CV"></i></div><small>X ≤ ${fmt(a.q40,4)} · Y ≤ ${fmt(a.q70,4)} · Z > ${fmt(a.q70,4)}；圓點為目前部門。</small></div>`;
}
function featureAnalysis(){
  const result=workflow.result;if(!result)return '';
  const items=result.importance.slice(0,12),maximum=Math.max(...items.map(r=>r.importance),.001);
  return `<section class="card feature-analysis"><h2>訓練期特徵重要性</h2><p>XGBoost 實際結果。LightGBM 沿用固定 19 欄；LSTM 採篩選清單，兩者特徵不宣稱相同。</p>${items.map(r=>`<div><span>${esc(r.feature)}</span><progress max="${maximum}" value="${r.importance}"></progress><b>${fmt(r.importance,4)}</b></div>`).join('')}</section>`;
}
function chartCard(records,model,history,title){return `<section class="card ribbon"><div class="card-head"><h2>${title||names[model]}</h2><span class="tag">P10–P90 · 80% 名目區間</span></div>${ribbonChart(records,model,history)}<div class="ribbon-legend"><span>━ 實績</span><span>┄ P50</span><span>▰ P10–P90</span><span class="holiday">● 節慶節點</span></div></section>`}
function periodControls(records){const dates=[...new Set(records.map(r=>r.Date))].sort();return `<div class="period-controls"><label>歷史週數<select id="historySize">${[8,12,26,52].map(n=>`<option ${n===historySize?'selected':''}>${n}</option>`).join('')}</select></label><label>預測起始週<select id="cutoff">${dates.map(d=>`<option ${d===(cutoff||dates[0])?'selected':''}>${d}</option>`).join('')}</select></label><label>預測週數<select id="forecastSize">${[4,8,13,26,52].map(n=>`<option ${n===forecastSize?'selected':''}>${n}</option>`).join('')}</select></label><button onclick="downloadQuery()">下載所選部門預測 CSV</button></div>`}
function pipelineData(){let counts={train:0,stores:0,features:0,test:0};try{counts=inspectBatch(workflow.tables)}catch{}const busy=!['idle','done','error'].includes(workflow.stage);return `<section class="card"><div class="card-head"><h2>原始資料與運算</h2><span class="tag">原專題流程</span></div><p>同步匯入三類原始資料，由模型服務執行特徵工程、XYZ 分群與三模型訓練。固定以 2011-11-01 切分訓練／測試，呈現原專題回測結果。</p><div class="input-grid">${[['train','銷售實績','Store · Dept · Date · Weekly_Sales · IsHoliday'],['stores','門市屬性','Store · Type · Size'],['features','外部特徵','Store · Date · 氣溫／油價／促銷／CPI／失業率'],['test','待預測清單（選填）','Store · Dept · Date · IsHoliday；不要求實績']].map(([role,label,desc])=>`<div><h3>${label}</h3><strong>${fmt(counts[role])} 列</strong><small>${desc}</small></div>`).join('')}</div><p class="service-state">test.csv 可隨批次匯入並保留，不需補填 Weekly_Sales。目前執行的是 train.csv 內的原專題回測；test 清單尚未進行未來預測，不會混入訓練、XYZ 或誤差評估。</p><p>${workflow.tables.map(t=>esc(t.name)).join('、')||'尚未選取資料'}</p><div class="service-state">${workflow.health?.ready?'運算服務已連線':workflow.health?'運算服務缺少套件：'+workflow.health.missing.map(esc).join('、'):'此網址尚未連接 Python 運算服務。GitHub Pages 可查看已完成的結果；完整運算版請從部署後的服務網址開啟。'}</div>${workflow.health?.requires_token?'<label>運算存取密碼<input id="training-token" type="password" autocomplete="off"></label>':''}<div class="actions"><button onclick="openImport()" ${busy?'disabled':''}>選取多份資料</button><button class="primary" onclick="runPipeline()" ${busy||!workflow.health?.ready||['train','stores','features'].some(role=>!counts[role])?'disabled':''}>${busy?'模型運算中…':'執行原專題流程'}</button><button onclick="checkService()">重新檢查連線</button><button onclick="legacyImport()">匯入既有預測結果</button></div>${workflow.error?`<p role="alert" class="pipeline-error">${esc(workflow.error)}</p>`:''}<p class="fine-print">運算期間保留頁面。原始資料及結果會存於運算服務的任務目錄，由部署管理者管理；不會提交至 GitHub。</p></section>`}
function auditPanel(){const a=workflow.result?.audit;return `<section class="card"><h2>流程與原程式對照</h2><div class="audit-flow"><p><b>預處理</b> 銷售與門市以 Store 左連接，外部特徵以 Store／Date 左連接，依門市、部門、日期排序。</p><p><b>特徵分析</b> Lag 1／2／4／8／52，退後一週的 Rolling 4／12／26；早期缺值、促銷缺值補零。XGBoost 僅以訓練期篩選重要性 ≥ 0.005，另保留指定領域特徵。</p><p><b>XYZ</b> 全期間平均銷售 ≥ 100 的時序計算 CV，40／70 百分位切分；其餘依原程式填 X／CV=0，屬回退標籤。${a?'本批門檻：'+fmt(a.q40,4)+' / '+fmt(a.q70,4):''}</p><p><b>STL + HW</b> 54 週以上：STL（52 週）＋加法趨勢；26 週以上：趨勢 HW；較短時序：最近 12 週均值。殘差標準差建立常態分位區間。</p><p><b>LightGBM</b> 固定 19 項特徵，24 組參數 × 3 分位數搜尋，再執行原正式訓練；正式訓練保留原程式按列最後 20% 作驗證的設定。</p><p><b>LSTM</b> XGBoost 篩選特徵、26 週視窗、32 隱藏單元、20 epochs，不留驗證集；只用訓練期估計標準化參數。</p></div><p>HW 為固定起點多步預測；LightGBM／LSTM 逐週使用已知歷史及當週外部特徵。XYZ 沿用全期間分類。此版本忠實呈現原專題回測，不能直接視為未知未來的線上預測。</p>${a?`<details><summary>本次特徵與資料稽核</summary><pre>${esc(JSON.stringify(a,null,2))}</pre></details>`:''}</section>`}
render=function(){
  if(page==='explore'){legacyRender();return}syncWorkspace();
  if(!rows.length){$('source').textContent='等待匯入原始資料';$('source-detail').textContent='銷售實績、門市屬性與外部特徵，可一次選取多份檔案。'}
  const labels={overview:'決策預測面板',segments:'XYZ 分類預測',models:'三模型區間比較',data:'資料匯入與模型運算',flow:'特徵與流程稽核'};
  $('title').textContent=labels[page]||labels.overview;$('crumb').textContent=$('title').textContent;$('subtitle').textContent='從原始資料到分類預測，以區間、節慶節點與部門查詢支援決策。';
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  let html=stageStrip();const selected=filtered();if(workflow.result?.pending_targets?.length)html+=`<div class="service-state">已保留 ${fmt(workflow.result.pending_targets.length)} 筆 test 待預測清單；下方圖表為 train 內回測結果，尚未產出 test 的未來預測。</div>`;
  if(page==='data'||!rows.length)html+=pipelineData();
  if(page==='flow')html+=featureAnalysis()+auditPanel();
  if(['overview','segments','models'].includes(page)&&rows.length){
    if(!selected.length){html+='<div class="card">此門市／部門／XYZ 組合沒有資料，請調整篩選。</div>'}
    else{html+=scopeBadge(selected)+classificationNode()+periodControls(selected);const history=scopeHistory(selected);
      if(page!=='segments')html+=Object.keys(names).filter(m=>hasModel(selected,m)).map(m=>chartCard(selected,m,history)).join('');
      if(page!=='models'){const model=$('model').value;const scope=scopeRows();const hist=(workflow.result?.history||scope).filter(r=>(!$('store').value||r.Store===+$('store').value)&&(!$('dept').value||r.Dept===+$('dept').value));html+='<section class="group-heading"><h2>整體與 XYZ 分類</h2><p>依所選門市／部門彙總；以下四圖不受 XYZ 篩選影響。多時序 P10／P90 加總僅為參考範圍，並非校準後的合計分位數。</p></section><div class="ribbon-grid">'+['全部','X','Y','Z'].map(g=>chartCard(scope.filter(r=>g==='全部'||r.XYZ===g),model,hist.filter(r=>g==='全部'||r.XYZ===g),g==='全部'?'整體預測':g+' 類預測')).join('')+'</div>'}
      html+=`<details class="card"><summary>查看與下載查詢明細</summary>${queryDetails(selected,$('model').value)}</details>`;
    }
  }
  if(!rows.length&&page==='overview')html+='<section class="card chart-empty"><h2>等待真實模型結果</h2><p>完成運算後，這裡將顯示三模型帶狀區間圖、整體與 XYZ 四組預測，以及單一門市／部門分類。</p></section>';
  $('content').innerHTML=html;
};
$('import').onclick=()=>openImport();
$('export').onclick=()=>{if(page==='explore')return exportData();if(!rows.length)return toast('請先完成模型運算或匯入結果');downloadQuery()};
render();checkService();
