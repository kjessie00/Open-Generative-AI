# Cinematic Pipeline Studio

Jessie의 기존 영상 제작 하네스를 로컬에서 열고, 상태를 복원하고, 검토 게이트와 결과 증거를 한 화면에서 확인하는 Electron/Vite 작업대입니다.

이 저장소는 `Anil-matcha/Open-Generative-AI`의 로컬 fork이지만 현재 제품 경로는 upstream hosted generation 서비스가 아닙니다. 기본 `dev`, `build`, `start` 명령은 `src/`와 `electron/` 아래의 로컬 Pipeline Studio만 사용합니다.

## 현재 운영 상태

- Vite/Electron 기본 제품 경로: 구현 및 자동 검증 완료
- 10개 핵심 패널과 11개 탭 renderer 계약: 검증 완료
- production Layout A/B fixture reader와 fail-safe: 검증 완료
- happyVideoFactory canonical pack/ledger read-only handoff: 구현 및 fixture 검증 완료
- canonical `selected_takes.json`/`qc_report.json` 마감 상태: 읽기·구조 검증·한글 표시 완료
- 실제 production 후보: partial/unknown 상태로 안전하게 차단
- 실제 Electron 창과 native folder dialog의 과거 시각 검증: 부분 통과; 현재 12-method bridge 재검증은 남음
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

1. 앱을 시작하고 `제작 폴더 열기`에서 기존 canonical production을 선택합니다.
2. `프로젝트`에서 project, concept, `intake/script.txt` 입력 상태를 확인합니다.
3. `스토리보드`와 `샷 설계`에서 shot continuity와 payload를 점검합니다.
4. `모션 보드`에서 카메라·동작·시간 정보를 확인합니다.
5. `참조 이미지`에서 first-frame/reference image dashboard와 review 상태를 확인합니다.
6. `프롬프트 팩`과 `검토 게이트`에서 prompt/media 검토 증거를 확인합니다.
7. `생성 대기열`에서 happyVideoFactory 계약이 `사용 가능`인지 확인하고,
   canonical validator 명령을 복사 가능한 읽기 전용 preview로 확인합니다.
8. `클립 QA`에서 `shot_manifest.json`으로 입증된 샷 별칭, 선택 테이크의
   in/out 구간·원본 파일 존재, canonical QC와 사람 판정의 분리 상태를 확인합니다.
9. `최종 편집`에서 선택 구간이 계획 clip과 모두 일치하는지, stitch/report/
   ffprobe 증거와 남은 blocker를 확인합니다. 이 화면은 렌더를 실행하지 않습니다.
10. `설정`에서 production root, fixed harness 계약과 dry-run 잠금을 확인합니다.

현재 탭은 다음 11개입니다.

- 프로젝트
- 스토리보드
- 샷 설계
- 모션 보드
- 참조 이미지
- 프롬프트 팩
- 검토 게이트
- 생성 대기열
- 클립 QA
- 최종 편집
- 설정

## 읽을 수 있는 production 구조

Layout A는 날짜별 실행 폴더입니다.

```text
docs/short_drama_pipeline_runs/<YYYYMMDD>-<slug>/
  intake/
    brief.md
    script.txt
  storyboard/
  motion_board/
  prompts/
  generated/
  qa/
  final/
```

Canonical Layout A에서는 root의 `pipeline_pack_report.json`과 선택적으로
`submission_manifest.json`, `jimeng_state.json`, `download_manifest.json`,
`shot_manifest.json`, `selected_takes.json`, `qc_report.json`을
각각 512 KiB 제한으로 읽습니다. UI에는 허용된 구조·상태·모델·로컬 경로
메타데이터만 전달하고 prompt, script 본문, error narrative는 복사하지 않습니다.
선택 구간은 유한한 시작·종료 값, production 내부의 실제 비심볼릭 원본 파일,
`shot_manifest.json`과 `timeline_builder` 계약이 함께 입증한 `clip_<shot_id>`
별칭이 모두 있을 때만 집계합니다. QC의 `accept`는 구조 메타데이터일 뿐 사람의
승인이나 최종 출력 품질 PASS로 승격하지 않습니다.

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
- Queue와 Final에는 run 버튼이 없습니다. 검증된 preview만 복사할 수 있고,
  계약이 불완전한 카드는 disabled 상태로 listener도 붙지 않습니다.
- 계약이나 canonical 입력이 누락된 command card는 복사 버튼 자체가 disabled입니다.
- canonical validator preview만 fixed happyVideoFactory cwd에서 로컬 읽기로 제공하며,
  기존 production을 덮어쓰는 build preview는 만들지 않습니다.
- 기존 ffprobe 카드는 증거 JSON을 저장하지 못하고 concat 방식은 선택 구간을
  반영하지 못하므로 두 최종 명령은 표시만 하고 복사할 수 없게 차단합니다.
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

2026-07-13 canonical finishing 통합 기준으로 network-denied 전체 테스트 115/115,
lint, Vite build 41 modules가 통과했습니다. 상세 결과는
[`32_canonical_finishing_state.md`](docs/ui_integration/32_canonical_finishing_state.md)에 기록합니다.
결정론적 renderer test는 실제 `PipelineStudio()` DOM 경로를 실행하지만 실제
Electron 창, preload IPC, CSS layout, media rendering, screenshot을 대신하지는 않습니다.

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
