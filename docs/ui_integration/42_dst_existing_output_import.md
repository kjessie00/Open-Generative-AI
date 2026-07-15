# DST 기존 결과 가져오기 체크포인트

## 범위

- `dst image`의 완료된 단일 이미지 번들을 읽어 기존 `retry_requested` 항목에 연결한다.
- 라이브 생성은 실행하지 않는다. Renderer는 경로나 셸 명령을 전달하지 않는다.
- 후보 목록에는 원본 바이트를 넣지 않고 선택한 한 장만 opaque token으로 미리보기를 읽는다.
- 가져온 결과는 `unreviewed`로 기록해 사람 검토 전에는 채택으로 간주하지 않는다.

## 실제 검증

- 실제 소스 번들: `materiality-focused_print-archive_still_life_511386ed84`
- 소스 이미지: 1086×1448 PNG, 2,505,818 bytes
- 소스/가져온 파일 SHA-256 일치:
  `bee35dc0daebca6fb972376c0f482bd28feb1da74e10f712d2a18337cede931b`
- Electron 앱에서 다른 실제 후보를 선택해 `가져오기 계획`과 `선택한 결과 가져오기`를 순서대로 실행했다.
- 결과: 복사 PASS, ledger 추가 PASS, 스토리보드 `시도 3` 즉시 표시 PASS, 1086×1448 미리보기 PASS.
- 차단된 retry plan 거부, production-root 협력 잠금, dead-PID stale 잠금 복구 테스트 PASS.
- 화면 증거: `/Users/jessiek/.codex/visualizations/2026/07/15/dst-real-import-storyboard-1440.png`

## 상태 분리

- 기존 결과 import: PASS
- 라이브 이미지 생성: NOT RUN
- 라이브 영상 생성: NOT RUN
- 결과 품질: `unreviewed`, Jessie 승인 전
