# 실행 목록 준비와 이미지→영상 안내

## 한 줄 결론

`작업 진행`에서 이미지부터 영상까지 네 단계를 한눈에 보고, 확인한 프롬프트와 순서를 실제 로컬 실행 인계 목록으로 저장할 수 있다. `실행 목록 준비`는 생성기 호출이나 유료 생성을 시작하지 않는다.

## 사용자 흐름

1. 기획·대본, 인물·장소·장면 설계, 이미지·영상 프롬프트는 직접 수정하거나 항목별로 에이전트에게 수정안을 요청한다.
2. `작업 진행`에서 `이미지 목록 → 이미지 결과 → 영상 목록 → 영상 결과` 순서를 확인한다.
3. 준비된 작업이 있으면 `실행 목록 준비`를 누른다.
4. 화면은 `실행 목록 준비됨 · 생성은 아직 시작하지 않음`으로 바뀐다.
5. 외부 실행기는 private 로컬 인계 파일을 읽고 진행 영수증과 결과 locator를 되돌려준다.
6. 사용자는 도착한 결과를 정확한 이미지·영상 카드에서 미리 보고 연결하거나 `다시 만들기`로 남긴다.

## 화면 원칙

- 새 탭, 모달, 상태 배지를 추가하지 않았다.
- 네 단계는 짧은 한글과 개수만 보여준다.
- 실행 목록을 저장하는 일과 실제 생성 시작을 같은 문장 안에서 분리해 설명한다.
- 경로, task token, run token, revision, locator, 해시를 renderer에 표시하지 않는다.
- 이미지 목록이 없으면 영상 목록은 `이미지 다음`으로 보인다.

## 실행 계약

- renderer는 현재 execution revision 하나만 Electron main에 전달한다.
- renderer는 파일 경로, 명령, provider 인자, 재시도 attempt를 전달할 수 없다.
- Electron main은 `new_attempt: false`를 고정하고 현재 이미지·영상 preparation을 다시 읽는다.
- manifest와 receipt 디렉터리는 `0700`, manifest는 `0600`으로 저장된다.
- 같은 revision의 준비 요청은 새 실행을 만들지 않고 기존 목록을 그대로 복원한다.
- 준비 전후 `external_call_performed`, `model_called`, `generation_executed`는 모두 `false`다.
- 성공 receipt의 결과 locator는 이미지 작업이면 `dst`, 영상 작업이면 해당 task의 `flow|grok|replicate|bytedance`와 정확히 일치해야 한다. 다른 provider 결과는 기록 단계에서 거부한다.

## 실제 검증

격리한 실제 `userData`에 초안, 설계, 이미지 계획 3개를 저장하고 이미지 작업 preparation을 만들었다.

Computer Use로 실제 macOS Electron 창을 열어 다음을 확인했다.

- 준비 전: `이미지 목록 3개 확인됨`, `영상 목록 이미지 다음`, `실행 목록 준비`
- 버튼 실행 후: `이미지 목록 3개 준비됨`
- `실행 목록 준비됨 · 생성은 아직 시작하지 않음`
- `실행 목록을 준비했습니다. 생성은 시작하지 않았습니다.`
- 실행 버튼은 사라지고 새로고침만 남음

그 다음 실제 로컬 CLI `new-project-execution-handoff.cjs inspect`로 같은 인계 목록을 읽었다.

- task 3개, receipt 0개
- manifest `0600`
- run·receipt 디렉터리 `0700`
- 외부 호출 0회, 모델 호출 0회, 생성 실행 0회
- provider 생성 호출 0회

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-handoff-stage-e2e/seed.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-handoff-stage-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/execution-handoff-stage-e2e/ui-staged.jpeg`

자동 검증은 `npm run lint` PASS, Vite build PASS, 전체 Node 회귀 `296/296 PASS`, `git diff --check` PASS다.

## 현재 가능한 파이프라인

| 단계 | 작업대에서 가능 | 아직 별도 |
| --- | --- | --- |
| 기획·대본 | 직접 수정, 에이전트 요청, 수정안 비교·적용·유지 | 없음 |
| 캐릭터·장소·장면 설계 | 직접 수정, 에이전트 요청, 수정안 비교·적용·유지 | 없음 |
| 이미지 | 프롬프트 직접 수정·에이전트 요청, 순서 저장, 결과 연결, 다시 만들기 선택 | DST live 생성 제출 |
| 영상 | 이미지 연결 후 프롬프트 직접 수정·에이전트 요청, provider 선택, 순서 저장, 결과 연결, 다시 만들기 선택 | Flow/Grok/Replicate/ByteDance live 생성 제출 |
| 클립·마무리 | 사용할 구간 선택, 로컬 최종 편집과 보고 | 사람 품질 승인, 외부 업로드 |

실행 목록 준비 PASS, 생성 제출 성공, 결과 도착, 결과 품질 승인, Jessie 최종 승인은 계속 서로 다른 사실이다.
