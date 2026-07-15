# 실행 파라미터 스냅샷과 협업 화면 검증

## 한눈에 보는 결과

- 기획과 스크립트는 각 구역에서 직접 편집·저장하거나 에이전트에게 수정 요청할 수 있다.
- 설계, 이미지 프롬프트, 영상 프롬프트도 직접 수정과 에이전트 요청을 분리해 제공한다.
- 확정된 화면비와 장면별 길이는 실행 인계 v2에 저장되며, 이후 기획이나 설계가 달라지면 기존 실행 준비를 재사용하지 않는다.
- 인물·장소 시트 결과가 연결되기 전에는 이를 참조하는 장면 이미지를 실행 목록에 넣지 않는다.

## 사용자가 보는 작업 순서

1. `기획·대본`에서 직접 작성하거나 `에이전트 작업 시작`으로 수정안을 요청한다.
2. 수정안은 현재 내용과 비교한 뒤 적용·보류하며, 적용 후에도 직접 다시 고칠 수 있다.
3. `설계`에서 인물·장소·장면을 같은 방식으로 직접 수정하거나 에이전트에게 요청한다.
4. `생성 준비`에서 인물·장소 시트를 먼저 확인하고 결과를 연결한다.
5. 필요한 참조 결과가 모두 연결된 장면만 이미지 작업 목록에 나타난다.
6. 승인된 장면 이미지를 기준으로 영상 작업 목록을 준비한다.

## 실행 인계 v2

`film_pipeline.new_project_execution.v2`는 다음 권한 체인을 한 번에 묶는다.

```text
기획 revision + 화면비
  → 설계 revision + 장면별 길이
  → 이미지/영상 계획 revision
  → 실행 준비 revision
  → 실행 run revision
```

각 작업에는 `source_id`와 `duration_seconds`가 포함된다. 이미지 작업의 길이는 `null`, 영상 작업의 길이는 해당 장면의 설계값이다. 외부 실행기용 비공개 인계에는 각 작업의 `aspect_ratio`도 포함한다.

이전 `film_pipeline.new_project_execution.v1` 파일은 바꾸거나 다시 쓰지 않는다. 이력 화면에서는 읽을 수 있지만, 현재 실행 대상으로 다시 선택하지 않는다.

## 실제 확인

- Electron 화면: 기획·스크립트 각각 `직접 저장`과 `에이전트 작업 시작` 노출
- 설계 화면: 직접 저장과 에이전트 전체 설계 요청 노출
- 생성 준비 화면: 기술 배지 대신 `대기 · 진행 · 결과 · 문제`와 다음 할 일 표시
- 실행 목록 준비 후: `생성은 아직 시작하지 않음` 표시 유지
- CLI 인계: v2, `9:16`, `hero`/`alley`, 이미지 길이 `null`
- 파일 권한: manifest `0600`, run/receipts 디렉터리 `0700`
- 외부 호출, 모델 호출, 이미지·영상 생성: 모두 0회

검증 산출물:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-snapshot-e2e/planning-collaboration.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-snapshot-e2e/execution-staged.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-snapshot-e2e/result.json`

## 현재 경계

이번 단계는 실행에 필요한 정확한 입력과 순서를 고정하고 UI에서 준비 상태를 확인한 것이다. 실제 DST·Flow·Grok·Replicate·ByteDance 생성 호출은 실행하지 않았으며, provider별 라이브 제출 연결은 별도 후속 단계다.
