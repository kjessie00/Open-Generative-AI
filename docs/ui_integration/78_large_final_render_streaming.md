# 32 MiB 초과 최종 검토 영상 스트리밍

## 목적

`32 MiB`를 넘는 새 프로젝트 검토용 합본도 private 경로·해시·token을 renderer에 노출하지 않고 실제 Electron 작업대에서 재생·탐색할 수 있게 한다. 작은 영상의 기존 inline Blob 경로는 그대로 두고, 큰 영상만 main-owned 일회성 capability와 Electron custom protocol을 사용한다.

## 구현 계약

- 큰 영상의 renderer URL은 정확히 `film-preview://final-render/<64자리 capability>/video.mp4` 형식이다. capability 생성, private 파일 선택, 열기와 수명 관리는 Electron main만 소유한다.
- protocol은 `GET`과 `HEAD`만 받고 닫힌 범위·열린 범위·suffix를 포함한 단일 `Range`만 허용한다. 정상 전체 응답은 `200`, 부분 응답은 `206`, 만족할 수 없는 범위는 `416`, 허용하지 않는 method는 `405`, 동시 stream 상한 초과는 `429`로 닫힌다.
- 파일은 `O_NOFOLLOW`로 연 file descriptor에 고정하고 같은 검증에서 얻은 `dev`, `ino`, mode, size, mtime, ctime identity를 대조한다. 교체, symlink 또는 요청 전 identity drift는 fail closed한다.
- main이 부여한 issuance generation은 늦게 끝난 이전 검사 결과가 더 최신 capability를 교체하거나 폐기하지 못하게 한다. capability TTL은 `60분`, 전역 열린 descriptor 상한은 `8`, token당 동시 stream 상한은 `4`다.
- reload, renderer 종료, render-process-gone과 app dispose 때 owner capability와 descriptor를 정리한다. positional read의 non-owning `Readable`은 취소 시 공유 descriptor를 직접 닫지 않아 다른 활성 range를 끊지 않는다.
- `32 MiB` 이하 영상은 기존 pathless inline base64 → Blob 경로를 그대로 사용하고 streaming capability를 발급하지 않는다.
- 새 preload/client IPC는 추가하지 않는다. 기존 final-render 상태/preview 응답만 stream descriptor를 운반하며, CSP는 `media-src`에만 `film-preview:`를 추가하고 `connect-src 'none'`을 유지한다.

## 자동·독립 검증

- 변경 집중 테스트: `78/78 PASS`
- actual ffmpeg 제외 전체 Node 회귀: `390/390 PASS`
- 실제 ffmpeg 검증: `2/2 PASS`
- lint: PASS
- Vite build: PASS, `77 modules`
- `git diff --check`: PASS
- 수정 뒤 최종 독립 판정: P0/P1/P2 없음

반례에는 단일 Range 파싱과 `200/206/416/405/429`, identity drift·symlink 차단, descriptor·stream 수명 정리, 같은 token의 동시 stream 상한, issuance generation 역전, 작은 영상 inline 유지, 새 renderer path IPC 부재와 CSP 비확장이 포함된다.

## 실제 Electron 검증

- 실제 프레임으로 인코딩한 `46,454,799 bytes` MP4를 사용했다. padding 없이 H.264 Constrained Baseline, yuv420p, 1920×1080, AAC-LC, `0.625초`다.
- 최종 protocol 수정 뒤 숨김 Electron 검증에서 metadata `readyState 4`, `duration 0.625`, seek event `current_time 0.300377`, playing `0.300427`, final `current_time 0.610012`, errors `0`을 확인했다. 실제 `Range 206`은 `bytes=0-` 2건과 `bytes=38830080-` 1건으로 총 3건이었다.
- Computer Use로 실제 macOS Electron의 최종 탭, native video frame과 재생을 확인하고 `다시 만들기` 저장과 `결과 검토 열기` 동선을 실행했다.
- 최종 코드 진단 증거: `/Users/jessiek/.codex/visualizations/2026/07/17/large-final-preview-fixture-20260717T001824KST/electron-custom-protocol-playback.json`
- 화면 증거: `/Users/jessiek/.codex/visualizations/2026/07/17/large-final-preview-fixture-20260717T001824KST/cua-large-final-preview-retry.jpeg`
- 비교 기준선: `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/final-review-decision/07-responsive-native-zoom.png`

## 화면 충실도 장부

기준선과 큰 영상 최종 화면을 같은 1228×768 데스크톱 조건에서 비교했다.

1. `1 기획·대본`부터 `5 마무리`까지 5단계 rail과 활성 단계 계층을 유지했다.
2. 검토용 최종 영상, 검은 media frame과 native 재생 컨트롤을 유지했다.
3. 결정 상태 문구, `이 영상 사용`, `다시 만들기`, `결과 검토 열기` 행동을 유지했다.
4. 영상과 결정 영역의 2열 구성과 첫 화면 핵심 조작 위치를 유지했다.
5. badge, private path, capability token과 hash를 화면에 추가하지 않았다.
6. above-fold 문구와 layout은 바뀌지 않았다. 보이는 frame, 내용과 project id의 차이는 큰 영상 fixture 데이터 차이뿐이다.

## 판정과 남은 경계

- 기술 구현과 자동·독립 검증: PASS
- 실제 Electron의 큰 영상 load, Range, seek, play, review 동선: PASS
- 사용한 synthetic noise 영상의 시각 품질: 승인하지 않음
- Jessie의 사람 품질 승인, canonical production 승격, live generation: 주장하지 않음
- API, provider submit, 외부 업로드 등 외부 호출: `0`

남는 기술 경계가 두 가지 있다. 이미 시작된 stream을 비협조 프로세스가 같은 inode에서 제자리 변경하면 각 chunk를 다시 hash하지 않는다. 또한 Electron protocol `Request`의 capability owner는 현재 단일 renderer의 lifecycle scope이며 강한 `webContents` 인증은 아니다. 현재 popup/navigation 차단과 제한된 CSP 경계 안에서 사용하며, 이 제한을 실제 품질 승인이나 canonical 승격과 혼동하지 않는다.
