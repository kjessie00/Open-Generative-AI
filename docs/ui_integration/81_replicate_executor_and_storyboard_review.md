# Replicate 실행기와 스토리보드 연결 최종 검토

검토일: 2026-07-17 KST

## 결론

기존 12개 작업 화면의 로컬 연속성은 유지됐고, Replicate 영상 작업은 `요청 준비 → 제출 상태 저장 → 조회 → 다운로드 → 결과 연결 → 스토리보드 검토`까지 main-owned 실행기로 이어졌다. 실제 Electron에서 이미지 3/3과 영상 1/1이 같은 프로젝트에 연결됐고, 인물·장소 기준과 장면 이미지·영상을 한 화면에서 확인한 뒤 영상이 1.002666초까지 재생되는 것을 확인했다. 앱을 종료하고 다시 실행한 뒤에도 연결 상태와 재생이 복원됐다.

이 PASS는 **로컬 UI·실행 계약·중단 복원 PASS**다. 실제 Replicate 인증 API나 과금 생성은 프로젝트 규칙에 따라 호출하지 않았고, 창작 품질과 Jessie의 최종 사용 승인은 별도다.

## 구현한 실행 흐름

- renderer에는 실행 IPC를 추가하지 않았다. 실행은 Electron main-owned CLI의 명시적 `--confirm-live` 경로에만 있다.
- 비동기 POST 응답의 prediction ID를 `0600` private sidecar에 먼저 저장한 뒤 같은 ID만 조회한다.
- provider가 명시적으로 `failed`, `canceled`, `aborted`를 반환한 경우만 새 시도를 열 수 있다. 4xx·5xx·timeout·잘못된 JSON처럼 기존 prediction의 상태가 불명확한 오류는 running을 유지하고 새 POST를 막는다.
- provider `succeeded` 사실과 완료 시각을 다운로드 전에 private completion record로 fsync한다. 다운로드나 canonical 결과 게시 뒤 중단돼도 provider 재조회 없이 완료 영수증을 복원할 수 있다.
- 실행 잠금 본문은 생성 후 바꾸지 않는다. heartbeat는 같은 inode의 mtime만 갱신해 살아 있는 실행과 partial을 보호하고, dead/expired 실행만 회수한다.
- 다운로드 결과는 같은 디렉터리의 private 임시 파일에서 hard-link no-replace로 확정한다. 경합 중 생긴 기존 대상은 덮어쓰지 않는다.
- 재시도 subset은 원래 장면 sequence를 보존한다. renderer의 pathless 상태가 장면 3 결과를 장면 1에 잘못 표시하지 않는다.
- UI에는 `시작 전`, `진행 중`, `결과 도착`, `문제 발생`, `연결 준비됨`, `확인 필요` 같은 짧은 한글 상태만 표시한다. API 토큰, URL, prediction ID, 절대 경로는 노출하지 않는다.

## 실제 검증

최종 증거 루트:

`/Users/jessiek/.codex/visualizations/2026/07/17/replicate-executor-final3-20260717T043943KST`

- 실제 로컬 HTTP: POST 1회, poll 2회, download 1회, `succeeded`
- 외부 네트워크: 사용하지 않음
- 실제 ffmpeg/ffprobe: H.264 + AAC, 360×640, 1.022초 MP4
- private 권한: user-data/result root `0700`, output/sidecar/receipt `0600`
- main/renderer public state: pathless, 민감값 노출 없음
- 실제 Electron:
  - 이미지 결과 3/3 연결
  - 영상 결과 1/1 연결
  - 스토리보드에 인물 시트, 장소 시트, 장면 이미지, 장면 영상 표시
  - 장면 영상 0→1.002666초 재생
  - 앱 재실행 뒤 연결과 재생 복원

화면 증거:

`/Users/jessiek/.codex/visualizations/2026/07/17/replicate-executor-final3-20260717T043943KST/storyboard-video-played.jpeg`

자동 검증:

- 전체 Node: `398/398 PASS`
- Replicate 실행기 집중: `32/32 PASS`
- renderer 계약: `65/65 PASS`
- `npm run lint`: PASS
- `npm run build`: PASS, 78 modules
- `git diff --check`: PASS
- 요청 미리보기 실제 스크립트: PASS, 외부 호출 0
- 독립 최종 코드 검토: P0/P1/P2 없음

## 현재 제품 경계

| 범위 | 판정 | 의미 |
|---|---|---|
| 로컬 작업대 12개 화면 | PASS | 기획부터 최종 로컬 검토까지 화면과 저장 상태가 이어짐 |
| 생성 결과 표시·선택·재제작 UI | PASS | 이미지와 영상을 장면 순서대로 보고 필요한 결과만 다시 만들 수 있음 |
| Replicate main-owned 실행기 | LOCAL PASS | 실제 로컬 HTTP·MP4·중단 복원 검증 완료, 라이브 인증 호출은 미실행 |
| DST 이미지 생성 | PARTIAL | 완료 묶음 연결은 가능, live submit은 미연결 |
| Flow·Grok 영상 생성 | PARTIAL | 미리보기·완료 결과 연결은 가능, live submit은 미연결 |
| ByteDance 직접 API | PARTIAL | receipt 연결 계약만 있고 직접 생성 adapter는 없음 |
| 생성물 창작 품질 | 미검토 | 이번 증거 영상은 기술 검증용 MOCK 결과 |
| Jessie 최종 승인 | 대기 | 실제 제작 결과가 들어온 뒤 `사용` 또는 `다시 만들기` 선택 필요 |

따라서 **UI 전체 흐름과 로컬 최종 검토는 PASS**, **실제 외부 provider 전체 생성 파이프라인은 PARTIAL**이다.
