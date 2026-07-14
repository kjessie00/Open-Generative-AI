# 선택 구간 로컬 렌더와 fresh probe 계약

기준일: 2026-07-14 (Asia/Seoul)

## 2026-07-15 current-state publication 정정

아래의 mutable `current.json` pointer 설명은 2026-07-14 역사다. 현재 finishing
restoration 권위는
`production/.film-pipeline-state-v1/finishing-current/`의 immutable payload/commit
graph이며 `final/workbench_runs/current.json`은 mode `0600` 호환 cache다.

Execute는 public content-derived run을 게시한 뒤 legacy current root import가 필요하면
먼저 수행하고 새 current payload를 child/root로 append·검증한 다음 cache를 동기화한다.
Graph가 있으면 missing/malformed/symlink cache를 restoration 근거로 읽지 않는다.
Canonical commit 뒤 cache 실패는 `FINISHING_CURRENT_CACHE_STALE`로 분리한다. Public run
rename 뒤 graph/cache/verification error가 나도 run을 재귀 삭제하지 않는다. 따라서 이
문서 아래의 “recursive cleanup/mutable current 미해결” 문장은 해결 전 역사로 보존되며,
현재 exact 계약과 잔여 TOCTOU는 `40_content_addressed_commit_graph.md`를 따른다.

구현·검증·통합 담당: `/root/finishing_render_integrator_20260714`

## 결론

`최종 편집`에 canonical 선택 구간을 실제로 자르고 새 `ffprobe`로 검증하는
로컬 마감 작업대를 추가했다. 이 경로는 영상 생성·업로드 실행기가 아니다.
Jessie가 선택한 production의 기존 입력을 다시 검증하고, 고정된
happyVideoFactory 편집 함수를 사용해 별도의 workbench 실행본을 만드는 범위만
소유한다.

격리 synthetic production의 실제 ffmpeg/ffprobe와 실제 Electron GUI에서 다음을
확인했다.

- canonical beat 순서대로 두 구간을 잘라 2.5초 출력 생성
- 출력 2.5초와 선택 구간 합계 2.5초 일치
- 새 probe의 video/audio stream, hash, duration 검증
- canonical 입력·delivery 파일 불변
- 허용된 workbench 파일 네 개만 생성
- full quit/relaunch 뒤 current pointer·receipt·output·probe·input snapshot 복원
- renderer 외부 HTTP(S) 요청 0, console/runtime event 0
- 렌더 성공과 영상 품질 승인 분리

실제 Jessie production에는 쓰지 않았고, happyVideoFactory 소스도 수정하지 않았다.
첫 실행의 복원된 전체 UI screenshot은 PASS다. 재실행 DOM과 main 검증은 PASS지만
CDP compositor의 full restored relaunch screenshot은 대부분 검게 저장되어 시각
증거만 BLOCK으로 분리한다. 추가 캡처 반복은 중단했다.

## 실행 계약

### 계획

Renderer는 `getFinishingWorkspace()`와 `planFinishingRun()`만 호출한다. Main은
production root, source path, 실행 파일 경로, cwd, argv와 command를 renderer에
전달하지 않는다. 계획은 main memory의 64자리 opaque token이고 TTL은 2분이다.

실행 요청 shape는 다음 세 필드로 고정한다.

```text
{ planToken, confirmed, projectId }
```

유효한 token은 payload shape, `confirmed`, project ID와 stale 검증보다 먼저
소모한다. 따라서 malformed envelope, `confirmed:false`, project mismatch도 같은
token을 재사용할 수 없다. 존재하지 않는 token은 다른 유효 계획을 소모하지 않는다.

### 실행 직전 재검증

Main은 계획 시점의 결과를 신뢰하지 않고 다음을 다시 읽고 hash/identity를 비교한다.

- `beats.json`
- `shot_manifest.json`
- `selected_takes.json`
- `qc_report.json`
- 선택 source 파일과 in/out 범위
- 고정 happyVideoFactory 파일과 이 repository의 adapter
- main-owned Python, ffmpeg, ffprobe 실행 파일
- current pointer와 기존 workbench output

Selected take 배열 순서는 신뢰하지 않는다. `beats.json`의 exact `order`를 기준으로
flat beat bridge와 positional shot manifest를 만들고, 선택 source/range를 그 순서에
맞춘다. 현재 지원 전환은 `cut`뿐이며 `crossfade`와 `dip_black`은 차단한다.

Adapter는 고정 happyVideoFactory root에서 다음 두 함수를 사용한다.

```text
build_timeline(..., measure_durations=False)
build_roughcut(...)
```

실행 파일은 main이 해석한 절대 경로만 사용하고 `shell:false`, 고정 cwd, 최소 PATH,
bounded stdout/stderr, timeout, SIGTERM/SIGKILL 경계를 적용한다. 현재 roughcut 계약은
source에 video와 audio stream이 모두 있어야 한다.

### 렌더 후·게시 전 provenance 재검증

2026-07-14 후속 보강은 `/root/finishing_post_render_drift_integrator_20260714`가
소유했다. 렌더와 fresh probe가 끝난 뒤 public run directory를 rename하기 직전에,
실행 직전과 같은 canonical JSON bytes/identity, 선택 source bytes/identity와 probe,
happyVideoFactory/adapter bytes, resolved Python/ffmpeg/ffprobe identity를 다시 읽어
동일한 input snapshot인지 확인한다. 이 재검사에서 읽기 실패·blocker·snapshot
불일치는 모두 path-free `FINISHING_POST_RENDER_INPUT_DRIFT`로 fail-closed 한다.

현재 실행이 만든 `.workbench.lock`, `.staging-*`, roughcut/probe/receipt는 render
provenance가 아니다. 따라서 post-render 비교는 output state/current를 제외하고 실제
입력만 계산한다. Source 또는 canonical bytes를 렌더 콜백 중 바꾸는 결정론적 회귀는
각각 error code 일치, public run/current/receipt 0, staging/lock residue 0, 주입된 입력
외 regular-file mutation 0을 확인했다. 입력이 고정된 기존 success/current 복원과 실제
ffmpeg 경로는 그대로 PASS했다.

### 출력

고정 출력은 production 아래 다음 위치뿐이다.

```text
final/workbench_runs/<content-derived-run-id>/
  roughcut.mp4
  fresh_probe.json
  receipt.json
final/workbench_runs/current.json
```

폴더는 mode `0700`, 파일은 mode `0600`이다. 협조 writer lock, staging, exclusive
create, fsync와 atomic rename을 사용한다. Canonical master, delivery manifest,
report, QC, selected takes와 ledger는 덮어쓰지 않는다. 같은 input snapshot은 새로
렌더하지 않고 검증된 current 실행본을 `already_current`로 재사용한다.

앱 재시작 때 current pointer, receipt, output/probe hash, probe duration과 input
snapshot을 모두 다시 검증한다. 일부 파일, malformed JSON, symlink, tamper, stale input은
현재 실행본을 신뢰하지 않는다.

## 한국어 UI

`최종 편집` 화면의 `선택 구간 마감 작업대`는 loading, plan-ready, confirmation,
executing, success, already-current, stale, blocked 상태를 별도 표시한다. 프로젝트 ID
exact 입력과 명시 확인 checkbox가 모두 맞아야 실행 버튼이 열린다. Source path, cwd,
명령과 실행 파일 경로는 표시·복사하지 않는다.

화면에는 다음 문구를 항상 강조한다.

> 렌더 실행 성공 ≠ 영상 품질 승인

Native input, checkbox, fieldset, progress와 button을 사용하고 정보 grid는
1/2/4열로 반응한다.

## 결정론적 검증

Focused 검증:

- provider/security: 14/14 PASS
- 한국어 semantic UI DOM: 3/3 PASS
- 실제 ffmpeg/ffprobe synthetic media: 1/1 PASS

Provider matrix는 pathless plan, canonical 순서, token 소비, 원자 게시/복원/no-op,
권한, 전환/범위, 만료, selected/QC/beats/shot/source/harness/binary/output drift,
source parent symlink, lock/partial/malformed/symlink pointer, JSON/source/output 상한,
stdout/stderr 상한, timeout, render failure cleanup, receipt/output tamper와 등록 IPC
shape를 포함한다. 후속 회귀는 persisted receipt/probe의 string/null/negative/fractional
numeric 값과 잘못된 SHA-256을 success로 복원하지 않는지, lock-open `EACCES`가
절대 경로 없는 `FINISHING_LOCK_ACQUIRE_FAILED`로 정규화되는지도 확인한다.

실제 media test는 source 배열을 beat 순서와 반대로 저장하고 blue/red frame을
샘플링해 canonical beat 순서를 검증한다. Source 전체 4.8초가 아니라 선택 합계
2.5초만 출력되는 것도 확인한다.

전체 suite, lint, build와 diff 검증의 최종 수치는 이 커밋 직전
`docs/ui_integration/21_current_acceptance_status.md`와 checkpoint에 기록한다.

Post-render drift 후속 검증은 provider 16/16, provider+실제 ffmpeg+UI 20/20,
전체 network-restricted suite 182/182, lint, Vite build 52 modules를 PASS했다.

### Post-render drift 독립 인수

별도 새 세션의 `/root/finishing_post_render_drift_independent_verifier_20260714`
(`gpt-5.6-terra` xhigh)는 matching snapshot
`/private/tmp/open-ga-post-render-verifier-NL1ITDKB/worktree`를 검증해 P0/P1/P2 없음으로
`PASS`했다. Focused provider+real FFmpeg+UI 20/20, 전체 Node suite 182/182,
standalone real FFmpeg 1/1, lint, Vite build 52 modules와 시작/종료 staged diff check는
모두 exit 0이었다. Code/test network primitive 및 electron-builder/package/release 실행
scan은 0이고, provider/test SHA-256은 각각
`cf04b0cdbb5f968a4e7a6f41fdd7d67912ecac3c9056b29851175fad74085214`,
`f337acb9e26ecbc11ad3e84b28ab4bcf6eaa74657c46168e44c156a0c06ced52`로 구현자 제출값과
일치했다. 기존 5개 scoped 파일 외 canonical source 변경과 actual production/HVF
write는 없었다. Final recheck-to-rename non-cooperating-writer TOCTOU, post-publication
recursive cleanup, mutable current canonical contract, G3 및 실제 production/human quality
approval은 이 독립 PASS 범위 밖이다.

## 독립 verifier BLOCK과 P2 복구

독립 verifier는 원본 통합 commit `a3186621441e4d0df8607f46a5a5aa0815106816`을
별도 immutable snapshot에서 확인한 뒤 P2 두 건으로 인수를 BLOCK했다.

- `P2-PROBE-NUMERIC-SCHEMA`: persisted probe의 `duration_seconds`가
  `"not-a-number"`여도 `success`와 `fresh_probe_verified:true`가 복원됨
- `P2-LOCK-ERROR-NORMALIZATION`: lock open `EACCES`의 raw code/message에 fixture
  절대 경로가 남음

독립 결과:

```text
/private/tmp/open-ga-finishing-verifier-evidence-20260714TaLYgp2B3/result.json
SHA-256 414b38acb008ac88e4ae0774deed4ba169a064e8df7158c7e78fb1208b9041a2

/private/tmp/open-ga-finishing-verifier-evidence-20260714TaLYgp2B3/verification-report.md
SHA-256 728dd3cbb31e4fc57a1e39695f364dc48d2ef3106862b81177312c7647705035
```

두 회귀를 먼저 추가한 pre-fix provider 회차는 정확히 12/14였고 두 새 test만
실패했다. 최소 수정 후 14/14다. Receipt는 positive finite selected duration,
1..1,000 정수 range count, 1..16 GiB 정수 output size와 exact SHA-256을 요구한다.
Probe도 positive finite output/selected duration, receipt와 같은 selected duration,
고정 tolerance, bounded integer size와 exact SHA-256을 요구한다. 따라서 JS 숫자
coercion이나 `NaN` 비교의 false branch로 success를 만들 수 없다.

Cooperative lock open/write/fsync/close는 한 경계에서 처리한다. Race `EEXIST`는
`FINISHING_CONCURRENT_LOCKED`, 그 외 raw filesystem error는 고정
`FINISHING_LOCK_ACQUIRE_FAILED`로 바꾸고 부분 lock을 정리한다. Raw errno, path,
command와 원시 message는 renderer에 전달하지 않는다.

수정 후 provider/security/IPC/renderer/UI와 실제 temp ffmpeg focused는 39/39
PASS했다. 전체 deny-network suite는 180/180, lint와 Vite build 52 modules도
PASS했다. 이 결과는 독립 verifier의 원본 commit BLOCK 기록을 지우지 않는다.

## Follow-up 최종 독립 인수

`fd0b9a32a7aee729d331a0c5b09603ce2431d674` (`tree
de4346f927d22dab3ce1448f177726fc335a7e79`, parent
`a3186621441e4d0df8607f46a5a5aa0815106816`)는 distinct-model fallback verifier
`gpt-5.6-terra` xhigh가 최종 `PASS`로 인수했다. 독립 numeric/hash/size matrix는
24/24, lock open/write/fsync/close/EEXIST matrix는 5/5, provider/security/IPC/
renderer/UI 및 실제 FFmpeg/happyVideoFactory를 포함한 focused contract는 39/39
PASS다. direct network primitive match는 0건이며 canonical snapshot target 9개와
happyVideoFactory harness input 7개 hash는 전후 동일하고 snapshot은 clean이었다.

최종 증거는 다음과 같다: `result.json` SHA-256
`adefd4572bda60684d713a047f8c5483836402972e7904f2e6215eec4cf703e1`,
`verification-report.md` SHA-256
`d873ba92daf73d9220818aeeae74a512d3e300b20357753fc0c4b9378ae81618`,
`commands.tsv` SHA-256
`6c1b297521b30eaefd0a28f220e57a3b9178b4b8de578f85824f9a7445de11a3`,
`artifact-hashes.txt` SHA-256
`0f51f77481656599836b789f2e4ae6cd11eb69074c9f32fa7f20e3fc3f3a3cac`.
이는 code/evidence acceptance PASS다. 실제 Jessie production 실행, live generation,
human output-quality approval, planning-write/path-provenance 및 native folder-selection
acceptance는 이 판정에 포함하지 않는다.

## 실제 Electron 격리 증거

증거 root:

```text
/private/tmp/open-ga-finishing-electron-20260714TH3C5yhf1buoO/evidence/
```

`runtime-summary.json` SHA-256:

```text
00767080a818a5ee069290b9addd6542c8c4c4eb0bbe3cb135bec770a31385a3
```

확인된 값:

- bridge: 정확히 24 methods
- `window.localAI`: `undefined`
- plan privileged path/command 노출: false
- progress: plan-ready → executing → execution-succeeded
- output: 52,832 bytes, SHA-256
  `2bc13d0ac5dee3923c8b6dcd07f63ac5dba2728fa0cd2a065f39d926c655a4ba`
- selected/output duration: 2.5초 / 2.5초
- fresh probe: true
- output quality approved: false
- canonical delivery modified: false
- immutable inputs unchanged: true
- external requests: 0
- console/runtime events: 0
- 첫 실행·재실행 종료: 모두 graceful exit 0

첫 실행 전체 UI screenshot:

```text
finishing-success.png
SHA-256 9bf48fe04eee5a6de953f5811b5ab7c30d19a212fe45c5562551f42c8aee2f10
```

재실행은 DOM에서 current run ID, fresh probe PASS와 `승인 안 됨`을 복원했지만,
`finishing-relaunch.png`는 compositor capture가 대부분 검게 저장되어 full restored
UI의 시각 증거로는 사용하지 않는다. 이 증거 gap을 기능 복원 PASS로 숨기지 않는다.

P2 복구 후에는 screenshot을 반복하지 않고 단 한 번의 functional Electron 회차를
새 temp production/userData에서 수행했다.

```text
/private/tmp/open-ga-finishing-electron-20260714TJGV0DHdD4wQ6/evidence/runtime-summary.json
SHA-256 5ebba7bd461a9fb4838b83202ecbc09422dc43b7f72ac44784e731e5cb8a66d2
```

24-method bridge, `window.localAI === undefined`, path/command 비노출, 세 progress
phase, selected/output 2.5초 일치, fresh probe true, quality false, canonical 불변,
허용 output 4파일, 외부 request/console event 0, 두 graceful exit 0과 functional
relaunch restore를 PASS했다. `capture_attempted:false`이며 기존 full restored
screenshot BLOCK은 그대로다.

## 남은 경계

- 실제 Jessie production 실행은 해당 production을 선택한 상태에서 별도 명시 확인이
  필요하다. 이번 회차는 temp fixture만 썼다.
- Fresh probe PASS는 출력 구조·duration/hash 증거다. 영상 내용 품질은 사람이 별도로
  재생·검토하고 승인해야 한다.
- 협조 lock은 같은 앱 writer만 직렬화한다. Node/macOS에서 native dirfd/no-replace를
  쓰지 않으므로 마지막 재확인과 rename 사이 비협조 writer TOCTOU는 남는다.
- Public run rename 뒤 current 게시 또는 검증이 실패했을 때의 기존 recursive cleanup
  설계와 그 cleanup TOCTOU는 이번 보강에서 바꾸지 않았다.
- 현재 전환은 `cut`만 지원한다.
- Source audio가 없는 영상은 현재 계약에서 차단한다.
- Full restored relaunch screenshot은 BLOCK이다. DOM/main 재검증 PASS와 별도 사실이다.
- Generation, Dreamina/Jimeng/Flow submit, external review/upload/account,
  release/deploy/package/push는 실행하지 않았다.
