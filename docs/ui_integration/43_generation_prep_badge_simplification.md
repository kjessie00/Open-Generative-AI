# 생성 준비 뱃지 단순화 체크포인트

## 목표

생성 준비 화면에서 장식성·중복 상태 뱃지를 없애고, 판단에 꼭 필요한 상태만 짧은 한글로 표시한다.

## 적용 결과

| 화면 | 변경 전 | 변경 후 |
| --- | ---: | ---: |
| 참조 이미지 | 7개 | 1개 (`통과`) |
| 프롬프트 팩 | 25개 | 0개 |
| 검토 게이트 | 16개 | 8개 (게이트당 1개) |
| 생성 대기열 | 수십 개 | 2개 (`연결됨`, `제출 전`) |

- 상태 코드와 차단 사유는 `통과`, `준비 필요`, `검토 전`, `확인 필요`처럼 짧은 한글로 통일했다.
- 일반 정보와 문제 목록은 평문으로 표시해 뱃지처럼 보이지 않게 했다.
- 명령 미리보기와 기술 기록은 기본적으로 접어 두고 필요할 때만 펼치게 했다.
- 라이브 생성, 크레딧 사용, 외부 업로드는 실행하지 않았다.

## 실제 UI 검증

- Electron 프로덕션 빌드를 실행해 320px, 768px, 1024px, 1440px에서 네 화면을 직접 확인했다.
- 모든 해상도에서 문서 전체 가로 넘침이 없었다.
- 닫힌 상세 영역의 기술 차단 코드가 기본 화면에 노출되지 않았다.
- 320px에서 명령 상세 영역을 키보드 스페이스로 열고 닫을 수 있었다.
- 캡처:
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-references-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-prompts-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-gates-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-queue-1440.png`

## 검증 결과

- `node --test tests/rendererContract.test.mjs tests/i18n.test.mjs`: 19/19 PASS
- `node --test tests/*.test.mjs`: 192/192 PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS
