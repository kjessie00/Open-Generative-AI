# 생성 준비 뱃지 단순화 체크포인트

## 목표

생성 준비 화면에서 장식성·중복 상태 뱃지를 없애고, 판단에 꼭 필요한 상태만 짧은 한글로 표시한다.

## 적용 결과

| 화면 | 변경 전 | 변경 후 |
| --- | ---: | ---: |
| 참조 이미지 | 7개 | 0개 |
| 프롬프트 팩 | 25개 | 0개 |
| 검토 게이트 | 16개 | 0개 |
| 생성 대기열 | 수십 개 | 0개 |

- 상태 코드와 차단 사유는 뱃지가 아닌 `통과`, `준비 필요`, `검토 전`, `확인 필요` 같은 짧은 한글 문구로 표시한다.
- 일반 정보와 문제 목록은 평문으로 표시해 뱃지처럼 보이지 않게 했다.
- 명령 미리보기와 기술 기록은 기본적으로 접어 두고 필요할 때만 펼치게 했다.
- 라이브 생성, 크레딧 사용, 외부 업로드는 실행하지 않았다.

## 실제 UI 검증

- Electron 프로덕션 빌드를 실행해 320px, 768px, 1024px, 1440px에서 네 화면을 직접 확인했다.
- 모든 해상도에서 문서 전체 가로 넘침이 없었다.
- 닫힌 상세 영역의 기술 차단 코드가 기본 화면에 노출되지 않았다.
- 320px에서 명령 상세 영역을 키보드 스페이스로 열고 닫을 수 있었다.
- 실제 기본 Electron에서 네 화면의 보이는 작은 상태 뱃지가 각각 0개임을 다시 확인했다.
- Computer Use로 검토 게이트를 직접 열었고, 각 상태가 일반 한글 문구로 읽히며 색상 뱃지는 없음을 확인했다.
- 캡처:
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-references-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-prompts-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-gates-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-queue-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-initial-storyboard-e2e/generation-prep-no-badges.png`

## 검증 결과

- `node --test tests/rendererContract.test.mjs tests/i18n.test.mjs`: 19/19 PASS
- `node --test tests/*.test.mjs`: 192/192 PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS

## 후속 단순화

- 샷 설계, 카메라 설정, 참조 자료, 이력 미리보기의 장식성 댜지를 제거했다.
- 스토리보드의 다시 만들기 계획과 DST 묶음 연결은 상태 댜지 대신 짧은 한글 문장으로 표시한다.
- 결과 카드에는 사용자가 판단해야 하는 `미검토`, `수정 필요`, `다시 만들기`만 남겼다.
- 카드 동작은 `다시 만들기` / `선택 해제`로 줄여 1440px 4열에서 불필요한 줄바꿈을 줄였다.
