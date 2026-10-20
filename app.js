/* micro:bit classroom dashboard (static GitHub Pages client) */
(() => {
  "use strict";
  const C = Object.assign({gasUrl:"",baudRate:115200,syncIntervalMs:30000,viewerIntervalMs:20000,temperatureJumpLimitC:10,temperatureJumpWindowMs:180000,temperatureConfirmToleranceC:3}, window.APP_CONFIG || {});
  const $ = id => document.getElementById(id);
  const DEVICES = Array.from({length:6}, (_,i) => [String(i+1)+'A',String(i+1)+'B']).flat();
  const STATE = { db:null, session:null, localRecords:[], localGroup:1, cloudGroup:1, cloudData:[], cloudSummary:{}, port:null, reader:null, reading:false, syncing:false, refreshing:false, refreshAgain:false, lastReceive:0, misses:0, renderScheduled:false, jsonpSeq:0, qualityProtection:true, lastGood:{}, pendingSuspect:{}, serialLines:[], anomalyCount:0 };
  let refreshTimer, syncTimer, serialTask;

  const now = () => new Date().toISOString();
  const uid = () => crypto.randomUUID();
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
  const configured = () => /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test((C.gasUrl || '').trim());
  const stamp = value => {if(value===null || value===undefined || value==='') return '—'; const d=new Date(value);if(Number.isNaN(d.valueOf()))return '—';return [d.getHours(),d.getMinutes(),d.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');};
  const fullStamp = value => {if(!value) return '—';const d=new Date(value);return Number.isNaN(d.valueOf())?'—':d.toLocaleString('ko-KR',{hour12:false});};
  const fixedTemp = v => v !== null && v !== undefined && Number.isFinite(Number(v)) ? String(Math.round(Number(v))) : '—';
  function announce(message, error=false) {
    const el=$('notice'); el.textContent=message;el.classList.remove('hidden');el.classList.toggle('error',error);
    clearTimeout(announce.timer);announce.timer=setTimeout(()=>el.classList.add('hidden'),8500);
  }
  function failure(err){ console.error(err);announce(err?.message || String(err),true); }
  function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('DB transaction aborted'));});}
  async function openDB(){
    return await new Promise((resolve,reject)=>{
      const r=indexedDB.open('microbit-temperature-dashboard',2);
      r.onupgradeneeded=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions',{keyPath:'id'});
        if(!db.objectStoreNames.contains('readings')){
          const s=db.createObjectStore('readings',{keyPath:'id'});
          s.createIndex('sessionId','sessionId',{unique:false});
        }
        if(!db.objectStoreNames.contains('anomalies')){
          const s=db.createObjectStore('anomalies',{keyPath:'id'});
          s.createIndex('sessionId','sessionId',{unique:false});
        }
      };
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
  }
  async function allSessions(){return await req(STATE.db.transaction('sessions').objectStore('sessions').getAll());}
  async function saveSession(s){const tx=STATE.db.transaction('sessions','readwrite');tx.objectStore('sessions').put(s);await txDone(tx);}
  async function getSession(id){return await req(STATE.db.transaction('sessions').objectStore('sessions').get(id));}
  async function getSessionRecords(id){
    return await req(STATE.db.transaction('readings').objectStore('readings').index('sessionId').getAll(IDBKeyRange.only(id)));
  }
  async function allReadings(){return await req(STATE.db.transaction('readings').objectStore('readings').getAll());}
  async function getSessionAnomalies(id){return await req(STATE.db.transaction('anomalies').objectStore('anomalies').index('sessionId').getAll(IDBKeyRange.only(id)));}
  async function saveAnomaly(deviceId,temperature,reason,raw){
    const entry={id:uid(),sessionId:STATE.session.id,deviceId,temperature,reason,raw,measuredAt:now()};
    const tx=STATE.db.transaction('anomalies','readwrite');tx.objectStore('anomalies').put(entry);await txDone(tx);
    STATE.anomalyCount++;$('stat-anomalies').textContent=STATE.anomalyCount.toLocaleString('ko-KR');
    addSerialLog('⚠ 보류: '+reason);
  }
  function addSerialLog(line){
    STATE.serialLines.push(stamp(now())+'  '+line);
    if(STATE.serialLines.length>150)STATE.serialLines.shift();
    const el=$('serial-log');if(el){el.textContent=STATE.serialLines.slice(-45).join('\n');el.scrollTop=el.scrollHeight;}
  }
  async function insertReading(r){const tx=STATE.db.transaction('readings','readwrite');tx.objectStore('readings').put(r);await txDone(tx);}
  async function patchReadings(ids, changes){
    const tx=STATE.db.transaction('readings','readwrite'), store=tx.objectStore('readings');
    for (const id of ids) {
      const value=await req(store.get(id));
      if(value)store.put(Object.assign(value,changes));
    }
    await txDone(tx);
  }
  async function removeSession(id){
    const records=await getSessionRecords(id);
    const anomalies=await getSessionAnomalies(id);
    const tx=STATE.db.transaction(['readings','sessions','anomalies'],'readwrite');
    for(const r of records)tx.objectStore('readings').delete(r.id);
    for(const a of anomalies)tx.objectStore('anomalies').delete(a.id);
    tx.objectStore('sessions').delete(id);
    await txDone(tx);
  }
  function newSession(){return {id:uid(),name:'온도 변화 탐구',classLabel:'과학실',createdAt:now()};}
  async function initSessions(){
    const sessions=await allSessions();
    const activeId=localStorage.getItem('microbit_active_session');
    STATE.session=sessions.find(s=>s.id===activeId) || sessions.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    if(!STATE.session){STATE.session=newSession();await saveSession(STATE.session);}
    await selectSession(STATE.session.id);
  }
  async function renderSessionOptions(){
    const list=(await allSessions()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const select=$('local-sessions');select.replaceChildren();
    for(const s of list){const op=new Option(`${s.name} · ${new Date(s.createdAt).toLocaleDateString('ko-KR')}`,s.id);select.add(op);}
    select.value=STATE.session.id;
  }
  async function selectSession(id){
    const s=await getSession(id);if(!s)return;
    STATE.session=s;localStorage.setItem('microbit_active_session',s.id);
    $('experiment-name').value=s.name;$('class-label').value=s.classLabel;
    $('session-id-short').textContent=`실험 ID: ${s.id.slice(0,8)}...`;
    $('active-experiment-name').textContent=s.name;
    STATE.localRecords=(await getSessionRecords(s.id)).sort((a,b)=>a.measuredAt.localeCompare(b.measuredAt));
    STATE.lastGood={};STATE.pendingSuspect={};
    for(const r of STATE.localRecords){STATE.lastGood[r.deviceId]={temperature:r.temperature,at:Date.parse(r.measuredAt)};}
    STATE.anomalyCount=(await getSessionAnomalies(s.id)).length;
    $('stat-anomalies').textContent=STATE.anomalyCount.toLocaleString('ko-KR');
    await renderSessionOptions();renderLocal();
  }
  async function commitSession(){
    const name=$('experiment-name').value.trim();
    if(!name)throw Error('실험 이름을 입력하세요.');
    STATE.session.name=name;STATE.session.classLabel=$('class-label').value.trim();
    await saveSession(STATE.session);await renderSessionOptions();
    $('active-experiment-name').textContent=STATE.session.name;
    announce('실험 정보를 저장했습니다.');
  }
  async function copyUrl(){
    await commitSession();
    await navigator.clipboard.writeText(STATE.session.id);
    announce('실험 ID를 복사했습니다. 학생용 Apps Script 전용 공유 링크는 다음 단계에서 연결됩니다.');
  }
  function currentView(){return $('collect-view').classList.contains('hidden')?'share':'collect';}
  function showView(view, updateUrl=true){
    const shared=view==='share';$('collect-view').classList.toggle('hidden',shared);$('share-view').classList.toggle('hidden',!shared);
    // v1.2 교사용 화면에서 탭 메뉴 제거. 기존 ?view=share 링크는 전환 기간에만 유지.
    $('tab-collect')?.classList.toggle('active',!shared);
    $('tab-share')?.classList.toggle('active',shared);
    if(shared){
      if(!$('viewer-session').value.trim() && STATE.session)$('viewer-session').value=STATE.session.id;
      if(updateUrl){const u=new URL(location.href);u.searchParams.set('view','share');u.searchParams.set('session',$('viewer-session').value.trim());u.searchParams.set('group',String(STATE.cloudGroup));history.replaceState({},'',u);}
      refreshCloud().catch(failure);
    } else if(updateUrl){history.replaceState({},'',location.pathname);setTimeout(renderLocal,50);}
  }
  function sourceLatest(records){
    const result={};for(const r of records){if(DEVICES.includes(r.deviceId)&&(!result[r.deviceId]||r.measuredAt>=result[r.deviceId].measuredAt))result[r.deviceId]=r;}return result;
  }
  function drawCards(target,latest,selected,onSelect){
    const container=$(target);container.replaceChildren();
    for(let g=1;g<=6;g++){
      const card=document.createElement('button');card.type='button';card.className='group-card'+(selected===g?' selected':'');
      const a=latest[`${g}A`],b=latest[`${g}B`];
      const last=[a?.measuredAt,b?.measuredAt].filter(Boolean).sort().pop();
      const recent=last ? (Date.now()-new Date(last).getTime()>120000?'수신 지연':`${stamp(last)} 수신`) : '수신 전';
      card.innerHTML=`<div class="row"><span class="group-name">${g}모둠</span><span class="recent">${recent}</span></div><div class="sensors"><span class="sensor"><b>A</b><strong class="${a?'':'none'}">${a?fixedTemp(a.temperature):'—'}</strong><small>°C</small></span><span class="sensor"><b>B</b><strong class="${b?'':'none'}">${b?fixedTemp(b.temperature):'—'}</strong><small>°C</small></span></div>`;
      card.addEventListener('click',()=>onSelect(g));container.append(card);
    }
  }
  function drawHistory(tbodyId, records, syncedColumn){
    const tbody=$(tbodyId);tbody.replaceChildren();
    if(!records.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=syncedColumn?4:3;td.textContent='조회된 데이터가 없습니다.';tr.append(td);tbody.append(tr);return;}
    for(const r of [...records].sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt)).slice(0,20)){
      const tr=document.createElement('tr');
      const parts=[fullStamp(r.measuredAt),r.deviceId,fixedTemp(r.temperature)+' °C'];
      if(syncedColumn)parts.push(r.syncState==='synced'?'완료':'대기');
      for(const v of parts){const td=document.createElement('td');td.textContent=v;tr.append(td);}tbody.append(tr);
    }
  }
  // 전체 수집 기간을 표시합니다. y축은 정수 눈금만 사용합니다.
  function chart(canvasId, records, group){
    const canvas=$(canvasId),ctx=canvas.getContext('2d');
    const width=Math.max(canvas.clientWidth,200),height=Math.max(canvas.clientHeight,200);
    const dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    const pts=records.filter(r=>r.group===group &&
      Number.isFinite(Number(r.temperature)) && Number.isFinite(Date.parse(r.measuredAt)))
      .sort((a,b)=>a.measuredAt.localeCompare(b.measuredAt));
    $(canvasId+'-empty').classList.toggle('hidden',pts.length!==0);
    const pad={left:49,right:15,top:17,bottom:40};
    const plotW=Math.max(1,width-pad.left-pad.right),plotH=Math.max(1,height-pad.top-pad.bottom);
    if(!pts.length){
      ctx.fillStyle='#7b8c97';ctx.font='13px system-ui';ctx.textAlign='center';
      ctx.fillText('측정 대기 중',width/2,height/2);
      return;
    }
    // min/max는 spread( ...values )를 피하여 장시간 실험에서도 안전하게 계산합니다.
    let minV=Infinity,maxV=-Infinity,tmin=Infinity,tmax=-Infinity;
    for(const p of pts){
      const temp=Number(p.temperature),time=Date.parse(p.measuredAt);
      minV=Math.min(minV,temp);maxV=Math.max(maxV,temp);
      tmin=Math.min(tmin,time);tmax=Math.max(tmax,time);
    }
    const magnitude=Math.max(1,Math.ceil((maxV-minV+2)/6));
    const scale=Math.pow(10,Math.floor(Math.log10(magnitude)));
    const normalized=magnitude/scale;
    const step=normalized<=1?scale:normalized<=2?2*scale:normalized<=5?5*scale:10*scale;
    const minTick=Math.floor((minV-1)/step)*step,maxTick=Math.ceil((maxV+1)/step)*step;
    const lo=minTick,hi=Math.max(maxTick,minTick+step);
    // 한 점뿐일 때에도 중앙에 표시하고 시간 레이블을 명확히 합니다.
    const oneInstant=tmax===tmin;
    if(oneInstant){tmin-=30000;tmax+=30000;}
    const x=t=>pad.left+(t-tmin)/(tmax-tmin)*plotW;
    const y=v=>pad.top+(hi-v)/(hi-lo)*plotH;
    ctx.font='12px system-ui';ctx.fillStyle='#718592';ctx.textAlign='right';ctx.textBaseline='middle';
    for(let tick=lo;tick<=hi+step/10;tick+=step){
      const py=y(tick);
      ctx.strokeStyle='#e3eaed';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(pad.left,py);ctx.lineTo(width-pad.right,py);ctx.stroke();
      ctx.fillText(String(Math.round(tick)),pad.left-9,py);
    }
    ctx.textAlign='center';ctx.textBaseline='top';
    const tickCount=width<450?2:4;
    for(let i=0;i<=tickCount;i++){
      const tt=tmin+(tmax-tmin)*i/tickCount;
      ctx.fillText(stamp(tt),x(tt),height-pad.bottom+12);
    }
    for(const [side,color] of [['A','#098e95'],['B','#e58b3c']]){
      const subset=pts.filter(r=>r.side===side);
      if(!subset.length)continue;
      ctx.save();ctx.beginPath();ctx.rect(pad.left-2,pad.top-3,plotW+4,plotH+6);ctx.clip();
      ctx.strokeStyle=color;ctx.lineWidth=2.6;ctx.lineJoin='round';
      ctx.beginPath();
      let previousTime=null;
      for(const r of subset){
        const time=Date.parse(r.measuredAt),px=x(time),py=y(Number(r.temperature));
        // 20초 기본 수집 주기에서 누락된 1회 이상의 구간은 잇지 않습니다.
        if(previousTime===null || time-previousTime>35000)ctx.moveTo(px,py);
        else ctx.lineTo(px,py);
        previousTime=time;
      }
      ctx.stroke();
      // 긴 실험은 점 표식 수만 제한하고 선의 전체 기간 데이터는 모두 표시합니다.
      const markEvery=Math.max(1,Math.ceil(subset.length/300));
      for(let i=0;i<subset.length;i+=markEvery){
        const r=subset[i];ctx.fillStyle=color;ctx.beginPath();
        ctx.arc(x(Date.parse(r.measuredAt)),y(Number(r.temperature)),2.2,0,Math.PI*2);ctx.fill();
      }
      const last=subset[subset.length-1];ctx.fillStyle=color;ctx.beginPath();
      ctx.arc(x(Date.parse(last.measuredAt)),y(Number(last.temperature)),2.8,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
  }
  function renderLocal(){
    const records=STATE.localRecords,latest=sourceLatest(records);
    drawCards('local-groups',latest,STATE.localGroup,g=>{STATE.localGroup=g;renderLocal();});
    $('local-chart-title').textContent=`${STATE.localGroup}모둠 온도 변화`;
    chart('local-chart',records,STATE.localGroup);
    const synced=records.filter(r=>r.syncState==='synced').length;
    $('stat-total').textContent=records.length.toLocaleString('ko-KR');$('stat-synced').textContent=synced.toLocaleString('ko-KR');$('stat-pending').textContent=(records.length-synced).toLocaleString('ko-KR');
    $('stat-last').textContent=stamp(records[records.length-1]?.measuredAt);
    $('local-last-updated').textContent=records.length?`마지막 기록 ${stamp(records[records.length-1].measuredAt)}`:'데이터 수신 대기';
    $('sync-status').textContent=!configured()?'Apps Script 미설정':STATE.syncing?'동기화 중':records.length-synced?'동기화 대기':'동기화 완료';
    drawHistory('local-history',records,true);
  }
  function scheduleLocalRender(){if(STATE.renderScheduled)return;STATE.renderScheduled=true;setTimeout(()=>{STATE.renderScheduled=false;if(currentView()==='collect')renderLocal();},400);}
  // 급격한 변화는 센서/실험 조건에 따라 진짜일 수도 있으므로 첫 번째 값만 보류합니다.
  // 같은 큰 변동이 연속 두 차례 나타나면 정상적인 빠른 온도 변화로 판단하여 허용합니다.
  function checkAnomaly(deviceId,temperature){
    if(!STATE.qualityProtection)return null;
    const last=STATE.lastGood[deviceId],t=Date.now();
    if(!last||t-last.at>C.temperatureJumpWindowMs)return null;
    const delta=Math.abs(temperature-last.temperature);
    if(delta<=C.temperatureJumpLimitC){delete STATE.pendingSuspect[deviceId];return null;}
    const pending=STATE.pendingSuspect[deviceId];
    if(pending && t-pending.at<=C.temperatureJumpWindowMs &&
       Math.abs(pending.temperature-temperature)<=C.temperatureConfirmToleranceC){
      delete STATE.pendingSuspect[deviceId];
      addSerialLog(`✓ 연속 확인: ${deviceId} ${temperature}°C (큰 온도 변화 확정)`);
      return null;
    }
    STATE.pendingSuspect[deviceId]={temperature,at:t};
    return `${deviceId} ${fixedTemp(last.temperature)}°C → ${fixedTemp(temperature)}°C (${fixedTemp(delta)}°C 변동)`;
  }
  async function saveMeasurement(deviceId,temperature,deviceMs,rawLine){
    const g=Number(deviceId[0]),side=deviceId[1];
    if(g<1||g>6||!['A','B'].includes(side)||!Number.isFinite(temperature)||temperature< -100||temperature>150){
      await saveAnomaly(deviceId,temperature,'온도 범위 또는 장치 ID 오류',rawLine);return;
    }
    const reason=checkAnomaly(deviceId,temperature);
    if(reason){await saveAnomaly(deviceId,temperature,reason,rawLine);return;}
    const r={id:uid(),sessionId:STATE.session.id,sessionName:STATE.session.name,classLabel:STATE.session.classLabel,deviceId,group:g,side,temperature,deviceMs,measuredAt:now(),syncState:'queued',batchId:null};
    await insertReading(r);STATE.lastReceive=Date.now();
    STATE.lastGood[deviceId]={temperature,at:Date.now()};
    if(STATE.session.id===r.sessionId)STATE.localRecords.push(r);
    scheduleLocalRender();
  }
  function parseSerialLine(line){
    const text=line.trim();if(!text)return null;
    const m=/^DATA\s*,\s*([1-6][AB])\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(\d+))?\s*$/i.exec(text);
    if(m)return {kind:'DATA',deviceId:m[1].toUpperCase(),temperature:Number(m[2]),deviceMs:m[3]?Number(m[3]):null};
    const miss=/^MISS\s*,\s*([1-6][AB])/i.exec(text);if(miss)return {kind:'MISS',deviceId:miss[1].toUpperCase()};
    return {kind:'OTHER',text};
  }
  async function serialLoop(port){
    const decoder=new TextDecoder();let buffer='';
    try {
      while(STATE.reading && port.readable){
        const reader=port.readable.getReader();STATE.reader=reader;
        try{
          while(STATE.reading){
            const {value,done}=await reader.read();if(done)break;if(!value)continue;
            buffer+=decoder.decode(value,{stream:true});
            if(buffer.length>10000)buffer=buffer.slice(-2000);
            let nl;while((nl=buffer.indexOf('\n'))!==-1){
              const line=buffer.slice(0,nl).replace(/\r/g,'');buffer=buffer.slice(nl+1);
              addSerialLog(line);
              const result=parseSerialLine(line);
              if(result?.kind==='DATA')await saveMeasurement(result.deviceId,result.temperature,result.deviceMs,line);
              else if(result?.kind==='MISS')STATE.misses++;
            }
          }
        }finally{reader.releaseLock();STATE.reader=null;}
        if(STATE.reading)break;
      }
    }catch(err){if(STATE.reading)announce('USB 데이터 수신이 중단되었습니다: '+err.message,true);}
    finally{
      STATE.reading=false;$('serial-badge').textContent='USB 연결 해제';$('connect').disabled=false;$('disconnect').disabled=true;
      try{await port.close();}catch(_){/* 포트가 이미 해제됨 */}
      if(STATE.port===port)STATE.port=null;
    }
  }
  async function connectSerial(){
    if(!('serial' in navigator))throw Error('이 브라우저에서 Web Serial을 사용할 수 없습니다. PC용 Chrome/Edge의 HTTPS 페이지를 사용하세요.');
    if(STATE.reading)return;
    await commitSession();
    const port=await navigator.serial.requestPort();
    await port.open({baudRate:C.baudRate});STATE.port=port;STATE.reading=true;
    $('serial-badge').textContent='USB 연결됨';$('connect').disabled=true;$('disconnect').disabled=false;
    announce('USB 시리얼 연결 성공. 교사용 마이크로비트의 DATA 출력을 기다립니다.');
    serialTask=serialLoop(port);
  }
  async function disconnectSerial(){
    if(!STATE.port)return;STATE.reading=false;
    try{await STATE.reader?.cancel();}catch(_){/* 종료 처리 */}
    await serialTask;
  }
  function jsonp(mode,params={}){
    return new Promise((resolve,reject)=>{
      if(!configured()){reject(Error('config.js에 Apps Script /exec 주소를 입력해야 합니다.'));return;}
      const callback=`microbit_jsonp_${Date.now()}_${++STATE.jsonpSeq}`;
      const u=new URL(C.gasUrl);u.searchParams.set('mode',mode);u.searchParams.set('callback',callback);
      for(const [key,val] of Object.entries(params))u.searchParams.set(key,String(val));
      const tag=document.createElement('script');let done=false;
      const cleanup=()=>{if(done)return;done=true;clearTimeout(timer);tag.remove();delete window[callback];};
      const timer=setTimeout(()=>{cleanup();reject(Error('Apps Script 응답 시간 초과. 배포 및 공개 권한을 확인하세요.'));},15000);
      window[callback]=payload=>{cleanup();if(payload?.ok===false)reject(Error(payload.error || '서버 오류'));else resolve(payload);};
      tag.onerror=()=>{cleanup();reject(Error('Apps Script 서버 조회 실패. URL 및 웹 앱 접근 권한 확인'));};
      tag.src=u.href;document.head.appendChild(tag);
    });
  }
  async function makeBatch(){
    const records=(await allReadings()).filter(r=>r.syncState!=='synced').sort((a,b)=>a.measuredAt.localeCompare(b.measuredAt));
    if(!records.length)return null;
    const pending=records.find(r=>r.batchId);
    let selected,batchId;
    if(pending){batchId=pending.batchId;selected=records.filter(r=>r.batchId===batchId).slice(0,80);}
    else {
      batchId=uid();const sessionId=records[0].sessionId;
      selected=records.filter(r=>r.syncState==='queued'&&r.sessionId===sessionId).slice(0,80);
      await patchReadings(selected.map(r=>r.id),{syncState:'pending',batchId});
    }
    return {batchId,records:selected};
  }
  function outgoing(r){
    return {id:r.id,sessionId:r.sessionId,sessionName:r.sessionName,classLabel:r.classLabel,
      deviceId:r.deviceId,temperature:r.temperature,measuredAt:r.measuredAt,deviceMs:r.deviceMs};
  }
  async function syncNow(){
    if(STATE.syncing)return;if(!configured()){announce('config.js의 gasUrl을 먼저 설정해 주세요.',true);return;}
    STATE.syncing=true;renderLocal();
    try{
      let confirmed=0;
      for(let i=0;i<5;i++){
        const batch=await makeBatch();if(!batch)break;
        // 마지막 전송의 성공 확인을 못 받은 배치라면 먼저 저장 여부를 조회합니다.
        let receipt=await jsonp('receipt',{batch:batch.batchId});
        if(!receipt.found){
          await fetch(C.gasUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'append',batchId:batch.batchId,records:batch.records.map(outgoing)})});
          // no-cors 응답은 저장 성공을 의미하지 않습니다. 별도 조회로 검증합니다.
          for(let retry=0;retry<4;retry++){
            await delay(1200+retry*600);
            receipt=await jsonp('receipt',{batch:batch.batchId});if(receipt.found)break;
          }
        }
        if(!receipt.found){announce('전송 결과가 아직 확인되지 않았습니다. 로컬 기록은 유지되며 다음 동기화 때 재확인합니다.',true);break;}
        await patchReadings(batch.records.map(r=>r.id),{syncState:'synced'});
        confirmed+=batch.records.length;
        for(const r of STATE.localRecords){if(r.batchId===batch.batchId)r.syncState='synced';}
        // 현재 localRecords에는 최초 batchId가 갱신되지 않았을 수 있어 동기화 상태를 다시 읽습니다.
        STATE.localRecords=await getSessionRecords(STATE.session.id);
      }
      if(confirmed)announce(`${confirmed}개 측정값의 스프레드시트 저장을 확인했습니다.`);
    }catch(err){failure(err);}
    finally{STATE.syncing=false;renderLocal();}
  }
  async function refreshCloud(){
    if(STATE.refreshing){STATE.refreshAgain=true;return;}
    const sessionId=$('viewer-session').value.trim();if(!sessionId){$('viewer-updated').textContent='공유 링크의 실험 ID를 입력하세요.';return;}
    if(!configured()){$('viewer-updated').textContent='config.js에 Apps Script URL이 설정되지 않았습니다.';return;}
    STATE.refreshing=true;$('viewer-badge').textContent='불러오는 중';
    try{
      const data=await jsonp('data',{session:sessionId,group:STATE.cloudGroup,limit:350});
      STATE.cloudData=(data.records||[]).map(r=>Object.assign({},r,{group:Number(r.group)}));
      STATE.cloudSummary=data.summary||{};
      drawCards('cloud-groups',STATE.cloudSummary,STATE.cloudGroup,g=>{STATE.cloudGroup=g;$('viewer-group').value=String(g);updateViewerUrl();refreshCloud().catch(failure);});
      $('cloud-chart-title').textContent=`${STATE.cloudGroup}모둠 온도 변화`;
      chart('cloud-chart',STATE.cloudData,STATE.cloudGroup);
      drawHistory('cloud-history',STATE.cloudData,false);
      $('viewer-updated').textContent=`마지막 조회: ${fullStamp(now())} · 시트에 업로드 완료된 데이터 기준`;
      $('viewer-badge').textContent='구글 시트 연결됨';
    }catch(err){$('viewer-badge').textContent='조회 실패';$('viewer-updated').textContent=err.message;failure(err);}
    finally{STATE.refreshing=false;if(STATE.refreshAgain){STATE.refreshAgain=false;queueMicrotask(()=>refreshCloud().catch(failure));}}
  }
  function updateViewerUrl(){if(currentView()!=='share')return;const url=new URL(location.href);url.searchParams.set('view','share');url.searchParams.set('session',$('viewer-session').value.trim());url.searchParams.set('group',String(STATE.cloudGroup));history.replaceState({},'',url);}
  function csvCell(v){let s=v==null?'':String(v);if(/^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function exportCSV(){
    const records=STATE.localRecords;if(!records.length){announce('백업할 기록이 없습니다.',true);return;}
    const table=[['측정시간','실험ID','실험명','교실','장치ID','모둠','센서','온도(°C)','시리얼시간(ms)','구글동기화','기록ID']];
    for(const r of records)table.push([r.measuredAt,r.sessionId,r.sessionName,r.classLabel,r.deviceId,r.group,r.side,r.temperature,r.deviceMs||'',r.syncState==='synced'?'완료':'대기',r.id]);
    const csv='\ufeff'+table.map(row=>row.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`온도측정_${STATE.session.id.slice(0,8)}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function bind(){
    // 교사용 사이트의 공개 탭은 제거했습니다. 기존 공유 URL은 임시 유지합니다.
    $('local-sessions').addEventListener('change',e=>selectSession(e.target.value).catch(failure));
    $('save-details').addEventListener('click',()=>commitSession().catch(failure));
    $('new-experiment').addEventListener('click',async()=>{
      if(STATE.reading && !confirm('USB가 연결되어 있습니다. 새 실험으로 전환할까요?'))return;
      try{await commitSession();const session=newSession();await saveSession(session);await selectSession(session.id);announce('새 실험을 생성했습니다.');}catch(err){failure(err);}
    });
    $('connect').addEventListener('click',()=>connectSerial().catch(failure));
    $('quality-protection').addEventListener('change',e=>{
      STATE.qualityProtection=e.target.checked;
      STATE.pendingSuspect={};
      announce(STATE.qualityProtection?'급격한 온도 변화 1회 검증을 켰습니다.':'급격한 온도 변화 검증을 해제했습니다. 급변 측정값도 모두 저장합니다.');
    });
    $('copy-serial-log').addEventListener('click',async()=>{
      if(!STATE.serialLines.length){announce('복사할 로그가 없습니다.');return;}
      await navigator.clipboard.writeText(STATE.serialLines.join('\n'));
      announce('USB 원본 로그를 복사했습니다.');
    });
    $('export-anomalies').addEventListener('click',async()=>{
      const list=await getSessionAnomalies(STATE.session.id);
      if(!list.length){announce('현재 실험에 보류된 값이 없습니다.');return;}
      const cells=[['수신시각','장치','수신 온도','보류 사유','원본 시리얼'],...list.map(x=>[x.measuredAt,x.deviceId,x.temperature,x.reason,x.raw])];
      const csv='\ufeff'+cells.map(row=>row.map(csvCell).join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`이상값_점검_${STATE.session.id.slice(0,8)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    });
    $('disconnect').addEventListener('click',()=>disconnectSerial().catch(failure));
    $('sync-now').addEventListener('click',()=>syncNow().catch(failure));
    $('copy-link').addEventListener('click',()=>copyUrl().catch(failure));
    $('export-csv').addEventListener('click',exportCSV);
    $('storage-persist').addEventListener('click',async()=>{
      if(!navigator.storage?.persist){announce('이 브라우저는 영구 저장 요청 기능을 지원하지 않습니다.',true);return;}
      try{const granted=await navigator.storage.persist();announce(granted?'브라우저에서 저장 보호 요청을 허용했습니다. 사용자 직접 삭제까지 막지는 못합니다.':'브라우저에서 저장 보호 요청을 허용하지 않았습니다. CSV 백업을 권장합니다.',!granted);}catch(err){failure(err);}
    });
    $('delete-session').addEventListener('click',async()=>{
      if(STATE.reading){announce('데이터 수집을 종료한 후 삭제해 주세요.',true);return;}
      if(!confirm('현재 실험의 이 PC 로컬 기록을 삭제하시겠습니까? 구글 시트의 데이터는 삭제되지 않습니다.'))return;
      try{const id=STATE.session.id;await removeSession(id);localStorage.removeItem('microbit_active_session');await initSessions();announce('현재 실험의 로컬 기록을 삭제했습니다.');}catch(err){failure(err);}
    });
    $('viewer-refresh').addEventListener('click',()=>{updateViewerUrl();refreshCloud().catch(failure);});
    $('viewer-group').addEventListener('change',e=>{STATE.cloudGroup=Number(e.target.value);updateViewerUrl();refreshCloud().catch(failure);});
    $('viewer-session').addEventListener('change',()=>{updateViewerUrl();refreshCloud().catch(failure);});
    window.addEventListener('resize',()=>{if(currentView()==='collect')renderLocal();else chart('cloud-chart',STATE.cloudData,STATE.cloudGroup);});
    window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);showView(p.get('view')==='share'?'share':'collect',false);});
  }
  async function main(){
    if(!('indexedDB' in window))throw Error('브라우저 IndexedDB를 사용할 수 없습니다.');
    STATE.db=await openDB();await initSessions();bind();
    const p=new URLSearchParams(location.search);STATE.cloudGroup=Math.max(1,Math.min(6,Number(p.get('group'))||1));
    $('viewer-group').value=String(STATE.cloudGroup);
    if(p.get('session'))$('viewer-session').value=p.get('session');
    drawCards('cloud-groups',{},STATE.cloudGroup,g=>{STATE.cloudGroup=g;$('viewer-group').value=String(g);updateViewerUrl();refreshCloud().catch(failure);});
    if(p.get('view')==='share')showView('share',false);
    if(!configured())announce('구글 스프레드시트 연결을 위해 config.js의 gasUrl을 설정해야 합니다. USB·로컬 저장은 별도로 사용할 수 있습니다.');
    syncTimer=setInterval(()=>{if(navigator.onLine)syncNow().catch(failure);},C.syncIntervalMs);
    refreshTimer=setInterval(()=>{if(currentView()==='share'&&navigator.onLine)refreshCloud().catch(failure);},C.viewerIntervalMs);
    if(navigator.storage?.persisted){navigator.storage.persisted().then(yes=>{if(!yes)console.info('사이트 데이터는 브라우저 저장 공간 정책에 따라 삭제될 수 있습니다.');});}
  }
  main().catch(failure);
})();
