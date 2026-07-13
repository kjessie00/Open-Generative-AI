# 로컬 미디어 미리보기 하드닝

기준일: 2026-07-13 (Asia/Seoul)

최종 통합자: `/root/media_preview_contract_integrator`

실행 기준 commit: `6e6170ee2ef52fb9039643ab4f38190f1bdd8919`

## 결론

한국어 GUI 회차에서 기록된 `net::ERR_FILE_NOT_FOUND` 2건의 정확 URL은 남아
있지 않다. 따라서 이번 수정은 과거 오류의 원인을 runtime으로 입증했다고
주장하지 않는다. 다만 mock의 동일한 상대 PNG 경로가 샷 기록 그리드와 최종
보고서에서 각각 직접 `img[src]`로 렌더되던 코드는 확인했다. 두 자동 로드가
과거 오류 수와 정확히 일치하므로 가장 강한 코드 수준 가설로 분류한다.

공통 deny-by-default 판정을 추가해 상대 artifact 경로와 HTTP(S) 경로는
브라우저 resource node로 만들지 않는다. 경로와 상태 메타데이터는 화면에
그대로 남고 한국어 `미리보기 불가` 상태를 함께 표시한다. 명시적인 macOS
absolute path, local-host 없는 `file:`, 미디어 MIME의 `data:`, 현재 renderer가
보유한 `blob:` source는 기존 미리보기 기능을 유지한다.

## 판정 계약

| 입력 | 자동 `img`/`video` source | 화면 경로 | 결과 |
| --- | --- | --- | --- |
| `production/.../first_frame.png` | 생성하지 않음 | 유지 | metadata-only |
| `https://...` 또는 `file://remote-host/...` | 생성하지 않음 | 유지 | deny |
| `/private/tmp/fixture.png` | 유지 | 유지 | local preview |
| `file:///private/tmp/fixture.png` | 유지 | 유지 | local preview |
| `data:image/...`, `data:video/...` | media kind 일치 시 유지 | 유지 | in-memory preview |
| `blob:...` | 유지 | 유지 | in-memory preview |

상대 경로를 absolute path로 자동 결합하거나 파일을 읽는 로직은 renderer에
추가하지 않았다. 이 동작은 향후 최소권한 IPC 또는 scoped custom protocol을
별도로 설계하기 전까지 metadata-only다.

## 수정 내용

1. `src/lib/pipeline/mediaSources.js`
   - 두 렌더 표면이 공유하는 `localMediaSource()`를 추가했다.
   - 상대 경로, HTTP(S), protocol-relative source, remote-host `file:`과 잘못된
     data MIME을 기본 차단한다.
2. `GenerationHistoryGrid`
   - 카드 thumbnail과 fullscreen image/video가 같은 source 판정을 사용한다.
   - 차단된 source는 자동 fetch 대신 한국어 fallback과 원래 경로를 표시한다.
3. `FinalReportPanel`
   - 첫 프레임 셀도 동일한 판정을 사용하고 상대 경로를 계속 표시한다.
4. `PipelineStudio` deterministic DOM 계약
   - mobile select를 `storyboard`로 바꾸고 `change`를 dispatch하면 패널 제목과
     재렌더된 select 값이 모두 `스토리보드`/`storyboard`로 전환됨을 고정했다.

## DOM 회귀 증거

`tests/rendererContract.test.mjs`는 source text 검색이 아니라 실제 vanilla DOM
component를 생성해 다음을 검사한다.

- mock 상대 PNG: history/final 양쪽에서 `img` 0개, 경로와 fallback 표시
- 상대 MP4 fullscreen: `video` 0개, 경로와 fallback 표시
- HTTPS PNG: history/final 양쪽에서 `img` 0개, 경로 표시
- absolute/file/data/blob image: history의 실제 `img[src]`에 원본 source 유지
- absolute MP4 fullscreen: 실제 `video[src]` 유지
- mobile select change: 실제 `PipelineStudio` heading과 select 값 전환

## 검증

모든 자동 검증은 macOS `sandbox-exec`의 `(deny network*)` 아래 실행했다.
Electron, 브라우저, native folder chooser는 실행하지 않았다.

| 명령 | 결과 |
| --- | --- |
| `node --test tests/rendererContract.test.mjs` | PASS, 5/5 |
| `node --test` | PASS, 83/83 |
| `npm run lint` | PASS |
| `npm run build` | PASS, Vite 41 modules |
| `git diff --check` | PASS |
| `test ! -e release` | PASS |

기존 `MODULE_TYPELESS_PACKAGE_JSON` 문구는 테스트 실패가 아닌 Node warning이며
이번 범위에서 package module type은 변경하지 않았다.

## 증거 강도와 잔여 gap

- 상대 source 자동 로드 코드 결함: 코드와 DOM 테스트로 **수정·회귀 고정됨**
- 과거 오류 2건이 정확히 이 source였는지: URL 부재로 **강한 추론**
- 수정 후 실제 Electron console-clean: 새 GUI 실행을 하지 않아 **미검증**
- mobile select DOM change 계약: **PASS**
- 실제 macOS 키보드만으로 select를 변경한 저장 증거: **미검증**

따라서 `LOCAL_FILE_LOG_URL_GAP`과 실제 키보드 증거 gap을 과거 회차에서
소급해 PASS로 바꾸지 않는다. 이번 결과는 다음 승인된 Electron 회차에서
확인해야 할 실패 surface를 제거하고 deterministic AC5 회귀를 강화한 것이다.

외부 네트워크, production folder probe, generation/upload/submit, 외부 계정,
패키지 설치·갱신, release/deploy/push는 실행하지 않았다.
