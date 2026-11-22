/* Custom tabular analysis shares the original Walmart workspace and runs offline. */
let dataset = null;
let draft = null;
let settings = {};
let walmartSource = null;
let latestRead = 0;

function decodeTable(text, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  let columns, records;
  if (ext === 'json') {
    const objects = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!Array.isArray(objects) || !objects.length || objects.some(o => !o || typeof o !== 'object' || Array.isArray(o)))
      throw Error('JSON 須為非空的物件陣列，每個物件代表一列。');
    columns = [...new Set(objects.flatMap(Object.keys))];
    records = objects.map((o,i) => columns.map(k => {
      const v = Object.hasOwn(o,k) ? o[k] : null;
      if (v !== null && typeof v === 'object') throw Error('第 '+(i+1)+' 筆含巢狀欄位，請先展開成表格。');
      return v;
    }));
  } else {
    if (!['csv','tsv'].includes(ext)) throw Error('請使用 CSV、TSV 或 JSON；Excel 可另存 UTF-8 CSV。');
    // Count separators in the first logical row, ignoring quoted field content.
    const firstRow=text.match(/^(?:"(?:[^"]|"")*"|[^"\r\n])*/)?.[0] || '';
    const header=firstRow.replace(/"(?:[^"]|"")*"/g,'');
    const delimiters=[',',';','\t'];
    const delimiter=ext==='tsv'?'\t':delimiters.sort((a,b)=>header.split(b).length-header.split(a).length)[0];
    const parsedRows = parseCSV(text,delimiter);
    columns = parsedRows[0];
    records = parsedRows.slice(1);
    columns = columns?.map(c => c.trim());
  }
  if (!columns?.length || !records.length) throw Error('請提供欄名及至少一列資料。');
  if (columns.some(c=>!c.trim()) || new Set(columns).size !== columns.length) throw Error('欄名不可空白或重複。');
  const bad = records.findIndex(r=>r.length !== columns.length);
  if (bad >= 0) throw Error('第 '+(bad+2)+' 列欄位數與標題不同。');
  return {columns,records,name:filename};
}
function numberValue(v) {
  if (v === null || typeof v === 'boolean') return null;
  const text = String(v).trim();
  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text.replaceAll(',',''));
  return Number.isFinite(value) ? value : null;
}
function encodedTable(columns,records,format) {
  if (format === 'json') return JSON.stringify(records.map(row=>Object.fromEntries(columns.map((k,i)=>[k,row[i]]))),null,2);
  const delimiter = format === 'tsv' ? '\t' : ',';
  const quote = cell => '"' + String(cell ?? '').replaceAll('"','""') + '"';
  return '\uFEFF'+[columns,...records].map(r=>r.map(quote).join(delimiter)).join('\r\n');
}
function tableView(columns,records) {
  return '<div class="table-wrap"><table><thead><tr>'+columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
    records.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function columnOptions(columns,selected,blank) {
  return '<option value="-1">'+esc(blank)+'</option>'+columns.map((c,i)=>
    '<option value="'+i+'" '+(selected===i?'selected':'')+'>'+esc(c)+'</option>').join('');
}
function defaults(data) {
  const sample=data.records.slice(0,100);
  const metric=data.columns.findIndex((_,i)=>sample.some(r=>numberValue(r[i])!==null));
  const group=data.columns.findIndex((_,i)=>i!==metric && sample.some(r=>r[i]!=null && String(r[i]).trim() && numberValue(r[i])===null));
  return {group,metric,compare:-1,query:'',offset:0};
}
function syncWorkspace() {
  const custom=page==='explore';
  document.querySelector('.filters').hidden=custom;
  document.querySelector('footer span:last-child').textContent=custom?'單位依匯入欄位':'金額單位：USD · 80% 名目預測區間';
  $('source').textContent=custom?(dataset?'自訂資料':'尚未匯入自訂資料'):(demo?'目前使用示範資料':'已載入 Walmart 預測資料');
  $('source-detail').textContent=custom?(dataset?dataset.name+' · '+fmt(dataset.records.length)+' 筆':'選擇表格即可分析。'):(demo?'目前顯示示範銷售資料。可匯入 Notebook 結果查看實際預測。':walmartSource);
}
function selection(data,config) {
  const query=config.query.trim().toLowerCase();
  const visible=data.records.filter(r=>!query || r.some(v=>String(v??'').toLowerCase().includes(query)));
  const buckets=new Map();
  for (const r of visible) {
    const label=config.group<0?'全部':String(r[config.group]??'').trim() || '（空白）';
    if(!buckets.has(label)) buckets.set(label,{label,count:0,value:0,valid:0,pairDelta:0,pairs:0});
    const b=buckets.get(label);
    b.count++;
    const v=config.metric<0?1:numberValue(r[config.metric]);
    if(v===null) continue;
    b.value+=v;b.valid++;
    const reference=config.compare<0?null:numberValue(r[config.compare]);
    if(reference!==null){b.pairDelta+=v-reference;b.pairs++}
  }
  const ranked=[...buckets.values()].sort((a,b)=>Number(!!b.valid)-Number(!!a.valid)||b.value-a.value);
  return {visible,ranked};
}
function renderExplorer() {
  $('title').textContent='自訂資料分析';$('crumb').textContent='自訂資料分析';
  $('subtitle').textContent='選擇要比較的欄位，查看各組總量與差異。';
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  if(!dataset){
    $('content').innerHTML='<section class="card upload-box"><h2>選擇要分析的表格</h2><p>支援 Excel（XLSX、XLS）、CSV、TSV、JSON。</p><button class="primary" onclick="openImport()">匯入資料</button></section>';return;
  }
  const {columns}=dataset;
  const {visible,ranked}=selection(dataset,settings);
  const valid=ranked.reduce((t,g)=>t+g.valid,0);
  const total=ranked.reduce((t,g)=>t+g.value,0);
  const metric=settings.metric<0?'筆數':columns[settings.metric];
  const largest=ranked.filter(b=>b.pairs).sort((a,b)=>Math.abs(b.pairDelta)-Math.abs(a.pairDelta))[0];
  const top=ranked.filter(b=>b.valid).slice(0,8);
  const scale=Math.max(1,...top.map(b=>Math.abs(b.value)));
  const controls='<div class="period-controls"><label>分組依據<select id="grp">'+columnOptions(columns,settings.group,'合併全部資料')+'</select></label><label>加總指標<select id="met">'+columnOptions(columns,settings.metric,'計算筆數')+'</select></label><label>比較基準<select id="ref" '+(settings.metric<0?'disabled':'')+'>'+columnOptions(columns,settings.compare,'無比較基準')+'</select></label><label>搜尋全部欄位<input id="query" value="'+esc(settings.query)+'" placeholder="輸入關鍵字"></label></div>';
  $('content').innerHTML=controls+'<div class="stats">'+stat('符合條件',fmt(visible.length),'資料列數','▦')+
    stat(esc(metric)+'合計',valid?fmt(total,2):'—','有效 '+fmt(valid)+' 筆','Σ')+
    stat('指標最高組別',esc(top[0]?.label??'—'),top.length?fmt(top[0].value,2):'無有效數值','↑')+
    stat('差額最大組別',esc(largest?.label??'—'),largest?'指標 − 基準：'+fmt(largest.pairDelta,2)+'（'+largest.pairs+' 筆）':'可選擇同單位的比較基準','↕')+'</div>'+
    '<section class="card"><h2>'+esc(metric)+'分組排名</h2><p>依合計由高到低，最多顯示 8 組。空白與非數字不計入數值合計。</p>'+
    (top.map(b=>'<div class="rank-row"><span>'+esc(b.label)+'</span><span class="rank-track"><i style="width:'+Math.abs(b.value)/scale*100+'%;background:'+(b.value<0?'#b15d44':'#1372c7')+'"></i></span><b>'+fmt(b.value,2)+'</b></div>').join('')||'<p>沒有可計算的資料</p>')+'</section>'+
    '<section class="card details-grid"><div class="card-head"><h2>原始明細</h2><span>'+fmt(visible.length)+' 筆</span></div>'+
    tableView(columns,visible.slice(settings.offset,settings.offset+25))+
    '<div class="pager"><button id="prev" '+(settings.offset?'':'disabled')+'>上一頁</button><span>'+(visible.length?settings.offset+1:0)+'–'+Math.min(visible.length,settings.offset+25)+'</span><button id="next" '+(settings.offset+25>=visible.length?'disabled':'')+'>下一頁</button></div></section>';
  for(const [id,key] of [['grp','group'],['met','metric'],['ref','compare']]) $(id).onchange=e=>{
    settings[key]=Number(e.target.value);if(settings.metric<0) settings.compare=-1;settings.offset=0;render();$(id).focus();
  };
  $('query').oninput=e=>{settings.query=e.target.value;settings.offset=0;const cursor=e.target.selectionStart;render();$('query').focus();$('query').setSelectionRange(cursor,cursor)};
  $('prev').onclick=()=>{settings.offset-=25;render()};$('next').onclick=()=>{settings.offset+=25;render()};
}
function showDialog(title,body) {
  const dialog=$('wizard');
  dialog.innerHTML='<div class="card-head"><h2 id="dialog-title">'+title+'</h2><button id="dismiss" aria-label="關閉">×</button></div>'+body+'<p id="dialog-error" role="alert"></p>';
  $('dismiss').onclick=()=>dialog.close();
  if(!dialog.open) dialog.showModal();
}
function exportData() {
  const general=page==='explore';
  if(general && !dataset)return toast('請先匯入資料。');
  const filteredRows=general?selection(dataset,settings).visible:filtered();

  showDialog('匯出資料','<label>資料範圍<select id="scope"><option value="filtered" '+(filteredRows.length?'': 'disabled')+'>目前篩選明細</option><option value="all">完整資料</option>'+
    (general?'<option value="summary">目前分組摘要</option>':page==='overview'?'<option value="window">畫面上的歷史與預測週</option>':'')+
    '</select></label><label>檔案格式<select id="format"><option>CSV</option><option>TSV</option><option>JSON</option></select></label><button id="save" class="primary">下載</button>');
  $('save').onclick=()=>{
    const scope=$('scope').value,format=$('format').value.toLowerCase();
    let columns,records;
    if(scope==='summary'){
      const {ranked}=selection(dataset,settings);
      columns=['組別','筆數','有效數值筆數','指標合計'];
      if(settings.compare>=0)columns.push('配對筆數','指標減基準');
      records=ranked.map(b=>[b.label,b.count,b.valid,b.valid?b.value:null,...(settings.compare>=0?[b.pairs,b.pairs?b.pairDelta:null]:[])]);
    } else if(scope==='window'){
      const w=weeklyWindow(filteredRows,$('model').value);
      columns=['週別','階段','實績','P10','P50','P90','時序數'];
      records=[...w.past.map(b=>[b.date,'歷史',b.actual,null,null,null,b.count]),...w.next.map(b=>[b.date,'預測',null,b.low,b.mid,b.high,b.count])];
    } else if(general){columns=dataset.columns;records=scope==='all'?dataset.records:filteredRows}
    else {const source=scope==='all'?rows:filteredRows;columns=Object.keys(source[0]);records=source.map(r=>columns.map(c=>r[c]))}
    const url=URL.createObjectURL(new Blob([encodedTable(columns,records,format)],{type:format==='json'?'application/json':'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=(general?dataset.name.replace(/\.[^.]+$/,''):(demo?'demo_predictions':'predictions'))+'_'+scope+'.'+format;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);$('wizard').close();toast('已匯出 '+fmt(records.length)+' 筆');
  };
}

$('export').onclick=exportData;
syncWorkspace();





