# 계획 파일 쓰기 보안 하드닝

기준일: 2026-07-13 (Asia/Seoul)

## 결론

Electron main의 `writePlanningFile`은 더 이상 production root 안의 임의
`.md`, `.json`, `.jsonl`, `.txt` 파일을 쓸 수 없다. 현재 UI가 실제로 만드는
아래 세 산출물만 허용한다.

1. `docs/ui_integration/intake_snapshot.json`
2. `storyboard/drafts/<safe-id>_shot_payload.json`
3. `image_generation/prompts/<safe-id>_deepsearch_scene_image.md`

`<safe-id>`는 ASCII 영숫자로 시작하고 그 뒤에 ASCII 영숫자, `.`, `_`, `-`만
사용하는 1~128자 값이다. 연속 `..`, separator, traversal, 빈 값, 제어/NUL,
비 ASCII 값은 허용하지 않는다.

## 위협과 변경 사항

이 경계의 입력은 신뢰하지 않는 renderer IPC payload다. 보호 대상은 production
산출물, production root 밖의 로컬 파일, 계획 초안의 감사 가능성이다. 중점
위협은 Tampering, Elevation of Privilege, oversized content를 통한 DoS다.

- IPC handler는 payload의 `rootPath`가 현재 저장된 `productionRoot` 문자열과
  정확히 같을 때만 요청을 전달한다.
- production root는 절대·정규화 경로이면서 실제 존재하는 non-symlink
  directory여야 한다.
- 허용 경로는 확장자나 prefix가 아니라 위 세 완전 경로 패턴으로 판정한다.
- 존재하는 모든 parent component는 `lstat` 기준 non-symlink directory여야
  하며 `realpath`가 production root 안에 있어야 한다.
- 기존 target은 regular file일 때만 갱신한다. symlink, directory, 다른 파일
  형식은 모두 쓰기 전에 거부한다.
- content는 well-formed JavaScript string이어야 하고 NUL을 포함할 수 없으며
  UTF-8 기준 최대 1 MiB다.
- 쓰기는 target과 같은 directory에 0600 temp를
  `O_CREAT | O_EXCL | O_NOFOLLOW`로 만들고, write, `fsync`, close 뒤 parent
  identity와 target을 다시 확인한 다음 atomic rename한다. 실패하면 temp를
  제거한다.
- 성공 결과는 `written:true`, `sideEffectType:'local_planning_write'`,
  `executed:false`를 함께 돌려준다. progress와 결과에 content는 포함하지
  않는다. 이는 로컬 계획 파일 쓰기 성공이지 생성·업로드·외부 실행 성공이
  아니다.
- renderer는 main의 reject/throw를 catch하고 원래 error나 content를 노출하지
  않은 채 `저장이 차단되었습니다: 안전한 계획 파일 경로와 내용인지
  확인하세요.`를 표시한다.

## 실제 공격 회귀 검증

`tests/planningWriteSecurity.test.mjs`는 fresh OS temp fixture에서 실제 파일을
만들어 다음을 확인한다.

- 세 허용 경로의 최초 쓰기와 기존 regular draft의 atomic 갱신
- UTF-8 1 MiB 경계 허용 및 1 MiB+1 차단
- traversal, absolute path, backslash, 임의 `brief.md`/`reviews` 경로, 잘못된
  suffix/extension, 빈 값·separator·비 ASCII·129자 id 차단
- non-string, NUL, unpaired UTF-16 surrogate 차단
- configured root 불일치와 symlink root 차단
- parent symlink와 leaf symlink를 통한 외부 sentinel 접근 차단
- non-directory parent와 directory target 차단
- 강제 rename 실패 뒤 partial target과 temp residue 0건
- 모든 negative case 전후 root 밖 sentinel SHA-256 불변

첫 focused 확대에서 문자열 끝의 lone high-surrogate가 빠지는 테스트 실패를
발견했다. 한 번의 targeted self-fix로 경계 검사를 수정한 뒤 동일 focused
범위를 다시 실행해 통과했다. stable symlink escape는 최초 공격 회귀부터
계속 차단되었다.

`tests/rendererContract.test.mjs`는 bridge가 민감한 원문을 포함한 error로
reject해도 클릭 Promise가 reject되지 않고 한국어 차단 안내만 표시되며
`unhandledRejection`이 0건임을 확인한다.

## 검증 결과

최종 full suite, lint, build는 macOS `sandbox-exec`의 `(deny network*)` 아래
실행했다. focused test도 OS temp filesystem과 deterministic DOM만 사용했으며
network API는 호출하지 않았다. 실제 production 폴더, Electron, GUI, native
picker는 사용하지 않았다.

```text
node --test tests/planningWriteSecurity.test.mjs tests/rendererContract.test.mjs
  11/11 PASS

node --test tests/planningWriteSecurity.test.mjs tests/rendererContract.test.mjs \
  tests/desktopSecurity.test.mjs tests/filmPipelineNativeClipboard.test.mjs
  23/23 PASS

node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs
  89/89 PASS

npm run lint
  PASS

npm run build
  PASS, Vite 41 modules

git diff --check
  PASS

test ! -e release
  PASS
```

`MODULE_TYPELESS_PACKAGE_JSON` 경고는 기존 Node module-type 경고이며 테스트
실패가 아니다. package type이나 dependency는 이 보안 단위에서 변경하지
않았다.

## 변경 파일

- `electron/lib/filmPipelineProvider.js`
- `src/components/pipeline/PipelineStudio.js`
- `src/components/pipeline/copy.js`
- `tests/planningWriteSecurity.test.mjs`
- `tests/rendererContract.test.mjs`
- `docs/ui_integration/29_planning_write_security.md`
- `docs/ui_integration/21_current_acceptance_status.md`
- `.agent/goal-checkpoint.md`

## 잔여 한계

Node의 현재 path 기반 API는 이 구현에 directory file descriptor를 기준으로 한
`openat`/`renameat` 경계를 제공하지 않는다. 따라서 stable root/parent/leaf
symlink 공격은 실제 회귀로 차단하고, temp에 no-follow/exclusive를 적용하며,
rename 직전 parent의 device/inode와 realpath를 재검사하지만, 별도의 로컬
공격자가 마지막 검사와 rename 사이에 ancestor를 동시에 교체하는 kernel-level
TOCTOU까지 race-free라고 주장하지 않는다. 이를 완전히 닫으려면 검증된 native
addon 또는 OS 전용 dirfd API가 필요하며 이번 범위에는 새 dependency를 추가하지
않았다.

이 코드는 security-significant 변경이므로 executor 검증과 별도로 immutable
commit을 대상으로 한 non-root read-only 독립 검증이 완료되기 전에는 최종 보안
인수 완료로 승격하지 않는다.

## 실행·승인 기록

- 구현·테스트·최종 통합자: `/root/planning_write_security_integrator`
- 배정: `gpt-5.6-sol / xhigh`
- prompt_steward: PASS
- 외부망, 생성, 업로드, 외부 계정, package 설치/갱신, release/deploy/push: 0건
- 별도 side-effect 승인: 불필요. repo patch와 fresh temp fixture만 사용했다.
- security skill의 핵심 `SKILL.md`는 적용했으나 참조된
  `references/security-checklist.md`는 설치본에 없어 tooling gap으로 기록한다.
