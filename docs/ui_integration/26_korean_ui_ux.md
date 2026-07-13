# 한국어 UI/UX 통합 보고서

작성일: 2026-07-13 KST

담당 executor: `/root/korean_ui_integrator` (`gpt-5.6-sol`, effort `high`)

시작 기준: `main` / `7a0bc8d6b0053883f4265131caa253182a12d89b`

## 1. 목표와 적용 기준

이 회차는 Electron/Vite 기반 Cinematic Pipeline Studio를 한국어 우선 영상
제작 작업대로 바꾸고, 지속 노출되던 제목·상태·안전 카드 때문에 실제 작업
패널이 아래로 밀리던 문제를 줄였다.

`frontend-ui-engineering` 스킬의 다음 기준을 적용했다.

- 실제 작업 콘텐츠를 1차 계층으로 두고 상태와 안전 설명은 2차 계층으로 둔다.
- 0.25rem 간격 단위, 작은 반경, 제한된 그림자와 기존 검정·cyan·상태 색을 쓴다.
- 네이티브 버튼, select, details를 사용하고 `focus-visible`과
  `prefers-reduced-motion`을 제공한다.
- 320px, 768px, 1024px, 1440px 구조를 각각 정의한다.
- 로딩, 빈 상태, 오류, 복구 동작에 한국어 상태 문구와 적절한 live role을 둔다.

스킬이 참조하는 `references/accessibility-checklist.md`는 설치 경로에 없었다.
따라서 스킬 본문의 WCAG 2.1 AA 기준과 정적 계약 테스트를 적용했다.

## 2. 정보 구조 변경

### 변경 전

- 전역 `Pipeline Studio`와 페이지 `Cinematic Pipeline Studio`가 중복됐다.
- 11개 대형 영문 메뉴가 그룹 없이 연속됐다.
- 안전 권한 7개 카드와 파일 상태 카드가 모든 탭 위에 항상 펼쳐졌다.
- 제작 목록이 주 탐색과 같은 무게로 지속 노출됐다.
- 좁은 화면에서도 전체 사이드바가 먼저 표시됐다.

### 변경 후

- 56px 전역 앱 바에는 제품명, 언어, 설정 진입만 둔다.
- 페이지 `h1`은 현재 제작명이며 route와 화면 비율만 보조 정보로 표시한다.
- 상단 동작은 `제작 폴더 열기`, `목록 새로고침` 두 개로 제한한다.
- 작업 단계를 다음 네 그룹으로 묶었다.

| 그룹 | 메뉴 |
|---|---|
| 기획 | 프로젝트, 스토리보드, 샷 설계 |
| 제작 준비 | 모션 보드, 참조 이미지, 프롬프트 팩 |
| 생성·검토 | 검토 게이트, 생성 대기열, 클립 QA |
| 마무리 | 최종 편집, 설정 |

- 파일 상태는 `파일 / 파싱 / 검토 / 채택` 네 지표의 compact strip이다.
- 안전 정책은 `안전 모드 · 생성 및 업로드 차단` 네이티브 `details`로
  기본 접힘 상태다.
- 제작 목록도 네이티브 `details`로 기본 접힘 상태다.
- 320px와 768px에서는 단계 select를 사용하고, 1024px 이상에서 그룹형
  사이드바를 사용한다. 1440px에서는 작업 콘텐츠 폭을 80rem으로 제한한다.

## 3. 한국어 계약

- `ko`, `ko-KR`, `ko_KR`는 `ko-KR`로 정규화한다.
- 첫 실행 기본값은 `ko-KR`이다.
- 저장된 `en`, `zh-CN` 선택은 계속 존중하며, 앱 바에서 한국어·EN·中文을
  명시적으로 선택할 수 있다.
- 파이프라인의 11개 메뉴, 4개 그룹, 11개 패널 제목, 설명, 버튼, 폼과 표
  레이블, 빈 상태, 로딩, 오류와 복구 동작을 중앙 `copy.js` 계약으로 분리했다.
- 기술 데이터인 `PASS`, `BLOCK`, `PREVIEW`, `UNREVIEWED`, blocker code,
  경로, 명령, JSON key, ID, route/model 값과 로드한 아티팩트 원문은 번역하지
  않는다.

## 4. 접근성과 반응형

- 작업 단계 `nav`에 `aria-label="파이프라인 작업 단계"`를 둔다.
- 현재 단계 버튼에 `aria-current="page"`를 둔다.
- 제작 목록의 아이콘 새로고침 버튼에 `aria-label="제작 목록 새로고침"`을
  둔다.
- PipelineStudio 내부의 중복 `main` landmark를 제거했다.
- 공통 버튼, select, input, textarea, summary에 2px cyan focus ring을 둔다.
- 설정 모달은 `role="dialog"`, `aria-modal`, 제목 연결, 이름 있는 닫기 버튼,
  Escape 닫기, 초기 초점과 이전 초점 복원을 갖는다.
- 헤더 설정 버튼은 중복 모달 대신 파이프라인 설정 단계로 직접 이동한다.

## 5. 안전 회귀 계약

- renderer에서 shell을 직접 실행하지 않는다.
- `runSafeCommand`, generation, submit, upload 실행 버튼을 추가하지 않았다.
- 명령 카드는 복사 전용이며 `previewCommand`, `runSafeCommand`,
  `writePlanningFile`은 렌더 시 호출되지 않는다.
- 기존 `window.filmPipeline` 브리지와 Electron main/preload 파일은 수정하지
  않았다.
- 생성, 업로드, 외부 검토, 외부 계정, 패키지 설치, 네트워크 호출은 0건이다.

## 6. 검증

외부 네트워크를 차단한 macOS `sandbox-exec` 프로필에서 실행했다.

| 명령 | 결과 |
|---|---|
| `node --test` | PASS, 80/80 |
| `npm run lint` | PASS |
| `npm run build` | PASS, Vite 40 modules |
| `git diff --check` | PASS |
| `rg -n "[ \\t]+$" ...` | PASS |

첫 전체 테스트에서는 창 제목을 한국어로 바꾼 변경이 기존 desktop security
계약과 충돌해 79/80이었다. 창 제목은 기존 계약으로 복구했고 같은 deny-network
환경에서 전체 테스트를 다시 실행해 80/80 PASS를 확인했다.

## 7. GUI_APPROVAL_GAP

이 회차의 현재 승인 범위에는 Electron/브라우저 재실행, GUI 자동화와 새
스크린샷 생성이 포함되지 않았다. 따라서 다음 항목은 정적 구조와 DOM 계약만
검증했고 실제 GUI 검증은 실행하지 않았다.

- 320px / 768px / 1024px / 1440px 실제 렌더 스크린샷
- Tab / Shift+Tab / Enter / Space / Escape 키보드 순회
- 실제 screen reader 이름과 heading/landmark 탐색
- Electron console error 0 및 axe warning 0

이는 구현 전체의 차단이 아니라 `GUI_APPROVAL_GAP`이다. 실제 GUI 검증에는
Jessie의 새 실행·자동화 승인이 필요하다.
