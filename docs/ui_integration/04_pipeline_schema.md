# Pipeline Schema Layer

Date: 2026-07-05

Scope: Task C created a pure JavaScript contract layer for the local
Cinematic Pipeline Studio. No UI route, Electron bridge, generation command,
MuAPI call, Dreamina submit, Gemini review, browser automation, or external
upload was wired.

## Files Created

- `src/lib/pipeline/schema.js`
- `src/lib/pipeline/blockers.js`
- `src/lib/pipeline/statusMachine.js`
- `src/lib/pipeline/validators.js`
- `src/lib/pipeline/mockData.js`

## Contract Source

The schema fields, validators, and blocker constants are implemented from the
Task C request. The repo still does not contain these required harness docs:

- `docs/harness/shorts-SKILL.md`
- `docs/harness/Seedance2-SKILL.md`

Because those files are absent, this layer should be treated as a local
UI/schema scaffold, not a verified extraction from the harness files.

## Schema Model

`schema.js` defines JSDoc typedefs and plain object field templates for:

- `ProductionProject`
- `ProductionBrief`
- `StoryboardClip`
- `MotionBoardShot`
- `AssetRecord`
- `PromptPackRecord`
- `ReviewGate`
- `SubmitRecord`
- `HeartbeatRecord`
- `QARecord`
- `AcceptedSeconds`
- `FinalReport`
- `PipelineProjectState`

It also exports enum-like arrays for routes, review verdicts, gate types, and
gate statuses.

## Blockers

`blockers.js` exports exact string constants requested for the Seedance2-style
pipeline gate:

- `MISSING_PIPELINE_DOC`
- `MISSING_WORK_DECOMPOSITION`
- `MISSING_PRODUCTION_BRIEF`
- `MISSING_STORYBOARD_CONTINUITY_PACKET`
- `MISSING_MOTION_BOARD`
- `MISSING_YOUMIND_TEMPLATE_EVIDENCE`
- `MISSING_GPT_IMAGE_GUIDE_EVIDENCE`
- `IMAGE_PROMPT_TEMPLATE_NOT_REVIEWED`
- `IMAGE_GEMINI_REVIEW_REQUIRED`
- `IMAGE_GEMINI_REVIEW_NOT_PASS`
- `MISSING_IMAGE_DASHBOARD`
- `IMAGE_DASHBOARD_STALE`
- `MISSING_REFERENCE_ANNOTATION`
- `MISSING_VIDEO_REFERENCE_METADATA`
- `DURATION_LOCK_MISSING`
- `DREAMINA_PREFLIGHT_BLOCKED`
- `GEMINI_REVIEW_BLOCKED`
- `FRAME_EXTRACTION_BLOCKED`
- `GEMINI_VIDEO_REVIEW_BLOCKED`
- `CREDIT_CONFIRMATION_REQUIRED`
- `MODEL_MISMATCH`
- `MISSING_ACCEPTED_SECONDS`
- `OUTPUT_QUALITY_NOT_PROVEN`

## Status Machine

`statusMachine.js` keeps the UI safety model explicit:

- planning files: `allowed`
- local reads/writes: `allowed`
- non-consuming status commands: `preview_only`
- image generation: `blocked`
- Dreamina submit: `blocked`
- Gemini review: `blocked`
- external upload: `blocked`

Credit-consuming or external actions can be represented in the UI, but this
schema layer still returns `blocked` for live execution. That preserves dry-run
behavior until a future Electron main-process bridge implements a confirmed,
audited execution hook.

## Validators

`validators.js` exports pure functions:

- `validateProductionBrief(project)`
- `validateStoryboardClip(clip)`
- `validateImageDashboard(projectState)`
- `validatePromptPack(promptPack)`
- `validateSubmitAllowed(clipState)`
- `validateHeartbeatAllowed(lastHeartbeat, now)`
- `validateFinalReady(projectState)`

Each function returns:

```js
{
  ok: boolean,
  blockers: string[],
  details: object
}
```

Critical rules covered:

- Submit is blocked when the image dashboard is missing or stale.
- Submit is blocked when attached image verdict is `RETRY`, `BLOCK`, or
  `UNREVIEWED`, unless an explicit exception exists.
- Submit is blocked without Gemini prompt/media review `PASS`.
- Submit is blocked without explicit credit confirmation.
- Retry is blocked by default after one live attempt.
- Heartbeat is blocked until at least 20 minutes after the previous active
  heartbeat.
- Final readiness is blocked until final video evidence, downloaded clips,
  submit IDs, QA records, accepted seconds, and blocker recording are present.

## Mock Data

`mockData.js` exports a dry-run sample production:

- one production project
- one production brief
- one storyboard clip
- one motion-board shot
- one first-frame asset
- one prompt pack
- review gates
- preview-only submit and heartbeat records
- unreviewed QA and accepted-seconds placeholders
- final report with active blockers

The mock intentionally keeps live generation blocked with:

- `CREDIT_CONFIRMATION_REQUIRED`
- `OUTPUT_QUALITY_NOT_PROVEN`

## Next Step

When the missing harness docs are available, compare their real field names and
blocker semantics against this layer before wiring the UI panels or Electron
`window.filmPipeline` bridge.
