# Replicate·ByteDance 완료 영상 가져오기 체크포인트

## 목표

Flow·Grok과 같은 스토리보드 검토 흐름에서 Replicate 결과를 선택·미리보기·연결하고, 직접 ByteDance API 결과가 없는 상태는 억지로 준비 완료로 표시하지 않는다.

## 실제 결과 조사

Replicate 경로로 생성된 역사 Seedance 원본 3개를 확인했다.

| 결과 | 크기 | 실제 영상 검사 | SHA-256 |
| --- | ---: | --- | --- |
| `seedance_1` | 6,349,367 B | H.264, 1088×1920, 24fps, 5.041667초 | `a685206f1e318fe12611c210ff411b3160b02608cf967c81233ba1e81db451ee` |
| `seedance_2` | 6,267,600 B | H.264, 1088×1920, 24fps, 5.041667초 | `300693afb1854374e28476afd8254763b28076e779b41487cd60da52f7f97c36` |
| `seedance_3` | 5,747,714 B | H.264, 1088×1920, 24fps, 5.041667초 | `4324cf0208e44ddfb235ed24c2087efaf0363c04e9527899c21f4b50cbbce9df` |

생성 스크립트는 Replicate client로 `bytedance/seedance-1-pro` 모델을 호출하며, 같은 실행 폴더의 `run_status.md`도 Replicate Seedance fallback이라고 기록한다. 다만 prediction ID·API 응답 영수증·비용 manifest는 없다.

직접 ByteDance API 결과나 영수증은 발견되지 않았다. Dreamina의 Seedance 결과와 Replicate가 호출한 ByteDance 모델을 direct ByteDance API 결과로 재분류하지 않는다.

## 가져오기 계약

- 고정된 역사 Replicate 원본 폴더만 읽는다.
- 파일명은 정확히 `seedance_1.mp4`부터 `seedance_3.mp4`까지만 허용한다.
- 세 실제 SHA-256 허용목록과 일치해야 한다.
- `run_status.md`의 고정 출처 문구, 크기, regular-file 상태와 읽기 전후 snapshot을 확인하고 후보 토큰과 계획 증거에 결합한다.
- overlay·final·추가 번호·다른 해시·symlink·계획 뒤 원본/출처 변경은 차단한다.
- renderer에는 불투명 후보 토큰과 크기·길이·해상도만 제공하며 절대 경로·파일명·SHA는 제공하지 않는다.
- 저장된 `replicate` 영상 재작업 항목과 공급자가 정확히 일치할 때만 content-addressed 복사와 원장 append가 가능하다.
- 원장에는 `source_provenance: historical_replicate_seedance_allowlist_v1`을 기록하고 품질 상태는 `unreviewed`로 둔다.

## UI

- 기존 `완료 영상 가져오기` 영역을 그대로 사용한다.
- 공급자 이름으로 `Replicate`, `ByteDance`만 추가했다.
- 새 뱃지는 추가하지 않았다.
- Replicate 재작업 항목을 고르면 실제 원본 3개가 표시된다.
- ByteDance 재작업 항목을 고르면 `이 도구의 완료 영상 없음`을 표시한다.

## 검증

- 실제 기본 결과 목록: Flow·Grok·Replicate 후보 PASS, Replicate 3개, ByteDance 0개
- 공개 목록의 절대 경로·SHA·`.mp4` 노출: 0건
- 집중 importer/UI/IPC 회귀: 58/58 PASS
- 전체 Node 테스트: 206/206 PASS
- `npm run lint`: PASS
- `npm run build`: PASS, 59 modules
- `git diff --check`: PASS

## 실제 Electron E2E

- 실제 ByteDance 재작업 항목을 선택했을 때 `이 도구의 완료 영상 없음`이 표시됐다.
- 실제 Replicate `seedance_1`을 선택해 Blob 미리보기, 가져오기 계획, 장면 연결을 완료했다.
- 미리보기와 연결된 장면 영상은 `readyState 4`, 5.041667초, 1088×1920로 재생 가능했다.
- 원장은 2행에서 3행으로 늘었고 `replicate · 시도 2`, `generation_status: imported`, `review_status: unreviewed`가 기록됐다.
- production 내부 CAS 파일은 6,349,367바이트, mode `0600`, SHA-256이 실제 원본과 일치했다.
- 가져온 영상을 다시 만들기 대상으로 선택하고 검토 초안을 저장해 순서 3개가 복원됐다.
- Electron을 완전히 종료하고 같은 userData로 재실행한 뒤 영상 카드, 선택 해제 버튼, 저장 순서, 재생 가능 상태가 모두 복원됐다.
- clean 재실행 기준 renderer console·exception·외부 요청은 모두 0개였다.
- 320px, 768px, 1024px, 1440px에서 가로 넘침과 잘린 조작부는 0개였다.
- 조작은 실제 renderer→preload→main IPC를 통과한 CDP visible-DOM 이벤트이며 `isTrusted:false`였다.
- Chromium stderr에는 영상 디코딩 진단 `Unsupported pixel format: -1`이 남아 strict whole-process stderr-clean은 BLOCK이다. 실제 재생·연결·복원 기능은 PASS다.
- macOS seatbelt와 Chromium sandbox 중첩은 `sandbox initialization failed: Operation not permitted`라, 이 E2E에서는 loopback-only seatbelt를 유지하고 Electron을 `--no-sandbox`로 실행했다. 이는 제품 기본 실행 설정을 바꾼 것이 아니라 시험 하네스 caveat다.
- 캡처: `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-replicate-video-import-e2e/replicate-restored-selected-storyboard-1440.png`

## 상태 구분

- 역사 Replicate 결과 탐색·실제 ffprobe·임시 production 가져오기: PASS
- 새 Replicate API 생성 실행: 실행하지 않음
- producer-authored prediction receipt: 없음
- 직접 ByteDance API 결과 탐색·가져오기: BLOCK, 실제 결과 증거 없음
- 가져온 영상의 화질·연출 품질: 미검토
- Jessie 최종 승인: 아직 없음
