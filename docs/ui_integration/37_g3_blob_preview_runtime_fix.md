# G3 Blob preview transport 수정, Chromium receiver 진단 및 실제 Electron 최종 인수

기준일: 2026-07-14 (Asia/Seoul)

Executor: `/root/g3_blob_preview_integrator`

Follow-up executor: `g3-atob-binding-integrator-20260714`

Final integrator: `g3-runtime-acceptance-final-integrator-20260714`

## 결론

G3의 기존 `data:video/...` source 생성은 제거하고, main이 반환한 제한된 base64를
renderer에서 검증한 뒤 `Blob`과 `blob:` object URL로 바꾸는 패치를 작성했다.
`index.html` CSP는 `media-src 'self' blob: file:`과 `connect-src 'none'`을 그대로
유지했다. 최초 실제 Electron 회차에서 video element를 관측하지 못한 뒤, 후속 실제
진단은 기본 helper 경로가 Chromium `atob`를 잘못된 객체 receiver로 호출해
fail-closed한 정확한 원인을 확정했다. 기본 browser `atob`만 `globalThis`에 bind하는
한 줄 제품 수정과 회귀를 추가했고 자동 검증은 통과했다. 수정 후 별도 실제 Electron
인수에서 Blob-only metadata-ready, save/export exact private files, full quit/relaunch
복원과 분리된 OS 창 캡처가 모두 PASS했다. 이 G3 runtime 슬라이스는 인수되지만 실제
production output quality, generation 실행이나 전체 앱의 production readiness를
승격하지 않는다.

역사적 `data:`/CSP 실패 증거는
`docs/ui_integration/36_current_electron_runtime_acceptance.md`에 그대로 보존한다.
이 문서는 그 후속 blob 전환 시도, 정확한 receiver 원인과 최종 PASS를 함께 기록한다.

## 시작 상태와 승인 경계

- main HEAD: `ed1e3190895c571b9c18304679f21543f3154bdd`
- tree: `967875d54019c1f7b85db9eef3660ecd8b9bfa95`
- 시작 시 clean, origin/main보다 30 commits ahead
- required harness 문서 2개 존재
- `release/`와 `/tmp/open-generative-ai-security-review-20260713-p0` 부재
- Jessie의 `앱검증 승인`에 따라 외부망 차단 Electron, 격리 userData/cache/config,
  synthetic fixture, GUI 자동화와 fixture screenshot만 허용
- native dialog, 실제 production, clipboard, generation/review/upload/account,
  ffmpeg/ffprobe, package/release/deploy/push는 금지

## 작성한 안전 설계

`src/lib/pipeline/g3PreviewObjectUrl.js`는 다음 조건을 모두 만족할 때만 object URL을
만든다.

- `loaded === true`
- exact video MIME allowlist: mp4, webm, quicktime, x-m4v
- 유한한 양의 정수 `byte_length`, 최대 32 MiB
- canonical base64 문자·길이·padding·unused bit 검증
- encoded-size 상한과 decoded byte length의 정확한 일치
- 32 KiB base64 quantum 단위 디코딩으로 단일 32 MiB binary string 방지
- Blob size/type 재검증
- 최종 URL이 `blob:`일 때만 성공
- 실패 시 URL을 반환하지 않고, 생성된 잘못된 URL은 폐기
- `dispose()`는 여러 번 호출해도 한 번만 revoke

`G3CandidatePanel`은 한 번에 하나의 URL만 소유한다. 새 preview, 후보 변경, media
error, wrapper DOM 이탈 때 폐기하며, pending IPC가 stale해지면 뒤늦게 만들어진
URL도 즉시 폐기한다. `<video>`는 `blob:` source, native controls,
`preload="metadata"`, 한국어 accessible label만 받는다. Main/preload/19-method
bridge, production schema/write path, command surface와 CSP는 바꾸지 않았다.

## 최초 blob 전환 자동 검증

외부망을 OS sandbox에서 차단한 결과:

- focused helper/UI/CSP/renderer: 21/21 PASS
- 전체 suite: 147/147 PASS
- lint: PASS
- Vite build: PASS, 48 modules
- `git diff --check`: PASS
- 첫 focused 회차의 제품 self-fix: 0회

Pure helper 검증은 네 MIME, exact bytes/type, invalid MIME/base64/padding,
missing/nonfinite/zero/oversize/mismatch length, API 부재, decode/Blob/URL 실패,
bounded aligned chunks, 잘못된 scheme revoke, idempotent dispose를 포함한다. DOM
검증은 blob-only source와 media error, 후보 변경, wrapper disconnect revoke를
포함한다. CSP 회귀는 media `self/blob/file`과 `connect-src 'none'`을 고정한다.

## 실제 Electron 결과

새 회차 root:

`/private/tmp/open-ga-g3-blob-runtime-20260714T110443+0900/`

첫 preflight는 실제 Electron 시작 전에 `git status --short` 첫 줄의 선행 공백을
runtime driver가 `trim()`으로 제거한 탓에 `REPO_WORKTREE_GATE_CHANGED`로
fail-closed했다. 허용된 단 한 번의 국소 self-fix를 temp driver parser에만 사용했다.
제품 코드나 fixture는 이 수정으로 바뀌지 않았다.

그 다음 유일한 actual Electron 회차는 다음까지 도달했다.

- loopback-only sandbox와 격리 mode-0700 profile 시작
- mode-0600 QA config로 synthetic production 복원
- G3 후보·provider·대사·beat·take·in/out·transition·사유를 untrusted DOM event로 설정
- 화면에 존재하는 `선택 후보 미리보기` 버튼을 한 번 programmatic click
- 그 뒤 15초 동안 video element를 관측하지 못해
  `G3_PREVIEW_VIDEO_NOT_CREATED`로 중단

표현식이 video 관측 전에 예외로 끝났기 때문에 새 회차에서는 preview progress,
blob source, decoder readyState/duration, CDP console-clean을 인수 증거로 저장하지
못했다. Electron log에는 reload 중 `ERR_ABORTED`와 종료 시 renderer/GPU 종료가
기록됐지만, 이는 object-URL helper 실패인지 빠른 media error 뒤 element 폐기인지
판별할 만큼 구체적이지 않다. 원인을 확정하지 않는다.

Stop rule에 따라 추가 제품 수정이나 Electron 재실행을 하지 않았다.

| 항목 | 결과 |
| --- | --- |
| decoded video/metadata | BLOCK |
| decoded-video screenshot | N/A, 생성하지 않음 |
| save click | 0 |
| export click | 0 |
| private G3 draft directory | 생성되지 않음 |
| full quit/relaunch restore | N/A |
| 첫 Electron 종료 | PASS, forced false, residual PID/listener 0 |

증거:

- `evidence/start-gate.json` SHA-256 `3a57f8cc1016a3ad32d5bb513d8fcc5411246959e026f8e8f9898db9d581a675`
- `evidence/first-termination.json` SHA-256 `4706f85c4b972757180884110be3fe0b63ea318596360414bc18f4040ec72233`
- `evidence/driver-failure.json` SHA-256 `a24a86565ab64acd512c36e71be9613eb70536d245729678cb9d5b4decb22d61`
- `profile/first-electron.log` SHA-256 `0f5b7b8dbcf274da6ffb1468a701c98da7ad863d09e24e40eb6e7dd9df91d52a`
- fail-closed audit: `evidence/post-block-audit.json`

## 후속 Chromium 진단으로 확정한 실제 branch

후속 진단 증거는 다음 파일에 있다.

`/private/tmp/open-ga-g3-blob-runtime-diagnostic-20260714T113030+0900/evidence/preview-diagnostic.json`

- 화면의 실제 preview button을 programmatic click한 횟수 1, `isTrusted:false`
- main IPC progress `g3-preview-loaded` 정확히 1회, blocked 0, `executed:false`
- renderer 분류 `helper_fail_closed`, video 전환과 media event 0
- 필요한 browser API는 모두 존재
- detached `globalThis.atob` 호출은 PASS
- `holder = { atob: globalThis.atob }` 뒤 `holder.atob(...)` 호출은 Chromium에서
  `TypeError`
- external request, console/log/CSP/exception은 모두 0

따라서 최초 `G3_PREVIEW_VIDEO_NOT_CREATED`의 실제 실행 branch는 media decoder나
CSP가 아니라 `src/lib/pipeline/g3PreviewObjectUrl.js`가 `globalThis.atob`를 plain
runtime object에 저장한 뒤 `runtime.atob(...)`로 호출해 잘못된 receiver를 전달한
helper fail-closed였음이 확정됐다.

## 후속 제품 수정과 회귀

기본 dependency 경로에서만 browser `atob`를 `globalThis`에 bind했다. 주입형
dependency 경로와 MIME/base64/byte 상한, chunking, Blob 검증, `blob:` scheme,
revocation, CSP, main/preload, bridge와 UI는 바꾸지 않았다.

`tests/g3PreviewObjectUrl.test.mjs`의 새 회귀는 임시 global `atob`/`Blob`/`URL`
stub을 설치하고 기본 dependency 경로를 실행한다. `atob` stub은 receiver가 정확히
`globalThis`가 아니면 Chromium과 같이 `TypeError`를 던지며, `finally`에서 기존
global property descriptor를 모두 복원한다. 제품 수정 전에는 6개 중 신규 회귀만
`false !== true`로 실패했고, 수정 후 helper 6/6이 PASS했다. 기존 injected dependency
검증도 그대로 통과했다.

최종 자동 결과:

- helper/UI/CSP/renderer focused: 22/22 PASS
- 전체 suite: 148/148 PASS
- lint: PASS
- Vite build: PASS, 48 modules
- `git diff --check`: PASS
- 기존 10-file WIP 전체 trailing whitespace: 0건
- 제품 self-fix: `globalThis` receiver bind 1건만 적용

저장소의 `sandbox-exec ... deny network*` 명령은 현재 관리형 실행 환경에서 중첩
seatbelt 적용이 `sandbox_apply: Operation not permitted`로 테스트 시작 전에
거부됐다. 동일 테스트·lint·build는 이미 외부 네트워크가 제한된 관리형 환경에서
직접 실행했다. Electron, native dialog, command, ffmpeg, generation, upload 또는
외부 account/network 작업은 실행하지 않았다.

## 수정 후 실제 Electron 최종 인수

Root-owned actual acceptance는 외부망 차단, 격리 fixture와 동일한 private profile
안에서 수행됐다. 새 실제 실행이나 GUI 재실행 없이 다음 저장 증거를 최종 통합했다.

증거 root:

`/private/tmp/open-ga-g3-blob-runtime-diagnostic-20260714T113030+0900/acceptance-functional-20260714T115648+0900/evidence/`

- `first-runtime.json`: PASS, SHA-256
  `24d2aa19460eebdebc68badcb5066ec16d4993687d0edb3a06f5983ef4ce04a8`
- `relaunch-runtime.json`: PASS, SHA-256
  `7823cd00f178d319cf9d3b6b0a799af37b8db5d498ff75f2cc7ef8a5a002cc14`
- `end-audit.json`: PASS, SHA-256
  `3a5a7766911427af6837d9e596c644d06dd6e586ca8952082608ab2888f76c13`
- `visual-runtime-ready.json`: PASS, SHA-256
  `f967322fc07feeecb4efc96af3bae922c0d60cfada6909f3001b859b6fc552a1`
- 별도 OS 창 `g3-decoded-preview.png`: 3104x2024, 856652 bytes, mode 0600,
  SHA-256 `d63bf5d62b67be86f2e009f546eaa61c6e004ce855de4e37916d6b87df57c690`

Actual renderer는 정확한 19-method bridge와 `클립 QA·채택 구간` heading을 노출했다.
화면의 visible preview control에 untrusted DOM click 1회를 보내 main
`g3-preview-loaded`가 정확히 1회, blocked 0, `executed:false`로 응답했다. Video는
`blob:` source만 사용했고 `readyState:4`, `networkState:1`, error null, duration
18.6초와 `loadedmetadata`를 확인했다. Separate OS window capture에는 fixture-only
한국어 UI, Clip QA 선택, decoded video frame/controls와 사람 선택 form이 보였다.

Preview/save/export click은 정확히 1/1/1이며 모든 progress는 `executed:false`다.
격리 draft namespace에는 정확히 다음 세 파일만 존재했다.

- `draft.json`
- `g3_review_export.json`
- `selected_takes.json`

상위 폴더는 mode 0700, 세 파일은 mode 0600이고 atomic residue는 0이다. Canonical
schema/hash/source hash, `selected_at`의 main ownership, `promotion_ready:false`, 사람
결정과 machine QC/validation 분리가 모두 PASS했다. 동일 격리 profile을 완전히
종료한 뒤 재실행하자 provider/dialogue/beat/take/range가 복원됐고 root가 일치했으며
stale/source blocker는 0, bridge는 다시 19 methods였다.

첫 실행·재실행·visual capture 종료는 모두 graceful이며 forced false, residual
PID/listener 0이다. External renderer request, console/log/exception, production/HVF/
ledger write, generation/review/upload/account, clipboard, native dialog,
`runSafeCommand`/`previewCommand`, ffmpeg/ffprobe, install/release/deploy/push는 모두
0이다. Tracked fixture/demo는 변하지 않았고 `release/`와 금지된 security temp도
부재했다. 승인된 두 production manifest는 런타임 전후 aggregate-identical이지만,
이번 G3 회차는 실제 production을 읽거나 품질 승인하지 않았다.

## 이전 회차 Source와 side-effect 감사

회차 전후 다음 SHA-256이 일치했다.

- tracked `docs/assets/demo.mp4`와 fixture copy:
  `7e6ee210472390f7ae87e64fd41390df08eba42f8bb8c8a43f44133174e1d895`
- fixture sentinel:
  `edbe13ae448cfcf4f0f51584f8b0d356d51db5cfc68e7c757ca3f71c5892f621`
- fixture `qc_report.json`:
  `d65f22844712cb1c2303798a844a8d7102c37b4cf015c549eceff1446aa61820`
- fixture production `selected_takes.json`:
  `ab6885da716b03fe9b7264c2d68e6560b50a003bdfd35e731f08796a0651e724`

최종 인수 전 회차의 외부 network, native dialog, 실제 production/HVF/ledger write,
clipboard, command, generation/review/upload/account, ffmpeg/ffprobe,
package/release/deploy/push는 모두 0이다. 당시 `film-pipeline/drafts`도 생성되지
않았다. 최종 인수의 격리 draft 파일은 위 절에 별도 기록한다.

## 현재 결론과 남은 BLOCK

G3 Blob preview, metadata, exact private save/export와 full quit/relaunch restore는
actual Electron 기준 PASS다. 역사 문서 36의 당시 `data:`/CSP BLOCK은 수정하지
않으며, 후속 receiver 진단과 현재 PASS를 소급해 섞지 않는다.

다음은 이번 인수와 별개로 계속 남는다.

1. Current build의 native folder selection.
2. 실제 keyboard-only mobile select.
3. Planning-write/path-provenance 독립 acceptance와 offline OSV.
4. Production 승격 importer/CAS, range-aware render와 fresh probe.
5. 실제 generation 실행과 production output-quality acceptance.

따라서 G3 runtime 슬라이스는 통합 가능하지만 전체 production readiness를
주장하지 않는다.
