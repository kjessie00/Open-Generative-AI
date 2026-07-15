# 작업별 실행 전 확인

## 한 줄 결론

`작업 진행`의 이미지·영상 항목에서 현재 실제 실행 가능 여부를 짧은 한글로 확인할 수 있다. 현재 연결된 provider는 앱 소유 live 실행기가 없으므로 모두 `결과만 연결`로 표시하며, 설치된 CLI를 근거로 `실행 가능`이라고 과장하지 않는다.

## 화면

각 작업은 provider 이름과 내부 연결 상태 대신 다음 세 상태 중 하나만 사용한다.

- `실행 가능 · 필요한 자료가 준비되었습니다.`
- `준비 필요 · 먼저 필요한 자료를 확인하세요.`
- `결과만 연결 · 이 작업대에서는 생성을 시작하지 않습니다.`

`실행 전 확인`을 펼치면 다음 정보만 보인다.

- 완료 결과를 다른 곳에서 가져와 연결해야 하는지
- 예상 결과가 이미지 1장인지 영상 1개인지
- 안내를 펼쳐도 생성이 시작되지 않는다는 사실

실행 파일, 명령 인자, 원문 프롬프트, provider 이름, 모델, 경로, token, hash는 표시하지 않는다. 기존의 `결과 확인`, `이미지 작업 열기`, `영상 작업 열기` 행동과 실행 receipt 상태가 계속 우선한다.

## 현재 실제 provider 상태

| 구분 | 현재 확인 | 작업대 표시 | 정확한 다음 연결 조건 |
| --- | --- | --- | --- |
| DST 이미지 | 로컬 CLI 존재, dry-run 없음 | 결과만 연결 | 비율 snapshot과 result handle 계약을 가진 main-owned adapter |
| Flow | no-submit 옵션 존재 | 결과만 연결 | 참조 2장 계약, 비율·runtime snapshot, canonical 결과 staging |
| Grok | i2v CLI 존재, dry-run 없음 | 결과만 연결 | 길이 snapshot과 private reference/output staging |
| Replicate | 완료 결과 receipt intake 존재 | 결과만 연결 | main-owned Predictions adapter |
| ByteDance | 완료 결과 receipt intake 존재 | 결과만 연결 | submit adapter |

Flow 영상 task는 현재 장면 참조 1장을 저장하지만 Flow refs CLI는 정확히 2장을 요구한다. Flow 기본 download 경로와 앱 importer의 canonical 결과 경로도 다르다. Grok은 영상 길이가 필수지만 execution manifest에 길이 snapshot이 없다. DST도 execution manifest에 화면 비율 snapshot이 없다. 따라서 prompt 문자열에서 값을 추측하거나 기술적인 raw 명령을 만들어 보여주지 않는다.

## main projection

Electron main은 각 task에 다음의 축약 정보만 붙인다.

```json
{
  "mode": "result_only",
  "status_label": "결과만 연결",
  "reason": "waiting_for_result",
  "user_status": "다른 곳에서 완성한 결과를 가져와 연결하세요.",
  "output_kind": "image",
  "output_count": 1,
  "preview_only": true
}
```

Renderer는 이 allowlist projection만 한글로 표시한다. 실제 provider·runtime·locator 정보는 기존 main-owned private handoff 안에 남는다.

## 실제 검증

격리한 실제 `userData`에 이미지 작업 3개를 준비하고 Computer Use로 macOS Electron 창을 직접 조작했다.

1. `실행 목록 준비`를 눌러 private handoff를 생성했다.
2. 이미지 작업 3개 모두에서 `결과만 연결 · 이 작업대에서는 생성을 시작하지 않습니다.`를 확인했다.
3. 첫 작업의 `실행 전 확인`을 열었다.
4. `다른 곳에서 완성한 결과를 가져와 연결하세요.`, `예상 결과: 이미지 1장`, `이 내용을 펼쳐도 실행은 시작되지 않습니다.`를 확인했다.
5. 접근성 화면 문자열에서 절대경로, task/result token, 64자리 hash, DST·Flow·Grok·Replicate·ByteDance 이름이 0건임을 확인했다.
6. 실제 로컬 handoff CLI가 같은 private manifest를 읽고 task 3개, receipt 0개, manifest `0600`, 디렉터리 `0700`을 확인했다.

실제 provider 생성·브라우저 제출·API 호출·모델 호출·업로드는 모두 0회다.

자동 검증은 `npm run lint` PASS, Vite build PASS, 전체 Node 회귀 `296/296 PASS`, `git diff --check` PASS다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-preview-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-preview-e2e/computer-use-result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-preview-e2e/execution-preview.jpeg`

## 다음 구현 경계

raw 명령 미리보기나 live executor를 추가하기 전에 execution manifest에 다음 값을 design/draft revision과 함께 snapshot해야 한다.

- 화면 비율
- 장면별 영상 길이
- provider preset/model
- provider-owned 결과 staging 계약

그 다음 main이 private snapshot으로만 exact argv를 구성하고 renderer에는 계속 사람용 상태만 전달한다.
