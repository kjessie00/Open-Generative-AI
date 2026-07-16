# 새 프로젝트 합본 사용·재제작 결정

## 목적

새 프로젝트의 비공개 검토용 합본을 앱 안에서 재생한 뒤 `이 영상 사용` 또는 `다시 만들기`를 선택하고, 같은 영상에 묶인 결정을 재실행 후에도 복원한다. `다시 만들기`는 기존 결과와 편집 증거를 지우지 않고 스토리보드 결과 검토로 돌아간다.

## 구현 계약

- 결정은 `<draft>/final_stitch/runs/review-decision.json`에 `film_pipeline.new_project_final_review.v1`로 저장한다.
- Electron main이 현재 `snapshot_id`와 `receipt_sha256`에 결정을 묶고, renderer에는 경로·해시·내부 식별자를 보내거나 표시하지 않는다.
- 저장 입력은 정확히 `{ decision, expected_review_version }`이며 `use` 또는 `retry`만 허용한다.
- 파일은 `0600`, 상위 디렉터리는 `0700`이고 전용 잠금과 같은 디렉터리 원자 교체를 사용한다.
- 오래된 version, 잘못된 JSON, symbolic link는 fail-closed다.
- 상위 선택이나 합본 receipt가 바뀌면 이전 결정은 `확인 필요`로 돌아간다.
- `use`는 현재 공개 상태의 `output_quality_approved=true`로 계산하지만, 생성 당시 receipt와 fresh probe의 `output_quality_approved=false`는 바꾸지 않는다.
- `retry`는 roughcut, receipt, fresh probe, handoff, 선택 구간, production, canonical delivery를 수정하거나 삭제하지 않는다.

## UI

- 상태는 `확인 필요`, `사용하기로 확인함`, `다시 만들기로 선택됨` 세 문구만 사용한다.
- 버튼은 `이 영상 사용`, `다시 만들기`이고 선택 상태는 `aria-pressed`로도 노출한다.
- `다시 만들기`를 선택하면 `결과 검토 열기`가 나타나며 스토리보드의 인물·장소·장면 이미지·영상 검토판으로 이동한다.
- 배지는 추가하지 않았다.
- 작은 화면은 1열, 큰 화면은 영상과 결정 영역을 2열로 배치한다. 영상은 `object-contain`과 viewport 기준 최대 높이를 사용한다.

## 실제 Electron 검증

격리된 userData 복사본과 실제 0.6초 private roughcut을 사용했다. 외부 생성·API·업로드는 실행하지 않았다.

- 실제 앱에서 합본을 다시 만들고 `확인 필요`를 확인했다.
- `이 영상 사용`을 눌러 `사용하기로 확인함`과 선택 상태를 확인했다.
- 이어서 `다시 만들기`를 눌러 `다시 만들기로 선택됨`과 `결과 검토 열기`를 확인했다.
- `결과 검토 열기`는 스토리보드의 인물 기준, 장소 기준, 장면 이미지, 장면 영상 검토판으로 이동했다.
- 앱 프로세스를 완전히 종료하고 같은 userData로 다시 실행한 뒤 `다시 만들기로 선택됨`, `aria-pressed`, CTA가 복원됐다.
- 결정 파일은 `0600`, 308바이트였고 결정 시각보다 앞서 생성된 roughcut·receipt·probe의 SHA-256과 파일 시각은 유지됐다.
- 현재 roughcut은 3,478바이트이고 선택 범위는 `0.2초 → 0.8초`다.
- 실행·재실행 복원은 통과했지만, 초기 복원은 final render fresh probe와 preview 검증을 연속 수행해 약 50초가 걸렸다. 신뢰 경계를 낮추지 않는 중복 probe 제거가 다음 성능 후보다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/final-review-decision/01-pending.png`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/final-review-decision/03-relaunch-retry.png`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/final-review-decision/07-responsive-native-zoom.png`

## 화면 충실도 확인

이번 변경은 기존 디자인 시스템 안의 작은 UI 확장이므로 별도 Image Gen 콘셉트는 만들지 않았다. 변경 전 실제 화면 `01-pending.png`를 기준 화면으로, 변경 후 기본 배율 실제 화면 `07-responsive-native-zoom.png`를 구현 화면으로 같은 `view_image` 점검에서 비교했다.

1. 5단계 왼쪽 rail과 `최종 편집·보고서 → 최종 편집 준비` 계층을 유지했다.
2. 선택 수, 총 길이, 장면 순서와 `0.2초 → 0.8초` 구간을 그대로 유지했다.
3. 검토용 영상 제목, native 재생 컨트롤과 기존 검은 media frame을 유지했다.
4. 상태·결정 영역만 오른쪽에 두어 영상과 버튼을 1228×768 첫 화면에서 함께 볼 수 있게 했다.
5. 새 visible copy는 요청에 필요한 세 상태와 세 버튼뿐이며 배지·영문 상태·내부 값 추가는 0건이다.
6. 모바일 1열, 큰 화면 2열, `min-w-0`, `flex-wrap`, 44px 이상 버튼 계약을 자동 테스트로 확인했다.

기준 화면 대비 남은 의도적 시각 편차는 없다. 실제 화면의 색, 타이포그래피, 테두리, radius, 간격, media treatment를 기존 작업대 시스템에 맞춰 확인했다.

## 자동·독립 검증

- 변경 관련 집중 테스트: `57/57 PASS`
- 전체 Node 회귀: `371/371 PASS`
- 실제 임시 synthetic ffmpeg: `1/1 PASS`
- 후속 renderer 회귀: `39/39 PASS`
- lint: PASS
- Vite build: PASS
- `git diff --check`: PASS
- 독립 검증: 초기 계약과 후속 반응형 변경 모두 P0/P1/P2 없음

## 경계와 다음 작업

이번 PASS는 로컬 합본에 대한 명시적 사람 결정 UI와 그 private 저장·복원을 증명한다. 격리 fixture에서 Codex가 누른 결정은 Jessie의 실제 최종 승인으로 주장하지 않는다. 영상의 미학·연속성·내용 품질, 실제 provider 생성, 실제 production finishing, canonical delivery 승격도 별도다. 다음 로컬 제품 작업은 32 MiB 초과 streaming preview 또는 재실행 때 중복 fresh probe를 제거하는 성능 개선이다.
