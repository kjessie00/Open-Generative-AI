# 최종 통합 감사

> 역사 기록 안내 (2026-07-13): 아래 감사는 2026-07-05 당시 상태다. 이후 필수 하네스/00-03 문서가 추가되었고, active MuAPI 경로 격리, network-denied 64-test/lint/build 검증, Layout A/B reader 보강이 완료되었다. 아래의 dependency·missing-doc·legacy MuAPI BLOCK을 현재 상태로 해석하지 않는다. 최신 판정은 `21_current_acceptance_status.md`를 우선한다.

감사 일시: 2026-07-05
범위: 현재 체크아웃의 Cinematic Pipeline Studio 구현, Electron bridge, production reader, validators, fixture tests, command preview/gate UI.
원칙: 새 기능 추가 없음. 외부 생성, Dreamina/Gemini, 업로드, ffmpeg/ffprobe 실행 없음.

## 핵심 판정

현재 구현은 **Pipeline UI 안전 모델과 validator 계약은 통과**한다. 다만 이 체크아웃은 `node_modules`가 없어서 **실제 앱 launch/build는 검증 불가/BLOCK**이고, `docs/harness` 및 초기 `00-03` 문서가 현재 파일 트리에 없어 **입력 문서 계보가 불완전**하다.

## 주요 발견

### BLOCK: 앱 launch 검증 불가

`npm run vite:build` 실행 결과:

```text
sh: vite: command not found
```

추가 확인:

```text
electron module missing
dist/index.html: false
```

의존성 설치는 이번 작업에서 금지되어 있으므로 설치하지 않았다. 따라서 `App launches`는 현재 환경에서 PASS가 아니라 `BLOCKED_BY_MISSING_LOCAL_DEPENDENCIES`로 기록한다.

### BLOCK: harness 입력 문서와 초기 감사 문서 누락

현재 체크아웃에서 `docs/harness`가 존재하지 않는다. 또한 아래 파일이 없다.

```text
docs/ui_integration/00_repo_audit.md
docs/ui_integration/01_harness_to_ui_contract.md
docs/ui_integration/02_implementation_plan.md
docs/ui_integration/03_shell_implementation_report.md
```

이미 존재하는 `docs/ui_integration/missing_inputs.md`의 `MISSING_PIPELINE_DOC` 상태와 일치한다. 구현은 mock/fixture 기반으로 진행되어 있으나, 최종 통합 기준으로는 원본 harness 계약 추적성이 아직 불완전하다.

### IMPORTANT: 기존 UI 통합 문서 대부분이 영어

`docs/ui_integration/04_pipeline_schema.md`부터 `10_test_matrix.md`까지 제목과 본문이 영어 중심이다. 이번 최종 감사 문서와 사용자 요약은 한국어로 작성했지만, 체크 항목 `Reports are in Korean`은 기존 보고서 전체 기준으로는 부분 실패다.

### IMPORTANT: Pipeline은 안전하지만 legacy MuAPI surface는 아직 남아 있음

Pipeline tab은 MuAPI key를 요구하지 않고 `window.filmPipeline`/mock fallback만 사용한다. 반면 기존 Image/Video/Cinema/LipSync/Settings 경로에는 MuAPI key 저장 및 MuAPI 호출 코드가 남아 있다. Task B의 “old components 제거 금지” 조건 때문에 유지된 상태이며, Pipeline 경계 밖 legacy risk로 남는다.

## 체크리스트 결과

| # | 항목 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | App launches | BLOCK | `npm run vite:build`가 `vite: command not found`로 실패. `electron` module도 없음. |
| 2 | Pipeline tab exists | PASS | `src/components/Sidebar.js`에 `id: 'pipeline'`, `src/main.js`에서 `PipelineStudio` dynamic import. |
| 3 | Mock production loads | PASS | `PipelineStudio` 초기 state가 `samplePipelineState`; bridge 실패 시 fallback도 mock state 사용. |
| 4 | Real production folder can be selected and partially parsed | PARTIAL PASS | bridge는 `selectProductionRoot` + `readProductionState`; reader fixture Layout B 파싱 PASS. 실제 GUI dialog는 launch BLOCK으로 미검증. |
| 5 | Missing files become blockers, not fake success | PASS | temp brief-only folder에서 `MISSING_STORYBOARD_CONTINUITY_PACKET`, `MISSING_MOTION_BOARD`, `MISSING_IMAGE_DASHBOARD`, `MISSING_ACCEPTED_SECONDS`, `OUTPUT_QUALITY_NOT_PROVEN` 확인. |
| 6 | No MuAPI key required for Pipeline tab | PASS | Pipeline imports `pipelineClient`, not `muapi`; AuthModal/MuAPI key path는 legacy tabs에만 존재. |
| 7 | No credit-consuming command can run | PASS | `runSafeCommand` always returns `FILM_PIPELINE_COMMAND_BLOCKED`; classifier hard-blocks credit generation keywords. |
| 8 | No external review/upload/generation command can run | PASS | classifier blocks `external_review`, `external_upload`, `account_mutation`, `vip_fallback_model`; command cards have no run button. |
| 9 | Submit buttons disabled unless gates pass | PASS | QueuePanel renders `Submit disabled`; `validateSubmitAllowed` requires dashboard, image verdict, prompt/media PASS, credit confirmation, attempt policy, duration lock. |
| 10 | Retry is not normal action | PASS | QueuePanel shows `No auto-retry`; text says retry/VIP/fallback/duplicate paths are never suggested. |
| 11 | Heartbeat disabled until at least 20 minutes | PASS | validator returns `DREAMINA_PREFLIGHT_BLOCKED` with `reason: heartbeat_not_due`, exact `nextHeartbeatAt`; tests PASS. |
| 12 | Missing/stale image dashboard blocks submission | PASS | validator fixture checks returned `MISSING_IMAGE_DASHBOARD` and `IMAGE_DASHBOARD_STALE`. |
| 13 | Unreviewed/failed images block submission | PASS | unreviewed attached image returns `IMAGE_GEMINI_REVIEW_REQUIRED`; RETRY/BLOCK paths map to `IMAGE_GEMINI_REVIEW_NOT_PASS`. |
| 14 | Accepted seconds missing blocks final | PASS | `accepted_seconds_missing` fixture returns `MISSING_ACCEPTED_SECONDS`. |
| 15 | Final ready requires final.mp4 and evidence paths | PASS | `validateFinalReady` requires `final.mp4`, submit IDs, downloads, QA, accepted seconds, concat list, ffprobe evidence, report, blockers array. |
| 16 | Reports are in Korean | PARTIAL FAIL | This final audit is Korean; existing `04-10` docs are English. |
| 17 | No secrets stored or copied | PARTIAL PASS | production reader skips cookie/profile/auth/session/token/secret/credential paths. Pipeline config stores root paths only. Legacy MuAPI key storage remains outside Pipeline. |

## 검증 증거

실행한 검증:

```bash
node scripts/test_pipeline_validators.js
```

결과: 42개 테스트 PASS. Node ESM package warning은 있었지만 실패는 아니다.

```bash
node --check electron/main.js
node --check electron/preload.js
node --check electron/lib/filmPipelineProvider.js
node --check electron/lib/productionReader.js
node --check src/components/pipeline/PipelineStudio.js
```

결과: PASS.

```bash
npm run vite:build
```

결과: BLOCK, `vite: command not found`.

Production reader fixture 결과:

```json
{
  "layout": "B",
  "storyboard": true,
  "motionBoard": true,
  "imageDashboard": true,
  "submitRecords": 1,
  "heartbeatLog": 1,
  "acceptedSeconds": 1,
  "report": true,
  "blockers": ["CREDIT_CONFIRMATION_REQUIRED", "OUTPUT_QUALITY_NOT_PROVEN"]
}
```

Missing folder probe 결과:

```json
{
  "blockers": [
    "MISSING_STORYBOARD_CONTINUITY_PACKET",
    "MISSING_MOTION_BOARD",
    "MISSING_IMAGE_DASHBOARD",
    "MISSING_ACCEPTED_SECONDS",
    "OUTPUT_QUALITY_NOT_PROVEN"
  ],
  "skippedSensitiveFile": true
}
```

Validator spot checks:

```json
{
  "dashboardMissing": ["MISSING_IMAGE_DASHBOARD"],
  "dashboardStale": ["IMAGE_DASHBOARD_STALE"],
  "imageUnreviewed": ["IMAGE_GEMINI_REVIEW_REQUIRED"],
  "acceptedSecondsMissing": ["MISSING_ACCEPTED_SECONDS", "OUTPUT_QUALITY_NOT_PROVEN"],
  "finalNoMp4": "missing_final_mp4_evidence",
  "heartbeatBefore20m": {
    "reason": "heartbeat_not_due",
    "nextHeartbeatAt": "2026-07-05T12:10:00.000Z"
  }
}
```

## 작동하는 것

- Pipeline navigation과 `Cinematic Pipeline Studio` shell이 코드상 연결되어 있다.
- mock production state가 브라우저/Vite fallback에서도 로드되도록 되어 있다.
- Electron bridge API `window.filmPipeline`이 preload에 노출되어 있다.
- Production reader가 Layout B fixture를 읽고 storyboard, motion board, image dashboard, JSONL ledgers, accepted seconds, report를 부분 파싱한다.
- 누락 파일은 PASS로 꾸미지 않고 blocker로 보존된다.
- Queue/Final/Asset validators가 submit, heartbeat, image dashboard, accepted seconds, final evidence를 막는다.
- Command preview cards는 copy-only이고 run button을 만들지 않는다.

## Mock-only / Preview-only

- Pipeline UI의 상태는 기본적으로 `samplePipelineState`와 fixture states에 의존한다.
- Dreamina help/list_task/query_result, ffprobe, ffmpeg concat은 preview command card만 있다.
- `runSafeCommand`는 모든 command에 대해 현재 실행을 차단한다.
- Shot Designer는 `ShotPayload` JSON 작성/복사/계획 파일 저장만 한다.
- 실제 GUI folder picker는 Electron launch가 막혀 이번 감사에서 수동 검증하지 못했다.

## 남은 BLOCK

- `BLOCKED_BY_MISSING_LOCAL_DEPENDENCIES`: `vite`와 `electron` module이 없어 앱 launch/build 검증 불가.
- `MISSING_PIPELINE_DOC`: `docs/harness/shorts-SKILL.md`, `docs/harness/Seedance2-SKILL.md`가 현재 체크아웃에 없다.
- `MISSING_INITIAL_AUDIT_DOCS`: `00_repo_audit.md`, `01_harness_to_ui_contract.md`, `02_implementation_plan.md`, `03_shell_implementation_report.md`가 없다.
- `REPORT_LANGUAGE_PARTIAL`: 기존 `04-10` UI integration docs가 영어다.
- `LEGACY_MUAPI_SURFACE`: Pipeline 외부의 기존 Image/Video/Cinema/LipSync/Settings path는 MuAPI key와 hosted generation 코드가 남아 있다.

## 정확한 다음 구현 단계

1. 의존성 설치가 허용되는 별도 단계에서 `npm install` 또는 lockfile 기준 설치 후 `npm run vite:build`와 `npm run electron:dev`를 실행해 실제 launch를 검증한다.
2. `docs/harness/shorts-SKILL.md`와 `docs/harness/Seedance2-SKILL.md`를 복구하거나 현재 repo에 명시적으로 제공한다.
3. 누락된 `00-03` 문서를 복구하거나 현재 구현 기준으로 재작성해 harness 계약 추적성을 닫는다.
4. 기존 `04-10` UI integration report를 한국어로 변환하거나, 문서 언어 기준을 “코드 문서 영어, Jessie 보고 한국어”로 명시한다.
5. 다음 기능 단계 전에 legacy MuAPI tabs를 Pipeline과 더 강하게 격리하거나, Pipeline-only 앱 모드에서 숨기는 결정을 한다.
6. 실제 Electron launch 후 `Open Production Folder`를 GUI에서 수동 검증하고 screenshot 또는 로그 증거를 남긴다.
