# Pipeline UI Agent Handoff

> 현재 handoff 안내 (2026-07-13): 아래 본문은 2026-07-06의 미커밋 작업트리 스냅샷으로 보존한다. 현재는 `main`이 clean이고 P0 보안 통합 `4dac387`, 인수 기록 `86655d7`, Layout A/B reader `93f35a3`까지 로컬 `main`에 커밋되었다. 전체 network-denied tests 64/64, lint, build가 통과했다. 최신 남은 작업은 실제 Electron GUI 증거, 완전한 실제 Layout A/B gap, offline OSV gap이며 `21_current_acceptance_status.md`와 `.agent/goal-checkpoint.md`를 우선한다.

작성일: 2026-07-06
대상 repo: `/Users/jessiek/StudioProjects/Open-Generative-AI`
상태: Cinematic Pipeline Studio UI shell, schema, validators, Electron bridge, production reader, command preview, DeepSearchTeam scene-image preview가 구현되어 있으나 아직 커밋되지 않은 작업트리 상태.

## 먼저 지켜야 할 규칙

- 기존 변경을 되돌리지 말 것. 현재 작업트리는 이전 Task A-L 산출물 전체가 untracked/modified로 남아 있다.
- `npm install` 금지였던 이전 단계 제약 때문에 `node_modules`가 없을 수 있다. 의존성 설치가 새로 허용되지 않았다면 설치하지 말 것.
- 실제 생성/외부 호출 금지:
  - `python -m dst image ...` 실행 금지
  - Dreamina/Jimeng/Seedance submit 금지
  - Gemini/DeepSearchTeam/browser automation 실행 금지
  - ffmpeg/ffprobe 실행 금지, 별도 승인 전에는 preview만
  - 외부 업로드/계정 변경/쿠키·토큰·프로필 접근 금지
- Pipeline UI에서 허용된 것은 planning file 저장, 로컬 production folder 읽기, command preview/copy뿐이다.
- 보고는 한국어로 한다.

## 현재 git 상태 요약

마지막 확인 명령:

```bash
git status --short
```

현재 요약:

```text
 M electron/main.js
 M electron/preload.js
 M src/components/Sidebar.js
 M src/main.js
?? AGENTS.md
?? docs/ui_integration/
?? electron/lib/filmPipelineProvider.js
?? electron/lib/productionReader.js
?? scripts/test_pipeline_validators.js
?? src/components/pipeline/
?? src/fixtures/
?? src/lib/pipeline/
?? tests/pipelineQueueRules.test.mjs
```

주의: `docs/ui_integration/`, `src/components/pipeline/`, `src/lib/pipeline/`, `src/fixtures/`는 디렉터리 단위로 표시되므로 내부에 많은 파일이 포함되어 있다. 다음 에이전트는 작업 전에 반드시 `git diff --stat`, `git diff --name-only`, 필요한 파일별 diff를 다시 확인해야 한다.

## 구현된 주요 표면

### App / navigation

- `src/components/Sidebar.js`
  - top-level navigation에 `Pipeline` 항목 추가.
- `src/main.js`
  - `PipelineStudio` route/import 연결.
- 기존 Image/Video/Cinema/LipSync 컴포넌트는 제거하지 않았다.

### Pipeline UI

- `src/components/pipeline/PipelineStudio.js`
  - `Cinematic Pipeline Studio` shell.
  - 탭: Intake, Storyboard, Shot Designer, Motion Board, Assets, Prompt Packs, Review Gates, Queue, QA, Final, Settings.
  - `LOCAL PIPELINE UI - DRY RUN MODE` 성격의 permanent side effects indicator.
  - `Open Production Folder` flow는 `pipelineClient`를 통해 Electron bridge 또는 mock fallback 사용.
- 주요 panel files:
  - `IntakePanel.js`
  - `StoryboardPanel.js`
  - `ShotDesignerPanel.js`
  - `MotionBoardPanel.js`
  - `AssetDashboardPanel.js`
  - `PromptPackPanel.js`
  - `ReviewGatesPanel.js`
  - `QueuePanel.js`
  - `QAPanel.js`
  - `FinalReportPanel.js`
  - `PipelineSettingsPanel.js`

### Schema / validators / safety

- `src/lib/pipeline/schema.js`
- `src/lib/pipeline/blockers.js`
- `src/lib/pipeline/statusMachine.js`
- `src/lib/pipeline/validators.js`
- `src/lib/pipeline/sideEffects.js`
- `src/lib/pipeline/commandBuilders.js`
- `src/lib/pipeline/mockData.js`

중요한 안전 규칙:

- submit은 image dashboard 누락/오래됨, attached image 미검토/실패, Gemini prompt/media review 미통과, credit confirmation 부재, duration lock 부재, retry-after-one-attempt 조건에서 차단된다.
- heartbeat는 같은 active production 기준 최소 20분 이후만 due로 본다.
- retry, VIP/fallback, duplicate job은 정상 버튼으로 노출하지 않는다.
- final ready는 `final.mp4`, concat list, source clip path, submit id, QA, accepted seconds, blockers, report evidence가 없으면 false다.

### Electron bridge / production reader

- `electron/preload.js`
  - `window.filmPipeline` bridge 노출.
- `electron/main.js`
  - bridge IPC registration.
- `electron/lib/filmPipelineProvider.js`
  - config, folder select, production read, planning file write, JSONL read, asset list, command preview, blocked runSafeCommand.
  - `runSafeCommand`는 현재 모든 command 실행을 차단한다.
- `electron/lib/productionReader.js`
  - Layout A/B 감지 및 부분 파싱.
  - cookies, browser profiles, auth bundles, session zips, token/secret/credential path는 읽지 않도록 방어.
- `src/lib/pipeline/client.js`
  - Electron unavailable 시 mock fallback.
- `src/lib/pipeline/productionNormalizer.js`
  - production reader output을 UI state로 normalize.

### Production layouts

Reader는 아래 두 layout을 대상으로 한다.

Layout A:

```text
docs/short_drama_pipeline_runs/<YYYYMMDD>-<slug>/
  intake/
  storyboard/
  prompts/
  generated/
  final/
  qa/
  report.md
```

Layout B:

```text
production/
  brief.md
  script.md
  assets/
  video_references/
  image_generation/
  image_dashboard/
  storyboard/
  motion_board/
  prompts/
  dreamina_outputs/
  reviews/
  edit/
  ledger.csv
```

구조화 데이터가 없으면 fake success를 만들지 않고 blocker를 기록한다.

### DeepSearchTeam scene image preview

가장 최근 단계에서 추가됨:

- `src/lib/pipeline/deepsearchSceneImages.js`
- `src/lib/pipeline/deepsearchSceneImages.test.mjs`
- `docs/ui_integration/12_deepsearch_scene_image_preview.md`

현재 동작:

- storyboard/ShotPayload에서 DeepSearchTeam용 scene image prompt를 만든다.
- commandSpec은 다음 형태다.

```text
command = python
args = -m dst image "<prompt>" -p goldpure369
cwd = /Users/jessiek/StudioProjects/deepSearchTeam
side_effect_type = credit_consuming_generation
preview_only = true
requires_confirmation = true
disabled_reason = CREDIT_CONFIRMATION_REQUIRED
```

중요: 이 기능은 prompt/copy/save/preview만 한다. 실제 `dst image` 실행은 연결되어 있지 않으며 실행하면 안 된다.

DeepSearchTeam 계약:

- profile: `goldpure369`
- mode: Thinking image generation
- output: prompt당 완성 이미지 1장
- stop 조건: 계정, mode, references, Jessie 승인 중 하나라도 불명확하면 제출 전 중단

## Fixture / tests

Fixture states:

- `src/fixtures/pipeline/states/complete_planning_no_generation.js`
- `missing_storyboard.js`
- `missing_motion_board.js`
- `dashboard_missing.js`
- `dashboard_stale.js`
- `image_unreviewed.js`
- `prompt_media_review_blocked.js`
- `credit_confirmation_required.js`
- `submitted_waiting_heartbeat.js`
- `heartbeat_due.js`
- `downloaded_qa_missing.js`
- `qa_failed.js`
- `accepted_seconds_missing.js`
- `final_ready.js`

Production reader sample folder:

- `src/fixtures/pipeline/sampleProductionFolder/`

Test runner:

```bash
node scripts/test_pipeline_validators.js
```

마지막 통과 결과:

```text
tests 45
pass 45
fail 0
```

Node 경고:

```text
MODULE_TYPELESS_PACKAGE_JSON
```

이 경고는 현재 package가 `"type": "module"`을 선언하지 않았는데 ESM 파일을 Node가 재파싱해서 생기는 경고다. 테스트 실패는 아니다. 다음 에이전트는 package type 변경을 별도 요청 없이 하지 말 것. 변경 blast radius가 크다.

## 마지막으로 확인된 검증 명령

성공:

```bash
node --check src/lib/pipeline/deepsearchSceneImages.js
node --check src/components/pipeline/ShotDesignerPanel.js
node --check src/lib/pipeline/commandBuilders.js
node --check scripts/test_pipeline_validators.js
node --test src/lib/pipeline/deepsearchSceneImages.test.mjs
node scripts/test_pipeline_validators.js
git diff --check
```

실패/BLOCK:

```bash
npm run vite:build
```

이전 감사 기준 실패 이유:

```text
sh: vite: command not found
electron module missing
dist/index.html: false
```

의존성 설치 금지 조건 때문에 해결하지 않았다.

## 현재 문서 상태

존재:

- `docs/ui_integration/04_pipeline_schema.md`
- `docs/ui_integration/05_electron_bridge.md`
- `docs/ui_integration/06_panel_implementation_report.md`
- `docs/ui_integration/07_production_reader.md`
- `docs/ui_integration/08_command_preview_and_gates.md`
- `docs/ui_integration/09_final_report_ui.md`
- `docs/ui_integration/10_test_matrix.md`
- `docs/ui_integration/11_final_audit.md`
- `docs/ui_integration/12_deepsearch_scene_image_preview.md`
- `docs/ui_integration/missing_inputs.md`
- `docs/ui_integration/checkpoints/2026-07-05_missing_pipeline_doc.md`

누락/BLOCK:

- `docs/harness/shorts-SKILL.md`
- `docs/harness/Seedance2-SKILL.md`
- `docs/ui_integration/00_repo_audit.md`
- `docs/ui_integration/01_harness_to_ui_contract.md`
- `docs/ui_integration/02_implementation_plan.md`
- `docs/ui_integration/03_shell_implementation_report.md`

`docs/ui_integration/11_final_audit.md`에도 같은 blocker가 기록되어 있다.

## 다음 에이전트 권장 순서

1. 작업 시작 직후:

```bash
git status --short
git diff --stat
git diff --check
node scripts/test_pipeline_validators.js
```

2. 의존성 설치 허용 여부를 확인한다. 허용되지 않았다면 `npm install`을 실행하지 않는다.

3. 허용된 경우에만 app launch/build 검증:

```bash
npm run vite:build
npm run electron:dev
```

4. GUI launch가 가능해지면 실제로 확인할 것:

- Pipeline tab이 보이는지
- mock production이 로드되는지
- `Open Production Folder`가 Layout B fixture 또는 실제 production folder를 읽는지
- missing files가 blocker로 표시되는지
- command cards에 run button이 없는지
- DeepSearchTeam scene image command가 blocked preview로만 보이는지

5. docs/harness 원본이 제공되면 먼저 `00-03` 문서 공백을 닫는다. 이 단계 없이 harness contract complete라고 주장하지 말 것.

6. legacy MuAPI path 격리 여부를 결정한다. 현재 조건에서는 old Image/Video/Cinema components를 제거하지 않았다.

## BLOCKER 문자열

현재 pipeline blocker constants:

```text
MISSING_PIPELINE_DOC
MISSING_WORK_DECOMPOSITION
MISSING_PRODUCTION_BRIEF
MISSING_STORYBOARD_CONTINUITY_PACKET
MISSING_MOTION_BOARD
MISSING_YOUMIND_TEMPLATE_EVIDENCE
MISSING_GPT_IMAGE_GUIDE_EVIDENCE
IMAGE_PROMPT_TEMPLATE_NOT_REVIEWED
IMAGE_GEMINI_REVIEW_REQUIRED
IMAGE_GEMINI_REVIEW_NOT_PASS
MISSING_IMAGE_DASHBOARD
IMAGE_DASHBOARD_STALE
MISSING_REFERENCE_ANNOTATION
MISSING_VIDEO_REFERENCE_METADATA
DURATION_LOCK_MISSING
DREAMINA_PREFLIGHT_BLOCKED
GEMINI_REVIEW_BLOCKED
FRAME_EXTRACTION_BLOCKED
GEMINI_VIDEO_REVIEW_BLOCKED
CREDIT_CONFIRMATION_REQUIRED
MODEL_MISMATCH
MISSING_ACCEPTED_SECONDS
OUTPUT_QUALITY_NOT_PROVEN
```

다음 에이전트는 새 blocker를 임의로 늘리기보다 기존 constants를 우선 사용해야 한다.

## 커밋 전 체크리스트

- `git diff --check` PASS
- `node scripts/test_pipeline_validators.js` PASS
- `rg -n "runSafeCommand\\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
- 새 문서가 한국어인지 확인
- secrets, cookies, browser profiles, auth bundles, session zips, token/secret/credential path가 repo에 저장되지 않았는지 확인
- Jessie가 명시적으로 승인하지 않은 live side effect가 없는지 확인

## 한 줄 현재 상태

Pipeline UI는 local dry-run studio로 구현되어 있고 validator/safety tests는 통과하지만, 앱 launch는 missing dependencies로 BLOCK이며 harness 원본 문서와 `00-03` 초기 감사 문서가 아직 없어 contract lineage는 닫히지 않았다.
