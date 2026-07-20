# 시네마틱 파이프라인 P0 최종 기록

## 한 줄 결론

Open-GA의 P0 시네마틱 제작 템플릿은 기존 5단계 흐름과 no-submit 경계를 유지한 채 구현·실제 재실행·실제 결과 연결·클립 선택·로컬 5초 렌더·사람 승인까지 확인됐다. 기능 기준 커밋은 `0944816b0bbc2700c9057188399eb74994e2d618`이며, 이 기록 작성 직전 `main = origin/main`, 작업 트리 clean이었다.

## 완료 범위

- 새 프로젝트 1단계에서 `기본 영상`과 `시네마틱 제작`을 선택한다.
- 시네마틱 제작은 `연출 의도`, `화면 핵심`, `꼭 지킬 점`, `피할 점` 네 항목만 저장한다.
- 같은 기준이 2 설계, 3 생성 준비, 4 클립 선택, 5 마무리에 짧은 한글 요약으로 이어진다.
- 기본 영상과 기존 production workspace에는 시네마틱 편집기·요약이 나타나지 않는다.
- renderer는 경로·shell·provider 실행 권한을 갖지 않고, Electron main이 private `userData` 저장과 파일 검증을 소유한다.
- 다른 컴퓨터에서는 provider 소스 경로를 수정하지 않고 `설정 → 결과 폴더` 선택 계약을 사용한다.
- 실제 Flow 결과 1개를 Open-GA에 연결하고, 이미지·영상 사용 결정, `0–5초` 구간 선택, 로컬 검토용 렌더, 전체 앱 재실행 복원과 최종 재생을 확인했다.
- Jessie가 최종 5초 영상의 `이 영상 사용`을 직접 선택했고 앱 저장 상태를 확인했다.

## 구현된 핵심 계약

### 시네마틱 companion

- 스키마: `film_pipeline.cinematic_template.v1`
- 위치: Electron `userData/film-pipeline/drafts/canonical-project-bootstrap-v1/cinematic-template.json`
- 파일: regular file, non-symlink, mode `0600`, 원자 저장
- renderer 공개 메서드:
  - `getNewProjectCinematicTemplateState()`
  - `saveNewProjectCinematicTemplate(payload)`
- workflow 완료도와 활성 단계 계산에는 참여하지 않는다.

### 재실행 결함 수정

실제 첫 E2E에서 cinematic companion만 저장된 폴더를 canonical 초안 일부 누락으로 오판하는 `NEW_PROJECT_DRAFT_INCOMPLETE`가 재현됐다. `draft.json`, `brief.md`, `script.txt`가 모두 없을 때만 canonical 초안을 `empty`로 분류하도록 최소 수정했다.

다음 fail-closed 경계는 유지된다.

- canonical 세 파일 중 하나라도 있으면 기존 완전성 검사를 수행한다.
- partial canonical draft는 `NEW_PROJECT_DRAFT_INCOMPLETE`다.
- symlink, 잘못된 mode, unsafe directory와 파일 변경은 계속 차단한다.
- cinematic companion은 canonical draft의 존재 증거로 승격되지 않는다.

## 실제 검증 기록

### P0 템플릿 E2E

- 새 격리 userData: `/tmp/open-ga-p0-cinematic-sol-xhigh-20260718T163302KST`
- 순서: clean basic → cinematic 저장 → 2–5단계 → 전체 재실행 → basic 저장/재실행 → cinematic 재저장/재실행
- 판정:
  - `TECHNICAL_PASS`
  - `ACTUAL_ELECTRON_PASS`
  - `PRODUCTION_PICKER_PASS`
- 저장 파일 SHA-256: `319a2b9ccf8e68b918681a4742002568ca60715167283cb76eb605daa1430eab`
- Layout A fixture 전후 집계 SHA-256: `d900656ce7cd0bed73c84a41927ec80846f61e08c28b0f70eed83c7cf4a8078e`

### 실제 결과물 E2E

- 프로젝트: `open-ga-live-lantern-20260718`
- 실제 Flow submit: 1회
- provider 원본: 10.006초, 720×1280, H.264/AAC
- 선택 구간: `0–5초`
- 최종 파일: `open-ga-live-lantern-final-5s.mp4`
- 최종 SHA-256: `6b2d2fdf8fe25136753ecae06036d40d187c67907ccd35f8e1ec3d7fa00988db`
- 최종 길이: 정확히 5.000초, 720×1280, 24 fps, H.264/AAC
- frame 120개 전부 서로 다른 hash, black interval 없음, 1초 이상 freeze 없음
- 판정:
  - `ACTUAL_PROVIDER_PASS`
  - `ACTUAL_ELECTRON_PASS`
  - `OUTPUT_QUALITY_PARTIAL_PASS`
  - `JESSIE_APPROVAL_RECORDED`

`OUTPUT_QUALITY_PARTIAL_PASS`는 영상 무결성과 시각 연속성을 확인했다는 뜻이다. 카메라 push 강도와 오디오의 창의적 품질을 별도 정밀 채점했다는 뜻은 아니다. Jessie의 `이 영상 사용`은 사람의 사용 승인으로 따로 기록한다.

## 2026-07-20 최종 자동 검증

기능 코드가 통합된 `main`에서 새로 실행했다.

| 검증 | 결과 |
| --- | --- |
| required harness docs | `shorts-SKILL.md`, `Seedance2-SKILL.md` 존재 |
| cinematic focused | `99/99 PASS` |
| full Node | `453/453 PASS`, exit 0 |
| lint | PASS |
| Vite build | PASS, Vite 5.4.21, 79 modules |
| `git diff --check` | PASS |
| Git 시작 상태 | `main = origin/main = 0944816`, clean |

기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 재현됐으며 새 실패나 build warning은 없었다.

## 증거와 기준 문서

저장소 안의 지속 문서:

- `docs/ui_integration/83_external_media_root_contract.md`
- `docs/ui_integration/84_p0_cinematic_template.md`
- `docs/ui_integration/85_p0_cinematic_template_e2e_handoff.md`
- `docs/ui_integration/86_p0_cinematic_template_actual_e2e.md`
- `docs/ui_integration/87_p0_cinematic_live_output_actual_e2e.md`

이 컴퓨터의 실제 증거 bundle:

- `/Users/jessiek/.codex/visualizations/2026/07/18/p0-cinematic-template-e2e-sol-xhigh-20260718T163302KST/`
- `/Users/jessiek/.codex/visualizations/2026/07/18/p0-cinematic-template-e2e-sol-xhigh-20260718T161948KST-pre-fix-defect/`
- `/Users/jessiek/.codex/visualizations/2026/07/18/open-ga-live-output-e2e-20260718T190755KST/`

증거 bundle은 machine-local이다. 다른 컴퓨터에서 경로가 없다는 사실은 코드 회귀가 아니며, 그 컴퓨터에서는 저장소 문서와 현재 코드·테스트를 먼저 사용한다.

## 완료와 미완료를 분리한 최종 상태

| 항목 | 상태 |
| --- | --- |
| P0 제작 방식 선택·네 기준 저장 | 완료 |
| 1–5단계 시네마틱 기준 연속 표시 | 완료 |
| basic/production 비노출 | 완료 |
| private 저장·재실행 복원 | 완료 |
| companion-only 오분류 수정 | 완료 |
| 외부 결과 폴더 portability | 완료 |
| 실제 Flow 결과 연결·검토·구간 선택·로컬 렌더 | 완료 |
| Jessie 최종 사용 승인 | 완료 |
| 캐릭터 3슬롯 typed contract | 미구현 |
| 독립 object sheet/state/shot dependency | 미구현 |
| project/scene look-color reference lock | 미구현 |
| G2 completeness 통합 | 미구현 |
| canonical multi-ref pack·provider projection | 미구현 |
| voice reference WAV/MP4 rendition 계약 | 미구현 |
| credit ladder C0–C3 | 미구현 |
| Open-GA 내부 유료 생성 실행 | 의도적으로 비범위 |
| 자동 업로드·공개 | 의도적으로 비범위 |

## 닫는 결정

- 새 시네마 전용 하네스나 세 번째 run root를 만들지 않는다.
- `short-drama-room`을 거버넌스 축으로, 기존 seedance Layout B를 자산 adapter 대상으로 유지한다.
- Open-GA는 로컬 기획·검토·결과 연결·선택·cut-only 마감 작업대다.
- provider 계정, 쿠키, API key, 결제, 유료 submit, 공개 업로드 UI를 Open-GA에 넣지 않는다.
- 기술 PASS, 실제 provider PASS, 결과물 품질, Jessie 승인, 배포·공개 승인을 계속 별도 상태로 유지한다.

이 범위의 P0 작업은 완료됐다. 다음 작업은 `docs/ui_integration/89_cinematic_pipeline_next_session_handoff_20260720.md`에서 시작한다.
