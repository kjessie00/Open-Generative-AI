# 앱 Launch 검증 (Dry-Run 모드) (17)

작성일: 2026-07-07 KST. 검증자: opencode session. 본 문서는 `docs/ui_integration/14_side_effect_audit.md` §7.2 후속 task 후보 둘째 항목 "앱 launch 검증 task"의 dry-run 검증 산출물이다. 본 검증 동안 외부 side effect 실행 0건, npm install 0회, git add/commit/push 0회, electron launch 0회이다.

## §1. 검증 결과 한 줄 요약

앱 launch는 dry-run 정적 검증 단계에서 6/6 PASS이며 실제 launch는 npm install 의존성 미보유로 BLOCK 상태이다. npm install이 Jessie 승인 후 별도 task에서 허용되면 본 §6 절차에 따라 실제 launch 검증이 가능하다.

## §2. 정적 검증 결과 (dry-run, 6/6 PASS)

본 §2는 실제 launch를 수행하지 않고 정적 분석만으로 검증 가능한 6가지 항목을 다룬다.

첫째, panel 파일 syntax 검증. `src/components/pipeline/` 디렉터리 안 19개 파일(`PipelineStudio`, `PipelineSidebar`, `CameraControlStrip`, `MediaReferencePicker`, `CommandPreviewCard`, `SideEffectGate`, `GenerationHistoryGrid`, `AssetDashboardPanel`, `FinalReportPanel`, `IntakePanel`, `MotionBoardPanel`, `PromptPackPanel`, `ReviewGatesPanel`, `QAPanel`, `QueuePanel`, `ShotDesignerPanel`, `StoryboardPanel`, `PipelineSettingsPanel`, `ui.js`) 모두 `node --check` 통과. 검증 명령: `for f in src/components/pipeline/*.js; do node --check "$f"; done`. 결과: 19/19 PASS.

둘째, pipeline lib syntax 검증. `src/lib/pipeline/` 디렉터리 안 13개 파일(`blockers.js`, `client.js`, `commandBuilders.js`, `deepsearchSceneImages.js`, `filePathUtils.js`, `mockData.js`, `productionNormalizer.js`, `schema.js`, `sideEffects.js`, `statusMachine.js`, `validators.js`, `deepsearchSceneImages.test.mjs`, `validators.test.mjs`) 모두 `node --check` 통과. 검증 명령: `for f in src/lib/pipeline/*.js src/lib/pipeline/*.mjs; do node --check "$f"; done`. 결과: 13/13 PASS.

셋째, electron lib syntax 검증. `electron/` 디렉터리 안 11개 파일(`main.js`, `preload.js`, `lib/filmPipelineProvider.js`, `lib/localInference.js`, `lib/localInferenceAssets.js`, `lib/localInferencePaths.js`, `lib/localInferenceRuntime.js`, `lib/modelCatalog.js`, `lib/productionReader.js`, `lib/wan2gpModelAvailability.js`, `lib/wan2gpProvider.js`) 모두 `node --check` 통과. 검증 명령: `for f in electron/main.js electron/preload.js electron/lib/*.js; do node --check "$f"; done`. 결과: 11/11 PASS.

넷째, validator 테스트 검증. `node scripts/test_pipeline_validators.js` 실행 결과 45 tests, 45 pass, 0 fail. node warnings는 `MODULE_TYPELESS_PACKAGE_JSON` 한 건이며 이는 package.json에 `"type": "module"` 선언 부재 경고로 테스트 실패가 아니다.

다섯째, deprecated folder 격리 검증. `rg -n "muapi|MuAPI" src/components/pipeline/ src/lib/pipeline/ electron/lib/` 결과 0건. 파이프라인 UI surface에서 hosted MuAPI 흔적 0건 확인. deprecated folder로 격리된 11개 파일은 본 repo의 active 렌더러 측 XHR/fetch 호출에 더 이상 노출되지 않는다.

여섯째, build config 존재 검증. `vite.config.mjs`, `index.html`, `package.json` 모두 존재 확인. 그러나 `dist/` 디렉터리는 존재하지 않으며 `node_modules/`도 존재하지 않는다. 따라서 실제 build/launch는 npm install 의존성이 필요하다.

## §3. launch BLOCK 사유

본 §3은 실제 launch가 BLOCK된 사유를 명시한다. 첫째, `node_modules/` 디렉터리 부재. `npm install`이 아직 실행되지 않았으며, AGENTS.md의 의도된 제약(credit-consuming 또는 외부 호출 회피)에 부합하기 위해 npm install이 보류되었다. 둘째, `dist/` 디렉터리 부재. vite build 산출물인 `dist/index.html`이 생성되지 않았으며, 따라서 electron main.js의 `mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))` 호출이 실패한다. 셋째, electron 바이너리 부재. `which electron` 결과 `electron not found`. 따라서 `electron .` 명령이 실패한다.

위 3가지 BLOCK 사유는 모두 의존성 부재에 기인하며 코드 문제와 무관하다. 코드 자체는 본 §2의 정적 검증에서 syntax 오류 0건 + validator 45/45 PASS + deprecated 격리 0건이 모두 확인되었다.

## §4. 실제 launch 시 검증 항목 (acceptance criteria)

본 §4는 npm install 허용 후 실제 launch가 수행될 때 검증해야 할 acceptance criteria를 한국어로 풀어 명시한다.

첫째, npm install 검증. 검증 명령: `npm install`. 합격 기준: 0 오류로 완료, node_modules 디렉터리 생성, package-lock.json 일치. 둘째, vite build 검증. 검증 명령: `npm run vite:build`. 합격 기준: 0 오류로 완료, dist/index.html 생성, dist/assets/* 생성. 셋째, electron launch 검증. 검증 명령: `npm run electron:dev`. 합격 기준: Electron 윈도우가 생성되어 화면에 표시됨, BrowserWindow의 ready-to-show 이벤트가 발화됨.

넷째, pipeline tab mount 검증. 검증 방법: pipeline 페이지 진입 후 PipelineStudio 컴포넌트가 mount되며 11개 패널(IntakePanel, StoryboardPanel, ShotDesignerPanel, MotionBoardPanel, AssetDashboardPanel, PromptPackPanel, ReviewGatesPanel, QueuePanel, QAPanel, FinalReportPanel, PipelineSettingsPanel)이 모두 정상 렌더링됨. 합격 기준: 11/11 패널 렌더링, 0 panel crash. 다섯째, side-effect gate 표시 검증. 검증 방법: SideEffectGate 컴포넌트가 dry-run 모드, 안전 커맨드 실행 허용, 외부 side effect 차단 표시 3개 상태 뱃지를 렌더링. 합격 기준: 3/3 뱃지 렌더링, 각 뱃지의 텍스트가 dry-run 모드, 안전 커맨드 실행 허용, 외부 side effect 차단 표시 3가지 사실을 정확히 안내.

여섯째, command preview 표시 검증. 검증 방법: 큐 패널 또는 다른 패널에서 명령 미리보기 카드가 표시되며 copy 버튼만 노출되고 실행 버튼은 노출되지 않음. 합격 기준: copy 버튼 1개만 노출, 실행 버튼 0개. 일곱째, IPC bridge surface 검증. 검증 방법: Electron dev tools 또는 pipelineClient 로그에서 window.filmPipeline의 9 surface(설정 읽기, 설정 쓰기, production root 선택, production state 읽기, planning file 쓰기, asset 목록, JSONL 읽기, 미리보기 명령, 안전 커맨드 실행, 진행 이벤트) 노출 확인. 합격 기준: 9/9 surface 노출, 그 외 surface 0개.

여덟째, production reader walk 검증. 검증 방법: production folder 열기 후 production reader가 walkFiles 결과 반환. 합격 기준: walkFiles가 depth 8 / max 1200 / .git skip / node_modules skip / 민감 이름 skip을 모두 강제. 아홉째, classification hard-block 검증. 검증 방법: 어떤 명령 사양을 미리보기 명령 handler에 전달해도 분류기가 blocked를 반환. 합격 기준: 100% blocked, 0% allowed.

## §5. dry-run launch 결과 acceptance 결정

본 §5는 dry-run 검증 결과의 acceptance 결정을 명시한다. 첫째, 본 dry-run 검증은 6/6 PASS로 합격이다. 둘째, 본 dry-run 검증의 합격은 실제 launch의 합격을 보장하지 않는다. 실제 launch는 npm install 의존성 확보 후 별도 task에서 검증되어야 한다. 셋째, 본 dry-run 검증의 합격은 본 repo의 local UI scaffold 코드 자체가 syntax 오류 0건 + validator 45/45 PASS + deprecated 격리 완료 상태임을 입증한다. 넷째, 본 dry-run 검증의 합격은 향후 실제 launch task의 prerequisite 조건이 충족되었음을 의미한다.

본 acceptance 결정은 본 §6 실제 launch 절차의 prerequisite로 사용된다. 본 dry-run 검증의 합격 없이는 본 §6 실제 launch 절차를 시작할 수 없다.

## §6. 실제 launch 절차 (npm install 허용 후)

본 §6는 npm install이 Jessie에 의해 허용된 경우 실제 launch를 수행하기 위한 절차를 한국어로 풀어 명시한다. 본 절차는 본 §4 acceptance criteria를 모두 만족시키기 위한 단계별 가이드이다.

첫째 단계, 의존성 설치. 명령: `npm install`. 합격: 0 오류, node_modules 생성, package-lock.json 일치. 둘째 단계, vite build. 명령: `npm run vite:build`. 합격: 0 오류, dist/index.html 생성. 셋째 단계, electron launch. 명령: `npm run electron:dev`. 합격: Electron 윈도우 생성, ready-to-show 발화. 셋째 단계가 실패하면 셋째 단계 결과를 캡처한 뒤 본 dry-run 검증 산출물에 첨부하고 별도 task에서 디버깅한다.

넷째 단계, GUI 검증. 검증: Pipeline tab → 11 패널 mount → side-effect gate 표시 → command preview 표시. 합격: 본 §4 acceptance criteria 9개 항목 모두 PASS. 다섯째 단계, IPC bridge 검증. 검증: window.filmPipeline surface 9개 노출 확인. 합격: 9/9 surface, 0 그 외. 여섯째 단계, production reader 검증. 검증: Layout B fixture 로드. 합격: walkFiles 결과 정상, secret성 entry 0건.

일곱째 단계, classification hard-block 검증. 검증: 임의의 명령 사양 전달 → 분류 결과 blocked. 합격: 100% blocked. 여덟째 단계, GUI launch 검증 종료. 검증 결과를 본 §7 launch 검증 보고에 기록. 합격: 본 §4 acceptance criteria 9개 항목 모두 PASS이면 launch 검증 종료. 한 항목이라도 FAIL이면 launch 검증 실패로 별도 디버깅 task 진행.

## §7. launch 검증 보고 양식

본 §7은 launch 검증 종료 시 작성해야 할 보고 양식을 명시한다. 본 보고는 `docs/ui_integration/17_app_launch_verification.md`의 후속 또는 별도 `18_*` 파일로 작성된다. 본 보고는 다음 4개 항목을 포함한다. 첫째, npm install 결과 (오류 메시지, 완료 시각, node_modules 크기). 둘째, vite build 결과 (오류 메시지, dist/index.html 생성 시각, dist/assets/* 파일 목록). 셋째, electron launch 결과 (Electron 윈도우 생성 시각, ready-to-show 발화 시각, 에러 메시지 유무). 넷째, GUI 검증 결과 (본 §4 acceptance criteria 9개 항목별 PASS/FAIL).

## §8. 한계 인정

본 §8은 본 검증의 한계를 인정한다. 첫째, 본 검증은 정적 분석과 unit test만 수행했으며 runtime 분석은 수행하지 않았다. 둘째, npm install이 아직 실행되지 않아 build/launch를 검증하지 못했다. 셋째, vite.config.mjs는 hosted MuAPI proxy(`/api` → `https://api.muapi.ai`) 설정을 가지며 본 격리 정책과 정합하지 않는다. 향후 본 설정은 deprecated 격리의 후속 task에서 제거되어야 한다. 넷째, electron 빌드의 full GUI 검증은 본 §4 acceptance criteria 9개 항목 모두 PASS이어야 완료로 인정된다.

본 한계는 dry-run 정적 검증의 범위 안에서 발생하는 한계이며 실제 launch 시 추가 검증이 필요하다.

## §9. STOP — commit 금지

본 검증 산출물의 commit은 별도 task에서 Jessie 승인 후 진행한다. 본 task 동안 git add, git commit, git push 호출은 일체 시도되지 않았다. 본 검증의 외부 side effect 실행 0건, npm install 0회, electron launch 0회이다. 본 §6 실제 launch 절차는 Jessie가 npm install을 별도 승인한 경우에만 진행된다.