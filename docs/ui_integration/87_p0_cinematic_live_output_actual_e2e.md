# P0 시네마틱 실제 결과물 Electron E2E

## 한 줄 결론

새 격리 Electron userData에서 시네마틱 입력과 설계를 실제 저장하고, 사전 Gemini 검토를 통과한 Flow 요청을 한 번 실제 제출해 새 10초 영상을 받았다. 그 영상을 OpenGA에 연결해 결과 사용 결정, `0–5초` 클립 선택, 로컬 최종 렌더, 전체 Quit/relaunch, 최종 재생까지 완료했으며 결과는 `TECHNICAL_PASS`, `ACTUAL_PROVIDER_PASS`, `ACTUAL_ELECTRON_PASS`다.

## 기준과 격리 범위

- 저장소 기준: branch `codex/p0-cinematic-actual-e2e-relaunch-fix`, 검증 HEAD `7060a42b58151cb75266d56c4679d044a9752626`
- main 기준: local/remote 모두 `e0d04d7dc1cc339220de5adddf13f11532bb4ca5`
- 새 userData: `/tmp/open-ga-live-output-e2e-20260718-W5QMvZ`
- 새 증거 bundle: `/Users/jessiek/.codex/visualizations/2026/07/18/open-ga-live-output-e2e-20260718T190755KST/`
- OpenGA project id: `open-ga-live-lantern-20260718`
- 외부 생성은 기존 로그인된 전용 Flow 프로필과 기존 프로젝트를 사용했다. 새 로그인, 계정 전환, 프로젝트 생성, 구매, 구독 변경은 하지 않았다.
- `.env`, API key, upload, production/HVF mutation, browser login, 다른 Electron/Codex/Claude 프로세스 종료는 수행하지 않았다.

## 실제 입력과 provider 결과

실제 제출 원문은 다음과 같다.

```text
One short vertical cinematic video only. At blue hour, a single red paper lantern floats upward through a quiet rain-soaked Seoul alley. Slow forward camera push, realistic reflections, gentle wind, no people, no text, no logo.
```

- Flow 설정: video, Omni Flash, `9:16`, output 1, reference 0
- runner가 실제 붙이는 한국어 영상 지시 prefix까지 포함한 review context SHA-256: `12cc9d4422965073592d76977d565bd4f4106c703e07aeca810080376fc4f451`
- Gemini 3.1 Pro High 사전 검토: `PASS`
- 실제 Generate 클릭: `1`
- baseline media: `0`; 새 stable media URL: `1`; 저장 결과: `result_1.mp4` 한 개
- provider 원본: 10.006초, 720×1280, H.264 High/yuv420p 24 fps, AAC-LC stereo
- provider 원본 SHA-256: `27cc38948c168076d373943fde05db7406698083a945a8963779c57a11ba48ab`

이 한 번의 실제 provider submit은 기존 계정 credit을 소모했을 수 있다. 새 결제나 구매는 없었고 정확한 비용은 실행 화면에 노출되지 않아 기록하지 않았다.

OpenGA 자체는 Flow submit을 수행하지 않는다. 실제 생성은 외부 Flow 실행 경로에서 일어났고, OpenGA는 새 결과를 picker로 import한 뒤 클립 선택과 로컬 최종 렌더를 수행했다. 따라서 OpenGA 영수증의 `generation_executed: false`와 외부 `ACTUAL_PROVIDER_PASS`는 모순이 아니라 서로 다른 경계다.

## 실제 Electron E2E

| 순서 | 실제 확인 | 판정 |
| --- | --- | --- |
| 새 프로젝트 입력 | project id, 9:16, 5초, 장면 1개, cinematic 네 필드, brief, exact script 저장 | PASS |
| 설계 | 붉은 종이등 1개, 비 오는 서울 골목 1개, 장면 1개와 연속성·카메라·조명·소리 저장 | PASS |
| 실제 reference | 새 941×1672 PNG bundle을 인물·장소·장면 세 작업에 연결하고 모두 `이 결과 사용` | PASS |
| 실제 Flow 결과 연결 | 새 provider MP4 후보를 미리보기하고 한 장면에 연결 | PASS |
| 결과 검토 | 이미지 3개와 영상 1개 모두 사용, `확인 필요 0 · 사용 4 · 다시 만들기 0` | PASS |
| 클립 선택 | provider 10.005초 중 `0 → 5초`, 선택 이유와 confidence medium 저장 | PASS |
| 최종 준비 | 선택 1개, 총 5초 final handoff 저장 | PASS |
| 실제 최종 렌더 | OpenGA `검토용 영상 만들기`, fresh probe와 receipt 생성 | PASS |
| 최종 재생 | Electron에서 5초 검토용 영상을 `5.01333`초 끝까지 실제 재생 | PASS |
| 전체 재실행 | 전체 Quit/relaunch 뒤 cinematic, clip, final receipt/output 복원과 재생 끝까지 확인 | PASS |
| 최종 화면 | `5 마무리 → 최종 편집`, `확인 필요`, `이 영상 사용` 미선택 상태로 열어 둠 | PASS |

## 연결 영상 초기 접근성 문구 조사

연결 직후 macOS 접근성 트리는 video container를 `미디어를 재생할 수 없습니다.`라고 표시했다. 파일 해시·크기·MIME·Blob 경로를 독립 감사한 결과 후보와 연결 결과의 차이 또는 코드 결함은 없었다.

전체 재실행 후 DevTools에서 실제 video element를 확인한 값은 다음과 같다.

- `error: null`
- `networkState: 1`
- `readyState: 4`
- `duration: 10.005`
- `videoWidth: 720`, `videoHeight: 1280`

computer-use로 재생을 눌렀고 scrubber가 `10.0053`초까지 진행했다. 최종 5초 출력도 재실행 전후 각각 끝까지 재생됐다. 따라서 초기 문구는 접근성 트리의 초기 상태 표현으로 분류했고 코드 수정은 하지 않았다.

## 최종 실제 결과물

- 파일: `final-output/open-ga-live-lantern-final-5s.mp4`
- duration: 정확히 `5.000`초
- size: `937244` bytes
- video: H.264 High/yuv420p, 720×1280, 24 fps
- audio: AAC-LC, stereo, 48 kHz
- SHA-256: `6b2d2fdf8fe25136753ecae06036d40d187c67907ccd35f8e1ec3d7fa00988db`
- fresh probe SHA-256: `7c85b781d252036c7c95bea04272d83d0b2d85106a85dc6b4ba69e4ba0b1ccaa`
- receipt SHA-256: `10f84d319ec5a630ec0786007a324a4e88bbd5cbfe8eb674466bfa9fc2500d22`
- `legacy_production_modified: false`
- `canonical_delivery_modified: false`
- `output_quality_approved: false`

## 결과물 품질 확인

`OUTPUT_QUALITY_PARTIAL_PASS`

- Electron에서 실제 5초 재생을 끝까지 확인했고, 1 fps contact sheet를 직접 열어 검토했다.
- 하나의 붉은 종이등이 푸른 시간대의 젖은 골목에서 연속적으로 상승한다. 사람, overlay text/logo, black frame, 큰 identity break는 보이지 않는다.
- 전체 120 frame을 decode했고 frame hash 120개가 모두 달랐다. 1초 이상 freeze나 black interval은 검출되지 않았다.
- audio stream은 존재하며 mean `-41.3 dB`, max `-12.4 dB`다.
- 요청한 forward camera push는 sampled frame에서 미묘해 강한 motion match로 채점하지 않았다. audio의 창의적 품질도 청취 평가하지 않았다.
- 이 평가는 Codex evidence review이며 Jessie의 품질 승인으로 기록하지 않았다.

## 자동 검증

작성·운영과 분리한 read-only technical prove에서 handoff 85의 exact commands를 새로 실행했다.

| 검증 | 결과 |
| --- | --- |
| focused Node exact | `99/99 PASS`, exit 0 |
| live-output focused 8 files | `28/28 PASS`, exit 0 |
| full Node exact | `453/453 PASS`, exit 0 |
| `npm run lint` | PASS, exit 0 |
| `npm run build` | PASS, 79 modules |
| `git diff --check` | PASS, exit 0 |

기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고만 focused exact 3회, full exact 18회 재현됐다. `package.json`에는 `test` script가 없어 별도 probe `npm test`는 `MISSING_NPM_TEST_SCRIPT`였지만, handoff의 requested full gate는 exact `node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs`이며 통과했다.

## picker 상태

- `PICKER_NOT_REPEATED_IN_LIVE_OUTPUT_RUN`
- Layout A production 비노출 picker 검증은 같은 branch의 바로 앞 새 actual template E2E인 `docs/ui_integration/86_p0_cinematic_template_actual_e2e.md`에서 `PRODUCTION_PICKER_PASS`다.
- 그 이전 캡처나 판정을 이번 live-output `ACTUAL_PROVIDER_PASS` 또는 `ACTUAL_ELECTRON_PASS` 증거로 재사용하지 않았다.

## 증거 bundle 핵심 파일

- `provider-execution.md`
- `flow_prompt.json`
- `gemini_video_review.md`
- `flow-results/open-ga-live-lantern-scene-01/result_1.mp4`
- `dst-images/open-ga-live-lantern-reference/`
- `open-ga-state/cinematic-template.json`
- `open-ga-state/connected-video-result.json`
- `open-ga-state/video-review-decisions.json`
- `open-ga-state/clip-selections.json`
- `open-ga-state/final-handoff.json`
- `open-ga-state/final-run/{current,receipt,fresh_probe}.json`
- `final-output/open-ga-live-lantern-final-5s.mp4`
- `final-output/frames/contact-sheet.png`
- `ui/connected-video-ready-devtools.jpeg`
- `ui/final-output-restored.jpeg`
- `ui/final-output-played-to-end.jpeg`
- `quality-review.md`
- `technical-validation.md`
- `result.json`
- `SHA256SUMS`

## 최종 판정 분리

- `TECHNICAL_PASS`: focused 99/99와 28/28, full 453/453, lint, build, diff, final fresh probe와 receipt PASS
- `ACTUAL_PROVIDER_PASS`: 사전 Gemini exact-context PASS 뒤 Flow 실제 submit 1회, 새 output 1개 저장 PASS
- `ACTUAL_ELECTRON_PASS`: 새 격리 OpenGA 입력·설계·실제 media 연결·review·0–5초 clip·실제 local render·Quit/relaunch·최종 재생 PASS
- `PICKER_NOT_REPEATED_IN_LIVE_OUTPUT_RUN`: 이전 doc 86의 `PRODUCTION_PICKER_PASS`와 별도
- `OUTPUT_QUALITY_PARTIAL_PASS`: visual coherence와 media integrity PASS, camera-push 강도와 audio 창의 품질은 미채점
- `JESSIE_APPROVAL_NOT_RECORDED`: 앱의 최종 `이 영상 사용`을 선택하지 않았고 현재 `확인 필요`
- upload, production/HVF mutation, 새 결제, 새 로그인: `0`
