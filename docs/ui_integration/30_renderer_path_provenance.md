# Renderer 경로 출처 보안 보완

기준 시각: 2026-07-13T18:53:22+0900

## 결론

Root 감사에서 `9c54eb75ebaa4c57bd2e7c0d3863c6af2bfb94a1`의 planning
writer 자체가 아니라 그 앞의 path provenance gap이 발견되었다. 당시 renderer는
public `setConfig(config)`와 path 인자형 `selectProductionRoot(rootPath)`를 통해
임의의 기존 directory를 configured root로 만든 뒤 exact allowlist 파일을 쓸 수
있었다.

현재 구현은 renderer의 config mutation IPC를 제거하고, production/parent
경로를 native dialog 결과 또는 configured parent의 main-validated immediate
real child에서만 갱신한다. 기존 세 planning path allowlist, 1 MiB cap, Unicode/NUL,
stable symlink, same-directory exclusive/no-follow temp와 atomic rename 경계는
그대로 유지된다.

## 직접 provenance 매트릭스

| Renderer 표면 | Renderer가 제공할 수 있는 값 | Main의 신뢰·검증 경계 | 결과 |
| --- | --- | --- | --- |
| `getConfig()` | 없음 | main-owned config의 renderer-visible 사본만 반환 | read-only |
| `setConfig` | method 자체가 없음 | preload와 main handler 모두 제거 | 임의 root/parent persistence 불가 |
| `selectProductionRoot({mode:'production'})` | mode만 | main native directory dialog 결과를 `lstat`/absolute/normalized 검사 | production root만 갱신 |
| `selectProductionRoot({mode:'parent'})` | mode만 | main native directory dialog 결과만 검사·저장 | parent만 갱신, production root 보존 |
| `selectProductionRoot({mode:'child', rootPath})` | sidebar 후보 path | configured parent와 candidate 모두 existing real non-symlink directory인지, lexical/realpath가 immediate child인지 검사 | 검증된 child만 production root로 저장 |
| `listProductionChildren()` | path 없음 | configured parent에 bind | 임의 parent scan 불가 |
| `readProductionState()` | path 없음 | configured production root에 bind | 임의 production read 불가 |
| `listAssets()` | path 없음 | configured production root에 bind | 임의 root asset scan 불가 |
| `readJsonl({relativePath})` | 상대 경로 | configured production root에 bind; mismatched root와 parent/leaf symlink 차단 | bounded local read |
| `writePlanningFile(payload)` | payload root/relative/content | payload root가 main-owned configured root와 정확히 일치해야 하고 기존 planning writer 정책 적용 | write redirection 차단 |

Native mode에 `rootPath`를 추가하거나 예상하지 않은 key를 넣으면 dialog 호출 전에
`PATH_SELECTION_INVALID`로 차단된다. Child mode의 outside/sibling/grandchild,
symlink, missing, non-directory, hidden child도 fail closed한다.

## Config migration과 UX

이전 public config writer가 남긴 path에는 main-owned provenance가 없으므로
`pathProvenanceVersion:1` 없는 legacy config의 root, parent, recent roots를 읽을 때
비운다. 사용자는 업그레이드 뒤 한 번 native folder selection을 다시 해야 할 수
있다. 이는 renderer가 과거에 저장한 경로를 조용히 신뢰하지 않기 위한 fail-closed
migration이다.

현재 사용자 흐름은 유지된다.

- `제작 폴더 열기`: main native production dialog
- `상위 폴더 선택`: main native parent dialog; 기존 production root 보존
- sidebar production: main이 current parent의 immediate child인지 재검증한 뒤 활성화
- `목록 새로고침`: renderer path 없이 current configured parent만 scan
- selection/reject: 민감한 error/path를 노출하지 않는 한국어 차단 안내,
  `unhandledRejection` 0건

기존 hard-coded known parent의 renderer probe/auto-persist와 client의 `setConfig`는
제거했다. Browser/Vite fallback도 임의 path 선택 성공을 흉내 내지 않고 unavailable
결과를 반환한다.

## 실제 공격·회귀 검증

`tests/pathProvenanceSecurity.test.mjs`는 fresh OS temp fixture와 실제 등록 handler를
사용한다. regex-only test가 아니다.

- legacy renderer-owned config path invalidation
- public main IPC에 `set-config` handler 0건
- native production/parent dialog 정상 선택과 서로 분리된 persistence
- native mode renderer path 주입 시 dialog call 0건
- configured parent immediate real child activation과 planning write 성공
- outside/sibling/grandchild/symlink/missing/non-directory/hidden child 차단
- configured-root/parent bound list/read/assets/JSONL handler
- renderer path argument와 mismatched JSONL root 차단
- JSONL leaf symlink 차단
- 모든 negative case에서 outside sentinel SHA-256 불변

`tests/desktopSecurity.test.mjs`는 실제 preload를 VM에서 실행해 current bridge가
11 methods이고 `setConfig`가 없으며 list/state/assets IPC에 renderer path argument가
전달되지 않음을 확인한다. `tests/rendererContract.test.mjs`는 production dialog,
parent dialog, refresh, sidebar child 활성화와 sanitized Korean reject를 실제
deterministic DOM action으로 실행한다.

기존 `tests/planningWriteSecurity.test.mjs`는 세 exact output, repeat update,
Unicode/NUL/1 MiB, root/parent/leaf symlink, non-regular target, outside sentinel,
atomic rename failure cleanup을 그대로 통과한다.

## 검증 결과

```text
sandbox-exec deny-network focused provenance/security/renderer
  32/32 PASS, exit 0

sandbox-exec deny-network node --test tests/*.test.js tests/*.test.mjs \
  src/lib/pipeline/*.test.mjs
  93/93 PASS, exit 0

sandbox-exec deny-network npm run lint
  PASS, exit 0

sandbox-exec deny-network npm run build
  PASS, Vite 41 modules, exit 0

git diff --check
  PASS

test ! -e release
  PASS
```

첫 focused 실행은 32개 중 31개가 PASS했다. 유일한 실패는 새 migration test가
기존 `dryRunMode:false` 보존 동작을 잘못 `true`로 기대한 test assertion이었다.
허용된 targeted self-fix 1회로 실제 안전 불변식인
`allowSafeCommandExecution:false`를 검사하도록 교정했고 동일 focused 재실행은
32/32 PASS였다. Path injection, immediate-child, write redirection, sentinel 검사는
최초 실행부터 PASS였다.

실제 Electron, userData/config cache, 승인된 production 폴더, GUI/native picker는
실행하거나 수정하지 않았다. 모든 filesystem mutation은 test가 만든 OS temp
fixture 안에서만 발생했고 종료 시 정리했다. 외부 network, 생성, 업로드, 계정,
package install/update, release/deploy/push는 0건이다.

## AI PRD / Prompt Steward side-effect decision record

- Outcome: renderer가 public IPC로 write root provenance를 만들 수 없고 main-owned
  selection만 persistence에 도달한다.
- Success criteria: direct provenance 매트릭스 전 행과 temp filesystem negative
  matrix PASS, 기존 planning writer regressions PASS, UX flow 유지.
- Constraints: external network/Electron/real config/production/generation/upload 금지,
  새 dependency 없음, renderer/main 격리 유지.
- Tools/evidence: injected real IPC handler map, VM preload, deterministic DOM, OS temp
  filesystem, deny-network full suite/lint/build.
- Failure definitions: public config mutation, dialog path injection, outside/nested/
  symlink child activation, configured-root mismatch write, sentinel 변화, sanitized
  feedback 누락, unhandled rejection.
- Golden eval: production/parent native result persistence 분리, immediate child
  activation, 세 planning output 및 regular target update.
- Negative eval: legacy config, injected native path, outside/sibling/grandchild/symlink/
  missing/non-directory child, mismatched read/write roots, JSONL symlink.
- Regression eval: bridge exact surface, renderer open/parent/sidebar/refresh,
  planning security, full suite/lint/build/diff/no-release.
- Stop rule: 첫 test-contract self-fix 뒤 implementation/security regression이
  실패하면 commit하지 않는 규칙을 적용했다. 최종 회귀는 모두 PASS다.
- prompt_steward: PASS.

## 잔여 한계와 독립 인수 BLOCK

Planning writer의 path 기반 Node API에는 dirfd 기반 `openat`/`renameat`이 없다.
따라서 stable root/parent/leaf symlink 공격은 실제 회귀로 차단하고 rename 직전
identity/realpath를 재검사하지만, 마지막 검사와 rename 사이의 concurrent
ancestor-swap을 kernel-level race-free라고 주장하지 않는다.

독립 security acceptance는 `BLOCK`이다. 첫 non-root 독립 verifier와 정확히 한
번의 fallback verifier가 모두 코드 판정 전에 cybersecurity classifier에서
실패했다. 두 시도 모두 독립 코드 verdict를 만들지 못했으므로 자동 verifier를
더 호출하지 않는다. Root도 이 remediation commit을 최종 security acceptance로
승격할 수 없다. Executor test PASS와 independent acceptance BLOCK은 별개의 사실이다.

Security skill의 핵심 지침은 적용했지만 설치본에
`references/security-checklist.md`가 없는 tooling gap은 계속 남는다.

## 변경 파일

- `electron/lib/filmPipelineProvider.js`
- `electron/preload.js`
- `src/lib/pipeline/client.js`
- `src/components/pipeline/PipelineStudio.js`
- `src/components/pipeline/copy.js`
- `tests/pathProvenanceSecurity.test.mjs`
- `tests/desktopSecurity.test.mjs`
- `tests/rendererContract.test.mjs`
- `docs/ui_integration/05_electron_bridge.md`
- `docs/ui_integration/29_planning_write_security.md`
- `docs/ui_integration/30_renderer_path_provenance.md`
- `docs/ui_integration/21_current_acceptance_status.md`
- `.agent/goal-checkpoint.md`

구현·테스트·최종 통합자는 `/root/planning_write_security_integrator`, 배정은
`gpt-5.6-sol / xhigh`다. 배정 availability evidence는
2026-07-13T18:14:33+0900의 codex-cli 0.144.0-alpha.4, local model cache의
Sol/xhigh capability, Node v24.8.0, `sandbox-exec` 확인이다.
