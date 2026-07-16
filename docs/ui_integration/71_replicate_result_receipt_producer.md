# Replicate 결과 영수증 생산기

## 목적

Replicate 실행기가 다운로드를 끝낸 뒤 전용 출력 위치에 둔 MP4를 현재 작업과 정확히 묶어, 작업대가 자동으로 찾을 수 있는 표준 결과 영수증으로 발행한다. 이번 범위는 로컬 결과 발행과 화면 연결이며 Replicate 제출·다운로드·유료 생성은 포함하지 않는다.

## 입력과 소유권

- 외부 실행기가 넘기는 값은 `film_pipeline.replicate_download_result.v1`의 여섯 필드뿐이다: 스키마, 실행 revision, 작업 token, prediction id, 성공 상태, 완료 시각.
- renderer와 CLI 입력은 원본 경로, URL, 인증 token, 결과 저장소 경로를 지정할 수 없다.
- Electron main이 현재 선택된 Replicate 작업을 다시 읽고, 전용 `outputs/<task_token>.mp4`와 현재 request/claim 결합을 스스로 계산한다.
- source MP4는 일반 파일, `0600`, 512 MiB 이하, 안정된 inode·크기·SHA-256이어야 한다.

## 발행 계약

- 실제 `ffprobe`를 통과한 바이트만 고정 Replicate 영수증 저장소에 복사한다.
- 결과 디렉터리는 `0700`, `result.mp4`와 `receipt.json`은 `0600`이다.
- 영수증은 `film_pipeline.external_video_result.v2`이며 run, task, request revision, output claim SHA-256, prediction id, 결과 SHA-256을 모두 포함한다.
- 쓰기는 전용 lock, 임시 디렉터리, fsync, 원자적 rename으로 처리한다. 같은 입력은 멱등 성공하고, 같은 prediction id의 다른 바이트는 기존 결과를 덮어쓰지 않고 충돌로 중단한다.
- 다운로드된 전용 출력이 존재해도 정확한 현재 claim/request와 안전한 출력 디렉터리를 다시 검증할 때만 실행 준비 상태를 유지한다. 새 실행 점검은 기존 출력이 있으면 계속 fail-closed다.

## 실제 검증

격리된 userData에서 기존 로컬 MP4 6,349,367바이트를 전용 출력에 놓고 `/opt/homebrew/Cellar/ffmpeg/8.0.1_4/bin/ffprobe`로 검증했다.

- 최초 발행과 동일 입력 재발행: PASS
- 원본/복사본 SHA-256과 바이트 일치: PASS
- 정확한 v2 영수증 12개 필드: PASS
- 디렉터리·파일 권한 `0700/0600`: PASS
- 작업 상태 `결과 도착 · 연결 준비됨`: PASS
- 전체 종료·재실행 후 같은 결과 복원: PASS
- 실제 Electron 결과 선택 `이번 결과 · Replicate · 5.0초 · 1088×1920`: PASS
- 실제 영상 프레임 미리보기: PASS
- 외부 호출, 모델 호출, 생성 실행: 모두 0

증거는 `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/replicate-result-receipt-producer/`에 있다. `result.json`, 최초 결과 상태, 실제 미리보기, 재실행 복원 화면을 포함한다.

## 자동 검증

- 집중 테스트: `2/2 PASS`
- 관련 provider 테스트: `39/39 PASS`
- 전체 Node 회귀: `345/345 PASS`
- lint: PASS
- Vite build: PASS, 74 modules
- verifier syntax와 `git diff --check`: PASS

## 남은 범위

이번 PASS는 기존 로컬 MP4를 안전하게 표준 결과로 발행해 UI에 연결하는 기능만 증명한다. 실제 Replicate 인증 제출·상태 조회·다운로드 실행기, 생성 영상의 사람 품질 승인, Jessie 최종 승인은 아직 별도 작업이다.
