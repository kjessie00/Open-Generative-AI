# 한국어 UI/UX 실제 Electron 검증

기준일: 2026-07-13 (Asia/Seoul)

최종 통합자: `/root/korean_gui_acceptance_rescue_integrator`

실행 기준 commit: `7c80ef6718d045b36b54a26d27b9921c7f1b43cc`

## 결론

> 후속 상태 (2026-07-13): `docs/ui_integration/28_media_preview_hardening.md`에서
> 상대 artifact 경로를 자동 `img`/`video` source로 만들던 두 렌더 표면을
> 공통 deny-by-default 계약으로 수정했고 deterministic DOM 회귀가 통과했다.
> 이는 과거 2건의 가장 강한 코드 가설을 제거하지만 exact URL과 수정 후 실제
> Electron 재실행이 없으므로 이 문서의 역사적 console-clean BLOCK은 유지한다.
> mobile select DOM change도 PASS했지만 실제 키보드-only runtime 증거와는
> 분리한다.

Jessie가 승인한 외부망 차단 Electron GUI 회차에서 한국어 우선 UI의 11개
작업 단계와 320px, 768px, 1024px, 1440px 레이아웃을 실제 렌더로 확인했다.
모든 메뉴와 패널 제목은 기대한 한국어 계약에 맞았고, 가로 넘침·잘린 조작
요소·교차축 겹침은 없었다. 1024px 이상에서는 네 그룹 사이드바, 그보다 좁은
화면에서는 작업 단계 select가 표시됐다.

첫 실행에서 발견한 중복 named region과 보이지 않는 focus outline을 한 번의
한정 패치로 수정했다. 수정 후 네 viewport의 axe 위반은 모두 0건이고, 실제
Tab 순회의 focus ring은 2px solid로 표시됐다.

이 회차는 전체 `console-clean`을 PASS로 올리지 않는다. CDP
`Runtime.consoleAPICalled` 오류·경고와 예외는 0건이지만 `Log.entryAdded`에
로컬 `file:` 자원 `net::ERR_FILE_NOT_FOUND` 2건이 남았고 저장된 증거에는 exact
URL이 없다. 모바일 select는 실제 초점 진입까지 확인했지만 저장된 최종 값이
`intake`이므로 키보드만으로 선택 변경을 완료했다는 주장도 BLOCK이다.

## 승인과 실행 경계

- 허용: Electron 실행·종료, 격리된 `/private/tmp` userData/cache/config,
  로컬 GUI 자동화·스크린샷, fixture 기반 화면 검증
- 차단: 외부 네트워크, native production folder 선택, generation/upload/submit,
  DeepSearchTeam/Gemini/imagegen, 외부 계정, 패키지 설치·갱신,
  release/deploy/push
- renderer 요청은 18건 모두 `file:`이었고 외부 요청은 0건이었다.
- `previewCommand`, `runSafeCommand`, `writePlanningFile` 호출과 unsafe control
  클릭은 모두 0건이었다.
- 스크린샷에는 추적된 mock fixture만 사용했으며 private production 화면은
  캡처하지 않았다.

## 수정 내용

1. `PipelineStudio`의 scroll host를 이름 없는 `div`로 바꿨다. 실제 named
   section landmark는 안쪽 `panelShell` 하나만 소유하게 하여 axe
   `landmark-unique` 중복을 없앴다.
2. 공통 `focus-visible` outline에 `#22d3ee` fallback을 추가했다. legacy
   variable이 없는 경우에도 focus indicator가 사라지지 않는다.
3. 위 두 계약을 `tests/koreanUiStaticContract.test.mjs`에 고정했다.

## 4개 viewport 결과

| 실제 viewport | 탐색 | 검증 결과 | 상태 |
| --- | --- | --- | --- |
| 320×900 | mobile select | 가로 넘침 0, 잘린 control 0, 상태 4개, safety/production 기본 접힘, 수직 순서·패널 도달 가능 | PASS |
| 768×900 | mobile select | 가로 넘침 0, 잘린 control 0, 상태 4개, safety/production 기본 접힘, 수직 순서·패널 도달 가능 | PASS |
| 1024×768 | 4-group sidebar | 가로 넘침 0, 잘린 control 0, 그룹 제목 4개, h1 1개, 교차축 겹침 0 | PASS |
| 1440×900 | 4-group sidebar | 가로 넘침 0, 잘린 control 0, 그룹 제목 4개, h1 1개, 읽기 폭 제한과 패널 도달 가능 | PASS |

네 화면 모두 제품 제목 중복, desktop/mobile nav 동시 노출, 접힌 production
본문 노출이 없었다. 화면의 프로젝트명·경로·콘셉트 같은 영문은 fixture 원문
데이터이며 메뉴·조작 문구 번역 누락으로 계산하지 않았다.

## 11개 메뉴와 패널

| 메뉴 | 실제 패널 제목 | 상태 |
| --- | --- | --- |
| 프로젝트 | 프로젝트 개요 | PASS |
| 스토리보드 | 스토리보드 | PASS |
| 샷 설계 | 샷 설계 | PASS |
| 모션 보드 | 모션 보드 | PASS |
| 참조 이미지 | 첫 프레임·참조 이미지 | PASS |
| 프롬프트 팩 | 프롬프트 팩 | PASS |
| 검토 게이트 | 검토 게이트 | PASS |
| 생성 대기열 | 생성 대기열 | PASS |
| 클립 QA | 클립 QA·채택 구간 | PASS |
| 최종 편집 | 최종 편집·보고서 | PASS |
| 설정 | 파이프라인 설정 | PASS |

각 클릭 후 active item은 정확히 1개였고 기대한 heading이 존재했다. 11개
화면의 enabled unsafe control은 0개였다. 생성 대기열의 submit은 disabled이고
명령 표면은 copy-only였다. 안전 확인을 위해 copy 자체는 누르지 않았다.

## 접근성과 키보드

- Chromium accessibility tree: node 829개, interactive 29개,
  이름 없는 interactive 0개
- 이름 있는 navigation, h1 1개, 이름 있는 panel heading, disabled submit
  semantics: PASS
- axe: 320/768/1024/1440 각각 violations 0,
  critical/serious 0, moderate/minor 0
- 실제 Tab 순서: 제품 홈 → 표시 언어 → 설정 → 제작 폴더 → 새로고침 →
  프로젝트 → 스토리보드 → 샷 설계 → 모션 보드 → 참조 이미지
- 위 focus 대상은 모두 `:focus-visible`, `solid 2px`, visible outline: PASS
- production/safety summary 초점 진입, safety Enter 열기, Space 닫기: PASS
- mobile select 초점 진입: PASS
- mobile select 키보드 선택 변경: `MOBILE_SELECT_CHANGE_EVIDENCE_GAP`
  (저장된 최종 값 `intake`; 별도 성공 주장을 입증할 결과 파일 없음)

## Electron 경계와 console 분리

- `document.lang`: `ko-KR`
- 제품명: `시네마틱 파이프라인`
- 표시 언어: `한국어`
- `window.localAI`: `undefined`
- `window.filmPipeline`: exact 12 methods, 추가 bridge 없음
- renderer network: `file:` 18, external 0
- `Runtime.consoleAPICalled`: error 0, warning 0
- runtime exception: 0
- `Log.entryAdded`: `net::ERR_FILE_NOT_FOUND` 2
- 전체 console-clean: `LOCAL_FILE_LOG_URL_GAP`으로 BLOCK

`Log.entryAdded` 두 건은 로컬 파일 자원 실패로 분류되지만 exact URL이
증거에 남지 않아 제품 영향과 원인을 결정할 수 없다. 따라서 기존 실제 GUI
회차의 console 0 주장과 합치거나 새 회차의 제품 오류 0으로 승격하지 않는다.

## 스크린샷 증거

증거 디렉터리:
`/private/tmp/open-ga-korean-gui-acceptance-20260713T172028+0900`

| viewport | bytes | SHA-256 |
| --- | ---: | --- |
| 320×900 | 58,574 | `1f279381caa8c3e2844c24c4378fbccad06d9116748fefcce1b70ee5d99a049b` |
| 768×900 | 80,244 | `fd3907f2353dd64268dbf9dfc7d4e2646f4313ce0dd0b845050d66ef20537742` |
| 1024×768 | 99,278 | `554fee9290b47df09666c06a2228a9aec8f00da66b13bb99f6267027ddf11a95` |
| 1440×900 | 117,752 | `a2318fb23c68b30cec00b5d800e8093053ef59c54e1f6f1ad283096854c95f65` |

## 자동 검증

같은 loopback-only OS sandbox에서 최종 통합 검증을 실행했다.

| 명령 | 결과 |
| --- | --- |
| `node --test` | PASS, 80/80 |
| `npm run lint` | PASS |
| `npm run build` | PASS, Vite 40 modules |
| `git diff --check` | PASS |
| `release/` 및 승인 삭제 temp 경로 확인 | 둘 다 부재 |

테스트 출력의 Node `MODULE_TYPELESS_PACKAGE_JSON` 문구는 기존 warning이며
실패·skip 없이 80개 테스트가 모두 통과했다.

## 잔여 상태

이번 회차가 닫은 것은 한국어 UI의 실제 4-viewport 렌더, 11개 메뉴 탐색,
AX/axe, 기본 키보드 탐색과 focus 표시 검증이다. 다음 항목은 계속 분리한다.

- `LOCAL_FILE_LOG_URL_GAP`: 새 회차의 전체 console-clean BLOCK
- `MOBILE_SELECT_CHANGE_EVIDENCE_GAP`: mobile keyboard 선택 변경 BLOCK
- `NATIVE_FOLDER_SELECTION_ROOT2_GAP`: 기존 두 번째 production native 선택 BLOCK
- `OSV_OFFLINE_DB_GAP`: 기존 오프라인 취약점 DB 부재
- 실제 날짜-run Layout A와 review/dashboard/accepted-seconds/final-quality 증거

외부 생성·업로드·계정·배포 side effect는 없었다.
