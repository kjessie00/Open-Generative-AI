# Canonical 새 프로젝트 부트스트랩 v1

날짜: 2026-07-13
구현·최종 통합 executor: `/root/canonical_handoff_adapter_integrator`

## 결과

기존 production을 읽는 작업대에 한글 새 프로젝트 시작 흐름을 추가했다. 사용자는
`프로젝트` 탭에서 다음 값만 입력한다.

- `production_id`: 영문 소문자·숫자·하이픈·밑줄 3–64자
- 한글 brief와 script
- route: `seedance`, `flow_omni`, `both`
- aspect ratio: `9:16`, `16:9`
- scene duration: 4–15초
- max scenes: 1–10

`IntakePanel`은 새 프로젝트 흐름과 기존 제작물 감사를 분리한다. 새 입력 표면은
`NewProjectDraftForm` focused component가 담당하며, 기존 감사 정보는 기본적으로
접힌 progressive disclosure 안에 보존했다. 11개 탭은 변경하지 않았다.

## 저장 계약

초안은 repository 또는 production 아래에 저장하지 않는다. Electron main process가
다음 고정 경로만 계산한다.

```text
<Electron userData>/film-pipeline/drafts/canonical-project-bootstrap-v1/
  draft.json
  brief.md
  script.txt
```

세 파일은 동일 디렉터리의 exclusive 임시 파일에 mode `0600`으로 쓰고 fsync한 뒤
rename한다. metadata는 brief/script SHA-256을 보존하고 두 본문을 포함하지 않는다.
NUL, malformed Unicode, 크기 초과, 예상 외 key, 경로 또는 command 주입은 파일
생성 전에 차단한다. 초안 디렉터리·파일의 심볼릭 링크, 넓은 권한, identity 변경과
부분 파일도 fail closed한다.

renderer는 다음 세 dedicated preload method만 사용한다.

```text
getNewProjectDraftState()
saveNewProjectDraft(draft)
copyNewProjectBuildCommand()
```

get/copy는 renderer 인자를 받지 않는다. save는 정확한 7개 입력 key만 받으며
저장 경로, production parent, target, builder entrypoint, cwd, command를 받지 않는다.
현재 `window.filmPipeline` bridge는 `setConfig` 없이 15 methods다.

## 명령 미리보기 계약

main process는 아래 고정 builder만 사용한다.

```text
/Users/jessiek/StudioProjects/happyVideoFactory/scripts/build_short_drama_pipeline_pack.py
```

cwd도 `/Users/jessiek/StudioProjects/happyVideoFactory`로 고정된다. 실제 preview의
인자는 아래 allowlist와 순서를 유지한다.

```text
--brief <main-owned-draft-brief>
--script <main-owned-draft-script>
--production-id <validated-id>
--output-root <main-owned-production-parent>
--target-generator <seedance|flow|both>
--aspect-ratio <9:16|16:9>
--scene-duration <4..15>
--max-scenes <1..10>
```

UI의 `flow_omni`는 builder의 `flow`로만 매핑한다. `--overwrite`, submit, generation,
review, download, upload 또는 외부 계정 flag는 만들지 않는다. preview와 copy 결과는
항상 `executed:false`다. `runSafeCommand` 호출은 0이다.

명령 생성과 복사 직전에 main은 저장된 초안의 hash/권한, fixed-root harness
readiness와 builder SHA-256, configured production parent의 실제 비심볼릭 폴더 여부,
`<parent>/<production_id>`의 부재를 다시 확인한다. 대상이 파일, 빈 폴더, 비어 있지
않은 폴더 또는 심볼릭 링크 중 하나라도 존재하면 모두 차단한다. 앱 재시작으로
초안은 복원하지만 harness, parent와 target 판정은 저장된 과거 값을 신뢰하지 않는다.

## 결정론적 검증

첫 focused run은 26개 중 19 PASS / 7 FAIL이었다. 6개는 macOS가 테스트의 `/tmp`를
`/private/tmp`로 canonicalize하는 사실을 fixture가 반영하지 않은 동일 원인이었고,
1개는 preload method 예상 배열의 알파벳 순서 오류였다. 제품 로직은 바꾸지 않고
허용된 한 번의 국소 self-fix로 두 테스트 기대만 수정했다.

재실행 결과:

```text
network-denied focused: 26/26 PASS
network-denied full: 131/131 PASS
lint: PASS
Vite build: PASS, 42 modules transformed
git diff --check: PASS
```

focused 검증은 정상 저장·복원·mode `0600`, 정확한 args/cwd/route mapping, clipboard
write/read-back, renderer 경로·command 주입, ID/NUL/Unicode/크기/범위, 대상 네 종류,
parent missing/file/symlink, harness 변경, 재시작 재검증, draft ancestor symlink,
rename 실패 정리, 최대 UTF-8 크기, 한글 label/form/responsive class, sanitized 오류와
generic preview/copy/run IPC 0을 포함한다.

## 부작용과 남은 증거

- happyVideoFactory: 읽기 전용 contract metadata 확인만 수행하며 write 0
- 실제 production: read/write 0, 새 폴더 생성 0
- 실제 Electron userData/config/cache: write 0
- command 실행, generation, review, download, upload, account 작업: 0
- 외부 network: OS 수준 차단
- release/package/deploy/push: 0

이번 구현 회차에서는 실제 Electron/GUI를 실행하지 않았다. 따라서 현재 15-method
bridge, 실제 userData 복원, native parent 선택 뒤 target 재판정, clipboard와 320/768/
1024/1440 화면은 결정론적 DOM/IPC 검증까지 PASS이며 실제 runtime 증거는 남아 있다.
