# DST 첫 이미지 스토리보드 연결

## 목표

기존 `media_attempts.jsonl`과 검토 초안이 없어도 스토리보드가 정한 캐릭터·장소·장면에 첫 DST 이미지 묶음을 연결한다. 사용자는 실제 이미지들을 한눈에 보고 이미지마다 한글 대상을 고른 뒤, 품질이 나쁜 결과만 다시 만들기로 선택한다.

## 계약

- 대상 권한은 production 안의 `storyboard/storyboard.json`, `storyboard/clips.json`, `storyboard.json` 중 실제로 읽힌 정식 JSON 하나에서만 만든다.
- `characters[]`는 캐릭터 시트, `location`은 장소 시트, `clip_id`는 장면 이미지 대상이다.
- 내부 ID가 한글이면 안정적인 해시 ID를 만들되 UI에는 원래 한글 이름만 표시한다.
- 이미지 수와 대상 수가 같아야 하고, 순서가 연속이어야 하며, 같은 대상을 두 번 고르거나 종류를 섞을 수 없다.
- 계획 뒤 스토리보드·원장·묶음 파일이 바뀌면 확인 단계에서 중단한다.
- 각 결과는 `attempt: 1`, `retry_of: ""`, `provider: "dst"`, `review_status: "unreviewed"`로 저장한다.
- 내용 주소 이미지 파일을 mode `0600`으로 복사한 뒤 원장을 atomic rename으로 한 번만 공개한다.
- 이미 같은 종류와 대상에 결과가 있으면 최초 연결 대상 목록에서 숨긴다.

## UI

- 제목은 `첫 이미지 연결`, 선택 항목은 `이미지 종류`, `완료된 이미지 묶음`처럼 짧은 한글을 사용한다.
- 캐릭터·장소·장면 중 실제 스토리보드에 있는 종류만 보여준다.
- 실제 9:16 이미지를 320/768/1024/1440px에서 1/2/2/3열로 모두 보여주며 자르지 않는다.
- 이미지별 대상은 기본 1:1로 놓고, 다른 이미지에서 고른 대상은 선택 목록에서 숨긴다.
- 모든 연결이 완성되기 전에는 `연결 확인`을 누를 수 없다.
- 기존 결과가 없는 최초 연결 화면에서는 재생성 계획 빈 카드와 영상 연결 영역을 숨긴다.

## 실제 Electron 검증

실제 DST 완료 묶음 `ep02_location_assets_batch_b_talk-room_doorway_0b31082ed6`의 세 이미지를 격리 production으로 복사했다. 시작 production에는 `brief.md`와 `storyboard/storyboard.json`만 있었고 원장·reviews·media는 없었다.

| 이미지 | 한글 대상 | 결과 |
| --- | --- | --- |
| `image_01.png` | 학교 상담실 출입구 | `location_sheet`, 시도 1 |
| `image_02.png` | 비 오는 저녁의 낡은 차 | `location_sheet`, 시도 1 |
| `image_03.png` | 지아의 밤 침실 | `location_sheet`, 시도 1 |

검증 결과:

1. 세 미리보기는 모두 941×1672로 읽혔다.
2. 320/768/1024/1440px에서 가로 넘침 0, 1/2/2/3열, 선택 상자 높이 44px였다.
3. 원장은 정확히 3건이며 attempt는 모두 1, `retry_of`는 모두 빈 값, 한글 `target_label`과 원본 순서가 일치했다.
4. 세 내용 주소 파일은 원본 SHA-256·byte 수가 같고 mode `0600`이었다.
5. 낡은 차 한 장만 다시 만들기로 골라 검토 초안과 retry queue 1개를 저장했다.
6. Electron을 완전히 종료하고 새 프로세스로 다시 실행한 뒤 세 카드와 선택 1개, retry plan 1개가 복원됐다.
7. 외부 요청·renderer console·예외·failed load·강제 종료·잔존 process group은 모두 0이었다.
8. 실제 유료 생성, API key 사용, 외부 업로드는 0건이었다.

## 생성 준비 배지 단순화

같은 실제 Electron 실행에서 생성 준비의 `참조 이미지`, `프롬프트 팩`, `검토 게이트`, `생성 대기열`을 차례로 열었다. 보이는 작은 상태 뱃지는 네 화면 모두 0개였다. 필수 상태는 `통과`, `준비 필요`, `검토 전`, `확인 필요` 같은 일반 한글 문구로 남겼다. Computer Use로 검토 게이트를 직접 열어 접근성 트리와 화면을 함께 확인했다.

## 증거

- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-initial-storyboard-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-initial-storyboard-e2e/generation-prep-no-badges.png`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-initial-storyboard-e2e/initial-target-mapping.png`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-initial-storyboard-e2e/attempt-1-selected.png`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-initial-storyboard-e2e/relaunch-restored.png`

## 화면 충실도

기준 화면 `generation-prep-queue-1440.png`와 실제 캡처를 직접 비교했다.

1. 기존 5단계와 검정·graphite·청록 구조를 유지했다.
2. 첫 이미지 연결은 기존 스토리보드 아래 한 영역에만 추가했다.
3. 이미지 카드는 9:16 원본 전체를 보여주고 한글 대상 선택을 바로 아래에 배치했다.
4. 새 장식 배지와 raw 상태 코드는 추가하지 않았다.
5. 생성 준비의 기존 배지는 일반 문구로 바꿔 시각적 소음을 줄였다.
6. label/select 연결, 44px 조작 높이, 네 대표 너비의 가로 넘침 0을 확인했다.

## 현재 경계

- 기술 검증은 집중 42/42, 최종 전체 순차 260/260, 실제 ffmpeg 1/1, lint, 59-module build, diff check와 실제 Electron import·복원까지 PASS다. 첫 전체 실행의 ffmpeg 1건은 외부 `happyVideoFactory` Python 모듈의 차가운 import가 10초 탐색 한도를 넘겨 실패했으며, 고정 Python 3.11.7 어댑터 확인 후 단독 1/1과 전체 260/260이 통과했다.
- 실제 이미지 생성과 영상 생성은 이번 검증에서 실행하지 않았다.
- 세 이미지가 서로 다른 장소임은 화면에서 확인했지만 영화적 품질은 자동 승인하지 않았다.
- Jessie의 최종 채택과 이후 영상 생성 파이프라인 검증은 별도 단계다.
