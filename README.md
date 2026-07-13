# Cinematic Pipeline Studio

Jessie의 기존 영상 제작 하네스를 로컬에서 열고, 상태를 복원하고, 검토 게이트와 결과 증거를 한 화면에서 확인하는 Electron/Vite 작업대입니다.

이 저장소는 `Anil-matcha/Open-Generative-AI`의 로컬 fork이지만 현재 제품 경로는 upstream hosted generation 서비스가 아닙니다. 기본 `dev`, `build`, `start` 명령은 `src/`와 `electron/` 아래의 로컬 Pipeline Studio만 사용합니다.

## 현재 운영 상태

- Vite/Electron 기본 제품 경로: 구현 및 자동 검증 완료
- 10개 핵심 패널과 11개 탭 renderer 계약: 검증 완료
- production Layout A/B fixture reader와 fail-safe: 검증 완료
- 실제 production 후보: partial/unknown 상태로 안전하게 차단
- 실제 Electron 창과 native folder dialog의 시각 검증: 아직 필요
- 이미지·영상 생성, 외부 review/upload: 이 앱에서는 실행하지 않고 preview-only로 유지

최신 인수 상태는 [`docs/ui_integration/21_current_acceptance_status.md`](docs/ui_integration/21_current_acceptance_status.md)를 기준으로 합니다.

## 시작하기

의존성이 이미 준비된 이 로컬 checkout에서는 다음 명령으로 build 후 Electron 앱을 시작합니다.

```bash
npm start
```

개발 모드는 다음과 같습니다.

```bash
npm run electron:dev
```

build만 확인하려면:

```bash
npm run build
```

처음 clone한 환경에서는 lockfile 기준 의존성 설치가 필요합니다. 이 단계는 registry 네트워크를 사용할 수 있으므로 승인된 환경에서만 실행합니다.

```bash
npm ci
```

`electron:build*` 명령은 installer와 `release/` 산출물을 만드는 별도 packaging 작업입니다. 일상적인 Pipeline Studio 실행에는 필요하지 않습니다.

## 작업대 사용 순서

1. 앱을 시작하고 `Open Production Folder`를 선택합니다.
2. Intake에서 project, concept, script 입력 상태를 확인합니다.
3. Storyboard와 Shot Designer에서 shot continuity와 payload를 점검합니다.
4. Motion Board에서 카메라·동작·시간 정보를 확인합니다.
5. Assets에서 first-frame/reference image dashboard와 review 상태를 확인합니다.
6. Prompt Packs와 Review Gates에서 prompt/media 검토 증거를 확인합니다.
7. Queue에서 submit/heartbeat 명령을 복사 가능한 preview로만 확인합니다.
8. QA에서 clip verdict와 accepted seconds를 확인합니다.
9. Final에서 stitch/report 증거와 남은 blocker를 확인합니다.
10. Settings에서 production root와 dry-run 잠금 상태를 확인합니다.

현재 탭은 다음 11개입니다.

- Intake
- Storyboard
- Shot Designer
- Motion Board
- Assets
- Prompt Packs
- Review Gates
- Queue
- QA
- Final
- Settings

## 읽을 수 있는 production 구조

Layout A는 날짜별 실행 폴더입니다.

```text
docs/short_drama_pipeline_runs/<YYYYMMDD>-<slug>/
  intake/
  storyboard/
  motion_board/
  prompts/
  generated/
  qa/
  final/
```

Layout B는 production root 기반 구조입니다.

```text
production/<project>/
  brief.md
  script.md
  assets/
  image_dashboard/
  storyboard/
  motion_board/
  prompts/
  dreamina_outputs/
  reviews/
  edit/
```

파일이 일부만 있거나 형식이 깨졌을 때 성공 상태를 만들지 않습니다. reader와 validator는 누락·파싱 실패·민감 경로·root escape·walker limit를 blocker로 보존합니다.

## 상태 판정 원칙

아래 상태는 서로 독립적입니다.

- planning complete
- generation submitted
- generation succeeded
- image/media review passed
- Jessie-visible dashboard confirmed
- backend model verified
- clip downloaded
- clip QA accepted
- accepted seconds selected
- final stitch ready

한 단계의 PASS는 다음 단계의 PASS가 아닙니다. 특히 파일 존재, 내용 parse, review PASS, output quality acceptance를 같은 상태로 취급하지 않습니다.

## 안전 경계

- renderer는 shell command를 직접 실행하지 않습니다.
- renderer는 Electron preload의 `window.filmPipeline`만 사용합니다.
- main process가 local file read/write와 command preview 경계를 소유합니다.
- dry-run은 config가 잘못 전달되어도 다시 잠깁니다.
- Queue와 Final의 command card는 copy-only이며 run 버튼이 없습니다.
- image/video generation, Dreamina/Jimeng/Flow submit, DeepSearchTeam, Gemini review, browser automation, upload는 명시적 현재 회차 승인 없이 실행하지 않습니다.
- cookies, browser profiles, auth bundles, API keys, session archive를 저장소에 복사하지 않습니다.

앱은 기존 하네스의 결과를 읽고 다음 명령을 준비·감사하는 작업대입니다. 실제 credit-consuming generation 실행기는 현재 제품 경로에 연결되어 있지 않습니다.

## 검증

네트워크 없는 기본 검증:

```bash
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs

/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' npm run lint
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' npm run build
git diff --check
```

2026-07-13 기준 전체 테스트는 65/65, lint, Vite build 39 modules가 통과했습니다. 결정론적 renderer test는 실제 `PipelineStudio()` DOM 경로를 실행하지만 실제 Electron 창, preload IPC, CSS layout, media rendering, screenshot을 대신하지는 않습니다.

## 주요 경로

```text
electron/main.js                         Electron main entry
electron/preload.js                      window.filmPipeline bridge
electron/lib/filmPipelineProvider.js     local file/preview IPC boundary
electron/lib/productionReader.js         Layout A/B safe reader
src/components/pipeline/                 Pipeline Studio panels
src/lib/pipeline/                        schema, normalizer, validators, gates
src/fixtures/pipeline/                   deterministic fixture states
tests/                                   security, reader, renderer regressions
docs/harness/                            local harness contracts
docs/ui_integration/                     audit and acceptance evidence
```

## 운영 증거

- [`20_production_reader_validation.md`](docs/ui_integration/20_production_reader_validation.md)
- [`22_renderer_contract_validation.md`](docs/ui_integration/22_renderer_contract_validation.md)
- [`23_offline_dependency_audit.md`](docs/ui_integration/23_offline_dependency_audit.md)
- [`.agent/goal-checkpoint.md`](.agent/goal-checkpoint.md)

## 남은 production 인수 항목

실제 작업대로 최종 승인하려면 네트워크를 차단한 Electron 회차에서 다음을 확인해야 합니다.

- 실제 창의 11개 탭 탐색
- native production folder 선택
- 실제 preload IPC 상태 복원
- 오류와 blocker 표시
- CSS clipping/overlap과 responsive layout
- console error 부재
- image/video preview 표시
- command preview에 실행 버튼이 없음을 화면 증거로 확인

이 runtime 검증은 앱 실행과 로컬 Electron cache 쓰기가 발생할 수 있으므로 현재 회차의 명시적 승인 후 수행합니다.
