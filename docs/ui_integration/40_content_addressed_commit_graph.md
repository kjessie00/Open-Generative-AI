# 콘텐츠 주소형 canonical commit graph 전환

기준일: 2026-07-15 (Asia/Seoul)

## 결론

Jessie가 승인한 제품 계약에 따라 production의 선택 take와 finishing 현재 실행 상태의
권위 원본을 mutable JSON alias에서 production 소유 immutable object/commit graph로
옮겼다. `production/selected_takes.json`과
`production/final/workbench_runs/current.json`은 graph가 생긴 뒤 mode `0600`으로
재생성 가능한 호환 cache일 뿐이다. Private G3 backup/pending/receipt는 운영 증거이며
canonical history가 아니다.

이 전환은 격리된 temp fixture에만 기록했다. 실제 Jessie production,
happyVideoFactory, 생성 서비스, 브라우저, 계정, 업로드, 배포, package/release에는
접근하거나 쓰지 않았다.

## 고정 경로와 namespace

공유 CommonJS 구현은 `electron/lib/contentAddressedCommitStore.js`다. 권위 경로는
production root 아래 다음 두 namespace로 고정한다.

```text
production/.film-pipeline-state-v1/
├── selected-takes/
│   ├── payloads/<payload-sha256>.json
│   └── commits/<commit-sha256>.json
└── finishing-current/
    ├── payloads/<payload-sha256>.json
    └── commits/<commit-sha256>.json
```

Store/namespace/payloads/commits 디렉터리는 mode `0700`, record는 mode `0600`이다.
Mutable head/index 파일은 존재하지 않는다. Head는 전체 commit set에서 다른 commit의
parent로 참조되지 않은 유일한 commit을 매번 계산한다.

## exact schema와 content address

Payload record schema는 다음 exact 네트워크 비의존 JSON 계약이다. 실제 key byte
순서는 재귀 정렬되며 마지막에 LF 한 바이트를 붙인다.

```json
{
  "namespace": "selected-takes",
  "schema_version": "film_pipeline.canonical_payload.v1",
  "value": {}
}
```

Commit record schema도 정렬 JSON+LF이며 timestamp나 경로를 넣지 않는다.

```json
{
  "namespace": "selected-takes",
  "parent": null,
  "payload_hash": "64-lowercase-hex",
  "schema_version": "film_pipeline.canonical_commit.v1"
}
```

각 filename은 record bytes의 SHA-256이다. Commit은 namespace, parent commit ID 또는
`null`, payload hash를 결합한다. 같은 parent와 같은 payload 전이는 같은 commit ID를
만들어 재시도 시 idempotent하다.

## no-replace publication

Immutable record 게시 순서는 다음과 같다.

1. 목적지와 같은 payloads/commits 디렉터리에 `O_CREAT|O_EXCL|O_NOFOLLOW` temp를 만든다.
2. mode `0600`, byte 수, regular-file type을 확인하고 file `fsync`를 수행한다.
3. `link(2)` hard-link로 `<sha256>.json` 목적지를 원자적 no-replace로 만든다.
4. 목적지가 이미 있으면 `EEXIST`를 허용하되 mode/type/no-follow/hash와 bytes 전체가
   정확히 같은 경우만 idempotent 성공으로 인정한다.
5. 디렉터리를 `fsync`하고 task-owned temp만 제거한다.

Symlink, wrong type/mode, 2 MiB 초과, noncanonical/malformed JSON, hash/name mismatch,
missing payload/parent, cycle, disconnected component, multiple root/head는 fail-closed다.
동일 parent에서 서로 다른 두 sibling이 경합하면 어느 것도 지우지 않고 이후 해석은
`*_FORK`로 차단한다. 이 보장은 immutable object/commit publication에 대한 것이다.
임의의 비협조 filesystem writer 전체에 대한 race-free 보장을 주장하지 않는다.

## migration과 fallback

Fallback은 namespace별로 적용한다. 해당 namespace 디렉터리가 없을 때만 legacy JSON을
읽는다. Read-only `plan`, `getWorkspace`, production reader는 graph나 cache 디렉터리를
만들지 않는다.

- `selected-takes`: 첫 확인된 G3 mutation 때 유효한 legacy
  `selected_takes.json`이 있으면 root commit으로 먼저 import한다. 새 선택이 다르면 그
  root의 child를 append한다. Legacy가 없으면 새 선택이 root다.
- `finishing-current`: 첫 changed finishing mutation 때 유효한 legacy `current.json`이
  있으면 root로 import하고 새 run pointer를 child로 append한다. Legacy가 없으면 새
  pointer가 root다.
- 해당 namespace가 한 번 생기면 cache가 missing, stale, malformed, symlink여도 이를
  canonical fallback으로 사용하지 않는다. Graph가 손상됐으면 cache로 우회하지 않고
  graph blocker를 반환한다.

## G3 publication 계약

G3 plan evidence는 source/export hash와 함께 selected-takes graph head/payload ID를
묶는다. Confirmed execute는 private lock 아래 legacy import와 changed child append를
수행하고 유일한 새 head를 재검증한 뒤 `selected_takes.json` cache를 동기화한다.

동일 payload의 no-op도 missing/stale safe cache를 복구할 수 있다. Canonical commit 뒤
cache 동기화가 실패하면 성공한 commit을 되돌렸다고 말하지 않고
`G3_SELECTED_TAKES_CACHE_STALE` warning, `canonical_committed`,
`cache_synchronized`를 별도로 반환한다. Existing private backup/receipt는 audit evidence로
남지만 history 권위는 graph다.

## production reader와 renderer provenance

Production reader와 finishing input inspection은 selected-takes graph가 있으면 graph
payload만 사용한다. Input snapshot에는 selected graph의 `commit_id`, `payload_hash`,
authority가 포함된다. Renderer normalized record는 다음 provenance를 구분한다.

- migrated: `selected_takes.commit_graph` + 64자리 commit/payload ID
- pre-migration legacy: `selected_takes.json`

UI/validator는 둘 다 유효한 선택-range 출처로 처리하지만 migrated 화면은 JSON cache를
canonical이라고 표시하지 않는다. Graph가 존재하면 tampered/missing cache가 production
reader 또는 finishing plan을 덮어쓸 수 없다.

## finishing publication과 restoration

Finishing execute는 staging에서 render/probe/receipt를 만들고 post-render input snapshot을
재검증한 뒤 content-derived run 디렉터리를 한 번 public rename한다. 그 뒤 current-state
payload/commit을 append·검증하고 마지막으로 `current.json` cache를 동기화한다.

Public run rename 이후 어떤 error path도 그 run을 재귀 삭제하지 않는다. Graph append나
cache 단계 실패 뒤에도 public run은 보존한다. Public 전 staging과 cooperative lock의
task-owned cleanup만 유지한다. Cache 실패는
`FINISHING_CURRENT_CACHE_STALE` warning으로 분리되고 graph에서 restoration은 계속 된다.

## stable path-free code family

공유 suffix는 다음 family다.

- 구조/record: `DIRECTORY_UNSAFE`, `DIRECTORY_LAYOUT_INVALID`, `STORE_ENTRY_INVALID`,
  `RECORD_NAME_INVALID`, `RECORD_TYPE_INVALID`, `RECORD_MODE_INVALID`,
  `RECORD_TOO_LARGE`, `RECORD_MALFORMED`, `RECORD_NONCANONICAL`,
  `SYMLINK_FORBIDDEN`, `HASH_NAME_MISMATCH`, `COLLISION`
- graph: `PAYLOAD_INVALID`, `PAYLOAD_MISSING`, `COMMIT_INVALID`, `PARENT_MISSING`,
  `CYCLE`, `DISCONNECTED`, `MULTIPLE_ROOTS`, `FORK`, `HEAD_CHANGED`, `VERIFY_FAILED`
- cache: `CACHE_UNSAFE`, `CACHE_CHANGED`, `CACHE_SYNC_FAILED`, `CACHE_VERIFY_FAILED`

Public prefix는 G3 selected graph `G3_SELECTED_TAKES_GRAPH_*`, G3 cache warning
`G3_SELECTED_TAKES_CACHE_STALE`, finishing selected input
`FINISHING_SELECTED_TAKES_GRAPH_*`, finishing current graph
`FINISHING_CURRENT_GRAPH_*`, finishing cache warning `FINISHING_CURRENT_CACHE_STALE`다.
오류 payload에는 filesystem path를 넣지 않는다.

## deterministic regression evidence

최종 focused 통합은 72/72 PASS했다. 포함 범위는 다음과 같다.

- read-only absence, legacy bootstrap, deterministic root/child, same-transition idempotence
- initial-absence hard-link no-replace, equal `EEXIST`, collision mismatch
- malformed/symlink/oversize/wrong-mode/hash mismatch, missing parent, multi-root,
  pure cycle/disconnected topology, sibling fork preservation
- G3 graph plan/execute/no-op, stale/missing cache regeneration, post-commit cache warning
- production reader graph precedence와 renderer commit/payload provenance
- finishing selected graph input, current graph restoration, legacy current root+child import
- finishing cache failure 뒤 canonical success, post-publication graph failure 뒤 run 보존
- existing actual-temp real ffmpeg selected-range regression

최종 검증 결과는 다음과 같다.

- 외부망 차단 full Node: `sandbox-exec` deny-network, 200/200 PASS, exit 0
- focused storage/G3/reader/finishing/UI/real-ffmpeg: 72/72 PASS, exit 0
- `npm run lint`: PASS, exit 0
- `npm run build`: PASS, Vite 53 modules, exit 0
- `git diff --check`: PASS, exit 0
- added-line network primitive scan: 0
- added-line package/release/child-process execution scan: 0
- `release/`와 임시 package lock artifact: 없음

첫 full suite는 199/200으로, 새 finishing 설명이 기존 exact 비노출 문장을 보존하지
않은 renderer copy 회귀 1건만 실패했다. Graph/cache 설명은 유지하면서
`source 경로·명령·실행 파일은 화면에 노출되지 않습니다`를 복원한 단일 targeted
self-fix 뒤 영향 test 1/1과 full 200/200이 PASS했다. Static scan의 첫 grep 두 개는
shell quoting 오류로 실행되지 않았고, 따옴표 충돌 없는 `awk` added-line count로 한 번
대체해 각각 0을 확인했다.

## 독립 검증 종료 기록

Writer Sol 세션은 `019f619b-3175-7d73-ac06-ef15eacf6d90`이다. 원본과 검증
snapshot의 tracked patch SHA-256은
`8bd118b2b1e4f7dc01a681a3fe090bc278d9aed7145cd2b11b509e32adcd5c8c`로
일치했고, snapshot은
`/private/tmp/open-ga-canonical-graph-verifier-U0CHeC/worktree`였다.

첫 Terra xhigh 검증 세션 `019f61be-4a05-7143-876c-2a7054eefec4`는
2026-07-15T02:47:30+0900에 Codex 0.144.2/Terra 사용 가능 상태를 확인했다. Store
8/8은 PASS했고 static invariant와 source 불변도 PASS했지만, combined는 snapshot에
`node_modules/electron`이 없어 정확히 2개의 환경 실패가 발생해 42/44였다. 따라서
판정은 코드 결함이 아닌 `UNVERIFIABLE (infra)`였고 P1은 verifier environment,
P0/P2는 없었다.

2026-07-15T02:51:51+0900에 원본 저장소의
`/Users/jessiek/StudioProjects/Open-Generative-AI/node_modules`를 read-only `NODE_PATH`로
연결해 Electron 33.4.11을 해석했고 source는 바뀌지 않았다. Fresh Terra xhigh 검증
세션 `019f61c2-1cda-7852-b22f-2e63b125444f`는 외부망 차단 G3+finishing 36/36을
PASS했다. C는 G3 graph 권위, legacy root-child, cache repair, cache fallback 금지,
fork fail-closed를 PASS했고, D는 finishing IPC, graph 우선, cache-stale warning,
public run 보존, legacy current root-child를 PASS했다. E도 모순 없이 PASS했으며
P0/P1/P2는 모두 없었다. 이 검증으로 인한 correction이나 source 변경은 없다.
Writer의 focused 72/72, full Node 200/200, lint/build/diff-check PASS 기록은 유지한다.

## 잔여 경계

- 이 작업은 실제 Jessie production migration을 실행하지 않았다. 첫 실제 mutation 전
  별도 운영 backup과 사람이 확인한 대상이 필요하다.
- Application은 public run을 게시 후 수정/삭제하지 않지만 OS immutable flag나 외부
  writer 차단을 설정하지 않는다.
- Existing final input recheck와 public rename 사이의 비협조 writer TOCTOU는 남는다.
- SHA-256 collision resistance와 같은-filesystem hard-link/rename semantics를 전제로 한다.
- Render 성공, graph commit 성공, cache freshness, 영상 품질 승인, 실제 production
  운영 승인은 서로 다른 상태다.

Prompt Steward: outcome/success/constraints/evidence/output/stop gate가 명시되어 PASS다.
AI quality/eval layer는 로컬 data-integrity storage migration이므로 not-applicable이다.
