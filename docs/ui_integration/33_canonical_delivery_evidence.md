# Canonical Delivery Evidence v1

기준일: 2026-07-13 (Asia/Seoul)

## 결과

Layout A의 exact `final/delivery_manifest.json`을 happyVideoFactory의 정식
delivery 증거로 읽는 read-only adapter를 추가했다. 앱은 manifest의 파일명만
믿지 않는다. schema, gate, 허용 경로, 저장된 probe, 해당 checksum key를 먼저
검사하고, 선택된 정식 master를 Electron main의 파일시스템 경계에서 다시
SHA-256으로 검증한다.

이 증거가 통과하면 작업대는 다음 세 항목만 충족된 것으로 판정한다.

- 정식 master 또는 subtitle-burn master 파일 존재와 SHA-256 일치
- producer가 delivery 전에 저장한 양의 duration, video stream, audio stream 증거
- happyVideoFactory의 filter-complex master/delivery 편집 결과 증거

사람 QA, 모든 계획 clip의 선택 구간, submit/download 이력, 보고서, 활성 blocker,
출력 품질은 이 manifest로 충족되지 않는다. `validateFinalReady()`는 더 이상
`canonicalHandoff.final_ready === true`라는 자기참조 값을 선행 조건으로 요구하지
않고 각 증거를 독립적으로 평가한다.

## Authoritative source contract

읽기 전용으로 확인한 happyVideoFactory 기준은 commit
`caaef48102b94dfe131bca9f4f6b77ae8fff14bd`, tree
`06847a85b6e621f32eb73806095380b9a0eb0f65`이다.

- `video_core/short_drama/edit/delivery.py`
  - caller가 지정한 `out_dir/delivery_manifest.json`에 기록한다.
  - schema는 `short_drama_room.delivery.v1`, `gate_status`는 `pass`다.
  - `MediaInfo`로 video/audio stream과 duration을 검사한 뒤 checksum을 기록한다.
- `video_core/short_drama/edit/master_render.py`
  - 일반 master는 `master.mp4`, subtitle burn master는 `master_sub.mp4`다.
  - 실제 producer 흐름에서는 `master_sub.mp4`도 `master` 키에 기록될 수 있다.
  - master는 단순 concat 파일 복사가 아니라 `filter_complex`와 별도 premix audio로
    렌더된다.
- `video_core/ffmpeg/duration.py`
  - persisted probe의 생산 시점에 ffprobe 기반 duration과 stream 정보를 만든다.

현재 authoritative caller와 tests는 Layout A의 `final/`을 `out_dir`로 사용한다.
따라서 앱은 `final/delivery_manifest.json`만 읽고 root 또는 다른 폴더의 같은
파일명을 검색하지 않는다.

## Reader와 파일 경계

`electron/lib/productionReader.js`의 delivery reader는 다음을 강제한다.

- manifest 최대 512 KiB, exact schema와 `gate_status: pass`
- manifest와 허용 asset 모두 production 내부 경로만 허용
- 민감 이름, root escape, symlink parent/leaf, non-regular, missing, empty file 거부
- master key는 `master.mp4` 또는 source-compatible `master_sub.mp4`,
  `master_sub` key는 `master_sub.mp4`만 허용
- mobile/square/thumbnail 이름과 subtitle 확장자를 허용 목록으로 제한
- 모든 노출 asset에 해당하는 lowercase SHA-256 key를 요구하고, 영상·이미지에는
  source contract에 맞는 persisted probe를 추가로 요구
- selected master 최대 16 GiB
- 가능한 플랫폼에서 `O_NOFOLLOW`로 open
- open 전 `lstat`, open 후와 read 후 `fstat`, read 후 `lstat`의
  dev/ino/mode/size/mtime/ctime 동일성 확인
- 1 MiB 고정 buffer의 bounded streaming SHA-256과 exact checksum 비교
- master가 manifest보다 새로우면 stale manifest로 거부

Renderer에는 원본 JSON, 임의 필드, raw error narrative, prompt/script/content를
전달하지 않는다. 허용된 경로, 크기, checksum, duration, stream boolean과
reason code만 전달한다.

## Persisted probe와 fresh probe 분리

Delivery manifest의 probe는 producer가 package 단계에서 저장한 증거다. 앱이 이번
읽기에서 ffprobe를 실행한 증거가 아니다.

- `persisted_probe_verified: true`: 저장된 값의 구조와 master SHA provenance가 통과
- `fresh_probe_verified: false`: 앱은 새 ffprobe를 실행하지 않음

한국어 최종 편집 화면은 manifest 경로, SHA-256, 저장된 producer probe와 duration,
새 ffprobe 미실행 상태, 남은 blocker를 별도 항목과 badge로 표시한다. 저장된 probe를
새 probe라고 부르지 않는다.

## Readiness와 command 안전성

정식 delivery가 검증되면 기존 hardcoded `final/final.mp4` 대신 검증된
`master.mp4` 또는 `master_sub.mp4`가 `finalReport.final_video_path`가 된다.
Canonical delivery provenance가 정확할 때만 기존 concat-list 요구를 source의
filter-complex delivery 증거로 대체하고 persisted probe 요구를 충족한다.

다음 항목은 계속 독립적으로 필요하다.

- 모든 계획 clip의 submit ID와 download 증거
- QA PASS 또는 명시적 예외와 사람/output-quality gate
- production 내부 원본 증거가 있는 모든 선택 구간
- `report.md`
- 기록된 blocker 배열과 활성 blocker 0건

Fresh ffprobe와 selected-range render command card는 여전히 command 빈 문자열,
evidence output 빈 문자열, copy disabled, click listener 0이다. UI는 ffmpeg,
ffprobe, render, generation, review, download 또는 upload를 실행하지 않는다.

## 결정론 검증

Temp fixture만 사용한 focused matrix의 최종 결과는 38/38 PASS다.

- 일반 master, producer-style `master`→`master_sub.mp4`, explicit `master_sub` golden
- malformed/oversize/symlink manifest
- outside/sensitive/symlink/missing/empty 또는 oversize master
- missing/malformed/mismatch checksum
- schema/gate/zero duration/missing video/missing audio/partial asset 오류
- stale manifest와 hashing 도중 master 변경 거부
- 무관 mp4/ffprobe와 다른 위치의 manifest가 증거로 승격되지 않음
- delivery가 final media/persisted probe/stitch만 충족하고 QA/selection/report 등을
  충족하지 않음
- 기존 strict legacy final-ready fixture PASS 유지
- 한국어 UI의 persisted/fresh 구분과 disabled command copy 0회

첫 focused 실행은 35/38이었다. 허용된 1회 국소 self-fix로 manifest 부재 시
무관 `*ffprobe*` 파일을 fresh 증거로 올리던 기존 normalizer 경로를 exact
`<final_video_path>.ffprobe.json`으로 좁혔고, fixture 기대값 두 곳을 실제
UNREVIEWED QA 및 허용된 manifest path 경계에 맞췄다. 재실행은 38/38 PASS다.

전체 network-denied suite는 123/123 PASS, lint PASS, Vite build 41 modules
PASS다. `git diff --check`와 최종 Git/HVF 불변성 결과는 commit 전 audit에서
확인하고 `21_current_acceptance_status.md`, `.agent/goal-checkpoint.md`와 함께
기록한다.

## 실행·승인 경계

이번 ordinary complex unit의 named executor/final integrator는
`/root/canonical_handoff_adapter_integrator`다. 배정은 GPT-5.6 guide에 따라
원인·범위가 명확하고 temp 자동 검증 가능한 통합으로 분류했으며 nominal
`gpt-5.6-sol / high`를 사용했다. 같은 turn의 availability evidence는
2026-07-13T22:51:35+09:00에 기록되었다. Token efficiency는 authoritative source와
직접 영향 파일만 읽고 exact path/temp fixture로 범위를 제한했다. 국소 실패는 한 번
self-fix하고, 추가 실패는 BLOCK하는 escalation rule을 적용했다. 상당히 복잡한 코딩
임계값은 아니므로 별도 independent verifier는 요구되지 않는다.

외부망, 실제 production, Electron/GUI/native picker/config/cache, generation, external
review, download/upload, ffmpeg/ffprobe, account, release/deploy/package/install/push를
사용하지 않았다. happyVideoFactory는 읽기 전용으로만 확인했다.
