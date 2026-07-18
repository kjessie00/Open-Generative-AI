# P0 시네마틱 템플릿 실제 E2E 핸드오프

## 한 줄 목표

`main`의 P0 시네마틱 템플릿을 새 격리 Electron 프로필에서 처음부터 실제로 조작하고, 기본 상태부터 저장·1–5단계 표시·전체 앱 재실행 복원·기본 모드 회귀까지 독립 검증한다. 이전 테스트와 화면 캡처는 참고 자료일 뿐 이번 PASS 근거로 재사용하지 않는다.

## 시작 기준

- 저장소: `/Users/jessiek/StudioProjects/Open-Generative-AI`
- 기준 브랜치: `main`
- 기준 커밋: `c6a74071066cd2ae0be5a412f5d8866d4176e42b`
- 기준 상태: `origin/main...main = 0 0`, clean worktree
- 구현 계약: `docs/ui_integration/84_p0_cinematic_template.md`
- 현재 체크포인트: `.agent/goal-checkpoint.md`의 `2026-07-18 P0 Cinematic Template`
- 기존 구현 검증: focused `98/98`, full `452/452`, lint/build/diff PASS, 독립 코드 검수 P0/P1/P2 없음

새 작업은 위 PASS를 그대로 인용해 끝내지 않는다. 현재 checkout과 실제 실행 결과를 더 강한 증거로 사용한다.

## 첫 액션

1. 프로젝트 `AGENTS.md`와 이 문서를 읽는다.
2. 아래 명령을 실행한다.

   ```bash
   /Users/jessiek/StudioProjects/jessie-context-memory/scripts/context-pack.sh "$PWD"
   git status --short --branch
   git rev-list --left-right --count origin/main...main
   git rev-parse HEAD
   ```

3. `HEAD`가 기준 커밋 이후라면 현재 diff와 최근 커밋을 먼저 감사한다. 핸드오프보다 최신 코드·테스트·체크포인트를 우선한다.
4. 실제 데스크톱 조작에는 `computer-use:computer-use` 스킬을 사용한다.

## 검증 대상

### 코드 경계

- `electron/lib/cinematicTemplateProvider.js`
- `electron/lib/filmPipelineProvider.js`
- `electron/preload.js`
- `src/lib/pipeline/client.js`
- `src/components/pipeline/NewProjectDraftForm.js`
- `src/components/pipeline/CinematicTemplateSummary.js`
- `src/components/pipeline/PipelineStudio.js`
- `tests/cinematicTemplateProvider.test.mjs`
- `tests/desktopSecurity.test.mjs`
- `tests/rendererContract.test.mjs`
- `src/lib/pipeline/workflowGuide.test.mjs`

### 고정 계약

- renderer는 절대경로나 shell 명령을 전달하지 않는다.
- IPC는 `getNewProjectCinematicTemplateState`와 `saveNewProjectCinematicTemplate`만 사용한다.
- 저장 파일은 Electron `userData` 아래 `film-pipeline/drafts/canonical-project-bootstrap-v1/cinematic-template.json`이다.
- 스키마는 `film_pipeline.cinematic_template.v1`, 파일은 regular file·mode `0600`이어야 한다.
- `basic`은 네 시네마틱 필드를 비우며 2–5단계 요약을 표시하지 않는다.
- cinematic companion은 workflow 완료도·활성 단계 계산에 참여하지 않는다.
- production workspace에는 시네마틱 편집기와 요약을 표시하지 않는다.
- shell, API key, provider submit, 모델 호출, 이미지·영상 생성, 업로드는 0이어야 한다.

## 실제 Electron E2E 절차

### 1. 완전히 새 프로필

고유한 빈 임시 폴더를 사용한다. 기존 `/tmp/open-ga-p0-cinematic-20260718`과 이전 캡처를 재사용하지 않는다.

```bash
npm run build
E2E_USER_DATA="/tmp/open-ga-p0-cinematic-sol-xhigh-$(date +%Y%m%d%H%M%S)"
./node_modules/.bin/electron . --user-data-dir="$E2E_USER_DATA"
```

실제 앱에서 다음을 확인한다.

- 새 프로젝트 1단계 기본값은 `기본 영상`이다.
- 네 시네마틱 입력 필드는 기본 모드에서 보이지 않는다.
- 2–5단계에도 시네마틱 요약이 보이지 않는다.

### 2. 시네마틱 저장

1단계에서 `시네마틱 제작`을 선택하고 아래 네 값을 모두 입력한다.

- 연출 의도: `고요한 선택이 남기는 긴장`
- 화면 핵심: `차가운 밤과 따뜻한 얼굴의 대비`
- 꼭 지킬 점: `붉은 스카프와 느린 호흡`
- 피할 점: `과도한 네온과 급격한 카메라 회전`

`제작 방식 저장`을 누른 뒤 다음을 확인한다.

- `시네마틱 기준을 저장했습니다.`가 보인다.
- 저장 버튼이 비활성화되고 저장하지 않은 상태가 남지 않는다.
- 실제 JSON의 네 값과 mode가 정확하다.
- 파일이 symlink가 아닌 regular file이고 mode가 `0600`이다.

### 3. 2–5단계 실제 탐색

각 단계로 직접 이동해 요약 문구와 펼친 네 값을 확인한다.

| 단계 | 필수 문구 |
| --- | --- |
| 2 설계 | `인물·장소·장면을 같은 연출 기준으로 설계합니다.` |
| 3 생성 준비 | `프롬프트와 생성 결과를 이 기준으로 비교합니다.` |
| 4 클립 선택 | `쓸 구간이 연출 의도와 맞는지 확인합니다.` |
| 5 마무리 | `최종 영상에서 지킬 점과 피할 점을 다시 확인합니다.` |

필수 확인:

- 접힌 요약은 짧은 한글만 보이고 badge, path, hash, provider ID를 노출하지 않는다.
- 요약을 펼치면 네 값이 모두 동일하다.
- 기존 단계의 핵심 CTA와 패널은 그대로 접근 가능하다.
- Tab/Enter 또는 Space로 radio, 저장 버튼, 요약을 조작할 수 있고 포커스가 보인다.

### 4. 전체 종료·재실행 복원

Electron 메뉴의 `Quit open-generative-ai`로 앱 전체를 종료한다. 다른 Electron·Codex·Claude 프로세스는 종료하지 않는다.

같은 `E2E_USER_DATA`로 다시 실행해 다음을 확인한다.

- 1단계에서 `시네마틱 제작`과 네 값이 복원된다.
- 2–5단계 요약이 다시 표시된다.
- renderer 화면에는 실제 저장 경로가 노출되지 않는다.

### 5. 기본 모드 회귀와 최종 복원

1. `기본 영상`으로 바꾸고 저장한다.
2. 네 필드와 2–5단계 요약이 사라지는지 확인한다.
3. 전체 종료·재실행 후에도 basic이 유지되는지 확인한다.
4. 다시 cinematic을 선택하고 네 값을 재입력·저장한다.
5. 한 번 더 전체 종료·재실행해 cinematic과 네 값이 복원되는지 확인한다.
6. 최종 앱은 5단계 마무리 화면을 실제로 연 상태로 남긴다.

### 6. production 비노출

가능하면 native folder picker로 저장소 안의 read-only fixture `src/fixtures/pipeline/layoutAProduction/20260713-studio-fixture`를 선택해 production workspace에서 시네마틱 편집기·요약이 보이지 않는지 실제 확인한다. picker가 도구 한계로 한 번 실패하면 같은 경로를 반복하지 말고 `ACTUAL_PICKER_BLOCKED`로 분리한다. 이 경우 기존 production 조건 테스트 PASS를 실제 picker PASS로 바꾸어 보고하지 않는다.

## 자동 검증

아래 명령을 새 작업에서 다시 실행한다.

```bash
node --test tests/cinematicTemplateProvider.test.mjs tests/newProjectBootstrap.test.mjs tests/desktopSecurity.test.mjs tests/rendererContract.test.mjs src/lib/pipeline/workflowGuide.test.mjs
node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs
npm run lint
npm run build
git diff --check
```

기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 이번 변경 원인이 아니다. 새 오류·warning·uncaught exception·외부 요청은 별도로 기록한다.

## 결과물

새 증거 폴더를 만든다.

```text
/Users/jessiek/.codex/visualizations/2026/07/18/p0-cinematic-template-e2e-sol-xhigh-<timestamp>/
```

최소 산출물:

- `00-environment.txt`: HEAD, branch, userData, 앱·Node·Electron 버전
- `01-basic-clean.png`
- `02-cinematic-saved.png`
- `03-stage-2-expanded.png`
- `04-stage-3.png`
- `05-stage-4.png`
- `06-stage-5.png`
- `07-relaunch-restored.png`
- `08-basic-restored.png`
- `09-final-cinematic-restored.png`
- `result.json`: 각 acceptance item의 PASS/BLOCK, 실제 파일 mode, 외부 실행 수
- 저장소 문서 `docs/ui_integration/86_p0_cinematic_template_actual_e2e.md`

스크린샷은 접근성 트리 문구와 같은 실제 상태에서 저장한다. 화면 전환 직전의 지연된 스크린샷을 증거로 쓰지 않고, 캡처 후 이미지를 직접 열어 확인한다.

## 판정 규칙

다음 사실을 분리해 보고한다.

- `TECHNICAL_PASS`: 테스트·lint·build·저장 계약
- `ACTUAL_ELECTRON_PASS`: 실제 조작·단계 탐색·전체 재실행 복원
- `PRODUCTION_PICKER_PASS|ACTUAL_PICKER_BLOCKED`: 실제 production 비노출 확인 여부
- `OUTPUT_QUALITY_NOT_TESTED`: 이미지·영상 생성물을 만들지 않았음
- `JESSIE_APPROVAL_NOT_RECORDED`: 사람의 최종 영상 품질 승인은 별도

이전 보고나 테스트만으로 `ACTUAL_ELECTRON_PASS`를 만들지 않는다. 실제 캡처·accessibility text·저장 파일 증거가 모두 있어야 한다.

## 결함 발견 시

- 재현 가능한 P0 결함이면 가장 작은 수정과 회귀 테스트를 추가하고 실제 E2E를 처음부터 다시 실행한다.
- 관련 없는 리팩터링, 디자인 확장, provider 연결, 새 템플릿 기능은 하지 않는다.
- 같은 UI 자동화 실패를 두 번 반복하지 않는다. 세 번째 시도 전에 경로를 바꾸거나 정확한 blocker로 멈춘다.
- 수정이 있으면 별도 브랜치에 커밋하고 hash·검증 결과를 보고한다. `main` merge나 외부 배포는 하지 않는다.

## 금지 사항

- `.env` API key 사용
- DST/Flow/Grok/Replicate/ByteDance 실제 submit·generation·download
- browser login, account 변경, 외부 업로드, 공개 게시
- 실제 production/HVF canonical 파일 수정
- 다른 에이전트 세션·대화·상태 DB·복구 파일 이동 또는 삭제
- 다른 Electron·Codex·Claude 프로세스 종료

## 완료 조건

1. 실제 clean→cinematic→stages 2–5→relaunch→basic→relaunch→cinematic→relaunch가 증거와 함께 끝난다.
2. focused/full/lint/build/diff가 통과하거나 정확한 blocker가 기록된다.
3. 기술 PASS, 실제 Electron PASS, production picker, 생성물 품질, Jessie 승인이 분리된다.
4. 새 결과 문서와 증거 폴더가 존재한다.
5. 최종 앱이 5단계 마무리 화면으로 열려 있다.
