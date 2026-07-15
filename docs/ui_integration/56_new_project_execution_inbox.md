# 새 프로젝트 작업 진행 화면

## 결론

`3 생성 준비 → 작업 진행`에서 이미지와 영상 준비 항목을 한 화면에 순서대로 확인한다. 화면에는 `대기 · 진행 · 결과 · 문제`, 다음 할 일, 쉬운 한글 상태, 진행률, 해당 작업 열기만 보인다. 내부 토큰·경로·해시·영문 차단 코드·제출 ID·백엔드 증거·배지는 표시하지 않는다.

이 화면은 생성을 실행하지 않는다. 별도 실행기가 private handoff를 읽고 로컬 receipt를 남기면 Electron main이 이를 다시 검증한 뒤 renderer에 경로 없는 짧은 상태만 전달한다.

## 사용 흐름

1. `이미지 작업`에서 인물 → 장소 → 장면 순서와 프롬프트를 저장하고 `DST 작업 준비`를 누른다.
2. 외부 실행기는 `scripts/new-project-execution-handoff.cjs inspect`로 현재 private handoff를 읽는다.
3. 실행기는 각 항목을 순서대로 처리하며 `publish`로 진행 또는 결과 receipt를 남긴다.
4. 사용자는 `작업 진행`에서 새로고침해 상태를 확인한다.
5. `이미지 작업 열기` 또는 `영상 작업 열기`를 누르면 해당 순번 카드로 이동해 프롬프트를 직접 고치거나 도착 결과를 연결한다.
6. 연결 결과를 전체 검토하고 필요한 항목만 다시 만들기로 선택한다.

## 실행 기록 계약

- 이미지와 영상 run은 lane별로 분리한다. 이미지 계획 revision이 바뀌고 영상 준비가 시작돼도 완료된 이미지 이력을 보존한다.
- 같은 lane은 가장 앞의 미완료 항목 하나만 `진행 중`이 될 수 있다.
- 첫 receipt는 `진행 중`이어야 하며 진행률과 보고 시각은 역행할 수 없다.
- `진행 중 → 결과 도착 | 실패`만 허용하고 terminal receipt는 같은 attempt에서 바꿀 수 없다.
- 부분 완료와 남은 대기는 전체 `진행 중`으로 표시한다.
- 실패 항목만 있는 lane은 명시적 새 attempt를 만들 수 있다. 성공과 실패가 섞인 run은 성공 항목까지 재실행하지 않고, 도착 결과를 연결한 뒤 새 preparation을 요구한다.
- private 디렉터리는 `0700`, manifest·receipt·CLI 입력은 `0600`이며 symlink, 변경 중 파일, 형식 불일치, 동시 writer lock은 fail-closed다.
- renderer에는 `getNewProjectExecutionState()` 읽기만 노출한다. handoff inspect와 receipt publish는 preload/IPC에 노출하지 않는다.

## 실제 Electron 검증

격리된 `userData`에서 실제 CLI와 private 파일 I/O로 이미지 receipt 5개와 영상 receipt 3개를 순차 기록했다. receipt는 로컬 fixture이며 실제 DST·Flow·Grok·API 생성은 실행하지 않았다.

- 첫 실행: `대기 1 · 진행 1 · 결과 6 · 문제 0`
- 이미지 5행, 영상 3행, 진행률 48% 표시
- 내부 token/hash/path/blocker 노출 0, 상태 배지 0
- 영상 2번 `작업 열기` → 정확한 영상 2번 카드 focus PASS
- Electron 완전 종료·재실행 후 같은 합계·8행·48% 복원 PASS
- 이미지 plan revision 변경과 영상 lane 추가 뒤 이미지 완료 이력 보존 PASS
- 320/768/1024/1440: 가로 넘침 0, 잘린 조작부 0, 최소 조작 높이 44px
- 콘솔 오류·경고 0, 외부 HTTP(S) 요청 0
- 외부 호출·모델 호출·생성 실행·production write·API key·upload 0

기능 증거는 `/Users/jessiek/.codex/visualizations/2026/07/16/open-ga-execution-inbox-e2e/result.json`, 화면 증거는 같은 폴더의 `execution-inbox-1440.png`다.

## 자동 검증

- 실행 provider 집중 테스트: `5/5 PASS` (`4 MOCK` 계약 검증 + `1 actual local CLI/file I/O`)
- UI·정적·보안 집중 테스트: `51/51 PASS` (`38 + 8 + 5`)
- 전체 순차 Node 회귀: `314/314 PASS`
- `npm run lint`: PASS
- `npm run build`: PASS, 72 modules
- `git diff --check`: PASS

## 현재 경계와 다음 연결

현재 앱은 실제 실행기가 남긴 진행·결과 receipt를 한눈에 보여 주고 해당 이미지·영상 작업대로 이동시킬 수 있다. 실제 DST/Flow/Grok/Replicate/ByteDance 실행기 호출, 결과 locator를 각 provider 결과 inbox로 자동 연결하는 adapter, 산출물 품질, Jessie 최종 승인은 아직 별도다.
