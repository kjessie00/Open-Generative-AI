# evidence_01 — 01_harness_to_ui_contract 증거 자료

수집 시각: 2026-07-07 00:21 KST
수집 대상: `/Users/jessiek/StudioProjects/Open-Generative-AI`
본 파일은 `docs/ui_integration/01_harness_to_ui_contract.md`의 증거 자료 모음이다. 본문에는 1줄 reference만 두고 verbatim 출력은 본 파일이 보관한다.

## 1. harness 문서 부재 확인

두 필수 harness 문서가 현재 체크아웃에 부재함을 확인. 이는 `AGENTS.md` §"Required local harness documents"가 명시하는 `MISSING_PIPELINE_DOC` blocker의 직접 원인이다.

```text
$ ls docs/harness/shorts-SKILL.md 2>&1
ls: docs/harness/shorts-SKILL.md: No such file or directory
$ ls docs/harness/Seedance2-SKILL.md 2>&1
ls: docs/harness/Seedance2-SKILL.md: No such file or directory
```

해석: `AGENTS.md` §"Required local harness documents"가 지정한 두 문서가 둘 다 부재. `MISSING_PIPELINE_DOC` blocker가 활성화된 상태.

## 2. blocker 상수 verbatim (23개)

`src/lib/pipeline/blockers.js`의 BLOCKERS 객체 23개 상수:

```text
MISSING_PIPELINE_DOC
MISSING_WORK_DECOMPOSITION
MISSING_PRODUCTION_BRIEF
MISSING_STORYBOARD_CONTINUITY_PACKET
MISSING_MOTION_BOARD
MISSING_YOUMIND_TEMPLATE_EVIDENCE
MISSING_GPT_IMAGE_GUIDE_EVIDENCE
IMAGE_PROMPT_TEMPLATE_NOT_REVIEWED
IMAGE_GEMINI_REVIEW_REQUIRED
IMAGE_GEMINI_REVIEW_NOT_PASS
MISSING_IMAGE_DASHBOARD
IMAGE_DASHBOARD_STALE
MISSING_REFERENCE_ANNOTATION
MISSING_VIDEO_REFERENCE_METADATA
DURATION_LOCK_MISSING
DREAMINA_PREFLIGHT_BLOCKED
GEMINI_REVIEW_BLOCKED
FRAME_EXTRACTION_BLOCKED
GEMINI_VIDEO_REVIEW_BLOCKED
CREDIT_CONFIRMATION_REQUIRED
MODEL_MISMATCH
MISSING_ACCEPTED_SECONDS
OUTPUT_QUALITY_NOT_PROVEN
```

해석: 본 contract 문서가 다루는 blocker vocabulary 23개. 새 blocker는 추가하지 않고 이 23개를 우선 사용.

## 3. panel 1:1 매핑 verbatim (11개 탭)

`src/components/pipeline/PipelineStudio.js`의 TABS 배열 11개:

```text
{ id: 'intake',         label: 'Intake' }
{ id: 'storyboard',     label: 'Storyboard' }
{ id: 'shot-designer',  label: 'Shot Designer' }
{ id: 'motion',         label: 'Motion Board' }
{ id: 'assets',         label: 'Assets' }
{ id: 'prompts',        label: 'Prompt Packs' }
{ id: 'gates',          label: 'Review Gates' }
{ id: 'queue',          label: 'Queue' }
{ id: 'qa',             label: 'QA' }
{ id: 'final',          label: 'Final' }
{ id: 'settings',       label: 'Settings' }
```

해석: 11개 탭이 10개 panel + Settings 1개로 1:1 매핑.

## 4. 테스트 상태 (cross-reference)

`docs/ui_integration/checkpoints/evidence_00.md` §2 참조. 본 contract의 안전 contract는 45/45 PASS 테스트가 보장하는 검증자 동작에 의존.

## 5. self-check 결과 (cross-reference)

본 task self-check verbatim 결과는 deliverable.md §0 참조.
