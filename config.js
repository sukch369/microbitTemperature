// 공개 GitHub Pages 설정: 비밀번호·개인정보·API 비밀키를 넣지 마세요.
// 서버 주소 변경 시 이 파일만 수정하면 됩니다.
window.APP_CONFIG = {
  // 기존 교사용 Google Sheets 데이터 업로드 서버 (기존 설정 유지)
  gasUrl: "https://script.google.com/macros/s/AKfycbwrWK7SrdMfLl-ypL9ZIR1-Hk2n2BC10_4kzh3S03B8Vn9rB9sq6XvAwJrWd97V_G6O/exec",
  // 학생용 읽기 전용 Apps Script 조회 사이트
  studentViewerUrl: "https://script.google.com/macros/s/AKfycbwxDhtuXrTDyUjagCQiYQhfi-M08HDd9jgxswAlbhv9fNUxk9LLaMnnvSZyL4PxIU3o/exec",
  baudRate: 115200,
  syncIntervalMs: 30000,
  viewerIntervalMs: 20000,
  temperatureJumpLimitC: 10,
  temperatureJumpWindowMs: 180000,
  temperatureConfirmToleranceC: 3
};
