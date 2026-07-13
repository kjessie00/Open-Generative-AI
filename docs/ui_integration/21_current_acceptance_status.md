# Cinematic Pipeline Studio 현재 인수 상태

기준일: 2026-07-13 (Asia/Seoul)

이 문서는 `docs/ui_integration`의 현재 상태 기준점이다. 이전 문서의 작성 당시 사실과 검증 기록은 보존하되, 현재 완료 여부와 남은 차단은 이 문서와 `.agent/goal-checkpoint.md`를 우선한다.

## 현재 결론

로컬 Vite/Electron 제품 경로, Electron 보안 경계, `window.filmPipeline` bridge, dry-run/command-preview 정책, Layout A/B fixture reader, validator 상태 분리는 코드와 자동 검증 기준으로 통과했다. 추가 최소권한 패치로 기본 main lifecycle의 Local AI/Wan2GP provider 등록과 `window.localAI` bridge를 제거했다. 과거 실제 Electron 증거는 당시 구성의 `window.filmPipeline` 12개 method였고, provenance 하드닝에서 public `setConfig`를 제거한 뒤 11개가 되었다. 현재 코드는 main-owned fixed-root `getHarnessContractStatus`를 추가해 `setConfig` 없는 정확한 12개 method다. 변경 후 실제 Electron은 이번 회차에 실행하지 않았다. dormant 소스는 기본 active import graph에서 도달 불가다. 외부 생성·업로드·계정 작업은 실행하지 않았다.

실제 Electron GUI는 외부망 차단 상태에서 실행되었고 10개 core panel/11-tab, preload IPC, 상태 복원, blocker/copy-only preview, 1440×900 및 1024×640 레이아웃이 검증되었다. fixture와 첫 번째 production의 native folder selection은 PASS다. 두 번째 production은 sidebar/preload로 UI state를 복원했지만 native sheet 자동화가 parent root를 반환하여 `NATIVE_FOLDER_SELECTION_ROOT2_GAP`이 남는다. main-process clipboard IPC와 실제 macOS trusted click은 write/read-back/hash equality 및 `executed:false`로 PASS했다. review/dashboard/accepted-seconds/final-quality는 계속 blocker다.

후속 한국어 UI 실제 검증은 320×900, 768×900, 1024×768,
1440×900에서 11개 한국어 메뉴와 패널, responsive 구조, AX tree, axe 0건,
focus 표시와 details 키보드 조작을 확인했다. 다만 이 후속 회차의
`Log.entryAdded`에는 exact URL이 없는 로컬 `ERR_FILE_NOT_FOUND` 2건이 남아
`console-clean`은 BLOCK이고, 모바일 select의 키보드 선택 변경도 저장된 최종
값이 `intake`라 증거 부족으로 BLOCK이다. 상세 증거는
`docs/ui_integration/27_korean_gui_acceptance.md`를 따른다.

GUI 후속 코드 하드닝에서는 mock 상대 artifact 경로가 샷 기록과 최종 보고서의
`img[src]`로 각각 생성되던 가장 강한 원인 가설을 제거했다. 상대/HTTP source는
경로 메타데이터만 표시하고, absolute local/file/data/blob source만 미리보기를
유지한다. 실제 DOM에서 두 렌더 표면의 negative/positive case와 mobile select의
`storyboard` change/heading 전환이 PASS했다. 다만 exact URL이 없는 과거 오류와
수정 후 실제 Electron console, 실제 macOS 키보드-only 조작은 새 GUI 회차 없이
소급 PASS로 바꾸지 않는다. 상세 증거는
`docs/ui_integration/28_media_preview_hardening.md`를 따른다.

계획 파일 쓰기 IPC는 writer와 root provenance를 모두 최소권한으로 하드닝했다.
Public config mutation을 제거하고 production/parent는 native dialog 결과 또는
configured parent의 main-validated immediate child에서만 갱신한다. List/state/
assets/JSONL reads도 configured root/parent에 bind한다. 세 planning 산출물,
1 MiB cap, parent/leaf symlink 차단, same-directory exclusive/no-follow temp,
flush/close, atomic rename과 실패 cleanup은 유지된다. Temp filesystem, VM preload,
actual registered-handler와 deterministic DOM 회귀는 executor 기준 PASS다.
상세 증거는 `docs/ui_integration/29_planning_write_security.md`와
`docs/ui_integration/30_renderer_path_provenance.md`를 따른다.

보안 독립 인수는 pending이 아니라 BLOCK이다. 첫 독립 verifier와 정확히 한 번의
fallback verifier가 모두 코드 판정 전 cybersecurity classifier에서 실패해
독립 verdict가 없으며 자동 verifier를 더 호출하지 않는다. Root도 이 변경을
최종 security acceptance로 승격할 수 없다.

happyVideoFactory canonical handoff adapter v1은 generic
`build_ai_video_pipeline_plan.py`/`run_ai_video_pipeline.py` preview를 제거했다.
Main은 고정 happyVideoFactory root의 exact 5-file allowlist를 읽기 전용
path/size/SHA-256 metadata로만 반환한다. 기존 canonical Layout A는
`intake/script.txt`, `pipeline_pack_report.json`, submission/jimeng/download
manifest를 bounded/sanitized하게 복원한다. Validator는 canonical 입력이 완전하고
main-owned production root가 일치할 때만 exact absolute command/cwd로 copy할 수
있다. Existing production build, missing/partial contract/input, unsupported route는
copy-disabled다. Network-denied full tests 108/108, lint, Vite build 41 modules가
PASS했다. 실제 production, GUI, live generation은 사용하지 않았다. 상세:
`docs/ui_integration/31_happy_video_factory_handoff_adapter.md`.

Canonical finishing state v1은 exact-root `shot_manifest.json`,
`selected_takes.json`, `qc_report.json`을 512 KiB/1,000 records 상한으로 읽고
최소 구조 메타데이터만 전달한다. 선택 구간은 유한한 in/out, production 내부
비심볼릭 일반 source file, shot manifest와 timeline-builder가 함께 입증한
`clip_<shot_id>` 별칭이 있어야 집계된다. Canonical QC의 deterministic/external
metadata/canonical decision/human decision/overall verdict는 서로 분리되며
canonical `accept`는 output-quality PASS가 아니다. 잘못된 evidence path를
주장하던 ffprobe와 selected range를 무시하던 concat command는 명령·복사·증거
출력을 모두 disabled했다. Focused network-denied 44/44, 전체 115/115, lint,
Vite build 41 modules가 PASS했다. 실제 production, Electron GUI, ffmpeg/ffprobe,
production write는 사용하지 않았다. 상세:
`docs/ui_integration/32_canonical_finishing_state.md`.

Canonical delivery evidence v1은 Layout A의 exact
`final/delivery_manifest.json`만 읽는다. Schema/gate/path/probe/checksum을 제한하고
선택된 `master.mp4` 또는 `master_sub.mp4`를 최대 16 GiB, no-follow/stable
identity, bounded streaming SHA-256으로 다시 검증한다. 검증된 delivery는 final
media, 저장된 producer probe, filter-complex delivery stitch 증거만 충족한다.
Fresh ffprobe, 사람 QA, 모든 선택 구간, submit/download, report, 활성 blocker와
output quality는 계속 분리된다. 무관 mp4/ffprobe는 증거로 승격되지 않으며 final
command card는 command/copy 모두 disabled다. Focused 최종 38/38, network-denied
전체 123/123, lint, Vite build 41 modules가 PASS했다. 실제 production,
Electron/GUI, ffmpeg/ffprobe 또는 production write는 사용하지 않았다. 상세:
`docs/ui_integration/33_canonical_delivery_evidence.md`.

## 인수 기준 현황

| 기준 | 상태 | 현재 증거 또는 남은 조건 |
| --- | --- | --- |
| AC1 active MuAPI 격리 | VERIFIED | `4dac387`; 기본 dev/build/start는 Vite/Electron이며 active MuAPI surface scan 통과 |
| AC2 Electron 보안 | EXECUTOR PASS / INDEPENDENT BLOCK | 외부 navigation deny-by-default, public config mutation 제거, native/immediate-child provenance와 planning exact allowlist/symlink/content/atomic-write 회귀 PASS; 독립 verifier verdict 없음 |
| AC3 renderer/main 경계 | EXECUTOR PASS / INDEPENDENT BLOCK | current preload는 `filmPipeline` 12 methods, `setConfig` 없음; 새 method도 renderer path 인자 없는 fixed-root read-only metadata이며 main이 configured root/parent selection과 read/write를 소유; 독립 verifier verdict 없음 |
| AC4 side-effect 차단 | VERIFIED (code/test) | live generation/upload는 연결하지 않았고 검증된 preview만 복사 가능; 불완전한 ffprobe/concat은 command/copy 모두 disabled |
| AC5 실제 GUI | PARTIAL PASS | 기존 실제 window/preload/11-tab/fixture+첫 root native/state/blocked preview/trusted copy와 한국어 4-viewport/AX/axe/focus PASS; provenance 변경 후 open/parent/sidebar/refresh는 deterministic DOM PASS지만 실제 Electron은 미실행; 두 번째 root native selection, 수정 후 console 및 실제 keyboard-only 증거는 BLOCK |
| AC6 production reader | VERIFIED (fixture/real/fail-safe) | Layout A/B와 실제 variant, canonical pack/ledger, selected takes/QC 및 exact delivery manifest/master SHA golden·missing·malformed·oversize·symlink·unsafe/stale/changed path·range·ID/QC conflict matrix PASS; 실제 두 경로 구조 복원 및 final fail-closed 확인 |
| AC7 자동 검증 | VERIFIED (명시된 GUI/독립 gaps 제외) | canonical delivery 후 network-denied 전체 123/123, delivery focused 38/38, lint, build 41 modules PASS; 기존 실제 GUI runtime 증거는 별도 보존 |
| AC8 문서 정합성 | VERIFIED | 본 상태 문서와 각 역사 문서의 현재 상태 안내로 기준점을 일치시킴 |
| AC9 secret/외부 side effect | PARTIAL PASS | active-source와 reader 방어 통과, 외부 실행 0건; npm offline audit은 0건이나 OSV DB 부재는 `SCANNER_GAP` |
| AC10 상태 분리 | VERIFIED (code/test) | planning/submission/review/quality/dashboard/backend/accepted-seconds와 canonical deterministic/external/canonical/human/final 상태를 독립 유지 |

## 현재 검증 증거

- P0 보안 통합 commit: `4dac3871202b8c1e6dc057d0e53e513ff7fa1678`
- 보안 인수 기록 commit: `86655d7e`
- Layout A/B reader commit: `93f35a3cfafd72e6da8c0c6ab9e6eb0957b6ceec`
- network-denied 전체 테스트: 123/123 PASS
- canonical delivery focused: 첫 실행 35/38, 허용된 1회 국소 self-fix 후 38/38 PASS
- canonical finishing focused: 첫 실행 44/44 PASS, self-fix 없음
- canonical handoff focused: targeted self-fix 후 38/38 PASS
- network-denied provenance/security/renderer focused: 32/32 PASS
- lint: PASS
- Vite build: PASS, 41 modules
- `git diff --check`: PASS
- 상세 reader 증거: `docs/ui_integration/20_production_reader_validation.md`
- 실제 포맷 호환성 증거: `docs/ui_integration/24_real_layout_compatibility.md`
- renderer 계약 증거: `docs/ui_integration/22_renderer_contract_validation.md`
- offline dependency 증거: `docs/ui_integration/23_offline_dependency_audit.md`
- 운영 시작 안내: repository root `README.md`
- 실제 Electron GUI 증거: `docs/ui_integration/25_electron_gui_acceptance.md`
- 한국어 4-viewport GUI 증거: `docs/ui_integration/27_korean_gui_acceptance.md`
- media source 및 mobile select DOM 계약: `docs/ui_integration/28_media_preview_hardening.md`
- planning file 최소권한 쓰기 경계: `docs/ui_integration/29_planning_write_security.md`
- renderer path provenance 경계: `docs/ui_integration/30_renderer_path_provenance.md`
- canonical finishing state: `docs/ui_integration/32_canonical_finishing_state.md`
- canonical delivery evidence: `docs/ui_integration/33_canonical_delivery_evidence.md`
- native/clipboard focused regression: 12/12 PASS
- active Electron entrypoint focused security regression: 8/8 PASS
- historical fresh runtime: `window.localAI === undefined`, 당시 `window.filmPipeline` 12 methods, legacy/unsafe enabled control 0, `file:` 7/external request 0, renderer console warning/error 0
- current preload VM: `window.filmPipeline` 12 methods, public `setConfig` 0건, path-free harness/list/state/assets IPC
- canonical harness source probe: exact 5/5 `available`; content 반환 0, renderer root 입력 0
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
4. 후속 한국어 GUI의 로컬 `ERR_FILE_NOT_FOUND` 2건은 가장 강한 상대 media source 코드 가설을 제거했지만, exact URL을 보존하는 승인된 read-only GUI 회차에서 수정 후 결과를 분류한다. 그 전에는 전체 `console-clean`을 주장하지 않는다.
5. 모바일 작업 단계 select의 DOM change/heading 계약은 PASS다. 실제 macOS 키보드-only 변경은 값과 heading을 같은 저장 증거로 재검증한다.
6. remote push는 수행하지 않았다. `main`의 로컬 커밋과 원격 상태는 별도 사실로 취급한다.
7. planning-write/path-provenance 독립 인수는 BLOCK이다. 첫 verifier와 fallback
   verifier가 모두 코드 판정 전에 classifier에서 실패했고 독립 verdict가 없다.
   자동 verifier는 더 호출하지 않으며 root도 최종 security acceptance하지 않는다.
8. provenance/canonical handoff 변경 후 12-method bridge와 native mode selection은 실제 Electron을
   실행한 회차에서 별도로 확인하기 전까지 runtime PASS로 소급하지 않는다.
9. 실제 production의 selected takes/QC는 이번 슬라이스에서 읽지 않았다. 실제
   finishing quality를 주장하려면 별도 승인된 read-only production 회차와 GUI
   증거가 필요하다.
10. Canonical delivery의 producer-persisted probe는 지원하지만 fresh ffprobe를
    실행하거나 증거 JSON을 새로 만들지는 않는다. Selected-range render plan과
    fresh-probe 실행 계약이 별도 구현·검증되기 전까지 최종 ffmpeg/ffprobe command
    card는 disabled 상태를 유지한다.

본 회차의 GUI 자동화는 Jessie의 current-turn 승인 아래 외부망 차단으로 수행했다. 외부 계정 접근, generation/upload, deploy/release는 실행하지 않았다.
