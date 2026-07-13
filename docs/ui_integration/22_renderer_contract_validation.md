# Renderer production UI 계약 검증

검증일: 2026-07-13 (Asia/Seoul)
실행자: `renderer_contract_integrator`
범위: 실제 Electron GUI 승인 전 결정론적 renderer 통합 검증

## 결론

`PipelineStudio()`의 실제 제품 구성요소 경로를 새 패키지 없이 Node의 결정론적 최소 DOM harness에서 실행했다. 저장된 config/state 복원, folder picker 전환, reader 오류와 복구 표면, 11개 탭과 10개 core panel, dry-run 강제 잠금, Queue의 blocked/copy-only command preview를 이벤트 수준에서 검증했다. focused test 1/1과 전체 65/65, lint, network-denied Vite build, diff check가 모두 통과했다.

이 증거는 AC5를 강화하지만 완료하지 않는다. 현재 제품 renderer는 React component가 아니라 `src/main.js → PipelineStudio() → HTMLElement`인 vanilla DOM 경로다. 이 테스트는 그 실제 구성요소를 호출하지만 Electron 창, 실제 preload IPC, CSS layout, 브라우저 media loading, visual/console evidence를 검증하지 않는다. 따라서 실제 Electron GUI 증거는 계속 `PENDING`이다.

## 검증 흐름

`PipelineStudio 실제 renderer 생성 → bridge config로 production state 복원 → Open Production Folder 이벤트 → parent refresh 오류 → 11개 탭 클릭 → Queue side-effect/command-preview 계약 확인`

외부 네트워크, Electron/브라우저 launch, generation, upload, DeepSearchTeam/Gemini/imagegen, package 설치, `electron-builder`, ffmpeg/ffprobe 실행은 모두 수행하지 않았다.

## 관찰 가능한 계약

| 계약 | 결과 | assertion 증거 |
| --- | --- | --- |
| 저장 상태 복원 | PASS | `getConfig()`의 `productionRoot`가 `readProductionState()`에 전달되고 `Restored Production State`가 렌더됨 |
| folder selection | PASS | `Open Production Folder` 클릭이 bridge picker를 1회 호출하고 `Folder Selected Production`으로 변경됨 |
| 안전 config 강제 | PASS | bridge가 `dryRunMode:false`, `allowSafeCommandExecution:true`를 반환해도 UI는 `Dry-run locked` 유지 |
| reader 오류 표면 | PASS | parent read 실패가 `Cannot read parent: READ_PARENT_BLOCKED_FOR_TEST` 및 `Open Settings`로 표시됨 |
| 11-tab surface | PASS | Intake, Storyboard, Shot Designer, Motion Board, Assets, Prompt Packs, Review Gates, Queue, QA, Final, Settings를 각각 클릭하고 panel heading 확인 |
| 10 core panels | PASS (renderer contract) | Shot Designer를 추가 surface로 유지하면서 project mission의 10개 core panel 모두 렌더됨 |
| First-frame/reference dashboard | PASS | Assets panel의 `Harness image dashboard mirror` 표면 확인 |
| blocked submit | PASS | Queue에 `CREDIT_CONFIRMATION_REQUIRED`, `DREAMINA_PREFLIGHT_BLOCKED`, disabled `Submit disabled` 확인 |
| copy-only preview | PASS | command cards에 `Copy command`와 `No run button is rendered`가 있고 활성 run/execute/generate/submit/upload 버튼 0개 |
| 무실행 보장 | PASS | render/navigation 동안 `previewCommand`, `runSafeCommand`, `writePlanningFile` bridge 호출이 각각 0회 |

## 변경 파일

- `tests/rendererContract.test.mjs`
- `docs/ui_integration/22_renderer_contract_validation.md`
- `.agent/goal-checkpoint.md`

제품 코드 수정이나 새 dependency는 없다.

## 실행 증거

모든 실행 검증은 macOS `sandbox-exec`의 `(deny network*)` profile 아래 수행했다.

```text
node --test tests/rendererContract.test.mjs
PASS 1/1

node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs
PASS 65/65

npm run lint
PASS

npm run build
PASS · Vite 5.4.21 · 39 modules transformed

git diff --check
PASS
```

`release/`는 생성되지 않았다. Vite의 ignored `dist/`만 정상 build output으로 갱신되었다.

## 정확한 잔여 범위

- actual Electron window의 표시·탐색·visual layout은 미검증
- 실제 preload IPC 대신 계약형 bridge mock을 사용
- 실제 native folder dialog는 미호출
- CSS clipping/overlap/responsive viewport, console health, image/video rendering은 미검증
- 브라우저/Electron screenshot evidence 없음
- 실제 완전한 production Layout A/B 부재 문제는 본 renderer test 범위 밖이며 `REAL_LAYOUT_A_GAP`, `REAL_LAYOUT_B_PARTIAL`이 유지됨
- offline OSV DB 부재 `SCANNER_GAP`도 유지됨

따라서 AC5 상태는 `PARTIAL PASS (deterministic renderer contract)`이며 실제 Electron GUI 승인 전에는 `VERIFIED`로 올리지 않는다.
