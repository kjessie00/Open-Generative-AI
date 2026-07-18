# P0 시네마틱 제작 템플릿

## 한 줄 결론

기존 새 프로젝트 흐름을 바꾸지 않고 `기본 영상`과 `시네마틱 제작`을 선택할 수 있게 했다. 시네마틱 제작을 선택하면 한 번 저장한 연출 기준이 설계, 생성 준비, 클립 선택, 마무리까지 같은 기준으로 보인다.

## 적용 범위

HappyVideoFactory의 `docs/design/cinema_dan_kieft_hvf_openga_integration_design_20260718.md`에서 이번 P0에 필요한 최소 요소만 반영했다.

- 기존 5단계와 상태 계산은 그대로 유지한다.
- 새 프로젝트 1단계에만 제작 방식 선택을 둔다.
- 시네마틱 제작은 `연출 의도`, `화면 핵심`, `꼭 지킬 점`, `피할 점` 네 항목만 저장한다.
- 2–5단계에는 짧은 한글 요약을 접힌 상태로 보여준다.
- 기존 제작물 화면과 기본 영상 모드에는 새 요약을 표시하지 않는다.
- 별도 에이전트 채팅, 생성 실행, 새 provider 선택, 배지 상태를 추가하지 않는다.

## 저장·보안 계약

- 스키마: `film_pipeline.cinematic_template.v1`
- 저장 위치: Electron main이 소유하는 `userData/film-pipeline/drafts/canonical-project-bootstrap-v1/cinematic-template.json`
- 파일 모드: `0600`, 같은 폴더의 임시 파일을 사용한 원자 저장
- renderer는 경로를 전달하지 않고 preload의 두 메서드만 호출한다.
  - `getNewProjectCinematicTemplateState()`
  - `saveNewProjectCinematicTemplate(payload)`
- 저장 입력은 정확한 여섯 키만 허용한다: 네 기준, `mode`, `expected_revision_sha256`.
- 잘못된 모드, 알 수 없는 키, NUL, 비정상 Unicode, 4 KiB를 넘는 UTF-8 텍스트, 오래된 revision, symlink 또는 바뀐 파일은 실패 처리한다.
- `basic` 저장 시 네 기준을 빈 값으로 정규화한다.
- shell, 모델, 이미지·영상 생성, 외부 업로드는 실행하지 않는다.

## 단계별 표시

| 단계 | 화면에 보이는 기준 |
| --- | --- |
| 1 기획·대본 | 제작 방식 선택과 네 기준 직접 편집·저장 |
| 2 설계 | 인물·장소·장면을 같은 연출 기준으로 설계 |
| 3 생성 준비 | 프롬프트와 생성 결과를 같은 기준으로 비교 |
| 4 클립 선택 | 사용할 구간이 연출 의도와 맞는지 확인 |
| 5 마무리 | 최종 영상에서 지킬 점과 피할 점 재확인 |

## 검증 결과

- 대상 provider·IPC·renderer 계약: `98/98 PASS`
- 전체 Node 회귀 테스트: `452/452 PASS`
- `npm run lint`: PASS
- `npm run build`: PASS, Vite 79 modules
- `git diff --check`: PASS
- 실제 격리 Electron: 시네마틱 선택, 세 기준 저장, 2–5단계 표시, 전체 종료 후 같은 userData로 재실행, 선택과 저장값 복원 PASS
- 실제 저장 파일: `-rw-------`, 스키마와 저장값 확인
- 독립 read-only 검수: P0/P1/P2 findings 없음
- 외부 생성·모델·업로드 호출: 0

실제 화면 증거는 `/Users/jessiek/.codex/visualizations/2026/07/18/p0-cinematic-template-20260718/`에 있다.

## 서로 다른 현재 상태

- 기술 연결과 로컬 상태 복원: PASS
- 실제 Electron 화면 표시: PASS
- 이미지·영상 생성물 품질: 이번 작업에서 생성하지 않았으므로 미검증
- 사람의 최종 영상 품질 승인: 별도 단계이며 이번 UI 구현 완료와 구분
