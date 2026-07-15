# Grok 영상 작업 미리보기

## 결론

현재 작업대의 장면 영상은 참조 이미지 1장을 사용한다. 이 구성은 Flow의 실제 CLI 계약(참조 0장 또는 정확히 2장)과 맞지 않으므로 Flow 명령을 추측해 만들지 않는다. Grok은 참조 1장과 6·10·15초를 지원하므로, Electron main이 실제 `i2v` 명령과 전용 출력 위치를 비공개로 준비한다.

이 단계는 생성 실행이 아니다. Grok 도구에는 안전한 `dry-run`/`no-submit` 모드가 없고 계정 순환을 끌 수도 없으며 `i2v` 화면 비율도 명령으로 고정할 수 없다. 따라서 준비된 명령은 `preview_only: true`, `live_submit_allowed: false`, `copy_allowed: false`로 유지한다.

## 사용자 화면

- `1 기획·대본`: 브리프와 스크립트를 직접 수정·저장하거나, 각 입력란에서 에이전트에게 수정 요청을 남길 수 있다.
- `2 설계`: 인물·장소·장면을 한 화면에서 직접 수정하거나 전체 설계를 에이전트에게 요청할 수 있다.
- `3 생성 준비 → 영상 작업`: 생성 도구와 프롬프트를 직접 바꾸고, Grok의 지원 길이를 짧은 한글 안내로 확인한다.
- `3 생성 준비 → 작업 진행`: `실행 목록 준비` 뒤 기존 `실행 전 확인`을 펼치면 확인할 내용, 다음 행동, 예상 결과만 보인다.

경로, 토큰, 해시, 명령, 내부 차단 코드와 계정 정보는 renderer로 보내지 않는다. 상태 배지를 추가하지 않고 기존 카드·상세 확인 구조만 사용한다.

## 비공개 실행 계약

- 실제 런타임: `/Users/jessiek/.pyenv/versions/3.11.7/bin/python3`의 realpath
- 실제 CLI: `/Users/jessiek/StudioProjects/grok-auto/grok-browser/grok_imagine_bot.py`
- 참조 1장: `i2v --image <staged-reference> --prompt <prompt> --duration <6|10|15> --output <absent-target> --timeout 180`
- 참조 0장: `video` 계약을 별도로 구성하되 지원 비율만 허용한다.
- 출력: 각 video run의 mode-0700 `outputs/` 아래 `<task_token>.mp4`; 준비 시 대상 파일이 이미 있으면 실패한다.
- `--submit`, Grok `i2v`의 미지원 `--ratio`·`--quality`는 넣지 않는다.

## 실제 검증

2026-07-16 실제 macOS Electron에서 Computer Use로 다음을 확인했다.

1. `기획·대본`의 직접 저장과 에이전트 요청 입력/버튼이 함께 보인다.
2. `영상 작업`에서 Grok과 `6초, 10초 또는 15초` 안내가 보인다.
3. `작업 진행 → 실행 목록 준비`를 눌러도 생성은 시작되지 않는다.
4. `실행 전 확인`에는 `확인 필요`, 프롬프트·길이 확인, 예상 영상 1개만 보인다.
5. renderer 화면에 비공개 경로·토큰·명령·내부 차단 코드는 없다.

실제 로컬 handoff CLI도 같은 userData를 다시 읽어 참조 1장, 정확한 Grok argv, mode-0700 출력 폴더, 미존재 출력 대상, 반복 inspect 안정성, receipt 0, 외부 호출 0, 모델 호출 0, 생성 0을 확인했다. 안전한 실제 CLI 확인은 `i2v --help`까지만 실행했다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/grok-video-preview-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/grok-video-preview-e2e/computer-use-result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/grok-video-preview-e2e/desktop-work-progress.jpeg`

기술 연결 PASS는 실제 영상 생성, 생성 결과 품질, Jessie의 최종 승인과 별개다.
