# Cinematic Pipeline Studio 현재 인수 상태

기준일: 2026-07-13 (Asia/Seoul)

이 문서는 `docs/ui_integration`의 현재 상태 기준점이다. 이전 문서의 작성 당시 사실과 검증 기록은 보존하되, 현재 완료 여부와 남은 차단은 이 문서와 `.agent/goal-checkpoint.md`를 우선한다.

## 현재 결론

로컬 Vite/Electron 제품 경로, Electron 보안 경계, `window.filmPipeline` bridge, dry-run/command-preview 정책, Layout A/B fixture reader, validator 상태 분리는 코드와 자동 검증 기준으로 통과했다. `main`에는 관련 변경이 통합되어 있고 외부 생성·업로드·브라우저 자동화는 실행하지 않았다.

production 완료를 선언할 수는 없다. 실제 Electron GUI에서 10개 core panel과 현재 11-tab UI, 폴더 선택, 상태 복원, 오류 표시, blocked command preview를 확인한 증거가 아직 없다. 실제 production 후보 2개도 완전한 구조화 Layout A/B가 아니라 partial/unknown으로 판정되었다.

## 인수 기준 현황

| 기준 | 상태 | 현재 증거 또는 남은 조건 |
| --- | --- | --- |
| AC1 active MuAPI 격리 | VERIFIED | `4dac387`; 기본 dev/build/start는 Vite/Electron이며 active MuAPI surface scan 통과 |
| AC2 Electron 보안 | VERIFIED | 외부 navigation deny-by-default, 보안 regression 6/6 PASS |
| AC3 renderer/main 경계 | VERIFIED | renderer는 preload의 `window.filmPipeline`을 사용하고 main이 file/preview 경계를 소유 |
| AC4 side-effect 차단 | VERIFIED (code/test) | live generation/upload는 연결하지 않았고 command preview만 허용 |
| AC5 실제 GUI | PENDING | 실제 Electron 창에서 panel/folder/state/error/blocked preview 증거 필요 |
| AC6 production reader | VERIFIED (fixture/fail-safe) | `93f35a3`, focused 8/8 PASS; 실제 후보는 partial/unknown |
| AC7 자동 검증 | PARTIAL PASS | network-denied 전체 65/65, lint, build 39 modules, diff check PASS; 실제 GUI 범위 미완료 |
| AC8 문서 정합성 | VERIFIED | 본 상태 문서와 각 역사 문서의 현재 상태 안내로 기준점을 일치시킴 |
| AC9 secret/외부 side effect | PARTIAL PASS | active-source와 reader 방어 통과, 외부 실행 0건; npm offline audit은 0건이나 OSV DB 부재는 `SCANNER_GAP` |
| AC10 상태 분리 | VERIFIED (code/test) | planning/submission/review/quality/dashboard/backend/accepted-seconds를 독립 상태로 유지 |

## 현재 검증 증거

- P0 보안 통합 commit: `4dac3871202b8c1e6dc057d0e53e513ff7fa1678`
- 보안 인수 기록 commit: `86655d7e`
- Layout A/B reader commit: `93f35a3cfafd72e6da8c0c6ab9e6eb0957b6ceec`
- network-denied 전체 테스트: 65/65 PASS
- lint: PASS
- Vite build: PASS, 39 modules
- `git diff --check`: PASS
- 상세 reader 증거: `docs/ui_integration/20_production_reader_validation.md`
- renderer 계약 증거: `docs/ui_integration/22_renderer_contract_validation.md`
- offline dependency 증거: `docs/ui_integration/23_offline_dependency_audit.md`
- 운영 시작 안내: repository root `README.md`

Jessie가 승인한 `release/`와 `/tmp/open-generative-ai-security-review-20260713-p0` 삭제는 완료되었고 두 경로는 재생성되지 않았다.

## 실제 production probe의 정확한 한계

- `gangnam_shorts_system_income_20260707`: partial Layout B, 293 files, 구조화 packet 불완전, `final_ready:false`
- `ep01_apologist`: unknown, 524 files, 구조화 계약 불충족, `final_ready:false`
- 잔여 표식: `REAL_LAYOUT_A_GAP`, `REAL_LAYOUT_B_PARTIAL`

위 결과는 reader가 실패 안전하게 동작한다는 증거이지, 실제 자산이 fixture 수준으로 완전히 복원된다는 증거는 아니다.

## 남은 작업과 승인 경계

1. 실제 Electron GUI 검증: 10개 core panel/11-tab, 폴더 선택, 상태 복원, 오류 처리, blocked preview를 항목별로 확인하고 증거를 남긴다.
2. 완전한 실제 Layout A와 Layout B가 생기면 aggregate-only read-only probe를 다시 수행한다.
3. OSV 취약점 검사는 오프라인 DB가 제공되면 재실행하거나 `SCANNER_GAP`을 명시적으로 수용한다.
4. remote push는 수행하지 않았다. `main`의 로컬 커밋과 원격 상태는 별도 사실로 취급한다.

브라우저 자동화, 외부 계정 접근, generation/upload, deploy/release는 현재 승인 범위가 아니며 실행하지 않는다. 실제 GUI 자동화가 필요하면 해당 회차의 명시적 Jessie 승인을 먼저 받는다.
