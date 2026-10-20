/**
 * micro:bit 6 groups / 12 sensors - Google Apps Script API
 * 1) Create a Google Spreadsheet
 * 2) Paste its ID below
 * 3) Run setup() once and authorize
 * 4) Deploy as Web app, Execute as Me, Anyone (where organization policy permits)
 * Note: PUBLIC DEMO API. Do not include students' names or sensitive data.
 */
const SPREADSHEET_ID = '여기에_구글_스프레드시트_ID_입력';
const DATA_NAME = 'Measurements';
const RECEIPTS_NAME = 'UploadBatches';
const DATA_HEADERS = ['record_id','session_id','session_name','class_label','device_id','group','side','temperature_c','measured_at','device_ms','saved_at','batch_id'];
const BATCH_HEADERS = ['batch_id','saved_at','session_id','received_count','new_count'];

function book_() {
  if (SPREADSHEET_ID.indexOf('여기에_') === 0) throw new Error('Code.gs의 SPREADSHEET_ID를 먼저 설정하세요.');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}
function sheet_(name,headers) {
  const file=book_();
  let sheet=file.getSheetByName(name);
  if(!sheet)sheet=file.insertSheet(name);
  if(sheet.getLastRow()===0){
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#e3eff0');
  }
  return sheet;
}
function setup(){
  const sheet=sheet_(DATA_NAME,DATA_HEADERS);
  sheet.getRange('H:H').setNumberFormat('0.00');
  sheet.getRange('I:I').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange('K:K').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet_(RECEIPTS_NAME,BATCH_HEADERS);
  Logger.log('초기화 성공! 이후 웹 앱으로 배포하세요.');
}
function cleanText_(v,maxLen){
  let s=String(v==null?'':v).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,maxLen);
  // Prevent formula injection in Google Sheets.
  if(/^[=+\-@]/.test(s))s="'"+s;
  return s;
}
function validId_(id){return /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(String(id||''));}
function respond_(obj,callback){
  let serialized=JSON.stringify(obj).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  if(callback){
    // JSONP is for a deliberately public, read-only API. Never evaluate callback text as is.
    if(!/^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/.test(callback))
      return ContentService.createTextOutput(JSON.stringify({ok:false,error:'Invalid callback'})).setMimeType(ContentService.MimeType.JSON);
    return ContentService.createTextOutput(callback+'('+serialized+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(serialized).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e){
  const p=e&&e.parameter||{};
  try{
    switch(p.mode){
      case 'health': return respond_({ok:true,service:'microbit-temperature',time:new Date().toISOString()},p.callback);
      case 'receipt': return respond_({ok:true,found:batchExists_(String(p.batch||''))},p.callback);
      case 'data': return respond_(readSession_(String(p.session||''),Number(p.group||1),Number(p.limit||350)),p.callback);
      default:return respond_({ok:false,error:'Unknown mode. Use ?mode=health'},p.callback);
    }
  }catch(err){return respond_({ok:false,error:String(err.message||err)},p.callback);}
}
function doPost(e){
  try{
    const content=e&&e.postData&&e.postData.contents;
    if(!content||content.length>75000)throw new Error('Missing or oversized payload');
    const body=JSON.parse(content);
    if(body.action!=='append'||!validId_(body.batchId)||!Array.isArray(body.records)||body.records.length<1||body.records.length>80)
      throw new Error('Invalid batch');
    const result=storeBatch_(body);
    return respond_({ok:true,batchId:body.batchId,saved:result});
  }catch(err){return respond_({ok:false,error:String(err.message||err)});}
}
function batchExists_(id){
  if(!validId_(id))return false;
  const sh=sheet_(RECEIPTS_NAME,BATCH_HEADERS);
  if(sh.getLastRow()<2)return false;
  return !!sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).findNext();
}
function storeBatch_(body){
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try{
    if(batchExists_(body.batchId))return 0;
    const sh=sheet_(DATA_NAME,DATA_HEADERS),last=sh.getLastRow();
    // Rescue against crash between writing measurements and receipt.
    const seen=new Set();
    if(last>=2){
      const start=Math.max(2,last-10000+1);
      sh.getRange(start,1,last-start+1,1).getValues().forEach(row=>seen.add(String(row[0])));
    }
    const rows=[],sessionIds=new Set();
    for(const record of body.records){
      if(!validId_(record.id)||!validId_(record.sessionId))throw new Error('Invalid record ID or session ID');
      const device=String(record.deviceId||'');if(!/^[1-6][AB]$/.test(device))throw new Error('Invalid device ID');
      const temperature=Number(record.temperature);
      if(!Number.isFinite(temperature)||temperature< -100||temperature>150)throw new Error('Temperature is out of range');
      const timestamp=new Date(record.measuredAt);
      if(Number.isNaN(timestamp.getTime()))throw new Error('Invalid timestamp');
      if(sessionIds.size>0&&!sessionIds.has(record.sessionId))throw new Error('Mixed sessions in one batch');
      sessionIds.add(record.sessionId);
      if(seen.has(record.id))continue;
      seen.add(record.id);
      const dms=record.deviceMs===null||record.deviceMs===undefined?'':Number(record.deviceMs);
      rows.push([record.id,record.sessionId,cleanText_(record.sessionName,70),cleanText_(record.classLabel,50),device,Number(device[0]),device[1],temperature,timestamp,Number.isFinite(dms)?dms:'',new Date(),body.batchId]);
    }
    if(rows.length){sh.getRange(sh.getLastRow()+1,1,rows.length,DATA_HEADERS.length).setValues(rows);SpreadsheetApp.flush();}
    const receipt=sheet_(RECEIPTS_NAME,BATCH_HEADERS);
    receipt.getRange(receipt.getLastRow()+1,1,1,5).setValues([[body.batchId,new Date(),[...sessionIds][0]||'',body.records.length,rows.length]]);
    SpreadsheetApp.flush();
    return rows.length;
  }finally{lock.releaseLock();}
}
function readSession_(sessionId,group,limit){
  if(!validId_(sessionId))throw new Error('Invalid session ID');
  if(!Number.isInteger(group)||group<1||group>6)throw new Error('Invalid group');
  limit=Math.min(350,Math.max(1,Math.trunc(limit)||350));
  const cache=CacheService.getScriptCache();
  const key='v1_'+sessionId+'_'+group+'_'+limit;
  const cached=cache.get(key);if(cached){try{return JSON.parse(cached);}catch(e){/* cache miss */}}
  const sh=sheet_(DATA_NAME,DATA_HEADERS),last=sh.getLastRow();
  const summary={},records=[];
  if(last>=2){
    // Scan the latest 12,000 rows (pilot-sized deployments). Historical full export remains in Sheet.
    const start=Math.max(2,last-12000+1);
    const rows=sh.getRange(start,1,last-start+1,DATA_HEADERS.length).getValues();
    for(let i=rows.length-1;i>=0;i--){
      const r=rows[i];if(String(r[1])!==sessionId)continue;
      const device=String(r[4]);if(!/^[1-6][AB]$/.test(device))continue;
      const when=r[8] instanceof Date?r[8].toISOString():new Date(r[8]).toISOString();
      const item={id:String(r[0]),deviceId:device,group:Number(r[5]),side:String(r[6]),temperature:Number(r[7]),measuredAt:when};
      if(!summary[device])summary[device]=item;
      if(item.group===group&&records.length<limit)records.push(item);
      if(Object.keys(summary).length===12&&records.length===limit)break;
    }
  }
  records.reverse();
  const output={ok:true,sessionId:sessionId,group:group,summary:summary,records:records,refreshedAt:new Date().toISOString()};
  const s=JSON.stringify(output);if(s.length<90000)cache.put(key,s,10);
  return output;
}
