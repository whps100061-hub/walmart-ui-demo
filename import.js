/* File selection stays visible while parsing and validation errors are resolved. */
let importBook = null;
function openImport() {
  ++latestRead;
  showDialog('匯入資料',
    '<p>選擇 Excel、CSV、TSV 或 JSON。預覽後確認匯入，再選擇分析欄位。</p>'+
    '<label for="import-file">檔案（上限 80 MB）</label>'+
    '<input id="import-file" type="file" accept=".xlsx,.xls,.csv,.tsv,.json">'+
    '<label for="encoding">文字檔編碼</label><select id="encoding"><option value="utf-8">UTF-8</option><option value="big5">繁體中文 Big5</option><option value="utf-16le">UTF-16</option></select>'+
    '<p id="import-status" role="status"></p><div id="sheet-holder"></div><div id="import-preview"></div>');
  $('import-file').onchange = e => loadImport(e.target.files[0]);
  $('encoding').onchange = () => loadImport($('import-file').files[0]);
  $('dismiss').onclick = () => { ++latestRead; $('wizard').close(); };
}
function workbookTable(book, sheetName, filename) {
  const matrix = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {
    header:1, defval:null, blankrows:false, raw:false, dateNF:'yyyy-mm-dd'
  });
  if (matrix.length < 2) throw Error('此工作表需要欄名及至少一列資料，請選擇其他工作表。');
  const columns = Array.from(matrix[0],v => String(v ?? '').trim());
  if (columns.some(c => !c) || new Set(columns).size !== columns.length)
    throw Error('工作表第一列須為非空白且不重複的欄名。');
  const records = matrix.slice(1).map((row,index) => {
    if (row.slice(columns.length).some(v => v !== null && v !== ''))
      throw Error('第 '+(index+2)+' 列含沒有欄名的資料。');
    return columns.map((_,i) => row[i] ?? null);
  });
  return {columns, records, name:filename+' · '+sheetName};
}
function previewImport(parsed) {
  draft = parsed;
  const required = ['Store','Dept','Date','Weekly_Sales','IsHoliday','XYZ',
    'P10_HW','P50_HW','P90_HW','P10_LGBM','P50_LGBM','P90_LGBM'];
  const walmart = required.every(k => draft.columns.includes(k));
  $('import-preview').innerHTML = '<p>'+esc(draft.name)+' · '+fmt(draft.records.length)+' 筆 · '+draft.columns.length+' 欄</p>'+
    tableView(draft.columns,draft.records.slice(0,4))+
    '<label for="mode">分析方式</label><select id="mode"><option value="general">自訂欄位分析</option>'+
    (walmart?'<option value="walmart" selected>Walmart 預測總覽</option>':'')+
    '</select><button class="primary" id="apply">確認匯入並分析</button>';
  $('apply').onclick = () => {
    try {
      if ($('mode').value === 'walmart') {
        const validated = validateCSV(encodedTable(draft.columns,draft.records,'csv'));
        rows=validated; demo=false; cutoff=''; walmartSource=draft.name+' · '+fmt(rows.length)+' 筆';
        page='overview';
        ['store','dept','xyz'].forEach(id => $(id).value='');
        options();
      } else page='explore';
      dataset=draft; settings=defaults(dataset);
      render(); $('wizard').close(); toast('已載入 '+fmt(dataset.records.length)+' 筆資料');
    } catch(e) { $('dialog-error').textContent=e.message+'；也可以選擇自訂欄位分析。'; }
  };
}
async function loadImport(file) {
  if (!file) return;
  const version = ++latestRead;
  $('import-preview').innerHTML='';
  $('sheet-holder').innerHTML='';
  $('dialog-error').textContent='';
  $('import-status').textContent='正在讀取 '+file.name+'…';
  try {
    if (file.size > 80*1024*1024) throw Error('檔案上限為 80 MB。');
    const ext=file.name.toLowerCase().split('.').pop();
    if (!['xlsx','xls','csv','tsv','json'].includes(ext))
      throw Error('支援 XLSX、XLS、CSV、TSV、JSON。請選擇表格檔案。');
    const buffer=await file.arrayBuffer();
    if (version !== latestRead || !$('wizard').open) return;
    if (['xlsx','xls'].includes(ext)) {
      if (typeof XLSX === 'undefined') throw Error('Excel 元件載入失敗，請重新整理網頁再試。');
      importBook=XLSX.read(buffer,{type:'array',cellDates:false,dateNF:'yyyy-mm-dd'});
      if (!importBook.SheetNames.length) throw Error('活頁簿沒有工作表。');
      $('sheet-holder').innerHTML='<label for="sheet">工作表</label><select id="sheet">'+
        importBook.SheetNames.map((name,i)=>'<option value="'+i+'">'+esc(name)+'</option>').join('')+'</select>';
      const chooseSheet=()=>{
        $('import-preview').innerHTML=''; $('dialog-error').textContent='';
        try { previewImport(workbookTable(importBook,importBook.SheetNames[Number($('sheet').value)],file.name)); }
        catch(e) { $('dialog-error').textContent=e.message; }
      };
      $('sheet').onchange=chooseSheet;
      chooseSheet();
    } else {
      let text;
      try { text=new TextDecoder($('encoding').value,{fatal:true}).decode(buffer); }
      catch { throw Error('文字編碼無法讀取，請切換 Big5 或 UTF-16 後重試。'); }
      previewImport(decodeTable(text,file.name));
    }
    $('import-status').textContent='讀取完成，請確認預覽後載入。';
  } catch(e) {
    if (version !== latestRead) return;
    $('import-status').textContent='尚未載入';
    $('dialog-error').textContent=e.message;
  }
}
$('import').onclick=openImport;

