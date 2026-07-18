# P0 시네마틱 템플릿 실제 Electron E2E

## 한 줄 결론

새 격리 Electron 프로필에서 `basic → cinematic → 2–5단계 → 전체 재실행 → basic → 전체 재실행 → cinematic → 전체 재실행`을 실제 조작했다. 첫 회차에서 companion-only 저장 폴더를 기존 초안 누락으로 오판하는 재실행 결함을 발견해 최소 수정했고, 완전히 새 프로필로 처음부터 다시 실행한 최종 회차는 `TECHNICAL_PASS`, `ACTUAL_ELECTRON_PASS`, `PRODUCTION_PICKER_PASS`다.

## 기준과 격리 범위

- 저장소 기준: `main`/`origin/main` `e0d04d7dc1cc339220de5adddf13f11532bb4ca5`
- 수정 브랜치: `codex/p0-cinematic-actual-e2e-relaunch-fix`
- 최종 userData: `/tmp/open-ga-p0-cinematic-sol-xhigh-20260718T163302KST`
- 최종 증거: `/Users/jessiek/.codex/visualizations/2026/07/18/p0-cinematic-template-e2e-sol-xhigh-20260718T163302KST/`
- 사전 결함 증거: `/Users/jessiek/.codex/visualizations/2026/07/18/p0-cinematic-template-e2e-sol-xhigh-20260718T161948KST-pre-fix-defect/`
- 사전 결함 캡처는 진단용으로만 보존했고 최종 PASS 증거로 재사용하지 않았다.
- `.env`, API key, provider submit, 브라우저 로그인, 유료 생성, 업로드, 실제 production/HVF 쓰기, 다른 Electron/Codex/Claude 프로세스 종료는 수행하지 않았다.

## 실제 E2E 결과

| 순서 | 실제 확인 | 판정 |
| --- | --- | --- |
| clean basic | 빈 userData에서 `기본 영상` 선택, 네 시네마틱 입력 미표시, 2–5단계 요약 미표시 | PASS |
| cinematic 저장 | 정확한 네 값 입력, `시네마틱 기준을 저장했습니다.`, dirty 없음, 저장 버튼 비활성화 | PASS |
| 저장 계약 | `film_pipeline.cinematic_template.v1`, regular file, non-symlink, mode `0600`, 네 값 일치 | PASS |
| 2–5단계 | 각 단계의 필수 한글 문구, 펼친 네 값, 기존 스토리보드·작업 진행·클립 QA·최종 편집 패널 접근 | PASS |
| 키보드 | radio는 방향키, 저장은 Tab/Return, 2단계 summary는 Tab/Space로 조작했고 focus outline 확인 | PASS |
| 첫 전체 재실행 | cinematic과 네 값 및 2–5단계 요약 복원, 저장 경로 비노출, 오류 배너 없음 | PASS |
| basic 회귀 | basic 저장 시 네 값과 2–5단계 요약 제거, JSON 네 필드 빈 문자열 | PASS |
| basic 전체 재실행 | basic 복원, 네 입력과 2–5단계 요약 계속 미표시, 오류 없음 | PASS |
| 최종 cinematic | 네 값을 재입력·저장하고 전체 재실행 뒤 exact 복원 | PASS |
| 최종 화면 | 새 프로젝트 `5 마무리 → 최종 편집`의 펼친 cinematic 요약으로 앱을 열어 둠 | PASS |

사용한 네 값:

- 연출 의도: `고요한 선택이 남기는 긴장`
- 화면 핵심: `차가운 밤과 따뜻한 얼굴의 대비`
- 꼭 지킬 점: `붉은 스카프와 느린 호흡`
- 피할 점: `과도한 네온과 급격한 카메라 회전`

최종 저장 파일 SHA-256은 `319a2b9ccf8e68b918681a4742002568ca60715167283cb76eb605daa1430eab`이고 mode는 `0600`이다.

## 실제로 발견하고 수정한 결함

사전 회차의 clean userData에서 cinematic companion만 저장한 뒤 전체 재실행하면 cinematic mode와 네 값은 복원됐지만, 기존 새 프로젝트 초안 로더가 같은 draft root의 존재만 보고 다음 오류를 표시했다.

```text
저장하지 못했습니다.
저장된 초안 파일 일부가 누락되었습니다.
```

원인은 `electron/lib/newProjectDraftProvider.js`의 `loadDraft`가 canonical `draft.json`, `brief.md`, `script.txt`가 하나도 없는 companion-only 폴더도 partial canonical draft로 읽으려 한 것이다.

최소 수정은 canonical 세 파일 중 하나라도 존재할 때만 기존 `readSavedDraft`를 실행하는 것이다. 세 파일이 모두 없으면 canonical draft는 `empty`이고, 하나라도 존재하는 진짜 partial draft·symlink·권한·파일 안전성 검사는 기존 fail-closed 경로를 유지한다. `tests/newProjectBootstrap.test.mjs`에 실제 cinematic companion 저장 후 empty 복원과 세 canonical 파일 각각의 partial 반례를 추가했다.

수정 후 완전히 새 userData로 전체 E2E를 처음부터 다시 실행했고, 첫 cinematic 재실행과 basic 재실행, 최종 cinematic 재실행 모두 오류 배너가 없었다.

## production picker

native `Open Production Folder` picker는 한 번만 실행했다. 저장소 fixture `src/fixtures/pipeline/layoutAProduction/20260713-studio-fixture`를 선택했고, production workspace의 1–5단계 모두에서 cinematic 편집기와 요약이 비노출이었다.

- 판정: `PRODUCTION_PICKER_PASS`
- fixture 파일 수: `16`
- 전·후 집계 SHA-256: `d900656ce7cd0bed73c84a41927ec80846f61e08c28b0f70eed83c7cf4a8078e`
- fixture 쓰기·변경: `0`

## 자동 검증

수정 구현자와 분리된 최종 read-only PROVE에서 다음을 새로 실행했다.

| 검증 | 결과 |
| --- | --- |
| focused Node 5 files | `99/99 PASS` |
| full Node | `453/453 PASS` |
| `npm run lint` | PASS |
| `npm run build` | PASS, Vite 5.4.21, 79 modules |
| `git diff --check` | PASS |

기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고만 focused 3회, full 18회·12개 파일에서 재현됐고 새 실패·build warning은 없었다. full suite에는 이름에 `MOCK`을 명시한 테스트와 실제 local smoke/ffmpeg 테스트가 함께 있으므로 전체 PASS를 provider 실제 실행으로 해석하지 않는다.

## 증거 파일

- `00-environment.txt`
- `01-basic-clean.png`
- `02-cinematic-saved.png`
- `03-stage-2-expanded.png`
- `04-stage-3.png`
- `05-stage-4.png`
- `06-stage-5.png`
- `07-relaunch-restored.png`
- `08-basic-restored.png`
- `09-final-cinematic-restored.png`
- `10-production-non-exposure.png`
- `11-final-app-stage-5.png`
- `result.json`

모든 PNG는 1229×768이고 캡처 뒤 직접 열어 같은 실제 상태인지 확인했다.

## 최종 판정 분리

- `TECHNICAL_PASS`: 수정 회귀, focused/full Node, lint, build, diff, schema·regular file·mode `0600` PASS
- `ACTUAL_ELECTRON_PASS`: 실제 clean→cinematic→2–5단계→전체 재실행→basic→전체 재실행→cinematic→전체 재실행 PASS
- `PRODUCTION_PICKER_PASS`: native picker 1회, Layout A production 1–5단계 비노출, fixture 불변 PASS
- `OUTPUT_QUALITY_NOT_TESTED`: 이미지·영상 생성물을 만들지 않음
- `JESSIE_APPROVAL_NOT_RECORDED`: 사람의 최종 영상 품질 승인은 별도
- 외부 생성·provider submit·업로드·production/HVF mutation: `0`
