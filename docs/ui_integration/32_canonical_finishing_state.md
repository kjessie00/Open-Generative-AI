# Canonical Finishing State v1

기준일: 2026-07-13 (Asia/Seoul)

## 결과

`happyVideoFactory`의 정식 `selected_takes.json`과 `qc_report.json`을 로컬
작업대의 채택 구간·클립 QA·최종 준비 상태에 연결했다. 이 연결은 production
root의 exact 파일을 읽는 read-only adapter다. 렌더링, ffmpeg/ffprobe 실행,
production 쓰기, generation/review/upload는 추가하지 않았다.

현재 작업대에서 가능한 일은 다음과 같다.

- 선택 테이크의 샷·비트·테이크·provider·in/out·transition을 구조적으로 확인
- 선택 원본이 현재 production 내부의 실제 비심볼릭 일반 파일인지 확인
- `shot_manifest.json` 증거가 있을 때만 `clip_<shot_id>` 별칭을 생성
- canonical QC의 결정론 검사, 대사 명료도, 발음 위험, canonical decision,
  외부 findings 개수, 사람 판정을 서로 다른 상태로 표시
- 계획 clip 식별자 불일치, 부분 QC, stale QC, 최종 영상·보고서·ffprobe 증거
  누락을 한국어 blocker로 확인

현재 작업대에서 불가능한 일은 다음과 같다.

- 선택 구간으로 최종 영상을 렌더링하거나 production 파일을 수정
- canonical `accept`를 사람 승인 또는 최종 품질 PASS로 간주
- 샷 식별자 증거 없이 `shot_id`, `beat_id`, 기존 `clip_id`를 자동 동일시
- 증거 JSON을 만들지 않는 ffprobe 명령이나 선택 구간을 무시하는 concat 명령 복사

## Authoritative source contract

읽기 전용으로 현재 source를 다시 확인했다.

- `video_core/short_drama_room/contracts.py`
- `video_core/short_drama_room/validator.py`
- `video_core/short_drama/edit/timeline_builder.py`
- `video_core/short_drama_room/schemas/shot_manifest.schema.json`
- `video_core/short_drama_room/schemas/selected_takes.schema.json`
- `video_core/short_drama_room/schemas/qc_report.schema.json`

`timeline_builder`는 명시적으로 `clip_id=f"clip_{shot_id}"`를 만든다. 앱은 이
규칙만 단독 사용하지 않는다. exact-root `shot_manifest.json`이 parse되고 중복
없는 동일 `shot_id`를 보유할 때만
`shot_manifest.json+timeline_builder.clip_<shot_id>` provenance를 기록하며 별칭을
사용한다. 다른 경우 accepted range는 식별자 미입증으로 차단된다.

## Bounded reader

세 finishing 문서는 production root의 exact path에서만 읽는다.

| 파일 | 상한 | renderer로 전달하는 값 |
| --- | --- | --- |
| `shot_manifest.json` | 512 KiB, 1,000 records | schema/project/episode, shot id와 count |
| `selected_takes.json` | 512 KiB, 1,000 records | 안전한 id/provider/in/out/transition/local path/source evidence |
| `qc_report.json` | 512 KiB, 1,000 records | 구조 QC 필드, findings count, bounded aggregate/count |

Missing, symlink, non-regular, oversize, malformed, top-level non-object,
records non-array는 fail-closed다. String id는 160자 safe token, source path는
2,048자 이하로 제한한다. Source path는 root containment, sensitive component,
parent/leaf symlink, regular-file 여부를 검사한다. Outside/sensitive/symlink raw
경로는 renderer에 반환하지 않는다.

Prompt, script/narrative, Gemini finding 본문, arbitrary note/error, credentials,
external path는 반환하지 않는다. QC는 findings 배열을 512자 문자열 최대 1,000개로
검증하지만 renderer에는 count와 `recorded_without_verdict` 상태만 전달한다.

## Normalization and readiness

Canonical selected range가 집계되려면 다음이 모두 참이어야 한다.

1. selected document와 required hidden contract fields가 유효하다.
2. `source_in_sec`은 유한한 0 이상 숫자다.
3. `source_out_sec`은 유한하며 `source_in_sec`보다 크다.
4. source는 현재 root 내부의 실제 비심볼릭 일반 파일이다.
5. shot manifest와 timeline-builder 규칙으로 clip alias가 입증된다.
6. selected document에 duplicate/unknown manifest shot 문제가 없다.

`whole_clip_accepted`는 항상 false다. Source file이 있거나 canonical decision이
`accept`라는 이유로 전체 클립을 채택하지 않는다.

QC의 `deterministic_checks_passed`, `external_review_state`,
`canonical_decision`, `human_decision`, renderer `verdict`는 독립 필드다.
Canonical QC 레코드의 renderer `verdict`와 `human_decision`은 `UNREVIEWED`다.
Provider mismatch, selected/QC shot set mismatch, duplicate shot, QC가 selected보다
오래된 상태는 `finishing_inconsistencies`에 남고 최종 준비를 차단한다.

`canonicalHandoff.final_ready`는 false를 유지한다. 전역 `validateFinalReady()`도
기존의 final.mp4, report, concat, ffprobe, submit/download, QA, 모든 계획 clip의
accepted range 증거를 완화하지 않는다. Canonical range는 source evidence와 alias
provenance까지 확인한다.

## UI와 command safety

기존 11단계 IA는 유지했다. `클립 QA`에는 canonical QC와 selected range 표를
추가하고, `최종 편집`에는 alias/ready-range/QC count와 정확한 차단 이유를
추가했다. 결정론 검사 PASS는 cyan/preview가 아닌 해당 검사 항목의 PASS로만
표시되며, canonical decision과 사람 판정 및 종합 QA는 별도 배지다.

기존 ffprobe spec은 단순 `ffprobe <file>`이면서 `<file>.ffprobe.json`을 evidence로
주장했고, concat spec은 selected in/out을 반영하지 않았다. 두 spec은 현재
`command:''`, `args:[]`, `copy_allowed:false`, `evidence_output_path:''`다. Disabled
버튼에는 click listener가 없고 synthetic DOM dispatch에서도 clipboard IPC는
0회다. Run 버튼은 없다.

## 검증

첫 network-denied focused 실행은 다음 44개를 모두 통과했다. 실패와 self-fix는
없었다.

```text
tests/canonicalFinishingState.test.mjs
tests/canonicalProductionReader.test.mjs
tests/pipelineQueueRules.test.mjs
tests/rendererContract.test.mjs
src/lib/pipeline/validators.test.mjs
```

Matrix는 golden selected/QC, missing, malformed, oversize, symlink, outside/sensitive
path, negative/reversed/string range, missing source, duplicate/mismatched shot,
provider/QC conflict, stale QC, private content non-leak, 한국어 UI, false final
command copy 0을 포함한다.

첫 full 실행은 113/115 PASS였다. 실패 2건은 Layout A/B의 기존 Markdown
`accepted_seconds.md` fixture에 canonical 전용 source-file evidence 규칙을 잘못
확장한 같은 호환 회귀였다. 허용된 한 번의 targeted self-fix는 canonical strict
path를 그대로 두고 legacy Markdown 집계 의미만 복원했다. 이어서 focused
54/54와 full 115/115가 통과했으며 두 번째 실패는 없었다.

최종 network-denied 전체 suite는 115/115 PASS, lint PASS, Vite build 41 modules
PASS다. `git diff --check`, trailing whitespace, secret/private-content negative scan,
no-release, 두 repository before/after status는 commit 전 evidence card로 고정한다.

## 배정 감사

- Executor/final integrator: `/root/canonical_handoff_adapter_integrator`
- Nominal allocation: `gpt-5.6-sol / high`
- Complexity: ordinary complex coding; schema가 명확한 bounded reader/normalizer/UI/
  test integration이며 unknown root cause나 architecture migration은 없음
- Token efficiency: canonical finishing source와 직접 영향 파일만 조사하고 temp
  fixture 자동 검증으로 제한
- Guide basis: multi-source contract synthesis와 실제 implementation/test/final
  integration은 Sol/high
- Availability: 2026-07-13T22:21:17+09:00,
  `/Users/jessiek/.local/bin/codex`, `codex-cli 0.144.0-alpha.4`, local cache의
  `gpt-5.6-sol` high/xhigh/max/ultra, Node v24.8.0
- Escalation: schema contradiction, 실제 source 실행/production mutation 필요,
  원인 불명의 첫 final validation failure면 commit 없이 BLOCK
- De-escalation: focused 44/44 PASS 후 full suite/lint/build/diff/status로 통합
- Independent verifier: ordinary-complex threshold이므로 executor-owned fixture와
  full regression을 적용하고 별도 verifier는 요구하지 않음

## 남은 blocker

- 실제 Electron current-build GUI는 이번 슬라이스에서 실행하지 않았다.
- 실제 production을 읽거나 수정하지 않았으므로 production finishing quality는
  증명되지 않았다.
- selected-range render plan과 persisted ffprobe JSON contract가 구현되기 전까지
  최종 명령은 계속 disabled다.
- Planning-write/path-provenance 독립 security verdict BLOCK, current bridge runtime
  재검증, root2 native selection, post-fix console/mobile keyboard 증거, offline OSV
  gap은 별도 기존 blocker다.
- 외부망, generation, review, download/upload, ffmpeg/ffprobe, account, release,
  deploy, package, push는 실행하지 않았다.
