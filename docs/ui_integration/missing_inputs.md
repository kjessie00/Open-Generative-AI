# Pipeline 입력 상태

기준일: 2026-07-13 (Asia/Seoul)

## 해결됨: MISSING_PIPELINE_DOC

최초 차단이었던 다음 필수 문서는 현재 저장소에 존재한다.

- `docs/harness/shorts-SKILL.md`
- `docs/harness/Seedance2-SKILL.md`

따라서 `MISSING_PIPELINE_DOC`는 현재 blocker가 아니다. 초기 감사와 계약 문서 `00_repo_audit.md`, `01_harness_to_ui_contract.md`, `02_implementation_plan.md`, `03_shell_implementation_report.md`도 존재한다.

## 남은 입력·증거 gap

- `REAL_LAYOUT_A_GAP`: 실제 날짜-run Layout A의 완전한 production 표본은 아직 없다. Layout A fixture E2E는 PASS다.
- `STRUCTURAL_REVIEW_EVIDENCE_GAP`: 기존 두 production 포맷은 `gangnam_scene_bundle`과 `markdown_scene_pack`으로 인식·복원되지만, 구조-only storyboard/motion은 continuity·duration lock·review PASS가 아니다. 상세 결과는 `docs/ui_integration/24_real_layout_compatibility.md`를 따른다.
- `NATIVE_FOLDER_SELECTION_ROOT2_GAP`: 실제 Electron window/preload/11-tab/fixture와 첫 production native selection은 PASS다. 두 번째 production은 sidebar/preload IPC로 state를 복원했다. 후속 회차에서 native sheet가 canonical parent에서 열리는 것까지는 증명했지만 bounded AX selection/Return은 parent root를 반환했다. 상세 증거는 `docs/ui_integration/25_electron_gui_acceptance.md`를 따른다.
- `OSV_OFFLINE_DB_GAP`: 외부 네트워크 금지 상태에서 사용할 offline OSV database가 없어 dependency vulnerability 판정은 완료되지 않았다.

## 해결됨: TRUSTED_COPY_GESTURE_GAP

Electron main-process clipboard IPC가 normalized preview를 쓴 직후 read-back
equality를 검증하며, 실제 macOS trusted click에서 화면 preview와 길이 및
SHA-256이 일치했다. 결과는 `verified:true`, `executed:false`였고 command
실행 event는 0이었다. clipboard 원문은 로그나 문서에 저장하지 않았다.

## 해결됨: ACTIVE_LEGACY_GENERATION_BRIDGE_GAP

기본 Electron main lifecycle은 더 이상 `localInference` 또는
`wan2gpProvider`를 import/register하지 않으며 preload는 `window.filmPipeline`만
노출한다. 실제 network-denied Electron에서 `window.localAI === undefined`,
legacy control 0, external request 0을 확인했다. dormant 소스는 active import
graph 회귀로 도달 불가를 계속 검증한다.

현재 상태와 승인 경계는 `docs/ui_integration/21_current_acceptance_status.md`와 `.agent/goal-checkpoint.md`를 우선한다. 실제 generation, 외부 upload, browser automation, account access는 명시적 현재 회차 승인 없이는 계속 금지한다.
