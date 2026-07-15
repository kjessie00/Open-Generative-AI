# 실행 결과 자동 찾기와 작업대 연결

## 결론

외부 실행 영수증의 `결과 도착`을 실제 DST 이미지 번들 또는 영상 provider 결과와 안전하게 연결했다. 사용자는 `작업 진행`에서 `결과 확인`을 누르면 정확한 결과가 `이번 결과`로 미리 선택된 이미지·영상 작업 카드로 이동한다. 이미 연결한 항목은 `작업대에 연결됨`으로 따로 표시한다.

앱 재실행마다 바뀌는 candidate token은 영구 영수증에 저장하지 않는다. 영수증은 다음의 안정적인 locator만 보존하고, Electron main이 현재 파일을 다시 해시·검증한 뒤 이번 프로세스의 임시 token으로 변환한다.

```text
dst:<bundle_id>:<image_index>:<image_sha256>
<flow|grok|replicate|bytedance>:<result_id>:<video_sha256>
```

bundle/result id가 같아도 파일 SHA-256이 달라지면 연결 후보로 인정하지 않는다. locator, 후보 token, 경로, 해시는 화면에 표시하지 않는다.

## 실제 제공자 상태

| 제공자 | 비소모성 실제 확인 | 현재 작업대 표시 | 라이브 생성 |
|---|---|---|---|
| DST 이미지 | 로컬 CLI·`goldpure369` 프로필 존재, 기존 정상 번들 12개 인식 | `결과 확인 준비됨 · 생성 연결 전` | BLOCK — `dst image`에 dry-run/no-submit 없음 |
| Flow | CLI 도움말·정적 안전 검증 PASS | `참조 방식 준비 필요` | BLOCK — 현재 작업대 1장 참조와 Flow 2장 계약 불일치 |
| Grok | 고정 Python 3.11.7 CLI 도움말 PASS | `로컬 명령 확인됨 · 생성 연결 전` | BLOCK — dry-run 없음, status도 브라우저 실행 |
| Replicate | canonical receipt 결과 검증·연결 PASS | `결과 영수증 확인 가능 · 생성 연결 전` | BLOCK — 안전한 Predictions adapter 없음 |
| ByteDance | canonical receipt intake만 존재 | `직접 생성 연결 없음` | BLOCK — 직접 API 실행기 없음 |

`.env`, API key, provider 브라우저, submit, generation, download는 사용하지 않았다.

## 실제 Electron 검증

격리된 `userData`에서 유효한 WebP와 MP4를 사용했다. 이미지에는 실제 DST bundle 계약을, 영상에는 실제 `film_pipeline.external_video_result.v1` Replicate receipt 계약을 적용했다.

1. 실제 CLI로 이미지 실행 receipt를 순차 발행했다.
2. `결과 확인`으로 장면 이미지의 정확한 bundle과 이미지 번호가 자동 선택됐다.
3. 실제 WebP 미리보기가 decode된 뒤 UI의 `이 결과 연결`로 작업 카드에 연결했다.
4. Replicate canonical receipt를 추가하고 실제 CLI로 영상 receipt를 발행했다.
5. `결과 확인`으로 정확한 영상이 자동 선택됐고 MP4 `readyState 4`를 확인했다.
6. UI의 `이 영상 연결`로 작업 카드에 연결했다.
7. Electron을 완전히 종료·재실행해 이미지와 영상 연결 상태를 복원했다.

결과:

- `대기 0 · 진행 0 · 결과 4 · 문제 0`
- 연결 완료 2개, 아직 연결 가능한 결과 2개
- image decode PASS, video preview/connected playback `readyState 4`
- locator·candidate token·경로·해시 화면 노출 0
- 배지 0
- 320/768/1024/1440 가로 넘침 0, 잘린 조작부 0, 최소 조작 높이 44px
- 콘솔 오류·경고 0, 외부 HTTP(S) 요청 0
- provider 브라우저 호출·API key·upload·production write 0
- `external_call_performed/model_called/generation_executed=false`

`@컴퓨터`로 실제 macOS Electron 창도 직접 조작했다. 접근성 트리에서 `작업 진행`, 쉬운 한글 상태, `결과 확인`, `이번 결과`, 실제 이미지 미리보기를 확인했다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/open-ga-durable-result-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/open-ga-durable-result-e2e/durable-result-inbox-1440.png`

## 자동 검증

- 변경 범위 집중 테스트 `92/92 PASS`
- 전체 순차 Node 회귀 테스트 `316/316 PASS`
- `npm run lint` PASS
- `npm run build` PASS, 72 modules
- `git diff --check` PASS

## 검증 경계

이번 PASS는 실제 로컬 CLI·파일·해시·미디어 decode·Electron UI 연결 증거다. 실제 DST/Flow/Grok/Replicate/ByteDance 생성 제출, 계정·요금제 상태, 생성 품질, Jessie 승인은 포함하지 않는다.
