/**
 * micro:bit 온도 탐구실 — 학생용 읽기 전용 Apps Script 웹 앱 (v1.0)
 *
 * 교사용 수집 Apps Script와는 별개의 새 프로젝트에 붙여넣으세요.
 * 이 프로젝트는 측정 데이터를 읽기만 합니다. doPost(), setValues() 등이 없습니다.
 * 기존 교사용 데이터 시트: Measurements
 *
 * 공유 URL: https://script.google.com/macros/s/.../exec?session=<실험 UUID>
 */
const VIEWER_SPREADSHEET_ID = '여기에_기존_측정_스프레드시트_ID_입력';
const VIEWER_SHEET_NAME = 'Measurements';
const VIEWER_ROWS_PER_PAGE = 1200;
const VIEWER_HEADERS = [
  'record_id','session_id','session_name','class_label','device_id','group',
  'side','temperature_c','measured_at','device_ms','saved_at','batch_id'
];

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const template = HtmlService.createTemplateFromFile('Index');
  const id = String(params.session || '').trim();
  template.sessionId = viewerValidId_(id) ? id : '';
  const group = Number(params.group || 1);
  template.initialGroup = Number.isInteger(group) && group >= 1 && group <= 6 ? group : 1;
  return template.evaluate()
    .setTitle('마이크로비트 온도 탐구실 | 학생용 데이터 조회')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function viewerValidId_(id) {
  // Existing teacher GitHub Pages uses crypto.randomUUID().
  return /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(String(id || ''));
}

function viewerSheet_() {
  if (VIEWER_SPREADSHEET_ID.indexOf('여기에_') === 0) {
    throw new Error('학생용 Code.gs에서 VIEWER_SPREADSHEET_ID를 먼저 설정해 주세요.');
  }
  const sheet = SpreadsheetApp.openById(VIEWER_SPREADSHEET_ID)
    .getSheetByName(VIEWER_SHEET_NAME);
  if (!sheet) throw new Error('Measurements 시트를 찾지 못했습니다. 기존 측정 스프레드시트를 확인해 주세요.');
  const headers = sheet.getRange(1, 1, 1, VIEWER_HEADERS.length).getDisplayValues()[0];
  for (let i = 0; i < VIEWER_HEADERS.length; i++) {
    if (headers[i] !== VIEWER_HEADERS[i]) {
      throw new Error('Measurements 시트 열 구성이 기존 데이터 형식과 다릅니다.');
    }
  }
  return sheet;
}

/**
 * HTML Service의 google.script.run으로만 호출합니다.
 * 서버가 반환하는 모든 값은 숫자/문자열/배열/일반 객체입니다 (Date 객체 반환 금지).
 *
 * @param {string} sessionId 공유 링크 안의 UUID
 * @param {number} fromRow 2부터 시작하는 스프레드시트 행 번호 (증분 조회)
 * @return {Object} 해당 실험에 속한 기록과 이어서 읽을 행 번호
 */
function getSessionChunk(sessionId, fromRow) {
  sessionId = String(sessionId || '').trim();
  if (!viewerValidId_(sessionId)) throw new Error('공유 링크의 실험 ID가 올바르지 않습니다.');
  fromRow = Number(fromRow);
  if (!Number.isInteger(fromRow) || fromRow < 2 || fromRow > 10000000) {
    throw new Error('조회할 기록 위치가 올바르지 않습니다.');
  }

  const sheet = viewerSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < fromRow) {
    return {ok:true,sessionId:sessionId,records:[],nextRow:fromRow,
      lastRow:lastRow,hasMore:false,checkedAt:new Date().toISOString()};
  }

  const count = Math.min(VIEWER_ROWS_PER_PAGE, lastRow - fromRow + 1);
  // B~I 8개 열: session_id, session_name, class_label, device_id,
  // group, side, temperature_c, measured_at
  const cache = CacheService.getScriptCache();
  const cacheKey = 'viewer1:' + sessionId + ':' + fromRow + ':' + count;
  let records;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { records = JSON.parse(cached); } catch (err) { records = null; }
  }
  if (!records) {
    const rows = sheet.getRange(fromRow, 2, count, 8).getValues();
    records = [];
    for (let i=0; i<rows.length; i++) {
      const r = rows[i];
      if (String(r[0]) !== sessionId) continue;
      const deviceId = String(r[3]);
      if (!/^[1-6][AB]$/.test(deviceId)) continue;
      const temp = Number(r[6]);
      const date = r[7] instanceof Date ? r[7] : new Date(r[7]);
      if (!Number.isFinite(temp) || temp < -100 || temp > 150 || Number.isNaN(date.getTime())) continue;
      records.push({
        row: fromRow + i,
        deviceId: deviceId,
        temperature: temp,
        measuredAt: date.toISOString(),
        sessionName: String(r[1] || '').slice(0,70),
        classLabel: String(r[2] || '').slice(0,50)
      });
    }
    const serialized = JSON.stringify(records);
    // Cache complete immutable-ish pages to reduce simultaneous student reads.
    // CacheService's per-item size limit is 100 KB; skip larger payloads.
    if (serialized.length < 90000) {
      try { cache.put(cacheKey, serialized, 90); } catch (err) {
        // Cache overflow/temporary failure must never block student access.
      }
    }
  }

  const nextRow = fromRow + count;
  return {ok:true,sessionId:sessionId,records:records,nextRow:nextRow,
    lastRow:lastRow,hasMore:nextRow<=lastRow,checkedAt:new Date().toISOString()};
}

/**
 * 배포 전 소유자 계정으로 실행하여 기존 시트 접근을 확인할 수 있습니다.
 * 데이터를 수정하지 않습니다.
 */
function checkViewerSetup() {
  const sheet = viewerSheet_();
  Logger.log('읽기 전용 연결 성공: ' + sheet.getName() + ' (마지막 행: ' + sheet.getLastRow() + ')');
}
