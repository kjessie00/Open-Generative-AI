# 시네마틱 파이프라인 다음 세션 핸드오프

## 한 줄 목표

P0 템플릿을 다시 만들거나 실제 provider 생성을 반복하지 않는다. 다음 세션은 현재 `main`과 최종 기록을 확인한 뒤, Dan/HVF 설계의 P1인 캐릭터 3슬롯·오브젝트·룩 참조의 source-of-truth와 G2 완전성 계약을 먼저 고정하고, 그 계약을 Open-GA의 단순한 read/review UI로 연결하는 가장 작은 다음 슬라이스를 진행한다.

## 첫 액션

```bash
cd /Users/jessiek/StudioProjects/Open-Generative-AI
/Users/jessiek/StudioProjects/jessie-context-memory/scripts/context-pack.sh "$PWD"
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git log --oneline --decorate -8
```

그 다음 아래 문서를 순서대로 읽는다.

1. `AGENTS.md`
2. `docs/ui_integration/88_cinematic_pipeline_final_record_20260720.md`
3. `docs/ui_integration/83_external_media_root_contract.md`
4. `docs/ui_integration/84_p0_cinematic_template.md`
5. `docs/ui_integration/86_p0_cinematic_template_actual_e2e.md`
6. `docs/ui_integration/87_p0_cinematic_live_output_actual_e2e.md`
7. `/Users/jessiek/StudioProjects/happyVideoFactory/docs/design/cinema_dan_kieft_hvf_openga_integration_design_20260718.md`

핸드오프의 커밋 값보다 현재 `main`, 현재 테스트, 현재 fixture와 최신 프로젝트 문서가 우선한다.

## 현재 인수 상태

- 기능 기준 커밋: `0944816b0bbc2700c9057188399eb74994e2d618`
- P0 cinematic template: 완료
- companion-only relaunch fix: 완료
- 실제 Electron 전체 재실행: 완료
- production picker 비노출: 완료
- 실제 Flow 결과 1개 연결·검토·0–5초 선택·로컬 최종 렌더: 완료
- Jessie `이 영상 사용`: 기록 완료
- 최종 자동 검증: focused `99/99`, full `453/453`, lint/build/diff PASS
- 통합된 로컬 작업 브랜치: 삭제 완료

현재 앱 프로세스와 machine-local evidence 존재 여부는 시간에 따라 달라질 수 있다. 프로세스가 열려 있다는 과거 기록을 현재 사실로 사용하지 않는다.

## 다음 작업: P1 reference readiness 최소 슬라이스

### 1. 무엇을 할 것

먼저 HVF와 Open-GA의 현행 계약을 읽어 아래 source-of-truth matrix를 확정한다.

- 캐릭터 3슬롯: `face_closeup`, `body_no_head`, `full_back`
- 장소 reference
- 독립 object와 state/view/shot dependency
- project 기본 + scene override look/color reference
- ordered content hash와 reference-lock revision
- per-slot 사람 review와 Jessie waiver
- Layout A/B compatibility projection

그 계약이 저장소 증거로 확정된 뒤에만 Open-GA에 다음 최소 UI를 구현한다.

- 2 설계: 캐릭터·장소·오브젝트·룩 준비 상태와 누락 이유
- 3 생성 준비: G2 준비 여부, stale reference, 권리·review blocker
- 기존 결과 연결과 사람 `사용/다시 만들기` 흐름 재사용
- 짧은 한글 문구, badge 최소화, 경로·hash·provider 내부 ID 비노출
- generation/run/submit 버튼 0개

### 2. 측정 가능한 성공 기준

1. 세 번째 시네마 spine, run root, ledger, gate를 만들지 않는다.
2. 동일 logical reference에 Layout A/B의 authoritative writer가 둘 생기지 않는다.
3. 기존 `reference_images[]` consumer가 깨지지 않는 compatibility projection이 있다.
4. 3슬롯/object/look 중 필수 항목이 누락·stale·권리 미확인이면 first-frame/video 준비가 fail-closed다.
5. renderer는 절대경로·shell·credential·provider submit 정보를 받지 않는다.
6. production과 basic 흐름의 기존 UI·완료도 계산이 바뀌지 않는다.
7. valid/invalid/stale/waiver/dual-layout fixture와 renderer 계약 테스트가 있다.
8. 실제 Electron에서 2–3단계의 단순 한글 UI, 키보드 탐색, 320/768/1229 이상 레이아웃을 확인한다.
9. focused/full Node, lint, build, diff check가 통과한다.
10. 기술 PASS와 실제 이미지 품질·Jessie 승인·외부 생성은 별도 상태로 보고한다.

### 3. 시작 경로와 시그니처

Open-GA:

- `electron/lib/newProjectDesignProvider.js`
- `electron/lib/newProjectImagePlanProvider.js`
- `electron/lib/newProjectVideoPlanProvider.js`
- `electron/lib/filmPipelineProvider.js`
- `electron/preload.js`
- `src/lib/pipeline/client.js`
- `src/components/pipeline/PipelineStudio.js`
- `src/components/pipeline/GenerationPreparationPanel.js`
- `src/components/pipeline/ImageTaskCard.js`
- `src/lib/pipeline/workflowGuide.js`
- 관련 `tests/*.test.mjs`, `src/lib/pipeline/*.test.mjs`

HVF read-first 경로:

- `/Users/jessiek/StudioProjects/happyVideoFactory/video_core/short_drama_room/contracts.py`
- `/Users/jessiek/StudioProjects/happyVideoFactory/docs/short_drama_room_harness_design_20260702.md`
- `/Users/jessiek/StudioProjects/happyVideoFactory/production/ledger.csv`
- `/Users/jessiek/StudioProjects/happyVideoFactory/production/ep01_apologist/first_frames/first_frame_ledger.csv`
- `/Users/jessiek/StudioProjects/happyVideoFactory/production/ep01_apologist/videos/dreamina/ep01_video_generation_ledger.csv`

HVF 경로가 없거나 현재 계약과 다르면 추정 필드를 만들지 말고 정확한 `MISSING_CONTRACT_INPUT`으로 기록한다.

### 4. 건드리지 말 것

- `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`
- 세션·대화·상태 DB·복구 파일
- MuAPI/hosted Next.js 제품 경로
- 새 provider 계정·쿠키·API key UI
- Open-GA 내부 실제 유료 생성·Flow/Dreamina/Jimeng submit
- 자동 업로드·공개 게시·배포
- longform 파이프라인에 시네마 필드 강제 추가
- Dan 전용 production root, selected-takes, ledger 또는 G2.5
- existing `selected_takes` 의미와 Open-GA commit graph 권위의 중복 구현
- accepted seconds의 별도 수동 source-of-truth
- grain/vignette/color/music/SFX creative engine의 Open-GA 내장
- 관련 없는 리팩터링과 UI 재디자인

### 5. 검증 명령과 증거 형태

최소 자동 검증:

```bash
node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs
npm run lint
npm run build
git diff --check
git status --short --branch
```

새 focused 테스트는 실제 수정 파일에 맞춰 위 full 명령보다 먼저 실행한다.

실제 UI 증거는 새 고유 userData와 새 evidence 폴더를 사용한다. 이전 P0 캡처나 실제 Flow 결과를 새 P1 PASS의 증거로 재사용하지 않는다. 다만 P1이 provider 결과 생성 자체를 바꾸지 않는다면 유료 provider submit을 반복하지 말고 안전한 fixture 또는 기존 결과 연결만 사용한다.

최종 보고는 다음을 분리한다.

- `TECHNICAL_PASS|BLOCKED`
- `ACTUAL_ELECTRON_PASS|BLOCKED`
- `REFERENCE_CONTRACT_PASS|BLOCKED`
- `EXTERNAL_GENERATION_NOT_RUN`
- `OUTPUT_QUALITY_NOT_TESTED`
- `JESSIE_APPROVAL_NOT_RECORDED`

## 권고 기본값

| 결정 | 기본값 |
| --- | --- |
| 시네마 거버넌스 | `short-drama-room` |
| seedance 자산 | 기존 Layout B adapter |
| object 저장 | 독립 asset contract, location props는 요약 projection |
| look/color | project 기본 + scene override |
| reference lock | 경로가 아니라 ordered content hash + revision |
| 사람 검토 | per-slot `use/retry`, 필요한 경우 Jessie waiver |
| Open-GA 역할 | read/review/connect/select/cut-only |
| 실제 생성 | 외부 executor, 별도 현재 요청과 승인 |
| 4K | 기본 OFF, G3 이후 선택 take만 opt-in |

## 알려진 주의점

- 기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 현재 baseline이며 별도 신규 실패가 아니다.
- machine-local evidence 경로는 다른 컴퓨터에 없을 수 있다.
- `docs/ui_integration/21_current_acceptance_status.md`는 넓은 역사 기록이다. 이번 P0의 최종 상태는 문서 88, 다음 실행 계약은 본 문서를 우선한다.
- 실제 결과 파일 존재는 결과 품질 승인이나 공개 승인이 아니다.
- `Gemini PASS`, provider 성공, Open-GA 연결, Jessie 사용 승인, 업로드 승인은 각각 다른 상태다.

## 완료 보고 형식

1. 맥락: 시작 HEAD, branch, dirty 여부, 읽은 계약
2. 한 일: 변경한 exact files와 계약
3. 검증: 명령, test count, 실제 Electron 증거
4. 상태 분리: 기술/실제 UI/계약/품질/사람 승인/외부 실행
5. 남은 blocker와 다음 한 단계
6. commit, push, main 통합 여부와 남은 로컬 브랜치

## 현재 세션 종료 조건

P0를 다시 검토하는 작업은 여기서 종료한다. 다음 세션은 본 문서의 P1 reference readiness 최소 슬라이스를 시작하거나, Jessie가 지정한 더 좁은 후속 작업으로 전환한다.
