# 현재 Electron runtime 인수 결과

검증일: 2026-07-14 KST
실행·증거 통합 담당: `/root/current_electron_dom_runtime_integrator`
검증 대상 commit: `710ed170d10aee8428349b51480fcb7518cf5360`
검증 대상 tree: `df27b74002a2217ace962f91bc0018d390d1d944`

## 결론

현재 build의 실제 Electron 창, 정확한 19-method `window.filmPipeline`, 한국어
11개 메뉴, fixture/두 승인 production의 main-owned 읽기와 4개 반응형 화면은
통과했다. G3 후보 선택도 실제 renderer control의 `input`/`change` 이벤트를 거쳐
preload/main IPC까지 도달했다.

그러나 실제 후보 미리보기는 **BLOCK**이다. Main은 후보를 정상적으로 읽어
`g3-preview-loaded`를 한 번 반환했고 renderer도 `data:video/...` source를 만들었지만,
`index.html`의 CSP가 `media-src 'self' blob: file:`만 허용해 `data:` 미디어를
거부했다. 실제 `<video>`는 `MEDIA_ERR_SRC_NOT_SUPPORTED`에 해당하는 error code 4,
`readyState:0`, `networkState:3`으로 끝났다. 따라서 이 회차는 fail-closed 규칙대로
저장·내보내기·G3 재실행을 하지 않았다. 현재 G3 save/export/userData restore는
구현·자동 테스트 상태이지 실제 Electron runtime 인수 상태가 아니다.

## 승인과 격리

Jessie의 현재 회차 `앱검증 승인`을 policy
`2026-07-12-manager-only-v1`의 다음 범위에만 적용했다.

- 실제 Electron 시작·종료
- 격리된 HOME/TMPDIR/cache/userData/config 쓰기
- fixture GUI 자동화와 fixture-only screenshot
- 승인된 두 production root의 읽기 전용 runtime 복원
- 외부망 차단 상태의 loopback CDP

외부 네트워크, 생성·제출·외부 검토·업로드·계정 작업, builder, command 실행,
ffmpeg/ffprobe, production/ledger/happyVideoFactory 쓰기, release/deploy/push는
허용 범위에서 제외했다. 사용한 loopback-only `sandbox-exec` profile의 기존
SHA-256은 `a7ae99c801f4ba7639b57815663297c7367bfdc5c4aace66997bfdc5887cdd51`이다.

모든 새 runtime artifact는
`/private/tmp/open-ga-current-runtime-20260714T0uVc9C/dom-phase/`에만 저장했다.
Screenshot과 Electron profile은 commit하지 않았다.

## 시작 게이트와 이전 두 회차

기존 evidence JSON 9개의 JSON object shape, 일반 파일/비심볼릭 상태와 SHA-256을
다시 검증해 모두 일치했다. 핵심 기존 evidence SHA-256은 다음과 같다.

| evidence | SHA-256 | 결과 |
| --- | --- | --- |
| 최초 actual runtime baseline | `b66f45d89479960233a26ee5ca4173c0331bbf8889684848bfbf40f300adedd7` | PASS |
| native fixture mismatch | `7d843ab4f0b123f3d4211853c65c41ef9c16e84b7d7958e8f32bc50bf4de98d1` | 원문 보존 |
| seeded trusted-keyboard blocker | `5e1b573794a34b73957f0d11d3e8254364aef762918d1129b9fc3c676ff1f45f` | 원문 보존 |
| seeded phase end audit | `e97f37f00f44487bdb68e27dac926650bd83b19a19db50ef43a7705b93687efc` | PASS |

세 실행 phase를 다음처럼 분리한다.

1. 첫 actual Electron phase의 baseline은 19-method bridge와 11개 메뉴를 확인했다.
   Native folder 자동화는 fixture가 아니라 기본 production root를 반환해
   `FIXTURE_NATIVE_SELECTION_MISMATCH`였다. 현재 문서는 이를 native PASS로
   바꾸지 않는다.
2. QA-preseeded phase는 fixture G3의 1 shot/1 candidate를 읽었지만 CDP trusted
   keyboard sequence 뒤에도 후보 select 값이 비어 있었다. Preview는
   `먼저 후보를 선택하세요`에서 끝났으므로 당시 `g3-media-decoder-block.json`은
   decoder 도달 증거가 아니다. 최종 분류는
   `G3_CANDIDATE_TRUSTED_KEYBOARD_SELECTION_NOT_APPLIED`다.
3. 이번 phase는 위 두 입력 경로를 반복하지 않았다. 새 profile에서 actual DOM
   event만 한 번 사용해 후보/편집 값과 preview click을 검증했다.

시작 시 canonical fixture의 `beats.json`, `shot_manifest.json`, `qc_report.json`,
production sentinel `selected_takes.json`, 후보 MP4와 tracked `docs/assets/demo.mp4`의
SHA-256을 검증했다. 후보와 tracked MP4는 같은 6,031,646-byte 파일이며 SHA-256은
`7e6ee210472390f7ae87e64fd41390df08eba42f8bb8c8a43f44133174e1d895`였다.
Fixture를 재생성하거나 수정하지 않았다.

## 이번 actual DOM phase

### Baseline

- 실제 `file:` renderer, `lang=ko-KR`, `window.localAI === undefined`
- `window.filmPipeline`: 정확히 19 methods
- 11개 메뉴 실제 DOM click과 expected heading: 11/11 PASS
- G3: 1 shot, 1 candidate, canonical room QC 읽기 전용
- 후보 opaque token: 43 bytes, 원문 미기록
- baseline renderer request: `file:` 4, external 0
- baseline console warning/error 0, log warning/error 0, exception 0
- native folder dialog 0, CDP `Input.*` 0
- 실행 가능한 generation/submit/upload command control 0

### G3 actual renderer event

단 하나의 `Runtime.evaluate` workflow에서 실제 visible control을 매 event마다 다시
조회했다. 후보, 제공자, 대사 소스, 비트, 테이크, in/out, 전환, 선택 사유,
샷 메모와 전체 메모에 bubbling `input`과 `change`를 각각 보냈다.

- DOM event: 24개, 모두 `isTrusted:false`
- 후보 값: 렌더 재생성 뒤에도 43-byte token으로 rebound
- 제공자 `seedance`, 대사 소스 `native_video_lipsync`, 비트 `BEAT01`,
  테이크 `TAKE01`, range `0..1`, transition `cut/0`: rebound PASS
- native dialog 0, trusted keyboard/CDP `Input.*` 0
- `선택 후보 미리보기` actual DOM `.click()`: 정확히 1회
- preview IPC progress: `g3-preview-loaded` 정확히 1회, `executed:false`
- `<video>` 생성: PASS
- source: `data:video/...`, 길이 8,042,218; base64 본문은 evidence/doc에 미기록
- metadata/decoder: error code 4, readyState 0, networkState 3, duration null,
  metadata event 0 → **BLOCK**
- renderer external request 0, console warning/error 0, exception 0
- preview 뒤 security log error 1건; SHA-256
  `55de2d64de681049ea4cdb2b01f0119e3dd72b7c47ff0e796b5022164ae024d7`

Electron log의 원문 base64는 출력·commit하지 않았다. Sanitized 원인은
`index.html:6`의 `media-src`가 `data:`를 허용하지 않는 CSP/runtime contract
불일치다. 후보 파일 자체는 사용 전후 SHA-256이 같았고 main IPC는 loaded progress를
반환했으므로, 이 결과를 후보 선택 실패나 파일 누락으로 분류하지 않는다.

### Stop 결과

Decoder가 metadata-ready에 도달하지 못했으므로 작업 packet의 stop rule을 적용했다.

- 저장 click: 0
- 내보내기 click: 0
- JS alert: 0
- `draft.json`, `selected_takes.json`, `g3_review_export.json`: 0
- production `selected_takes.json` 변경: 0
- G3 full quit/relaunch restore: N/A
- clipboard: N/A; G3 화면에는 이 회차에서 검증할 copy-ready card가 없어 click 0

DOM에 입력된 unsaved 값은 screenshot 시점 renderer state에 남았지만 main state는
`status:empty`, `G3_SELECTION_INCOMPLETE`, `saved_at/exported_at` 빈 값으로 유지됐다.
이는 저장되지 않은 renderer 입력을 runtime 저장 성공으로 오인하지 않았다는
fail-closed 증거다.

## 반응형과 screenshot

CDP device metrics와 fixture-only 화면으로 네 크기를 캡처한 뒤 모든 이미지를
original detail로 직접 확인했다. Screenshot은 temp에만 있고 commit하지 않았다.

| viewport | navigation | overflow/clipped interactive | G3 reach | screenshot SHA-256 |
| --- | --- | --- | --- | --- |
| 320×900 | mobile stage select | 0 / 0 | PASS | `8cd517eb5e3848e7d46c9884a1475d0a41f1bebc9848b097fa16a582bd9e6284` |
| 768×900 | mobile stage select | 0 / 0 | PASS | `35775d18ba69c2a5351682b85194ccd355d7b2af3e73d484295b42c83bf254e5` |
| 1024×768 | desktop grouped sidebar | 0 / 0 | PASS | `e0b04a0a590c2e4bceabffc8f0a239879176ea808383e64ac3b0109ff67800c1` |
| 1440×900 | desktop grouped sidebar | 0 / 0 | PASS | `84c67e6ce51cac30f7c89993c0cc02770f1cf5c4987cf3796faae94524b346bc` |

320/768 instrumentation의 `mobile_select_visible:false`는 change 직후 렌더로
분리된 이전 node를 재사용한 측정 결함이다. 두 screenshot에는 `작업 단계 선택`과
`클립 QA` select가 실제로 보이며 별도 visual-inspection evidence에 그 차이를
명시했다. 이 측정 보정 때문에 Electron/DOM을 재실행하지 않았다.

Mobile stage select는 bubbling change로 `final` 값과 `최종 편집·보고서` heading을
동시에 확인해 `PROGRAMMATIC_DOM_CHANGE_PASS`다. 이벤트는 `isTrusted:false`이며
**실제 keyboard-only PASS로 승격하지 않는다**. `MOBILE_KEYBOARD_ONLY_GAP`은 남는다.

Screenshot skill helper가 만든 실제 macOS app-window capture는 3104×2024,
831,188 bytes, SHA-256
`dbf7ce8c3491ecbb993643994533325dfff65ae9f5e84e26b5f8c784f99b094e`다.
Fixture 화면만 포함하고 승인된 실제 production의 private 화면은 캡처하지 않았다.

## 승인된 두 production의 non-native runtime

두 root는 각각 별도 0600 config/fresh isolated profile로 한 번씩 읽었다. Native
dialog를 사용하거나 G3 action/copy를 실행하지 않았으므로 분류는
`NON_NATIVE_RUNTIME_READ_PASS`에 한정한다.

| production | files / parsed / review / accepted | blocker | final_ready | unsafe enabled | 결과 |
| --- | --- | --- | --- | --- | --- |
| `gangnam_shorts_system_income_20260707` | 293 / 4 / 0 / 0 | 5 | false | 0 | PASS |
| `ep01_apologist` | 524 / 2 / 0 / 0 | 5 | false | 0 | PASS |

두 앱 모두 19-method bridge, `최종 편집·보고서` heading, root equality, external
request 0, console/log/exception 0을 확인했다. Gangnam reload 중 취소된 local
`file:` Script 1건(`net::ERR_ABORTED`, canceled true)은 외부 요청이나 renderer
console failure로 분류하지 않는다. 실제 content/screenshot은 기록하지 않았다.

두 root의 relative path/type/size/nanosecond-mtime aggregate는 phase 전후 같다.

- Gangnam: 356 entries,
  `58c8c9bcb2ff09354e651bfe0e33f635cbb705b78b9b13f982d713bbee253c30`
- Ep01: 588 entries,
  `87c216d43fc57e07839ed356954f7169be8f9101b4e5a38f1124d42fb666e560`

이번 회차 시작 전 happyVideoFactory dirty context는 이미 packet 기준 91 entries에서
97 entries로 외부 drift했다. 이 phase의 시작과 종료는 commit
`2fb68dae58a688239cd477deafe7074b866f1e08`, tree
`199d1723943936e3ec2f079668b3a6997b693437`, dirty count 97, aggregate
`afa4a7ba7a18e21c0260eb72c5e9ac43c9fa6094ce0550113e485b1c91a262ff`로
같았다. Dirty content는 읽거나 수정·stage·commit하지 않았다.

## PASS/BLOCK/N/A matrix

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 기존 evidence 보존/shape/hash | PASS | 9/9 exact match |
| fresh isolated Electron launch | PASS | loopback-only OS sandbox |
| current preload bridge | PASS | exact 19 methods |
| 한국어 menu/panel | PASS | 11/11 actual DOM click/heading |
| G3 source reconstruction | PASS | 1 shot, 1 candidate, canonical QC read-only |
| actual DOM candidate/editor events | PASS | 24 events, all untrusted, rerender rebound |
| preview renderer→preload→main IPC | PASS | `g3-preview-loaded` 1, executed false |
| native media decoder/metadata | **BLOCK** | CSP rejects data media; code 4/readyState 0 |
| G3 save/export filesystem | N/A | decoder stop rule, click/file 0 |
| G3 full quit/relaunch restore | N/A | 저장 artifact 없음 |
| 4 viewport layout | PASS | overflow/clipped 0, visual inspection complete |
| mobile programmatic select | PASS | value `final` + expected heading |
| mobile keyboard-only select | **BLOCK** | 재시도 금지, 기존 gap 유지 |
| native folder selection | **BLOCK** | 이번 distinct phase에서 재시도하지 않음 |
| real roots non-native read | PASS | both final false, unsafe enabled 0 |
| clipboard | N/A | copy-ready G3 card 없음, invocation 0 |
| external network | PASS | renderer external request 0 |
| baseline console/log/exception | PASS | 0/0/0 |
| preview 이후 console-clean | **BLOCK** | CSP security log error 1 |
| process termination | PASS | 3 launches 모두 force 없이 종료, residual/port 0 |
| fixture/production/HVF write | PASS | 0; before/after aggregate 동일 |

## 부작용 감사

Fixture production과 승인 root는 모두 불변이다. 격리된 Electron profile 외 실제
userData write는 0건이며, 다음 side effect는 모두 0건이다.

```text
external network, generation, submission, external review, upload,
external account, clipboard, native dialog, CDP trusted keyboard,
runSafeCommand, previewCommand, planning write, production/ledger/HVF write,
ffmpeg, ffprobe, builder, release, deploy, push
```

모든 Electron process는 force 없이 종료됐고 residual PID와 CDP listener는 0이었다.
`release/`와 `/tmp/open-generative-ai-security-review-20260713-p0`도 재생성되지 않았다.

## 문서 통합 후 재검증

제품 코드와 test harness를 수정하지 않은 상태에서 외부망을 OS sandbox로 차단하고
현재 checkout을 다시 검증했다.

- 전체 test: 141/141 PASS
- lint: PASS
- Vite build: PASS, 47 modules
- 외부 package install/audit/update: 실행하지 않음

최종 `git diff --check`, changed-document trailing whitespace, 변경 범위와 금지 경로
부재는 문서 전용 commit 직전에 별도로 확인한다.

## 남은 production-readiness blocker

1. G3 preview transport와 CSP를 같은 계약으로 맞춰야 한다. `data:` 허용 확대와
   bounded `blob:` 전환은 보안 trade-off가 다르므로 별도 제품 코드 판단·회귀가
   필요하다.
2. 수정 후 actual Electron에서 preview metadata-ready, save, 정확한 mode 0700/0600
   세 파일, 비승격 export shape/hash, full quit/relaunch restore를 새로 검증해야 한다.
3. Current 19-method build의 native folder 선택은 여전히 PASS가 아니다. 기존
   fixture mismatch와 Ep01 native gap을 보존한다.
4. Mobile keyboard-only selection은 프로그램 change PASS와 별개로 남는다.
5. Planning-write/path-provenance 독립 security verdict와 offline OSV DB gap은 이
   회차가 해결하지 않았다.
6. 실제 production 승격 importer/CAS, selected-range render/fresh probe 계약과 실제
   output-quality acceptance는 아직 없다. 이 앱은 generation/upload 실행기가 아니다.

따라서 현재 앱은 production을 읽고 상태를 복원·감사하는 실제 Electron 작업대로는
사용할 수 있지만, G3 동영상 확인→저장→내보내기까지 완결되는 production 영상
검토 작업대로 최종 승인할 수는 없다.
