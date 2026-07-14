# Cinematic Pipeline Studio 현재 인수 상태

기준일: 2026-07-14 (Asia/Seoul)

이 문서는 `docs/ui_integration`의 현재 상태 기준점이다. 이전 문서의 작성 당시 사실과 검증 기록은 보존하되, 현재 완료 여부와 남은 차단은 이 문서와 `.agent/goal-checkpoint.md`를 우선한다.

## 현재 결론

로컬 Vite/Electron 제품 경로, Electron 보안 경계, dry-run/command-preview 정책,
Layout A/B reader와 상태 분리는 코드·자동 검증 기준으로 통과했다. 기본 main
lifecycle의 Local AI/Wan2GP provider 등록과 `window.localAI` bridge는 제거됐고,
dormant source는 active import graph에서 도달 불가다.

현재 build를 외부망 차단 상태의 실제 Electron에서 새로 검증했다. 정확한 21-method
`window.filmPipeline`, `window.localAI === undefined`, 11개 한국어 메뉴/heading,
fixture 상태와 두 승인 production의 비-native 읽기, 320×900·768×900·1024×768·
1440×900 화면의 horizontal overflow/clipped interactive 0건이 PASS했다. Renderer
external request, generation/submit/upload 실행 control과 외부 side effect도 0건이다.

G3는 실제 renderer control에 untrusted bubbling `input`/`change`를 보내 후보와
편집 값을 선택했고, preload/main IPC가 `g3-preview-loaded`를 정확히 한 번
`executed:false`로 반환하는 데까지 PASS했다. 그러나 renderer가 만든
`data:video/...` source를 `index.html`의 CSP `media-src 'self' blob: file:`이
거부했다. Video는 error code 4, `readyState:0`, `networkState:3`으로 metadata-ready에
도달하지 못했다. Stop rule에 따라 save/export click과 파일은 0건이고 full
quit/relaunch restore는 N/A다. 상세 증거는
`docs/ui_integration/36_current_electron_runtime_acceptance.md`를 따른다.

후속 worktree에서는 `data:` 생성을 제거하고 bounded base64를 검증·chunk decode한
Blob object URL만 쓰도록 수정했다. 첫 격리 Electron 회차는 preview click 뒤
`G3_PREVIEW_VIDEO_NOT_CREATED`로 중단됐지만, 진단이 main IPC `g3-preview-loaded` 1회
뒤 renderer `helper_fail_closed` branch와 잘못된 Chromium `atob` receiver를 확정했다.
기본 browser `atob`만 `globalThis` receiver에 bind하는 한 줄 수정과 default-path
회귀를 추가했다.

수정 후 실제 Electron 인수는 PASS다. 화면의 untrusted DOM click 1회가 정확히 한
번의 `g3-preview-loaded`/`executed:false`에 도달했고, Blob-only video는
`readyState:4`, `networkState:1`, error 없음, duration 18.6초와 `loadedmetadata`를
확인했다. Preview/save/export는 각 1회이고 모두 `executed:false`다. 격리 draft
namespace에는 mode `0700` 폴더와 mode `0600`인 `draft.json`,
`g3_review_export.json`, `selected_takes.json`만 존재하며 atomic residue는 0이다.
동일 격리 profile을 완전히 종료·재시작한 뒤 provider/dialogue/beat/take/range가
복원됐고 stale/source blocker는 없다. 별도 OS 창 캡처도 decoded frame/controls와
사람 선택 form을 확인했다. 외부 renderer request, console/log/exception, 강제 종료,
잔존 PID/listener와 production/HVF/ledger write는 모두 0이다. 상세:
`docs/ui_integration/37_g3_blob_preview_runtime_fix.md`.

최신 G3 production 반영 슬라이스는 private strict export를 production의 exact
`selected_takes.json` 한 파일에만 반영한다. Main-memory 계획 token은 2분 TTL·1회용이고
current source/manifest/QC/candidate inventory, private draft/export hash와 target identity에
묶인다. Renderer에는 production 경로가 없으며 promote payload는 token, exact project
ID, boolean 확인 세 필드만 허용한다. 반영 직전 모든 근거와 target을 다시 읽어 stale을
차단하고, private lock/pending/backup/receipt와 mode `0600` exclusive temp, fsync, atomic
rename, stable post-write hash를 사용한다. 같은 hash는 `executed:false` no-op이다.

외부망 차단 actual Electron fixture 회차는 정확한 21-method bridge, path 없는 ready
plan, 실제 GUI의 trusted input/change/click, `g3-production-promoted` 1회
`executed:true`, exact target hash·mode `0600`, private receipt, source invariant와
full quit/relaunch 후 `already_current`를 확인했다. 외부 request/console/log/exception,
잔존 process, 실제 Jessie production/HVF write, generation/upload/command/ffmpeg/ffprobe는
모두 0이다. 별도 panel capture는 이미 최신 badge, target/project/hash/safety 요약과
반영 button 0건을 보여준다. 상세: `docs/ui_integration/38_g3_production_promotion_cas.md`.

독립 verifier가 `e7926ff`에서 발견한 P2 one-shot 순서 문제도 후속 수정했다. 유효한
raw token은 이제 exact payload shape, confirmation, expiry와 evidence 검증보다 먼저
lookup/delete되어 `confirmed:false`, extra field, malformed confirmation을 포함한 모든
promote 시도에서 즉시 1회 소모된다. Invalid/nonexistent raw token은 다른 유효 plan을
소모하지 않는다. 제품 수정 전 새 promotion file은 9/12로 정확히 세 replay 회귀가
실패했고, 수정 후 12/12다. 새 actual Electron main IPC 회차도 invalid attempt, 같은
token INVALID, fresh plan 정상 반영, 정상 token 재사용 INVALID, relaunch
`already_current`와 21-method bridge를 PASS했다. 최종 acceptance는 새 follow-up
commit의 root independent verifier가 별도로 수행해야 한다.

과거 native folder 결과는 보존하지만 현재 21-method build의 native selection
PASS로 소급하지 않는다. 이번 distinct 회차는 native dialog와 trusted keyboard를
재시도하지 않았고, mobile stage select는 programmatic DOM change만 PASS했다.
따라서 current native selection과 actual keyboard-only interaction은 BLOCK이다.

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
| AC3 renderer/main 경계 | EXECUTOR PASS / INDEPENDENT BLOCK | current actual Electron preload는 정확히 `filmPipeline` 21 methods, `setConfig` 없음; G3 preview와 pathless promotion plan/promote가 main-owned root/read/write를 사용하고 renderer promote payload는 exact 3 fields; 독립 planning-write/path-provenance verifier verdict 없음 |
| AC4 side-effect 차단 | VERIFIED (code/test) | live generation/upload는 연결하지 않았고 검증된 preview만 복사 가능; 불완전한 ffprobe/concat은 command/copy 모두 disabled |
| AC5 실제 GUI | PARTIAL PASS | 21-method/11개 한국어 menu/4 viewport/두 root 비-native 증거, Blob-only metadata/save/export restore와 trusted confirmation 기반 fixture promotion/full quit-relaunch·별도 panel 캡처 PASS; current native selection과 actual mobile keyboard-only는 BLOCK |
| AC6 production reader | VERIFIED (fixture/real/fail-safe) | Layout A/B와 실제 variant, canonical pack/ledger, selected takes/QC 및 exact delivery manifest/master SHA golden·missing·malformed·oversize·symlink·unsafe/stale/changed path·range·ID/QC conflict matrix PASS; 실제 두 경로 구조 복원 및 final fail-closed 확인 |
| AC7 자동 검증 | VERIFIED (명시된 독립 gaps 제외) | G3 promotion 포함 focused 44/44, network-denied 전체 162/162, lint, build 50 modules와 actual Electron one-shot/promotion/relaunch 회차 PASS |
| AC8 문서 정합성 | VERIFIED | 본 상태 문서와 각 역사 문서의 현재 상태 안내로 기준점을 일치시킴 |
| AC9 secret/외부 side effect | PARTIAL PASS | active-source와 reader 방어 통과, 외부 실행 0건; npm offline audit은 0건이나 OSV DB 부재는 `SCANNER_GAP` |
| AC10 상태 분리 | VERIFIED (code/test) | planning/submission/review/quality/dashboard/backend/accepted-seconds와 canonical deterministic/external/canonical/human/final 상태를 독립 유지 |

## 현재 검증 증거

- P0 보안 통합 commit: `4dac3871202b8c1e6dc057d0e53e513ff7fa1678`
- 보안 인수 기록 commit: `86655d7e`
- Layout A/B reader commit: `93f35a3cfafd72e6da8c0c6ab9e6eb0957b6ceec`
- 외부망 제한 환경 전체 테스트: 162/162 PASS
- G3 production promotion focused: 44/44 PASS; P2 follow-up 전용 file은 수정 전 9/12, 수정 후 12/12
- canonical delivery focused: 첫 실행 35/38, 허용된 1회 국소 self-fix 후 38/38 PASS
- canonical finishing focused: 첫 실행 44/44 PASS, self-fix 없음
- canonical handoff focused: targeted self-fix 후 38/38 PASS
- network-denied provenance/security/renderer focused: 32/32 PASS
- lint: PASS
- Vite build: PASS, 50 modules
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
- current Electron runtime acceptance: `docs/ui_integration/36_current_electron_runtime_acceptance.md`
- G3 blob preview 수정 및 최종 runtime PASS: `docs/ui_integration/37_g3_blob_preview_runtime_fix.md`
- G3 production promotion/CAS 및 actual runtime PASS: `docs/ui_integration/38_g3_production_promotion_cas.md`
- native/clipboard focused regression: 12/12 PASS
- active Electron entrypoint focused security regression: 8/8 PASS
- historical fresh runtime: `window.localAI === undefined`, 당시 `window.filmPipeline` 12 methods, legacy/unsafe enabled control 0, `file:` 7/external request 0, renderer console warning/error 0
- current actual Electron preload: `window.filmPipeline` 정확히 21 methods, public `setConfig` 0건, `window.localAI === undefined`
- current G3 preview: historical data/CSP 실패 뒤 잘못된 Chromium `atob` receiver를 수정했고 Blob-only metadata-ready, save/export exact private 3 files, 별도 OS 창 캡처와 full quit/relaunch restore PASS
- current G3 promotion: fixture exact target 생성·mode `0600`·private receipt·trusted confirmation·relaunch already-current PASS; 실제 Jessie production/HVF write는 0건
- current G3 one-shot follow-up: confirmed false 뒤 same-token INVALID, fresh-plan valid promote, valid-token replay INVALID와 relaunch already-current actual Electron PASS
- G3 promotion panel capture: SHA-256 `c1bf4687b6e50057115912c2012811e903de63099626b9c2b7d51d98155b5646`
- canonical harness source probe: exact 5/5 `available`; content 반환 0, renderer root 입력 0
- fresh runtime screenshot (private temp only): SHA-256 `0280c8892a5e6c9dbf9a913ade9d9ec4618a554b6d9564246f68e28da5539e70`
- trusted copy aggregate: 86 bytes, SHA-256 `7401b0abcbdf800d5d75aa1c278ef1f45c4578755fb6fecc45d505689065cf5c`, `verified:true`, `executed:false`

Jessie가 승인한 `release/`와 `/tmp/open-generative-ai-security-review-20260713-p0` 삭제는 완료되었고 두 경로는 재생성되지 않았다.

## 실제 production probe의 현재 결과

- `gangnam_shorts_system_income_20260707`: Layout B / `gangnam_scene_bundle`, 293 files, storyboard/prompt/queue/report 구조 복원, `final_ready:false`
- `ep01_apologist`: Layout B / `markdown_scene_pack`, 524 files, storyboard/motion/prompt/media 구조 복원, `final_ready:false`
- 두 경로 모두 별도 격리 profile의 current actual Electron 비-native 읽기에서 같은
  file count와 `final_ready:false`를 복원했고 unsafe enabled control은 0건이었다.
- 두 경로 모두 runtime 전후 aggregate manifest hash가 동일하다.
- 잔여 표식: `REAL_LAYOUT_A_GAP`, `STRUCTURAL_REVIEW_EVIDENCE_GAP`

위 결과는 실제 작업 폴더를 탐색 가능한 UI state로 복원한다는 증거다. 구조 존재를 review/quality PASS로 승격하지 않으며 상세 blocker는 `24_real_layout_compatibility.md`를 따른다.

## 남은 작업과 승인 경계

1. G3 blob helper의 Chromium `atob` receiver 수정과 실제 Electron
   metadata/save/export/full quit-relaunch 및 별도 OS 창 캡처는 PASS다. 이어지는
   G3 promotion/CAS도 격리 fixture exact target 생성과 relaunch already-current까지
   PASS했지만 실제 Jessie production 반영이나 output quality 인수는 아니다.
2. Current 21-method build의 native folder selection은 별도 macOS dialog
   harness나 사용자 직접 선택으로 재검증한다. 과거 fixture/Gangnam native PASS와
   현재 비-native production read PASS를 current native PASS로 승격하지 않는다.
3. 완전한 실제 날짜-run Layout A가 생기면 aggregate-only read-only probe를 수행한다.
4. OSV 취약점 검사는 오프라인 DB가 제공되면 재실행하거나 `SCANNER_GAP`을 명시적으로 수용한다. fresh HOME deny-network OSV v2.4.0은 1,097 packages/4 filtered 뒤 exit 127과 `no offline version of the OSV database is available`을 반환했다.
5. 과거 committed runtime의 정확한 console blocker는 CSP의 `data:` media
   rejection이었다. 후속 blob 진단의 정확한 branch는 잘못된 Chromium `atob`
   receiver로 인한 helper fail-closed였고, 수정 후 actual Electron은 media 성공과
   console/log/exception 0건을 확인했다. 역사 문서 36의 당시 BLOCK은 그대로 보존한다.
6. 모바일 작업 단계 select의 programmatic DOM change/heading 계약은 PASS다. 실제 macOS keyboard-only 변경은 값과 heading을 같은 저장 증거로 재검증한다.
7. remote push는 수행하지 않았다. `main`의 로컬 커밋과 원격 상태는 별도 사실로 취급한다.
8. planning-write/path-provenance 독립 인수는 BLOCK이다. 첫 verifier와 fallback
   verifier가 모두 코드 판정 전에 classifier에서 실패했고 독립 verdict가 없다.
   자동 verifier는 더 호출하지 않으며 root도 최종 security acceptance하지 않는다.
9. 실제 production의 selected takes/QC는 이번 슬라이스에서 읽지 않았다. 실제
   finishing quality를 주장하려면 별도 승인된 read-only production 회차와 GUI
   증거가 필요하다.
10. Canonical delivery의 producer-persisted probe는 지원하지만 fresh ffprobe를
    실행하거나 증거 JSON을 새로 만들지는 않는다. Selected-range render plan과
    fresh-probe 실행 계약이 별도 구현·검증되기 전까지 최종 ffmpeg/ffprobe command
    card는 disabled 상태를 유지한다.
11. G3 promotion lock은 같은 앱/private namespace의 협조 promotion만 직렬화한다.
    Node/macOS API에는 이 구현이 사용할 native dirfd `openat`/`renameat` 또는
    no-replace CAS가 없어, 최종 target 재확인과 rename 사이 비협조 writer의 잔여
    TOCTOU를 race-free라고 주장하지 않는다. 실제 production 사용 정책에서 이
    한계를 수용하거나 native helper를 별도 구현해야 한다.

본 회차의 GUI 자동화는 Jessie의 current-turn 승인 아래 외부망 차단으로 수행했다. 외부 계정 접근, generation/upload, deploy/release는 실행하지 않았다.
