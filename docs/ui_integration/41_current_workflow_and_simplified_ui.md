# 현재 영상 작업 흐름과 단순화한 사용자 인터페이스

기준일: 2026-07-15 (Asia/Seoul)

## 결론

이 앱은 영상을 새로 생성하는 도구가 아니다. 지금 실제로 할 수 있는 일은 안전한 로컬
기획 파일 작성, 제작 폴더 읽기와 상태 복원, G3 후보의 사람 선택 기록, canonical 선택
구간을 이용한 별도 로컬 마감 실행본 생성이다. 생성 서비스 제출, 외부 검토와 업로드는
앱에서 실행하지 않는다.

기본 Vite 화면의 `파일 1 / 파싱 5 / 검토 4 / 채택 0`은 Electron bridge가 없을 때
`src/lib/pipeline/mockData.js`를 쓰는 **MOCK fallback 화면**이다. 이 수치와 미디어는 실제
Jessie production이나 실제 생성 결과가 아니다. 반면 `ffmpeg`/`ffprobe` PASS는
`tests/finishingWorkbenchRealFfmpeg.test.mjs`가 격리 임시 폴더에서 만든 synthetic
media에 대한 실제 로컬 실행 증거다. 둘을 섞어 production 품질 PASS로 읽으면 안 된다.

## 지금 바로 가능한 로컬 작업

| 작업 | 실제 코드 경로 | 신선한 검증 또는 현재 증거 | 정확한 한계 |
| --- | --- | --- | --- |
| 프로젝트 초안 저장과 고정 명령 복사 | `NewProjectDraftForm.js` → `client.js` → `preload.js` → `filmPipelineProvider.js` → `newProjectDraftProvider.js` | `tests/newProjectBootstrap.test.mjs`, `tests/rendererContract.test.mjs` | 초안과 검증된 복사만 가능. 제작 명령은 실행하지 않음 |
| 안전한 제작 폴더 읽기와 상태 복원 | `productionReader.js:readProductionFolder` → `productionNormalizer.js` → `PipelineStudio.js` | `tests/productionReaderLayouts.test.mjs`, `tests/canonicalProductionReader.test.mjs`, `tests/rendererContract.test.mjs` | 선택/configured root 안의 제한된 파일만 읽음. 구조 존재는 품질 승인 아님 |
| 기획 3종 파일 저장 | `IntakePanel.js`, `StoryboardPanel.js`, `MotionBoardPanel.js` → `filmPipelineProvider.js:writePlanningFile` | `tests/planningWriteSecurity.test.mjs`, `tests/pathProvenanceSecurity.test.mjs` | exact allowlist, 크기·링크·원자 쓰기 검사를 통과한 로컬 기획 파일만 저장 |
| G3 후보 미리보기, 로컬 초안, 비승격 export | `G3ReviewWorkspace.js` → `g3ReviewDraftProvider.js` | `tests/g3ReviewWorkspace.test.mjs`, `tests/g3PreviewObjectUrl.test.mjs`, `tests/g3ReviewUiStatic.test.mjs` | 후보를 생성하지 않음. 미리보기와 private draft/export는 production 승격이 아님 |
| 명시 확인 뒤 canonical 선택 반영 | `G3PromotionPanel.js` → `g3ProductionPromotionProvider.js` → `contentAddressedCommitStore.js` | `tests/g3ProductionPromotion.test.mjs`, `tests/contentAddressedCommitStore.test.mjs`; 상세는 `38_g3_production_promotion_cas.md`, `40_content_addressed_commit_graph.md` | 2분·1회용 계획과 명시 확인 필요. 실제 Jessie production 반영은 이번 회차에 실행하지 않음 |
| canonical selected ranges 기반 로컬 final cut, fresh probe, receipt | `FinishingWorkbenchPanel.js` → `finishingWorkbenchProvider.js:plan/execute` | `tests/finishingWorkbenchProvider.test.mjs`, 실제 temp `tests/finishingWorkbenchRealFfmpeg.test.mjs`; 상세는 `39_selected_range_render_and_fresh_probe.md` | 고정 `cut`과 검증된 local source만 지원. 실제 production 실행·영상 내용 품질 승인은 별도 |

## 준비나 외부 결과가 있어야 가능한 작업

| 작업 | 먼저 필요한 것 | 앱이 하는 일 | 앱이 하지 않는 주장 |
| --- | --- | --- | --- |
| 생성 결과 불러오기 | 외부 하네스가 안전한 production 안에 생성 결과와 근거 파일을 저장 | 제한된 제작 폴더를 다시 읽고 후보·원장·QA 상태를 복원 | 생성 성공, backend 모델, 다운로드 완료를 추정하지 않음 |
| 사람 품질 승인 | 사람이 실제 클립을 재생하고 품질과 사용할 in/out 구간을 결정 | G3 초안과 canonical selected ranges에 명시 선택을 기록 | Gemini PASS나 canonical accept를 사람 승인으로 승격하지 않음 |
| 실제 production 사용 | 정확한 대상 production 선택과 그 실행에 대한 새 명시 확인 | G3 반영 또는 로컬 finishing 계획을 대상 근거와 다시 비교 | 격리 fixture PASS를 실제 production PASS로 바꾸지 않음 |

## 앱에서 실행하지 않는 작업

- 유료 이미지·영상 생성
- Dreamina/Jimeng/Flow 라이브 제출
- Gemini 외부 검토
- 외부 업로드, 배포, 게시

강제 경계는 `src/lib/pipeline/statusMachine.js`, `src/lib/pipeline/sideEffects.js`,
`electron/lib/filmPipelineProvider.js`와 renderer → preload → main 구조다. Renderer에는
실행 가능한 shell surface가 없고, 명령 카드는 dry-run/command preview 또는 복사만
제공한다. `runSafeCommand`는 계속 `PIPELINE_COMMAND_BLOCKED`와 `executed:false`를
반환한다. 관련 회귀는 `tests/desktopSecurity.test.mjs`,
`tests/pipelineQueueRules.test.mjs`, `tests/rendererContract.test.mjs`가 맡는다.

## 5단계 사용자 인터페이스 계약

| 단계 | 하위 작업으로 남긴 기존 패널 |
| --- | --- |
| 1 시작 | 프로젝트 |
| 2 설계 | 스토리보드, 샷 설계, 모션 보드 |
| 3 생성 준비 | 참조 이미지, 프롬프트 팩, 검토 게이트, 생성 대기열 |
| 4 클립 선택 | 클립 QA |
| 5 마무리 | 최종 편집 |

설정은 단계가 아니며 상단 `설정` 버튼으로만 연다. 프로젝트 제목은 상단 중앙에 남고,
새 프로젝트·제작 폴더 열기·목록 새로고침은 사이드바의 접힌 제작 목록 안에 보존한다.

기본 화면은 `WorkflowOverview.js`다. `workflowGuide.js`가 순수 함수로 파일/파싱/검토/
채택 수치와 다음 행동을 한 곳에서 계산한다. 현재 MOCK fallback의 `1/5/4/0`은 4단계로
분류되며 다음 두 문구를 반환한다.

```text
클립을 검토하고 사용할 구간을 선택하세요
클립 QA 열기
```

채택 수가 0이므로 최종 편집을 시작할 수 없다는 설명을 함께 보여 준다. CTA는 새 가짜
화면이 아니라 기존 `qa` 패널로 이동한다. 사이드바는 5단계만 상시 유지하고 활성
단계의 실제 하위 패널만 펼친다. 설정은 이 목록에 들어가지 않는다.

## 시각·접근성 계약

- true neutral black/graphite, 흰 글자와 절제된 teal만 사용
- 그라데이션·glow·보라·과도한 카드/그림자 없음
- 8px 간격 리듬, 6–10px radius, 1px 경계선의 rail/list/band 구조
- 320, 768, 1024, 1440 반응형
- native button/select, 올바른 heading, `aria-current`, `aria-live`, `focus-visible`
- `prefers-reduced-motion`에서 전환과 애니메이션 최소화

시각 기준은 다음 승인 설계안이다.

```text
/Users/jessiek/.codex/generated_images/019f6018-5d37-7321-834e-fd5040eb15b1/exec-eabe5fa8-8b9a-4f50-948e-2bb2571950fe.png
```

## 이번 변경의 검증 기록

- plain fixture workflow guide + 한국어 정적 계약 + renderer 대상 회귀: 19/19 PASS
- macOS `sandbox-exec` `(deny network*)` 전체 Node: 203/203 PASS
- 전체 Node 안 실제 temp `ffmpeg`/`ffprobe` selected-range: 1/1 PASS
- `npm run lint`: PASS
- deny-network `npm run build`: PASS, Vite 53 modules
- `git diff --check`: PASS

브라우저 검증은 Browser plugin이 선택한 로컬 Chrome에서
`http://127.0.0.1:5174/` Vite 화면만 열어 수행했다. 외부 URL, 계정, API, 실제
production에는 접근하지 않았다. 320×900, 768×900, 1024×768, 1440×900 모두
horizontal overflow 0, 좌우 clipped interactive 0이며 `지금 할 일`이 첫 화면에
보였다. 1440×900의 panel 내부 scroll은 0이다. `클립 QA 열기`는 기존
`클립 QA·채택 구간` 패널로 이동했고, 상단 설정은 `파이프라인 설정`을 열었으며 단계
목록의 설정 버튼 수는 0이었다. Browser warn/error log는 0이다.

### 설계 충실도 장부

| 비교점 | 승인 설계안 | 최종 렌더 | 판정 |
| --- | --- | --- | --- |
| 상단 | 브랜드 / 중앙 프로젝트 / 설정 | 동일 3영역 | 일치 |
| 첫 행동 | `지금 할 일`, 한 문장, 단일 CTA | exact copy와 단일 CTA | 일치 |
| 상태 수치 | 파일 1 / 파싱 5 / 검토 4 / 채택 0 | exact 수치, 채택만 절제된 경고색 | 일치 |
| 구조 | 5단계 rail, 평면 band/list | 5단계와 active 하위 작업, 1px band/list | 일치 |
| 팔레트 | neutral black/graphite/white/teal | gradient/glow/purple 없이 동일 계열 | 일치 |
| 반응형 | 작은 화면에서도 핵심 행동 우선 | 320/768/1024/1440 overflow 0 | 일치 |

상단 visible copy diff는 허용 목록과 일치했다: `시네마틱 파이프라인`, 프로젝트 제목,
`설정`, `지금 할 일`, 상태 문장, CTA, `파일/파싱/검토/채택`, 5단계명. 요구된 capability
세 줄과 active 하위 작업은 본문에만 추가했다. 설계 이미지의 단계별 `완료/진행 중/준비
필요` 문자열과 세부 행별 중복 버튼은 사용자의 더 엄격한 상단 카피·단일 주 행동 조건에
따라 의도적으로 생략했다. 이 두 항목 외 수정 가능한 material mismatch는 남지 않았다.

승인 설계안과 최종 1440×900 browser screenshot은 같은 최종 QA pass에서 각각
`view_image`로 직접 확인했다. 최종 구현은 위 의도적 차이를 제외하고 승인 설계에
충실하게 검증됐다.

MOCK 사용 여부: 새 workflow 단위 테스트는 별도 객체인 plain fixture를 사용하며
mock/patch/monkeypatch를 쓰지 않는다. Vite 기본 화면 데이터 자체는 MOCK fallback이다.
실제 ffmpeg 검증은 mock이 아닌 격리 synthetic media 실행이다.
