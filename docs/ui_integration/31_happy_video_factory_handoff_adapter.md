# happyVideoFactory Canonical Handoff Adapter v1

기준일: 2026-07-13 (Asia/Seoul)

> 후속 현재 상태: canonical finishing state v1이 exact-root
> `shot_manifest.json`, `selected_takes.json`, `qc_report.json`과 QA/최종 상태를
> 추가했다. ffprobe/concat command는 더 이상 copy-only가 아니라 명령·증거·복사가
> 모두 disabled다. 현재 계약은
> `docs/ui_integration/32_canonical_finishing_state.md`를 함께 따른다.

## 결과

기존 generic `ai_video_pipeline` plan/run preview를 제거하고
`happyVideoFactory`의 실제 `short_drama_pipeline` pack 계약에 맞춘 읽기 전용
handoff를 연결했다. 기존 production에서는 canonical validator만 copy-only로
제공한다. 새 pack 출력 폴더가 비어 있음을 main process에서 증명할 수 없는 현재
상태에서는 build 명령과 복사를 모두 fail-closed한다.

이 변경은 generation, submit, external review, upload, ffmpeg/ffprobe 실행을
추가하지 않는다. `runSafeCommand`는 계속 모든 실행을 차단한다.

## Fixed-root harness provenance

Main process만 아래 고정 root를 알고 있다.

`/Users/jessiek/StudioProjects/happyVideoFactory`

Renderer는 root나 entrypoint를 전달할 수 없다. `getHarnessContractStatus()`는
인자 없는 IPC이고 exact allowlist 5개만 검사한다. Root와 모든 parent component,
leaf는 existing non-symlink directory/regular file이어야 한다. 각 파일은 2 MiB
상한, required marker, no-follow open, lstat/fstat identity와 root containment를
통과해야 한다. 반환값은 path, exists, size, SHA-256, ready, reason,
`liveSideEffect`뿐이며 본문은 반환하지 않는다.

| id | exact relative path | 역할 | live side effect |
| --- | --- | --- | --- |
| `pack_builder` | `scripts/build_short_drama_pipeline_pack.py` | plan-only pack build 계약 | false |
| `pack_validator` | `scripts/validate_short_drama_pipeline_pack.py` | existing pack read-only validation | false |
| `room_plan_builder` | `scripts/build_short_drama_room_pipeline_plan.py` | room plan/ledger 계약 | false |
| `room_verifier` | `scripts/verify_short_drama_room_pipeline.py` | synthetic room self-test 계약 | false |
| `canonical_pack_contract` | `video_core/short_drama_pipeline/validator.py` | pack version/submission/id fail-closed 계약 근거 | false |

현재 source read-only probe는 5/5 `available`이다. SHA-256은 다음과 같다.

- pack builder: `99fa9ee72964c7cc7d9948b502cc0b67607264bf4373c6d4bab835e75de1740e`
- pack validator: `9e5a01be5c692aef4e77ec20472b02eaeddb03086e3f29e721c322aebd1e2be8`
- room plan builder: `e219d3a5f45f307a17d0920426b0404103b12048e3432306ee12942be95eaa09`
- room verifier: `d950866fec78e0d8bece79b5cc9731e2211fc7745aef308cc35e4e49b9a18e38`
- canonical pack contract: `227d8726c98471356a72dfc97509a425abeb169ca16f06e94cc828064abdc368`

이 hash는 provenance 상태이지 해당 repo의 전체 QA 또는 실제 생성 readiness를
뜻하지 않는다.

## Command contract

| 경우 | preview | copy | 실행 |
| --- | --- | --- | --- |
| fixed harness 5/5 + main-owned production + canonical brief/script/report | `python3 <absolute-validator> <configured-root> --json`, cwd=fixed root | 허용 | 없음 |
| harness missing/partial/symlink/oversize/malformed | disabled | 차단 | 없음 |
| production root mismatch 또는 canonical input partial | disabled | 차단 | 없음 |
| existing production build | 명령 미생성 | 차단 | 없음 |
| unsupported route | 명령 미생성 | 차단 | 없음 |

Route mapping은 `seedance -> seedance`, `flow_omni -> flow`, `both -> both`다.
기존 production에 덮어쓰기 옵션이나 side-effect 허용 플래그를 추가하지 않는다.
Validator stdout은 저장 파일 증거라고 주장하지 않는다.

`copy_allowed:false`인 카드에는 click listener가 없으므로 disabled 버튼을
programmatic dispatch해도 clipboard IPC가 0회다. Side-effect BLOCK 카드의 기존
copy-only 정책은 바꾸지 않았다.

## Canonical reader contract

Layout A는 `intake/script.txt`를 우선 읽고 기존 `intake/script.md`와 `script.md`
fallback을 유지한다. Root의 다음 JSON만 exact path에서 각각 512 KiB 상한으로
읽는다.

- `pipeline_pack_report.json`
- `submission_manifest.json`
- `jimeng_state.json`
- `download_manifest.json`

허용된 구조 메타데이터만 renderer state로 전달한다. Prompt, image input,
script 본문, raw error/note, private/outside/sensitive path는 폐기한다.
Submission normalization은 `shot_id -> clip_id`, `gen_status -> status`,
`model -> submitted_cli_model` fallback을 적용한다. 값이 없으면 `unknown`으로
명시한다. 파일 존재, download, status는 review PASS나 output-quality PASS로
승격하지 않는다. Report/manifest malformed, stale, production-id/route 불일치는
`OUTPUT_QUALITY_NOT_PROVEN`을 유지하고 `canonicalHandoff.final_ready`는 항상
false다.

## Prompt Steward / AI PRD·Eval

- Outcome: 실제 canonical validator handoff와 최소 pack/ledger 복원을 제공한다.
- Success: path/cwd/args가 source CLI와 정확히 일치하고 UI가 한국어
  `사용 가능/부분/차단`을 표시하며 모든 상태가 fail-closed다.
- Constraints: fixed root read-only, renderer path input 없음, 외부망/GUI/production
  read-write/live side effect 없음, happyVideoFactory 수정 없음.
- Tools/evidence: source-only CLI/schema inspection, OS temp fixture, Node test,
  network-denied sandbox, lint/build/diff/status/hash.
- Output: app code, deterministic tests, 본 계약 문서와 current acceptance update,
  단일 local main commit.
- Stop/BLOCK: canonical source 충돌, renderer path injection 필요, 실제 production
  또는 live execution 필요, happyVideoFactory mutation, self-fix 후 두 번째 검증
  실패 시 commit 없이 BLOCK.
- Quality eval: exact validator command/cwd/arg, Korean readiness, sanitized state,
  no private content, no false `final_ready`.
- Failure eval: wrong route/script/cwd, disabled copy IPC, malformed manifest success
  승격, generic/live surface 재도입, external repo delta는 모두 실패다.
- Golden: 5-file harness + canonical Layout A fixture -> available, exact validator,
  `SHOT_01/processing/seedance2.0` normalization.
- Edge: partial/stale report/manifests -> copy disabled, quality blocked.
- Negative: missing/symlink/oversize/malformed/unsupported -> fail-closed.

## 배정 감사

- Executor: `/root/canonical_handoff_adapter_integrator`
- Nominal model allocation: `gpt-5.6-terra / xhigh`
- Task complexity: ordinary complex coding; clear root cause and bounded
  multi-component adapter/test integration.
- Token efficiency: bounded-moderate; canonical scripts/contracts and impacted app
  files only.
- Guide basis: 명확하고 자동 검증 가능한 patch/test/integration은 Terra xhigh.
- Escalation: canonical contract 충돌 또는 두 번째 validation failure면 BLOCK.
- De-escalation: focused golden/missing/stale/forbidden matrix PASS 후 full regression.
- Availability evidence: 2026-07-13T21:43:22+09:00,
  `/Users/jessiek/.local/bin/codex`, `codex-cli 0.144.0-alpha.4`, local model cache의
  `gpt-5.6-terra` xhigh, Node v24.8.0, clean target commit/tree를 read-only 확인.
- Independent verifier: project threshold 아래의 fixed-root read-only metadata
  adapter이며 실제 fixture/handler regression으로 executor-owned validation 적용.

## 검증

첫 focused 실행은 35/38 PASS였다. 제품 metadata 설명의 덮어쓰기 flag literal과
동기 throw를 비동기 assertion으로 검사한 test harness 오류만 실패했다. 허용된
한 번의 targeted self-fix 후 같은 network-denied focused matrix가 38/38 PASS했다.

추가 fail-closed edge와 한국어 readiness 3상태를 포함한 최종 network-denied full suite는 108/108 PASS,
`npm run lint` PASS, Vite build 41 modules PASS다. `git diff --check`, whitespace,
두 repo status/hash와 no-release 결과는 commit 직전 evidence card에 고정한다.

## 잔여 P0/P1

- P0: 이 adapter가 새로 만든 live side-effect 또는 external path는 없다.
  기존 planning-write/path-provenance 독립 security verdict BLOCK은 별도 상태로
  유지한다.
- P1: 현재 UI는 안전한 빈 new-pack output을 main에서 증명하지 못하므로 build
  preview를 제공하지 않는다.
- P1: 현재 12-method bridge는 실제 Electron 재실행 증거가 없으며 이전 GUI
  증거와 분리한다.
- P1: 실제 production artifact/QA/accepted-seconds/final-quality가 없으면
  `final_ready`는 계속 false다.
- P1: offline OSV DB gap은 본 adapter와 별도로 남는다.
