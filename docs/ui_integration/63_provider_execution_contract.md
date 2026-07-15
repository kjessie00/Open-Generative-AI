# 프로바이더 실행 계약 v1

> 현재 상태: DST 장면 참조 staging은 다음 단계에서 완료되었다. 최신 계약과 실제 검증은 `64_typed_reference_staging.md`를 기준으로 한다.

## 한 줄 결론

인물·장소 시트는 실제 DST CLI 형식과 일치하는 비공개 명령 미리보기까지 준비되었다. 작업대에는 명령·경로·프로바이더 배지 대신 `내용 확인 가능`과 쉬운 다음 행동만 보이며, 생성·복사·제출은 시작되지 않는다.

## 사용자가 보는 흐름

1. `기획·대본`과 `설계`에서 직접 수정하거나 에이전트 수정안을 요청한다.
2. `생성 준비 → 작업 진행`에서 인물 시트와 장소 시트 순서를 확인한다.
3. 각 항목의 `실행 전 확인`을 펼쳐 다음 행동과 예상 결과만 확인한다.
4. `이미지 작업 열기`에서 프롬프트를 직접 수정하거나 에이전트에게 요청한다.
5. 완성된 로컬 결과가 생긴 뒤에만 결과를 연결하고 장면 이미지 단계로 넘어간다.

화면에는 다음만 표시한다.

- `내용 확인 가능 · 작업 내용이 준비되었습니다.`
- `다음 행동: 이미지 작업에서 프롬프트를 확인하세요.`
- `예상 결과: 이미지 1장`
- `이 내용을 펼쳐도 실행은 시작되지 않습니다.`

프로바이더 이름, 절대경로, 명령 인자, 프롬프트 원문, task token, hash, 영어 차단 코드는 renderer로 전달하지 않는다.

## 비공개 실행 인계

`film_pipeline.new_project_execution_handoff.v3`는 각 작업에 `film_pipeline.provider_execution_preview.v1`을 포함한다. 명령은 shell 문자열이 아니라 `{command, args, cwd}`로 고정하고 다음 안전값을 항상 유지한다.

```json
{
  "shell": false,
  "preview_only": true,
  "live_submit_allowed": false,
  "copy_allowed": false
}
```

DST 인물·장소 시트의 실제 형식은 다음과 같다.

```text
python -m dst image <prompt>
  -p goldpure369
  --count 1
  --set-count 1
  --aspect <9:16|16:9>
```

이 구조는 실행용이 아니라 main/CLI 전용 정확성 검토 자료다. renderer에는 새 실행·복사 IPC를 추가하지 않았다.

## 현재 정확한 차단 상태

| 작업 | 내부 판정 | 이유 |
| --- | --- | --- |
| DST 인물·장소 시트 | 명령 미리보기 준비 | 참조 파일이 필요하지 않음 |
| DST 장면 이미지 | 참조 staging 필요 | 연결 결과는 현재 확장자 없는 private 파일 |
| Flow 영상 | 현재 계약 불일치 | 기본 작업은 참조 1장이지만 Flow는 0장 또는 정확히 2장 |
| Grok 영상 | 현재 계약 불일치 | 기본 5초지만 CLI는 6·10·15초만 허용 |
| Replicate | 생성 어댑터 없음 | 완료 결과 receipt 수신만 구현됨 |
| ByteDance | 생성 어댑터 없음 | 완료 결과 receipt 수신만 구현됨 |

참조를 버리거나 같은 이미지를 두 번 넣거나 5초를 임의로 6초로 바꾸지 않는다.

## 실제 검증

격리 `userData`로 실제 로컬 파일·CLI·Electron을 검증했다.

- CLI handoff: v3
- DST sheet preview: 2개 모두 `preview_ready`
- 명령 인자: `goldpure369`, `--count 1`, `--set-count 1`, `--aspect 9:16` 확인
- private manifest: `0600`
- private run/receipt 디렉터리: `0700`
- receipt: 0개
- live submit 허용: 0개
- 명령 복사 허용: 0개
- 외부 호출·모델 호출·생성 실행: 모두 0회

Computer Use로 실제 macOS Electron 창을 열어 두 작업 모두 `내용 확인 가능`을 표시하고, 펼친 안내에 쉬운 다음 행동과 예상 결과가 나오는 것을 확인했다. 작업 영역 접근성 문자열에는 DST·Flow·Grok·Replicate·ByteDance 이름과 내부 token/hash가 0건이었다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/provider-contract-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/provider-contract-e2e/computer-use-result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/provider-contract-e2e/workbench.png`

## 다음 구현 단위

다음은 private result token을 MIME 검증된 `0600` 임시 이미지로 staging하는 main 전용 resolver다. 이 단계가 완료되어야 DST 장면 이미지와 참조 기반 영상 작업을 정확한 입력 파일에 묶을 수 있다. 실제 생성과 사람의 결과 품질 승인은 계속 별도 단계다.
