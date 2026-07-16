# 검토 선택에서 재제작 작업으로 이어지는 동선

## 맥락

새 프로젝트 결과 검토 보드는 이미지와 영상을 한눈에 비교하고 `다시 만들기`를 저장할 수 있었지만, 선택 뒤 어느 작업으로 가야 하는지 바로 알려주지 않았다. 저장 실패도 이미지·영상 작업대의 별도 문구로만 보여 검토 화면에서 복구하기 어려웠다.

## 한 일

- 다시 만들 항목이 있으면 검토 보드 맨 위에 한 줄짜리 `다음 할 일`을 표시한다.
- 이미지가 선택되면 `이미지 작업 열기`, 영상만 선택되면 `영상 작업 열기`를 표시한다.
- 버튼은 첫 선택 항목의 실제 작업 카드로 이동하고 그 카드에 초점을 둔다.
- 선택 저장 중·성공·실패를 같은 보드에서 짧은 한글로 알린다.
- 실패 시 `선택을 저장하지 못했습니다. 다시 선택하세요.`만 보여 내부 오류·토큰·경로를 숨긴다.
- 상태 뱃지는 추가하지 않았다.

이미지 계획이 바뀌면 기존 영상 계획의 참조 이미지 버전이 더 이상 맞지 않는다. 실제 Electron 검증에서 이 상태로 영상 선택을 이어가면 `VIDEO_PLAN_REFERENCE_IMAGE_REQUIRED`가 발생했다. 이미지 선택 저장 직후 영상 계획과 미리보기를 다시 읽도록 수정해 오래된 영상 결과와 선택 버튼을 제거하고, `이미지를 다시 만든 뒤 영상 검토를 이어가세요.`라고 안내한다. 따라서 작업 순서는 이미지 재제작과 승인 후 영상 검토다.

## 실제 검증

격리된 Electron userData 두 개에 로컬 ffmpeg로 만든 이미지 3개와 1초 MP4 1개를 넣었다. 외부 API, 모델, 생성 제공자, 업로드는 호출하지 않았다.

Computer Use로 다음을 직접 확인했다.

1. 장면 이미지를 다시 만들기로 선택하면 저장 성공과 이미지 다음 행동이 같은 보드에 나타난다.
2. 오래된 장면 영상 카드가 즉시 사라지고 이미지 이후 영상 검토 안내가 나타난다.
3. `이미지 작업 열기`가 선택한 장면 이미지 카드로 이동하고 초점을 둔다.
4. 앱을 완전히 종료하고 다시 실행해도 이미지 선택과 다음 행동이 복원된다.
5. 별도 격리 상태에서 영상만 선택하면 영상 다음 행동이 나타난다.
6. `영상 작업 열기`가 선택한 영상 카드로 이동하고 초점을 둔다.
7. 앱을 완전히 종료하고 다시 실행해도 영상 선택과 다음 행동이 복원된다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/review-to-retry-image/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/review-to-retry-image/image-work-item-focused.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/review-to-retry-image/relaunch-restored.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/review-to-retry-video/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/review-to-retry-video/video-work-item-focused.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/review-to-retry-video/relaunch-restored.jpeg`

## 자동 검증과 경계

- 대상 렌더러 테스트: `3/3 PASS`
- 전체 Node 회귀: `343/343 PASS`
- lint: PASS
- Vite build: PASS, 74 modules
- 검증 스크립트 구문과 `git diff --check`: PASS

이 결과는 선택 저장, 상위 계획 변경 반영, 작업 카드 이동과 재실행 복원을 증명한다. 실제 DST·Flow·Grok·Replicate·ByteDance 생성, 결과물 품질, Jessie의 최종 승인은 수행하거나 주장하지 않는다.
