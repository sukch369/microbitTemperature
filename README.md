# 마이크로비트 6모둠 온도 탐구실

**버전 1.0 / GitHub Pages + Web Serial + IndexedDB + Google Apps Script + Google Sheets**

## 1. 전체 구조

학생 마이크로비트 12개(1A~6B) → 마이크로비트 무선 → 교사용 마이크로비트 1개 → USB 시리얼 → GitHub Pages를 실행 중인 교사 PC → IndexedDB 로컬 저장 → Apps Script → Google Sheets → GitHub Pages의 공유 화면(모둠별 조회).

교사용 웹사이트는 브라우저의 Web Serial API로 USB 시리얼을 직접 읽습니다. 공유 화면은 USB 없이 사용 가능하며, 구글 시트에 업로드 **완료**된 데이터만 보여줍니다.

## 2. 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 수집 및 공유 화면 |
| `style.css` | 반응형 화면 디자인 |
| `app.js` | Web Serial, IndexedDB, 동기화, 그래프 및 CSV |
| `config.js` | Apps Script `/exec` 주소 및 동기화 주기 설정 |
| `apps-script/Code.gs` | 구글 스프레드시트 저장/조회 웹 API |

## 3. 구글 스프레드시트 만들기

1. 구글 스프레드시트를 새로 만들고 이름을 `마이크로비트 온도 데이터`로 지정합니다.
2. 시트 주소가 `https://docs.google.com/spreadsheets/d/`**`여기_부분`**`/edit`라면 가운데 부분이 스프레드시트 ID입니다.
3. 스프레드시트 메뉴 `확장 프로그램` → `Apps Script`를 열고 기존 코드를 지운 뒤 **`apps-script/Code.gs` 전체**를 붙여넣습니다.
4. 맨 위 `const SPREADSHEET_ID = '여기에_구글_스프레드시트_ID_입력';`를 실제 ID로 변경합니다.
5. 상단 실행 함수에서 `setup`을 선택한 뒤 한 번 실행합니다. Google 권한을 승인하면 `Measurements` 및 `UploadBatches` 시트가 생성됩니다.
6. 오른쪽 상단 `배포` → `새 배포` → `유형: 웹 앱`을 선택합니다.
   - **다음 사용자 인증 정보로 실행: 나(Me)**
   - **액세스 권한: 모든 사용자(Anyone)**. 조직 정책에서 외부 공개가 금지되어 있으면 사용할 수 없으며 학교 보안정책 확인이 필요합니다.
7. 배포를 완료하면 `https://script.google.com/macros/s/.../exec` 형태의 URL을 복사합니다.
8. 이 주소에 `?mode=health`를 추가하여 브라우저에서 열고 `"ok":true`가 나오는지 확인합니다.
9. **주의:** Apps Script `Code.gs`를 수정할 때는 기존 웹 앱 배포를 새 버전으로 업데이트해야 반영됩니다.

## 4. GitHub Pages 업로드

1. GitHub에서 공개 Repository를 새로 만듭니다(예: `microbit-temp`).
2. **루트 폴더**에 `index.html`, `style.css`, `app.js`, `config.js`를 업로드합니다. (`apps-script/Code.gs` 파일도 보관해도 되지만 스프레드시트 ID가 들어 있으므로 공개 저장소에 올리지 않는 편이 좋습니다.)
3. `config.js`의 다음 부분을 3번에서 배포한 웹 앱 주소로 변경합니다.

```js
window.APP_CONFIG = {
  gasUrl: "https://script.google.com/macros/s/여기에_실제_배포_ID/exec",
  baudRate: 115200,
  syncIntervalMs: 30000,
  viewerIntervalMs: 20000
};
```

4. 저장소 `Settings` → `Pages` → `Build and deployment`에서 `Deploy from a branch`, 브랜치 `main`, 폴더 `/(root)`를 설정합니다.
5. 배포된 주소(예: `https://username.github.io/microbit-temp/`)를 PC용 Chrome 또는 Edge에서 엽니다.

## 5. 학생/교사 마이크로비트 프로그램

**이미 정상 작동을 확인한 기존 코드를 그대로 사용**합니다. 교사용 코드는 아래 형식으로 줄 단위 출력하면 됩니다.

```text
REQ,1A
RX,1A,24
DATA,1A,24
REQ,1B
RX,1B,25
DATA,1B,25
MISS,2A
```

- `DATA,1A,24` 또는 `DATA,1A,24,12345`만 저장합니다.
- `REQ`, `RX`는 기록하지 않습니다. `MISS`는 기록하지 않고 개수만 셉니다.
- 시리얼 속도는 기본값 **115200 baud**입니다.
- MakeCode 시리얼 창을 닫고 웹사이트에서 `USB 시리얼 연결` 버튼을 눌러 장치를 선택합니다.
- Chrome/Edge 데스크톱에서 지원되며, 사용자가 포트 연결을 직접 승인해야 합니다.

## 6. 사용 방법

### 교사용 데이터 수집

1. 교사는 `교사용 수집` 화면을 엽니다.
2. `실험 이름`과 익명 `교사/교실 구분`을 작성하고 `실험 정보 저장`을 누릅니다.
3. `USB 시리얼 연결`을 누르고 교사용 마이크로비트를 선택합니다.
4. 수신된 DATA는 **즉시 교사 PC의 IndexedDB**에 보관되고, 6개 모둠 카드와 그래프가 업데이트됩니다.
5. 온라인 상태라면 30초마다 미전송 데이터를 구글 시트로 올립니다. `구글 시트 동기화` 버튼으로 수동 동기화할 수도 있습니다.
6. `현재 실험 CSV 백업`을 눌러 별도 파일로 보존할 수 있습니다.
7. `로컬 저장 보호 요청`을 눌러 브라우저에 지속 저장 권한을 요청할 수 있습니다(브라우저가 허용하지 않을 수 있습니다).
8. `측정 결과 공유 링크 복사`를 눌러 학생에게 전달합니다.

### 학생 또는 다른 교사: 공유 조회

1. 공유받은 링크를 열면 자동으로 `데이터 공유` 화면이 열립니다.
2. 6개 모둠의 A/B 최신 온도값이 나타납니다.
3. 모둠 카드를 누르거나 모둠 선택 메뉴를 바꾸면 해당 모둠의 A/B 그래프가 나타납니다.
4. 공유 데이터는 약 20초마다 자동 갱신됩니다. 그 외에도 Apps Script 캐시(약 10초) 및 구글 시트 업로드 주기로 인한 지연이 있습니다.

**중요:** 공유 URL에는 추측하기 어려운 임의 실험 ID가 들어 있습니다. 비밀번호는 없으므로 링크가 노출되면 데이터를 볼 수 있습니다.

## 7. 시트 구조

**Measurements**: `record_id`, `session_id`, `session_name`, `class_label`, `device_id`, `group`, `side`, `temperature_c`, `measured_at`, `device_ms`, `saved_at`, `batch_id`.

**UploadBatches**: `batch_id`, `saved_at`, `session_id`, `received_count`, `new_count`.

측정값의 고유 ID와 업로드 배치 ID를 사용합니다. `no-cors` POST만으로는 저장 성공을 확인할 수 없으므로, 별도 JSONP GET으로 `UploadBatches`의 저장 여부를 확인하고 나서만 로컬 기록을 `synced`로 바꿉니다. 이미 처리한 배치는 재수신 시 건너뜁니다.

## 8. 제한 및 보안 안내

- **웹 공개:** GitHub Pages 저장소의 `config.js`에는 공개 Apps Script 주소가 노출됩니다. 아무나 조회/기록을 시도할 수 있는 교육용 시범 API입니다. **학생 이름·학번·민감정보를 보내지 마세요.** 실제 학교 전체 보급 시 접근제어를 별도로 설계해야 합니다.
- **Apps Script 제약:** 조직 Google Workspace에서 `모든 사용자` 배포를 허용하지 않으면 이 예제의 공개 데이터 공유 구조는 불가능합니다.
- **네트워크:** 인터넷이 끊겨도 이미 열려 있는 웹사이트에서 USB 수신 및 IndexedDB 저장은 가능합니다. 사이트를 처음 열거나 새로고침하려면 인터넷이 필요할 수 있습니다.
- **로컬 저장:** 브라우저/사용자 프로필마다 독립적이며, 사이트 데이터 삭제, 시크릿 모드 종료, 저장 공간 정책 등에 의해 제거될 수 있습니다.
- **전송 지연:** Apps Script 데이터 읽기는 최근 12,000행을 대상으로 하며, 선택한 모둠의 최근 350개 점을 반환합니다. 데이터가 쌓이면 쿼리 구조를 개선해야 합니다.
- **성능:** 구글 Apps Script 실행량, 동시 접속자, 사용량 제한이 있습니다. 다수 학급이 동시에 쓰는 상용 규모의 서버로 간주하면 안 됩니다.
- **실험 종료:** 수집 화면을 닫으면 시리얼 연결은 종료됩니다. 재접속할 때 USB 권한 재승인이 필요할 수 있습니다.

## 9. 현장 테스트 순서

1. 서버 배포 후 `.../exec?mode=health` 정상 반환 확인.
2. 웹페이지 `교사용 수집`에서 1A·1B의 `DATA`가 로컬에 나타나는지 확인.
3. 동기화 버튼 후 시트 `Measurements`에 기록되는지 확인.
4. `UploadBatches`에 배치 ID가 기록되는지 확인.
5. `시트 동기화 완료` 값 증가 확인.
6. 공유 링크를 **다른 기기**에서 열고 1모둠 그래프가 보이는지 확인.
7. 인터넷을 끊은 상태로 2~3분 수집 후 복구하여 저장이 이어지는지 확인.
8. `구글 시트 동기화`를 반복해도 같은 기록이 중복 저장되지 않는지 확인.

## 10. 개발 상태

코드 정적 점검과 오프라인 브라우저 테스트를 할 수 있도록 제작한 **초기 구현 버전**입니다. 실제 GitHub Pages 및 Apps Script 계정에 대한 배포/권한 설정은 소유자가 진행해야 합니다. 라이브 USB·Google 서비스와 결합한 현장 검증은 별도로 필요합니다.
