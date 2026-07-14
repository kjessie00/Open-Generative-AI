# Cinematic Pipeline Studio 현재 인수 상태

기준일: 2026-07-15 (Asia/Seoul)

이 문서는 `docs/ui_integration`의 현재 상태 기준점이다. 이전 문서의 작성 당시 사실과 검증 기록은 보존하되, 현재 완료 여부와 남은 차단은 이 문서와 `.agent/goal-checkpoint.md`를 우선한다.

## 2026-07-15 canonical data migration 현재 상태

Jessie의 승인에 따라 `selected_takes.json`과 finishing `current.json`의 mutable
canonical 계약을 종료했다. 현재 제품 권위는
`production/.film-pipeline-state-v1/{selected-takes,finishing-current}/` 아래
content-addressed payload/commit graph다. 두 JSON은 namespace 이관 뒤 mode `0600`
재생성 cache이며, graph가 있으면 reader/G3/finishing restoration이 cache로 fallback하지
않는다.

G3는 graph head를 계획 근거로 묶고, 첫 mutation의 legacy root import와 changed child
append, 같은 payload cache repair, sibling fork fail-closed를 구현했다. Production
reader/normalizer/UI는 `selected_takes.commit_graph`와 commit/payload ID를 provenance로
전달한다. Finishing은 immutable public run 게시 뒤 current-state commit을 append하고
cache를 마지막에 동기화한다. 게시 후 error path의 public run recursive delete는
제거했다. Canonical commit 성공과 cache stale warning은 별도 결과다.

현재 focused storage/G3/reader/finishing/UI/real-ffmpeg 통합은 72/72 PASS다. 외부망
차단 full Node는 최종 200/200, lint와 Vite 53-module build, diff check가 PASS했고
added-line network/package/release execution scan은 0이다. Exact
schema/path/code/migration matrix와 잔여 경계는
`docs/ui_integration/40_content_addressed_commit_graph.md`를 우선한다. 실제 Jessie
production migration, 실제 production render, 사람 영상 품질 승인은 수행하거나
주장하지 않는다. 아래 2026-07-14 BLOCK/PASS 문장은 당시 기록으로 보존한다.

최종 독립 검증은 writer Sol `019f619b-3175-7d73-ac06-ef15eacf6d90`의 tracked patch
SHA-256 `8bd118b2b1e4f7dc01a681a3fe090bc278d9aed7145cd2b11b509e32adcd5c8c`와
snapshot `/private/tmp/open-ga-canonical-graph-verifier-U0CHeC/worktree`를 기준으로 했다.
첫 Terra xhigh `019f61be-4a05-7143-876c-2a7054eefec4`는 store 8/8과 static/source
불변은 PASS했으나 snapshot의 `node_modules/electron` 부재 때문에 combined 42/44,
`UNVERIFIABLE (infra)`, P1 verifier environment였다. 2026-07-15T02:51:51+0900
read-only `NODE_PATH`로 Electron 33.4.11을 해석한 뒤 fresh Terra xhigh
`019f61c2-1cda-7852-b22f-2e63b125444f`가 외부망 차단 G3+finishing 36/36과
C/D/E를 PASS했고 P0/P1/P2는 없었다. Correction과 source 변경은 없었으며 첫 환경
실패 기록도 삭제하지 않는다.

## 현재 결론

로컬 Vite/Electron 제품 경로, Electron 보안 경계, dry-run/command-preview 정책,
Layout A/B reader와 상태 분리는 코드·자동 검증 기준으로 통과했다. 기본 main
lifecycle의 Local AI/Wan2GP provider 등록과 `window.localAI` bridge는 제거됐고,
dormant source는 active import graph에서 도달 불가다.

현재 build를 외부망 차단 상태의 실제 Electron에서 새로 검증했다. 현재 정확한 24-method
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

과거 native folder 결과는 보존하지만 현재 24-method build의 native selection
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

Canonical finishing workbench v1은 renderer에 production/source/binary 경로, cwd,
argv나 command를 노출하지 않는 2분 TTL·1회용 계획으로 exact selected range만
로컬 렌더한다. Main은 token을 confirmation/payload/project 검사보다 먼저 소모하고,
실행 직전 beats/shot/selected/QC/source/happyVideoFactory/adapter/runtime/output을
다시 검증한다. Canonical beat order로 `cut` timeline을 만들고 고정
happyVideoFactory의 `build_timeline(measure_durations=False)`와 `build_roughcut`을
사용한다. 결과는 `final/workbench_runs/<content-derived-run-id>/`와 current pointer에
mode `0700`/`0600`, lock/staging/fsync/atomic rename으로만 게시한다. Canonical
master/delivery/report/QC/selected/ledger는 수정하지 않는다.

Provider 14/14, semantic UI 3/3, 실제 synthetic ffmpeg/ffprobe 1/1이 PASS했다.
외부망 차단 actual Electron fixture도 24-method bridge, pathless plan, 실제 확인 UI,
3단계 progress, 2.5초 선택 합계와 2.5초 output/fresh probe, canonical 불변, 허용
output 4파일만 생성, graceful full quit/relaunch와 current DOM 복원을 PASS했다.
외부 request와 console/runtime event는 0이다. 첫 실행 전체 UI screenshot은 PASS다.
재실행 full restored screenshot은 compositor capture가 대부분 검게 저장되어 시각
증거만 BLOCK이며 기능 복원 PASS와 분리한다. 실제 Jessie production/HVF는 쓰지
않았고 output quality는 `false`다. 상세:
`docs/ui_integration/39_selected_range_render_and_fresh_probe.md`.

독립 verifier는 원본 finishing commit `a318662`을 P2 두 건으로 BLOCK했다. Persisted
probe의 string duration이 fresh success로 복원됐고, lock-open `EACCES` raw message에
fixture 절대 경로가 남았다. Result/report SHA-256은 각각
`414b38acb008ac88e4ae0774deed4ba169a064e8df7158c7e78fb1208b9041a2`,
`728dd3cbb31e4fc57a1e39695f364dc48d2ef3106862b81177312c7647705035`다.

두 회귀를 먼저 추가한 provider pre-fix는 12/14로 정확히 두 test가 실패했다.
Receipt/probe의 성공 판정 duration/count/size/hash를 positive finite, bounded integer,
exact SHA-256와 receipt/probe 상호 일치로 고정하고, cooperative lock
open/write/fsync/close의 raw error를 pathless `FINISHING_*`로 정규화한 뒤 14/14와
focused 39/39가 PASS했다. 단 한 번의 새 Electron functional 회차도 24 methods,
2.5초=2.5초, quality false, external/console 0, graceful relaunch restore를 PASS했다.
새 screenshot은 만들지 않았고 기존 full restored screenshot BLOCK을 유지한다.
원본 독립 BLOCK 기록은 보존한다. 두 P2는 follow-up commit
`fd0b9a32a7aee729d331a0c5b09603ce2431d674`에서 수정됐고, 별도 distinct-model
fallback verifier `gpt-5.6-terra` xhigh가 최종 PASS로 독립 폐쇄했다. 해당 회차는
실제 Jessie production/HVF 실행이나 human output-quality 승인을 뜻하지 않는다.

Finishing post-render drift 후속 보강은 render provenance와 output/current state를
분리하고, 렌더·fresh probe 뒤 첫 public run rename 전에 canonical/source/
happyVideoFactory+adapter/runtime identity를 동일 input snapshot으로 다시 검증한다.
렌더 중 source 또는 canonical 변경은 path-free
`FINISHING_POST_RENDER_INPUT_DRIFT`로 실패하며 public run/current/receipt,
staging/lock residue가 모두 0이다. Provider 16/16, provider+실제 ffmpeg+UI 20/20,
network-restricted 전체 182/182, lint와 Vite build 52 modules가 PASS했다. 이는
비협조 writer의 최종 재확인↔rename TOCTOU, G3, mutable current canonical 계약,
게시 후 recursive cleanup 설계를 해결했다는 주장이 아니다. 상세:
`docs/ui_integration/39_selected_range_render_and_fresh_probe.md`.

이 exact artifact는 별도 새 세션의
`/root/finishing_post_render_drift_independent_verifier_20260714`
(`gpt-5.6-terra` xhigh)가 matching snapshot
`/private/tmp/open-ga-post-render-verifier-NL1ITDKB/worktree`에서 독립 검증해
P0/P1/P2 없음으로 `PASS`했다. Focused 20/20, 전체 Node 182/182, standalone real
FFmpeg 1/1, lint, Vite build 52 modules와 시작/종료 staged diff check가 모두 exit 0이며,
network primitive 및 electron-builder/package/release 실행 scan은 0이다. Code/test
해시는 구현자 제출값과 동일했고 actual production/HVF write는 없었다. 위 TOCTOU,
cleanup, mutable current, G3 및 실제 production/human quality 경계는 그대로 남는다.

## 인수 기준 현황

| 기준 | 상태 | 현재 증거 또는 남은 조건 |
| --- | --- | --- |
| AC1 active MuAPI 격리 | VERIFIED | `4dac387`; 기본 dev/build/start는 Vite/Electron이며 active MuAPI surface scan 통과 |
| AC2 Electron 보안 | EXECUTOR PASS / INDEPENDENT BLOCK | 외부 navigation deny-by-default, public config mutation 제거, native/immediate-child provenance와 planning exact allowlist/symlink/content/atomic-write 회귀 PASS; 독립 verifier verdict 없음 |
| AC3 renderer/main 경계 | EXECUTOR PASS / FINISHING FOLLOW-UP + POST-RENDER INDEPENDENT PASS | current actual Electron preload는 정확히 `filmPipeline` 24 methods, `setConfig` 없음; pathless finishing plan/execute, strict persisted evidence, pathless lock errors와 post-render input drift fail-closed를 회귀 검증함. 원본 `a318662`의 P2 2건 BLOCK은 `fd0b9a3`에서 독립 폐쇄했고, current post-render artifact도 별도 Terra xhigh verifier가 P0/P1/P2 없음으로 PASS했다. 별도 planning-write/path-provenance 독립 verdict는 없음 |
| AC4 side-effect 차단 | VERIFIED (code/test) | live generation/upload는 연결하지 않았다. 과거 불완전 ffprobe/concat은 제거했고, 별도 명시 확인된 local cut/fresh-probe workbench만 고정 adapter로 실행한다. |
| AC5 실제 GUI | PARTIAL PASS | 24-method/11개 한국어 menu/4 viewport/두 root 비-native 증거, Blob-only metadata/save/export restore, fixture promotion, selected-range render와 full quit/relaunch DOM 복원 PASS; current native selection, actual mobile keyboard-only, full restored relaunch screenshot은 BLOCK |
| AC6 production reader | VERIFIED (fixture/real/fail-safe) | Layout A/B와 실제 variant, canonical pack/ledger, selected takes/QC 및 exact delivery manifest/master SHA golden·missing·malformed·oversize·symlink·unsafe/stale/changed path·range·ID/QC conflict matrix PASS; 실제 두 경로 구조 복원 및 final fail-closed 확인 |
| AC7 자동 검증 | VERIFIED (명시된 독립 gaps 제외) | 기존 Finishing focused 39/39에 post-render drift provider+실제 ffmpeg+UI 20/20을 추가했고, network-restricted 전체 182/182, lint, build 52 modules와 기존 actual Electron render/fresh-probe/functional relaunch 회차 PASS |
| AC8 문서 정합성 | VERIFIED | 본 상태 문서와 각 역사 문서의 현재 상태 안내로 기준점을 일치시킴 |
| AC9 secret/외부 side effect | PARTIAL PASS | active-source와 reader 방어 통과, 외부 실행 0건; npm offline audit은 0건이나 OSV DB 부재는 `SCANNER_GAP` |
| AC10 상태 분리 | VERIFIED (code/test) | planning/submission/review/quality/dashboard/backend/accepted-seconds와 canonical deterministic/external/canonical/human/final 상태를 독립 유지 |

## 현재 검증 증거

- P0 보안 통합 commit: `4dac3871202b8c1e6dc057d0e53e513ff7fa1678`
- 보안 인수 기록 commit: `86655d7e`
- Layout A/B reader commit: `93f35a3cfafd72e6da8c0c6ab9e6eb0957b6ceec`
- 현재 network-restricted 전체 테스트: 182/182 PASS
- finishing post-render drift provider/UI/actual ffmpeg: 16/16 + 3/3 + 1/1 PASS; 한 명령 20/20 PASS. 기존 follow-up 통합 focused 39/39 기록은 별도 보존
- G3 production promotion focused: 44/44 PASS; P2 follow-up 전용 file은 수정 전 9/12, 수정 후 12/12
- canonical delivery focused: 첫 실행 35/38, 허용된 1회 국소 self-fix 후 38/38 PASS
- canonical finishing focused: 첫 실행 44/44 PASS, self-fix 없음
- canonical handoff focused: targeted self-fix 후 38/38 PASS
- network-denied provenance/security/renderer focused: 32/32 PASS
- lint: PASS
- Vite build: PASS, 52 modules
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
- selected-range render/fresh probe와 actual runtime: `docs/ui_integration/39_selected_range_render_and_fresh_probe.md`
- native/clipboard focused regression: 12/12 PASS
- active Electron entrypoint focused security regression: 8/8 PASS
- historical fresh runtime: `window.localAI === undefined`, 당시 `window.filmPipeline` 12 methods, legacy/unsafe enabled control 0, `file:` 7/external request 0, renderer console warning/error 0
- current actual Electron preload: `window.filmPipeline` 정확히 24 methods, public `setConfig` 0건, `window.localAI === undefined`
- current G3 preview: historical data/CSP 실패 뒤 잘못된 Chromium `atob` receiver를 수정했고 Blob-only metadata-ready, save/export exact private 3 files, 별도 OS 창 캡처와 full quit/relaunch restore PASS
- current G3 promotion: fixture exact target 생성·mode `0600`·private receipt·trusted confirmation·relaunch already-current PASS; 실제 Jessie production/HVF write는 0건
- current G3 one-shot follow-up: confirmed false 뒤 same-token INVALID, fresh-plan valid promote, valid-token replay INVALID와 relaunch already-current actual Electron PASS
- current finishing workbench: 원본 P2 numeric-schema/lock-error 독립 BLOCK은 역사로 보존하고, follow-up `fd0b9a3` 독립 검증에서 numeric/hash/size 24/24, lock open/write/fsync/close/EEXIST 5/5, focused contract 39/39(실제 FFmpeg/happyVideoFactory 포함), direct network primitive 0, snapshot target 9 및 harness input 7 불변 PASS; synthetic exact 2.5초 range render/fresh probe, immutable canonical inputs, 4개 fixed output, 새 functional relaunch restore PASS; full restored relaunch screenshot BLOCK
- finishing follow-up evidence: `/private/tmp/open-ga-finishing-followup-terra-fallback-LMKb7a/evidence/result.json` (`adefd4572bda60684d713a047f8c5483836402972e7904f2e6215eec4cf703e1`), `verification-report.md` (`d873ba92daf73d9220818aeeae74a512d3e300b20357753fc0c4b9378ae81618`), `commands.tsv` (`6c1b297521b30eaefd0a28f220e57a3b9178b4b8de578f85824f9a7445de11a3`), `artifact-hashes.txt` (`0f51f77481656599836b789f2e4ae6cd11eb69074c9f32fa7f20e3fc3f3a3cac`); canonical snapshot stayed clean. 이는 code/evidence acceptance이며 실제 Jessie production 실행 또는 human output-quality approval이 아니다.
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
10. Canonical delivery의 producer-persisted probe와 새 workbench의 fresh probe는
    분리한다. Selected-range render/fresh-probe 계약은 격리 fixture에서 구현·검증됐지만
    실제 Jessie production 실행과 output-quality 승인은 별도다. Functional relaunch
    복원은 PASS이고 full restored relaunch screenshot은 BLOCK이다. finishing
    follow-up의 code/evidence 독립 PASS와 이 screenshot/실제 production 실행 및
    human output-quality 승인은 별도 상태다.
11. G3 promotion lock은 같은 앱/private namespace의 협조 promotion만 직렬화한다.
    Node/macOS API에는 이 구현이 사용할 native dirfd `openat`/`renameat` 또는
    no-replace CAS가 없어, 최종 target 재확인과 rename 사이 비협조 writer의 잔여
    TOCTOU를 race-free라고 주장하지 않는다. 실제 production 사용 정책에서 이
    한계를 수용하거나 native helper를 별도 구현해야 한다.
12. Finishing post-render input snapshot은 public run rename 직전 다시 확인한다.
    그러나 그 마지막 확인과 rename 사이 비협조 writer TOCTOU, run rename 뒤 current
    게시/검증 실패 때의 recursive cleanup 및 mutable current canonical 계약은 기존
    경계로 남는다.

본 회차의 GUI 자동화는 Jessie의 current-turn 승인 아래 외부망 차단으로 수행했다. 외부 계정 접근, generation/upload, deploy/release는 실행하지 않았다.
