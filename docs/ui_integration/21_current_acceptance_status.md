# Cinematic Pipeline Studio 현재 인수 상태

기준일: 2026-07-13 (Asia/Seoul)

이 문서는 `docs/ui_integration`의 현재 상태 기준점이다. 이전 문서의 작성 당시 사실과 검증 기록은 보존하되, 현재 완료 여부와 남은 차단은 이 문서와 `.agent/goal-checkpoint.md`를 우선한다.

## 현재 결론

로컬 Vite/Electron 제품 경로, Electron 보안 경계, `window.filmPipeline` bridge, dry-run/command-preview 정책, Layout A/B fixture reader, validator 상태 분리는 코드와 자동 검증 기준으로 통과했다. 추가 최소권한 패치로 기본 main lifecycle의 Local AI/Wan2GP provider 등록과 `window.localAI` bridge를 제거했고, 실제 Electron은 `window.filmPipeline` 12개 method만 노출한다. dormant 소스는 기본 active import graph에서 도달 불가다. 외부 생성·업로드·계정 작업은 실행하지 않았다.

실제 Electron GUI는 외부망 차단 상태에서 실행되었고 10개 core panel/11-tab, preload IPC, 상태 복원, blocker/copy-only preview, 1440×900 및 1024×640 레이아웃이 검증되었다. fixture와 첫 번째 production의 native folder selection은 PASS다. 두 번째 production은 sidebar/preload로 UI state를 복원했지만 native sheet 자동화가 parent root를 반환하여 `NATIVE_FOLDER_SELECTION_ROOT2_GAP`이 남는다. main-process clipboard IPC와 실제 macOS trusted click은 write/read-back/hash equality 및 `executed:false`로 PASS했다. review/dashboard/accepted-seconds/final-quality는 계속 blocker다.

## 인수 기준 현황

| 기준 | 상태 | 현재 증거 또는 남은 조건 |
| --- | --- | --- |
| AC1 active MuAPI 격리 | VERIFIED | `4dac387`; 기본 dev/build/start는 Vite/Electron이며 active MuAPI surface scan 통과 |
| AC2 Electron 보안 | VERIFIED | 외부 navigation deny-by-default, active provider/bridge 최소권한, 보안 regression 8/8 PASS |
| AC3 renderer/main 경계 | VERIFIED | renderer global은 `window.filmPipeline`만 노출하고 main이 file/preview 경계를 소유; `window.localAI` undefined |
| AC4 side-effect 차단 | VERIFIED (code/test) | live generation/upload는 연결하지 않았고 command preview만 허용 |
| AC5 실제 GUI | PARTIAL PASS | 실제 window/preload/11-tab/fixture+첫 root native/state/blocked preview/trusted copy/visual PASS; 두 번째 root native selection만 BLOCK |
| AC6 production reader | VERIFIED (fixture/real/fail-safe) | Layout A/B와 실제 variant golden 10/10 PASS; 실제 두 경로 구조 복원 및 final fail-closed 확인 |
| AC7 자동 검증 | VERIFIED (root2 native exception) | network-denied 전체 74/74, lint, build 36 modules, diff check 및 실제 GUI runtime PASS |
| AC8 문서 정합성 | VERIFIED | 본 상태 문서와 각 역사 문서의 현재 상태 안내로 기준점을 일치시킴 |
| AC9 secret/외부 side effect | PARTIAL PASS | active-source와 reader 방어 통과, 외부 실행 0건; npm offline audit은 0건이나 OSV DB 부재는 `SCANNER_GAP` |
| AC10 상태 분리 | VERIFIED (code/test) | planning/submission/review/quality/dashboard/backend/accepted-seconds를 독립 상태로 유지 |

## 현재 검증 증거

- P0 보안 통합 commit: `4dac3871202b8c1e6dc057d0e53e513ff7fa1678`
- 보안 인수 기록 commit: `86655d7e`
- Layout A/B reader commit: `93f35a3cfafd72e6da8c0c6ab9e6eb0957b6ceec`
- network-denied 전체 테스트: 74/74 PASS
- lint: PASS
- Vite build: PASS, 36 modules
- `git diff --check`: PASS
- 상세 reader 증거: `docs/ui_integration/20_production_reader_validation.md`
- 실제 포맷 호환성 증거: `docs/ui_integration/24_real_layout_compatibility.md`
- renderer 계약 증거: `docs/ui_integration/22_renderer_contract_validation.md`
- offline dependency 증거: `docs/ui_integration/23_offline_dependency_audit.md`
- 운영 시작 안내: repository root `README.md`
- 실제 Electron GUI 증거: `docs/ui_integration/25_electron_gui_acceptance.md`
- native/clipboard focused regression: 12/12 PASS
- active Electron entrypoint focused security regression: 8/8 PASS
- fresh runtime: `window.localAI === undefined`, `window.filmPipeline` 12 methods, legacy/unsafe enabled control 0, `file:` 7/external request 0, renderer console warning/error 0
- fresh runtime screenshot (private temp only): SHA-256 `0280c8892a5e6c9dbf9a913ade9d9ec4618a554b6d9564246f68e28da5539e70`
- trusted copy aggregate: 86 bytes, SHA-256 `7401b0abcbdf800d5d75aa1c278ef1f45c4578755fb6fecc45d505689065cf5c`, `verified:true`, `executed:false`

Jessie가 승인한 `release/`와 `/tmp/open-generative-ai-security-review-20260713-p0` 삭제는 완료되었고 두 경로는 재생성되지 않았다.

## 실제 production probe의 현재 결과

- `gangnam_shorts_system_income_20260707`: Layout B / `gangnam_scene_bundle`, 293 files, storyboard/prompt/queue/report 구조 복원, `final_ready:false`
- `ep01_apologist`: Layout B / `markdown_scene_pack`, 524 files, storyboard/motion/prompt/media 구조 복원, `final_ready:false`
- 두 경로 모두 probe 전후 manifest hash가 동일하다.
- 잔여 표식: `REAL_LAYOUT_A_GAP`, `STRUCTURAL_REVIEW_EVIDENCE_GAP`

위 결과는 실제 작업 폴더를 탐색 가능한 UI state로 복원한다는 증거다. 구조 존재를 review/quality PASS로 승격하지 않으며 상세 blocker는 `24_real_layout_compatibility.md`를 따른다.

## 남은 작업과 승인 경계

1. 두 번째 production의 native folder selection은 사용자 직접 선택 또는 별도 macOS dialog harness로 재검증한다.
2. 완전한 실제 날짜-run Layout A가 생기면 aggregate-only read-only probe를 수행한다.
3. OSV 취약점 검사는 오프라인 DB가 제공되면 재실행하거나 `SCANNER_GAP`을 명시적으로 수용한다. fresh HOME deny-network OSV v2.4.0은 1,097 packages/4 filtered 뒤 exit 127과 `no offline version of the OSV database is available`을 반환했다.
4. remote push는 수행하지 않았다. `main`의 로컬 커밋과 원격 상태는 별도 사실로 취급한다.

본 회차의 GUI 자동화는 Jessie의 current-turn 승인 아래 외부망 차단으로 수행했다. 외부 계정 접근, generation/upload, deploy/release는 실행하지 않았다.
