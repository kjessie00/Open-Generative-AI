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
- `ELECTRON_GUI_EVIDENCE_PENDING`: 실제 Electron GUI에서 panel, folder selection, state restoration, error handling, blocked command preview를 확인한 증거가 필요하다.
- `OSV_OFFLINE_DB_GAP`: 외부 네트워크 금지 상태에서 사용할 offline OSV database가 없어 dependency vulnerability 판정은 완료되지 않았다.

현재 상태와 승인 경계는 `docs/ui_integration/21_current_acceptance_status.md`와 `.agent/goal-checkpoint.md`를 우선한다. 실제 generation, 외부 upload, browser automation, account access는 명시적 현재 회차 승인 없이는 계속 금지한다.
