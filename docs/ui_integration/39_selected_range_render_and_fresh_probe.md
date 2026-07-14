# 선택 구간 로컬 렌더와 fresh probe 계약

기준일: 2026-07-14 (Asia/Seoul)

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

- provider/security: 12/12 PASS
- 한국어 semantic UI DOM: 3/3 PASS
- 실제 ffmpeg/ffprobe synthetic media: 1/1 PASS

Provider matrix는 pathless plan, canonical 순서, token 소비, 원자 게시/복원/no-op,
권한, 전환/범위, 만료, selected/QC/beats/shot/source/harness/binary/output drift,
source parent symlink, lock/partial/malformed/symlink pointer, JSON/source/output 상한,
stdout/stderr 상한, timeout, render failure cleanup, receipt/output tamper와 등록 IPC
shape를 포함한다.

실제 media test는 source 배열을 beat 순서와 반대로 저장하고 blue/red frame을
샘플링해 canonical beat 순서를 검증한다. Source 전체 4.8초가 아니라 선택 합계
2.5초만 출력되는 것도 확인한다.

전체 suite, lint, build와 diff 검증의 최종 수치는 이 커밋 직전
`docs/ui_integration/21_current_acceptance_status.md`와 checkpoint에 기록한다.

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

## 남은 경계

- 실제 Jessie production 실행은 해당 production을 선택한 상태에서 별도 명시 확인이
  필요하다. 이번 회차는 temp fixture만 썼다.
- Fresh probe PASS는 출력 구조·duration/hash 증거다. 영상 내용 품질은 사람이 별도로
  재생·검토하고 승인해야 한다.
- 협조 lock은 같은 앱 writer만 직렬화한다. Node/macOS에서 native dirfd/no-replace를
  쓰지 않으므로 마지막 재확인과 rename 사이 비협조 writer TOCTOU는 남는다.
- 현재 전환은 `cut`만 지원한다.
- Source audio가 없는 영상은 현재 계약에서 차단한다.
- Full restored relaunch screenshot은 BLOCK이다. DOM/main 재검증 PASS와 별도 사실이다.
- Generation, Dreamina/Jimeng/Flow submit, external review/upload/account,
  release/deploy/package/push는 실행하지 않았다.
