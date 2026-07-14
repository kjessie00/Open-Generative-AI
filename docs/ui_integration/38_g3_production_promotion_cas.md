# G3 production 반영과 CAS 검증

기준일: 2026-07-14 (Asia/Seoul)

## 결론

G3 사람이 선택해 private export한 canonical `selected_takes.json`을 현재 main-owned
production root의 exact `selected_takes.json` 한 파일에만 반영하는 별도 단계를
추가했다. Renderer에는 production 경로가 전달되지 않으며, 짧은 수명의 1회용 계획,
프로젝트 ID exact 입력과 명시적 checkbox 확인을 모두 통과해야 한다.

결정론적 CAS/fail-closed matrix, 외부망 차단 전체 테스트, lint와 build가 PASS했다.
외부망 차단 actual Electron fixture에서는 실제 trusted input/change/click으로 absent
target을 반영하고 full quit/relaunch 후 `already_current` no-op 상태를 복원했다. 이
실행은 격리 fixture에만 썼고 실제 Jessie production 또는 happyVideoFactory에는
쓰지 않았다.

실행·테스트·최종 통합 소유자는 `/root/g3_promotion_cas_integrator`다. Root Codex의
별도 최종 acceptance는 이 문서의 executor 증거와 구분한다.

## 제품 경계

새 preload surface는 다음 두 개다.

- `planG3ProductionPromotion()`: 인자 없음. 경로와 private content를 반환하지 않고
  plan token, 만료 시각, project/episode, shot 수, target 상태, hash 요약, 한글 안전
  요약과 blocker만 반환한다.
- `promoteG3ProductionSelection(payload)`: exact
  `{ planToken, projectIdConfirmation, confirmed }`만 허용한다. 추가 path/root/cwd/command
  필드가 있으면 차단한다.

이에 따라 `window.filmPipeline`은 정확히 21 methods다. Public `setConfig`나 별도
generation/upload/ledger/command surface는 추가하지 않았다. Plan progress는 항상
`executed:false`이고 실제 fixture 반영만 `g3-production-promoted`와
`executed:true`를 보낸다. 같은 hash는 `g3-promotion-already-current`와
`executed:false`다.

## 계획과 재검증

Plan token은 32 random bytes의 43자 base64url이며 process memory에만 저장한다.
기본 TTL은 2분이고 한 번 promote 요청에 사용하면 성공 여부와 무관하게 즉시
소모한다. 앱 재시작 뒤 이전 token이 무효가 되는 것은 의도된 fail-closed 동작이다.

계획과 반영 시 다음 근거를 모두 다시 읽고 검증한다.

1. configured production root identity와 root fingerprint
2. `shot_manifest.json`, canonical beat list, `qc_report.json`, candidate inventory hash
3. private draft, strict `selected_takes.json`, `g3_review_export.json`의 stable hash
4. 모든 shot의 current candidate, provider별 machine QC, beat/take identity와 유효 구간
5. export envelope의 `promotion_ready:false`, human/machine 분리와 strict validation
6. 기존 production target의 존재, regular/non-symlink, 최대 2 MiB, canonical shape,
   identity, mode, 크기와 SHA-256

Source/export/target 중 하나라도 계획 뒤 바뀌거나 target이 malformed, symlink,
oversize이면 반영하지 않는다. Machine QC는 읽기 전용 근거일 뿐 사람 선택이나 최종
영상 품질을 대신하지 않는다. Candidate duration이 authoritative일 때만 선택 종료
상한을 검증하므로 이 단계는 output-quality acceptance가 아니다.

## 저장 알고리즘

Private promotion namespace는 다음 고정 구조를 사용한다.

```text
<Electron userData>/film-pipeline/promotions/g3-production-v1/<root fingerprint prefix>/
  promotion.lock
  previous_selected_takes.json
  promotion_pending.json
  promotion_receipt.json
```

Namespace directory는 mode `0700`, 파일은 mode `0600`이다. Lock과 temp는
`O_NOFOLLOW|O_EXCL`로 만들고 lock 해제 전 inode identity를 다시 확인한다. 반영은
다음 순서다.

1. 같은 private namespace의 exclusive lock 획득
2. plan에 묶인 모든 source/export/target 증거 재검증
3. private pending 저장, 기존 target이 있으면 private backup 저장
4. production root 안의 `.g3-selected-takes-*` mode `0600` temp를 exclusive 생성,
   write와 `fsync`
5. root identity와 target CAS snapshot을 다시 확인
6. exact `selected_takes.json`으로 atomic rename, parent directory `fsync`
7. stable read로 SHA-256, 크기, mode `0600` post-write 검증
8. private receipt 저장 뒤 pending 제거

Rename 전에 실패하면 production temp를 제거한다. Receipt 쓰기만 post-write에서
실패하면 이미 검증된 production 반영은 성공으로 반환하되
`G3_PROMOTION_RECEIPT_WRITE_FAILED` warning과 pending을 남긴다. 기존 target이 export와
같으면 production/private 파일을 쓰지 않는 no-op이다.

## 한글 UI

`클립 QA`의 G3 작업대 아래에 `Production 반영 · 명시적 확인` panel을 추가했다.
Target 상태, exact project 확인 문자열, 선택 shot 수, export/current hash, 안전 요약과
blocker를 먼저 보여준다. Ready 상태에서만 native text input, native checkbox와 반영
button이 나타난다. Exact project ID와 checkbox가 모두 충족되기 전 button은 disabled다.
Interactive control은 최소 44 px 높이를 유지하고 작은 화면에서는 column으로
재배치된다.

초안 저장, export 또는 selection 변경 뒤 기존 계획은 stale 처리한다. 새 계획을
만들어야만 다시 반영할 수 있다. 반영 뒤 workspace, production state와 계획을 모두
다시 읽어 `already_current`를 표시한다.

## 결정론적 검증

외부 네트워크를 차단한 focused 명령:

```bash
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  node --test \
  tests/g3ProductionPromotion.test.mjs \
  tests/g3PromotionUiDom.test.mjs \
  tests/g3ReviewWorkspace.test.mjs \
  tests/g3ReviewUiStatic.test.mjs \
  tests/desktopSecurity.test.mjs \
  tests/rendererContract.test.mjs
```

최종 결과는 follow-up 회귀를 포함해 44/44 PASS다. 포함 범위는 다음과 같다.

- absent target golden write와 exact private export hash
- existing canonical target 교체와 private backup
- same-hash no-op
- one-shot, expiry, wrong project ID, false confirmation, malformed confirmation,
  extra path field와 invalid/nonexistent raw token 격리
- source candidate/manifest/QC, private selected/export/envelope, target stale
- malformed/symlink/oversize target
- concurrent private lock
- rename failure, pending 유지, production temp cleanup
- registered IPC의 pathless plan과 exact promote payload
- 실제 `PipelineStudio()` DOM의 text input + checkbox + button gating과 exact payload
- blocked/already-current 상태의 promote button 부재
- exact 21-method preload와 active Electron security regression

첫 focused 실행의 유일한 실패는 production target symlink 전용 blocker를 기대한 새
test가 기존 reader의 선행 `G3_PRODUCTION_SCAN_SKIPPED_SYMLINKS`를 반영하지 못한
test-only 기대 불일치였다. 기대만 기존 fail-closed 계층에 맞춘 뒤 40/40을 통과했다.
호환성 test의 optional plan 기본값과 obsolete UI copy도 최종 전체 검증 전에
국소 수정했다. 최종 self-audit에서는 공용 ID validator가 주위 공백을 trim한다는
점이 exact 확인 요구와 맞지 않는 것을 찾아 backend raw string 비교와 UI exact
비교로 강화하고, 공백 입력 차단 회귀를 같은 focused case에 추가했다.

### 독립 verifier P2 follow-up

독립 verifier는 `e7926ff`에서 `consumePlan`이 envelope/confirmation을 token 삭제보다
먼저 검증해, 유효한 raw token을 넣은 `confirmed:false`, extra field, malformed
confirmation 실패 뒤 같은 token을 정상 요청으로 재사용할 수 있음을 재현했다. 실제
production 우회는 아니지만 모든 promote 시도에서 즉시 1회 소모한다는 계약 위반이다.

제품 수정 전 새 12-test promotion file은 9 PASS / 3 FAIL이었다. 실패는 위 세 경우
각각의 두 번째 정상 요청이 `G3_PROMOTION_TOKEN_INVALID`를 던지지 않은 동일 원인이다.
수정은 `consumePlan` 순서만 바꿨다. Payload가 object인지 확인한 뒤 raw 43-char
base64url token만 판독하고 store lookup/delete를 즉시 수행한 다음 exactKeys,
confirmation, expiry와 evidence 검증을 진행한다. Invalid 또는 nonexistent raw token은
어떤 다른 plan record도 소모하지 않는다.

수정 후 promotion file은 12/12 PASS다. Confirmed false, extra field, malformed
confirmation, wrong-but-valid mismatch, expired token과 valid success 모두 같은 token의
후속 요청이 INVALID이고, invalid/nonexistent token 뒤에는 별도 유효 plan이 정상
반영되는 회귀를 포함한다. Bridge와 IPC payload surface는 바뀌지 않았다.

전체 검증 결과:

```text
network-denied tests: 162/162 PASS
network-denied lint: PASS
network-denied Vite build: PASS, 50 modules
git diff --check: PASS
```

## Actual Electron fixture 증거

증거 root:

```text
/private/tmp/open-ga-g3-promotion-runtime-20260714T124624+0900/evidence/
```

기능 회차는 application network를 `sandbox-exec`으로 loopback-only로 제한했고,
automation driver는 local CDP에만 연결했다. 결과는 다음과 같다.

- exact bridge methods: 21
- pathless plan: `ready`, 43-char token, absolute fixture path 직렬화 0
- trusted GUI events: input/change/click 모두 `isTrusted:true`
- progress: `g3-production-promoted` 정확히 1회, `executed:true`
- target: 605 bytes, mode `0600`, SHA-256
  `ef2ceda6b4f38c150f2c81c16789eca6f19cd9448b11cc052b677c0c4e9cb6c1`
- target과 private export byte/hash exact match, schema/project/episode/take count 검증
- absent target 회차의 private 파일은 mode `0600` `promotion_receipt.json` 한 개
- manifest/QC/beats/candidate before/after hash 동일, production temp/lock 0
- full quit/relaunch 뒤 private draft selection 복원, target hash 동일,
  plan/UI `already_current`, promote button 0
- external request, failed request, console/log/exception 0
- graceful termination, forced false, residual PID/listener 0
- 실제 production/HVF write, generation/submission/review/upload/account, command,
  ffmpeg/ffprobe, package/install/release/deploy/push 0
- 승인된 실제 production 두 root의 post-work read-only aggregate는 기존 기준과 동일했다:
  `gangnam_shorts_system_income_20260707` 356 entries /
  `58c8c9bcb2ff09354e651bfe0e33f635cbb705b78b9b13f982d713bbee253c30`,
  `ep01_apologist` 588 entries /
  `87c216d43fc57e07839ed356954f7169be8f9101b4e5a38f1124d42fb666e560`.
- happyVideoFactory authoritative `contracts.py`, `validator.py`, selected-takes schema,
  `timeline_builder.py`의 post-work SHA-256도 시작 gate와 각각
  `645e8e78247820f688c77f130a6b45aec6a6f75c49abc0ca4f97b3aa8848b32a`,
  `f5f263ed29c3ddd684238e31d518c4a50aa78389058a3fbdec2a4e1a0226cd98`,
  `f6043f265644e23f24025d462bb928c7e3572231cf59cfc4f6b804a88bb27f51`,
  `ee2e6b97c370c8b1a05e0b53f74ae0949a3cd7479d0885ca9ebd8f81be83476a`로
  일치했다.

핵심 증거 SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| `start-gate.json` | `4b95f50132fe1a9d80b14ce472539d399399e44bdafdf8a74d875c3f008ce024` |
| `first-runtime.json` | `b7cb67d6223a21a72f2c7fa35b819bd110b8d497a4224dc609573b03fcadaba1` |
| `filesystem-evidence.json` | `b5d32fbc738ec9e0f4b341ef867e9a65d93843561bff481eba228f10d5e6d3f5` |
| `relaunch-runtime.json` | `64d62fb4c234ca1ba9b180e85f49c0ca46593fec7dee13108b550f79f8503329` |
| `end-audit.json` | `0d0256b2af68ccf9b16842417a8515b26e62b2a22718ae51e8e61ac2a1f121bb` |
| `visual-runtime.json` | `03b276534881211e6b32aa1559130e529af914ec12c832858d08407e61907081` |
| `g3-production-promotion-status-panel.png` | `c1bf4687b6e50057115912c2012811e903de63099626b9c2b7d51d98155b5646` |

1200×900 panel capture는 `이미 production과 동일`, `현재 target: 이미 최신`,
`project_01`, hash와 세 안전 요약, `승격 계획 다시 확인`을 한 화면에 보여준다.
Panel은 viewport 안에 완전히 들어왔고 already-current 상태의 promote button은 0건이다.

### One-shot follow-up actual Electron 증거

새 증거 root:

```text
/private/tmp/open-ga-g3-token-consumption-runtime-20260714TujW9Vr/evidence/
```

외부망 차단 actual Electron renderer에서 exact 21-method preload를 통해 registered main
IPC를 호출했다. `confirmed:false` 요청은 거부됐고 같은 token의 정상 재요청은
`unknown or already used`로 거부됐다. 서로 다른 새 plan은 정상 반영되어
`g3-production-promoted` 1회 `executed:true`를 남겼고, 그 정상 token의 재사용도 같은
INVALID 결과였다. 마지막 plan과 full quit/relaunch UI는 `already_current`였다.

Fixture target은 private export와 exact match인 605 bytes, mode `0600`, SHA-256
`13e3b25780be69e3748e5d31491ef8bbac2e23b3c77ec6c4a6f20db21577ab52`다. Source hash,
repo status는 회차 전후 동일하고 production temp/lock은 0이다. External/failed request,
console/log/exception, 실제 production/HVF write와 모든 금지 side effect는 0이다. First와
relaunch 모두 graceful 종료, forced false, residual PID/listener 0이다.

| 파일 | SHA-256 |
| --- | --- |
| `start-gate.json` | `15ca1ae7e470dd54bb786ed8feefe5b6470c5899828d69494c429c8046b99620` |
| `first-runtime.json` | `ecf054890da2cc502842185757dc5696e44277ec2a8d7fc43e7322aed4e5a264` |
| `filesystem-evidence.json` | `fb5ede04cd540eafb246eb337fdf8c881c7af747c060c5636b7b4599c0b656c8` |
| `relaunch-runtime.json` | `469fab414ad07833f900e4c7ce2c824f6252a1967606e537cfae6f8928cfc71b` |
| `end-audit.json` | `8ec3f49947990d573e997631913a3ba5102ded0345f276410453a7bb6c9dc1d1` |

## 명시적 한계와 남은 작업

- Actual Electron write는 격리 fixture의 absent target만 검증했다. Existing-target
  replacement/backup, conflict와 실패 matrix는 결정론적 filesystem test 증거다.
- 실제 Jessie production과 happyVideoFactory에는 쓰지 않았다. 실제 운영 반영은
  별도 사용자 선택과 현재 화면의 명시적 확인이 필요하다.
- Private lock은 같은 앱/userData namespace의 협조 promotion만 직렬화한다.
  Node/macOS에서 이 구현이 사용할 native dirfd `openat`/`renameat` 또는 no-replace
  CAS가 없으므로 최종 target 재확인과 rename 사이 비협조 writer의 잔여 TOCTOU를
  race-free라고 주장하지 않는다.
- Rename 뒤 receipt 전에 crash하면 verified target과 pending이 남을 수 있다.
  Existing-target 교체에서는 private backup을 남기지만 자동 rollback은 하지 않는다.
- Plan은 process memory 전용이라 app relaunch 뒤 반드시 새로 확인해야 한다.
- 이 반영은 human-selected canonical metadata commit이다. Media generation, accepted
  seconds render, fresh probe, output quality와 final delivery acceptance가 아니다.
- Required harness documents는 원본 하네스 문서가 아닌 이 repository의 synthesized
  local contract라는 기존 limitation을 해소하지 않는다.
- Planning-write/path-provenance independent security verdict, native folder selection,
  mobile keyboard-only interaction과 offline OSV DB gap은 별도 blocker로 남는다.
- 이 follow-up은 executor 증거이며 최종 수용 문구가 아니다. 새 follow-up commit의
  root-owned independent verifier가 별도로 필요하다.
