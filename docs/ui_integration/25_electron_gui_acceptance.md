# Electron GUI production 인수 검증

기준일: 2026-07-13 (Asia/Seoul)

실행자: `electron_gui_acceptance_integrator`

## 결론

실제 Electron `BrowserWindow`, preload IPC, 11-tab renderer, 1440×900 및
1024×640 레이아웃, fixture와 승인된 두 production state를 외부망 차단
상태에서 검증했다. 실제 브라우저에서만 재현된 제품 결함도 bounded fix로
수정했다.

- production 목록이 있을 때 nested array를 DOM child로 넘기던 초기 crash
- CSP 부재로 발생하던 Electron product security warning
- 긴 production 목록이 11개 기본 탐색 탭을 가리던 sidebar 구조
- legacy Local Models/Download 표면이 global Settings에서 다시 노출되던 경계
- native folder sheet가 filesystem root에서 열리던 기본 경로 문제
- `file:` renderer의 clipboard 권한에 의존하던 command-copy 경계

fixture와 첫 번째 production은 실제 macOS native folder sheet를 통해
선택되었다. 두 번째 production은 서로 다른 native accept 방식 모두
sheet를 닫았지만 이전 root가 config/state에 남았다. 같은 자동화 반복은
중단했고, 해당 데이터는 승인된 sidebar entry를 통해 preload IPC로
검증했다. 따라서 두 번째 root의 **native selection만 BLOCK**이며, 데이터
reader/IPC/UI 검증을 native PASS로 과장하지 않는다. 반면 trusted command
copy는 main-process clipboard write/read-back과 실제 macOS click으로 별도
검증되어 이전 gap이 닫혔다.

## 승인과 안전 경계

Jessie는 policy `2026-07-12-manager-only-v1` 아래 다음을 현재 회차에
명시적으로 승인했다.

- 외부 네트워크 차단 상태의 Electron 실행/종료
- 격리된 Electron cache/config 쓰기
- GUI 자동화와 screenshot
- fixture 및 승인된 두 production folder의 native 선택

생성, 업로드, 외부 계정, package install/update, builder, deploy/release는
금지 상태를 유지했다. generation/upload/account control은 클릭하지 않았고
`runSafeCommand`도 호출하지 않았다.

## 실제 launch와 네트워크 경계

빌드는 완전 network-denied sandbox에서 실행했다.

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' npm run build
PASS, Vite 36 modules
```

Electron 자동화에는 CDP loopback만 허용한 다음 profile을 사용했다.

```scheme
(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
```

```text
/usr/bin/sandbox-exec -f /tmp/open-generative-ai-electron-loopback.sb \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . \
  --no-sandbox --remote-debugging-port=9223 --remote-allow-origins=* \
  --user-data-dir=/tmp/open-ga-electron-userdata --enable-logging=stderr
```

`sandbox-exec` 안에서 Chromium child sandbox가 `Operation not permitted`로
초기화되지 않아, QA process에만 `--no-sandbox`를 사용했다. 제품 코드와
BrowserWindow security preference는 바꾸지 않았고 전체 Electron process는
위 OS sandbox 안에 유지했다.

검증 결과:

- loopback HTTP probe: PASS
- external DNS/HTTPS: BLOCK
- external IP HTTPS probe: exit 7, 연결 없음
- final reload와 11-tab interaction: `file:` 6건만 관측, external request 0건
- console error 0, console warning 0, unhandled exception 0
- stderr product diagnostic 0
- Chromium `VizNullHypothesis is disabled (not a warning)` 1건은 제품
  console이 아닌 platform diagnostic으로 분리했다.

## preload와 window

- 실제 window title: `Cinematic Pipeline Studio`
- final relaunch main PID: `36950` (회차 한정 runtime evidence)
- 기본 viewport: 1440×900
- narrow viewport: 1024×640 (`BrowserWindow.minWidth/minHeight`)
- `window.filmPipeline`: 존재
- bridge method: 12개 (`copyCommandPreview` 포함)
- mock fallback badge: 없음; `Electron bridge` 표시
- relaunch 후 저장된 fixture/root state 복원: PASS

## dataset matrix

실제 production의 narrative, prompt, media 또는 private metadata는 본 문서에
복사하지 않았다.

| dataset | 진입 방법 | aggregate UI state | final-ready | unsafe enabled control | 결과 |
| --- | --- | --- | --- | --- | --- |
| Layout A fixture | actual native sheet | 16 files, parsed 8, review 1, accepted 1 | UI가 별도 quality evidence를 유지 | 0 | PASS |
| `gangnam_shorts_system_income_20260707` | actual native sheet | 293 files, parsed 4, review 0, accepted 0 | false | 0 | PASS |
| `ep01_apologist` | approved sidebar entry / preload IPC | 524 files, parsed 2, review 0, accepted 0 | false | 0 | DATA/IPC/UI PASS; NATIVE BLOCK |

두 번째 root native 증거:

1. Go-to paste 후 `Enter → Escape → Return`
2. Go-to paste 후 `Enter → Escape → Command-O`

두 방법 모두 sheet close 후 expected root path가 DOM/config에 없었고 첫 번째
production의 293/4/0/0 state가 남았다. 이후 승인된 exact sidebar entry는
expected root path와 524/2/0/0 state를 복원했다.

두 승인 production root의 상대경로·크기·mtime aggregate manifest는 GUI
검증 전후 동일했다.

- Gangnam: `4a50d8c420a472c85556b9ba985959f3c41cce2c967a4c65f302c934a6ff64d3`
- Ep01: `8acb885807df93c1be84fc34a93790356c7d83616eebb9afdef2613b34372f35`

위 두 값은 이전 회차 알고리즘의 증거로 보존한다. 이번 gap-closure 회차는
별도로 relative path, type, size, nanosecond mtime을 정렬한 manifest를
SHA-256으로 계산했다. 회차 마감 전후 동일 알고리즘 결과가 일치했으며
cross-algorithm equality는 주장하지 않는다.

- Gangnam: 355 entries,
  `083c64eaea2add92a4d6f8be492564dbc1332c0ca3ab4585bdb619cf4ac26551`
- Ep01: 587 entries,
  `b37144f912602036376069e6eca9c6c382346f13882472e7a1ac0505cceca454`

## 11-tab / 10-core panel matrix

| tab | core surface | actual click | expected heading | 1440 | 1024 | side effect |
| --- | --- | --- | --- | --- | --- | --- |
| Intake | Project Intake | PASS | PASS | PASS | scroll-reachable | 0 |
| Storyboard | Storyboard / Shot List | PASS | PASS | PASS | scroll-reachable | 0 |
| Shot Designer | extra shot surface | PASS | PASS | PASS | scroll-reachable | copy-only |
| Motion Board | Motion Board | PASS | PASS | PASS | scroll-reachable | 0 |
| Assets | First-Frame / Reference Dashboard | PASS | PASS | PASS | scroll-reachable | 0 |
| Prompt Packs | Prompt Pack Builder | PASS | PASS | PASS | scroll-reachable | 0 |
| Review Gates | Review Gates | PASS | PASS | PASS | scroll-reachable | 0 |
| Queue | Seedance/Dreamina Queue | PASS | PASS | PASS | scroll-reachable | disabled submit/copy-only |
| QA | Clip QA / Accepted Seconds | PASS | PASS | PASS | scroll-reachable | 0 |
| Final | Final Stitch / Report | PASS | PASS | PASS | scroll-reachable | copy-only |
| Settings | Pipeline Settings | PASS | PASS | PASS | scroll-reachable | dry-run locked |

1440에서 모든 기본 탐색 탭이 production list보다 앞에 표시된다. 1024에서는
aside와 panel이 독립적으로 `overflow-y:auto`이며 header controls, sidebar,
panel content가 겹치지 않는다. 넓은 table surface는 자체 horizontal scroll을
유지한다.

Queue 실제 DOM에서 `Submit disabled`, `Copy command`, blocker badges를
확인했고 enabled `run|execute|generate|submit|upload|download|get` control은
전 tab/dataset/viewport에서 0개였다. command copy는 renderer clipboard API를
사용하지 않고 preload를 거쳐 Electron main process가 normalized preview를
쓴 뒤 즉시 read-back equality를 확인한다. 256 KiB를 넘으면 fail closed하고
결과에는 원문 대신 길이와 SHA-256만 반환한다.

실제 macOS `CGEvent` trusted click 1회 결과는 `command-copied`,
`copied:true`, `verified:true`, `executed:false`, length/bytes `86`, SHA-256
`7401b0abcbdf800d5d75aa1c278ef1f45c4578755fb6fecc45d505689065cf5c`였다.
화면 `<code>` preview를 WebCrypto로 독립 계산한 길이/해시와 정확히
일치했고 `command-blocked` event 0, `runSafeCommand` 호출 0이었다. clipboard
원문은 로그·문서로 외부화하지 않았다. reader error의 fail-safe surface는
`tests/rendererContract.test.mjs`의 실제 `PipelineStudio()` contract로 별도
고정되어 있다.

## screenshot 증거

Screen Recording과 Accessibility preflight는 PASS했다. screenshot skill의
macOS window/region helper와 loopback CDP `Page.captureScreenshot`을 함께
사용했다. real-root capture는 raw private text 가능성 때문에 `/tmp`에만 두고
커밋하지 않았다.

- fixture 1440 OS capture: SHA-256
  `9af4d48f7754db5004b773b13f8da4e0ec2f3cf9d98110130ba84ef79125c9c0`
- fixture native dialog path capture: SHA-256
  `8f1a3b272374fa53c1a21fd2b056123b200779fab6b06a8030df14be60a93a34`
- first production 1440 CDP capture: SHA-256
  `dd55c28ef7555189727b143093918c327a80b68853680bb5e783338b43fc0650`
- second production 1440 CDP capture: SHA-256
  `a3c137b74162956ad64f24f848402ee8a95b4dac8215af181aed6bda51c3f6d5`
- second production 1024×640 CDP capture: SHA-256
  `550254bcd3a6aa53c2ec5e93c9705a013e3700fd7c4257aaf4c3f27cb02c1036`
- canonical production-parent native sheet capture: SHA-256
  `811a890f25d3303066a52e3a578d2b0e2d392d10038d091801698c1f751ac822`
- trusted-copy Queue capture: SHA-256
  `a5d28ad2e4f03d72e4d158192c6bc82986b304ca3b5301f78aa7dbbc488b09df`

## 수정과 회귀

변경 파일:

- `electron/lib/filmPipelineProvider.js`
- `electron/preload.js`
- `src/lib/pipeline/client.js`
- `src/components/pipeline/PipelineStudio.js`
- `src/components/pipeline/CommandPreviewCard.js`
- `tests/desktopSecurity.test.mjs`
- `tests/filmPipelineNativeClipboard.test.mjs`

회귀 결과:

```text
focused native/clipboard/security/renderer: 12/12 PASS
full network-denied suite: 72/72 PASS
npm run lint: PASS
npm run build: PASS, Vite 36 modules
git diff --check: PASS
release/ absent: PASS
```

## 잔여 blocker

- `NATIVE_FOLDER_SELECTION_ROOT2_GAP`: 두 번째 production은 native sheet에서
  state가 바뀌지 않았다. 이번 회차에는 canonical parent가 native sheet의
  default path로 열리는 것까지 증명했지만 AX selection/Return은 parent를
  반환했다. sidebar/preload reader는 정상이다. 사용자 직접 selection 또는
  별도 macOS native-dialog harness가 있어야 native 항목을 PASS로 바꿀 수 있다.
- `OSV_OFFLINE_DB_GAP`: offline OSV database 부재는 본 GUI 회차에서
  해결하지 않았다. OSV Scanner v2.4.0을 fresh HOME과 deny-network로 실행한
  결과 1,097 packages/4 filtered 뒤 exit 127,
  `no offline version of the OSV database is available`로 종료됐다. JSON의
  vulnerability 0은 scan failure이므로 PASS로 해석하지 않는다.
- 실제 날짜-run Layout A 완전 표본은 여전히 없다.
