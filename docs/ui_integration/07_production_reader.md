# Production Folder Reader

Date: 2026-07-05

Scope: Task F added local production-folder readers for existing harness
artifacts. The reader performs filesystem reads only. It does not execute
commands, submit generation, run external review, upload files, or call MuAPI.

## Files Added

- `electron/lib/productionReader.js`
- `src/lib/pipeline/productionNormalizer.js`
- `src/lib/pipeline/filePathUtils.js`
- `src/fixtures/pipeline/sampleProductionFolder/`

## Files Modified

- `electron/lib/filmPipelineProvider.js`
- `src/components/pipeline/PipelineStudio.js`

## Supported Layouts

Layout A:

```text
docs/short_drama_pipeline_runs/<YYYYMMDD>-<slug>/
  intake/
  storyboard/
  prompts/
  generated/
  final/
  qa/
  report.md
```

Layout B:

```text
production/
  brief.md
  script.md
  assets/
  video_references/
  image_generation/
  image_dashboard/
  storyboard/
  motion_board/
  prompts/
  dreamina_outputs/
  reviews/
  edit/
  ledger.csv
```

`productionReader.detectLayout()` returns `A`, `B`, or `unknown`. If the user
selects a parent folder containing a `production/` child with Layout B markers,
the reader follows that child as the production root.

## Parsed Artifacts

The reader detects presence and parse status for:

- markdown files and paths
- storyboard JSON
- motion board JSON
- `image-dashboard-data.js`
- `submit_records.jsonl`
- `heartbeat_log.jsonl`
- `cost_ledger.jsonl`
- `ledger.csv`
- `accepted_seconds.md`
- `blockers.md`
- `report.md`

Structured data that is missing or unparseable becomes a partial state with
exact blockers. The UI must not treat file presence as review pass or quality
acceptance.

## Security Boundaries

- All internal paths are normalized to absolute paths.
- Sensitive names are skipped during traversal: cookies, browser profiles,
  auth bundles, session zips, tokens, secrets, and credentials.
- `.zip` files are skipped.
- Markdown and JSON-like text reads are bounded.
- `image-dashboard-data.js` is parsed as text only. It is never executed.
- No shell, browser, external review, upload, or generation command is run.

## Renderer Normalization

`src/lib/pipeline/productionNormalizer.js` converts raw reader output into the
existing `PipelineProjectState` shape:

- `project`
- `brief`
- `storyboard`
- `motionBoard`
- `imageDashboard`
- `assets`
- `promptPacks`
- `reviewGates`
- `submitRecords`
- `heartbeatRecords`
- `qaRecords`
- `acceptedSeconds`
- `finalReport`
- `fileEvidence`
- `fileStatus`

It keeps four states separate:

- file exists
- content parsed
- review passed
- quality accepted

## UI Flow

`PipelineStudio` now includes `Open Production Folder`.

Flow:

1. Renderer calls `pipelineClient.selectProductionRoot()`.
2. Electron opens a local folder picker.
3. Renderer calls `pipelineClient.readProductionState(rootPath)`.
4. Electron reads local artifacts through `productionReader`.
5. Renderer normalizes raw reader output.
6. Panels populate from the imported partial state.
7. Missing or unaccepted sections display exact blockers.

Browser/Vite mode still falls back to mock fixture data because
`window.filmPipeline` is unavailable.

## Fixture

`src/fixtures/pipeline/sampleProductionFolder/` is a small Layout B fixture.
It includes path-only media placeholders, storyboard JSON, motion board JSON,
image dashboard JS, JSONL ledgers, CSV ledger, accepted seconds markdown,
blockers markdown, and report markdown.

The fixture intentionally does not prove output quality. It keeps final
readiness blocked with:

- `OUTPUT_QUALITY_NOT_PROVEN`
- `FRAME_EXTRACTION_BLOCKED`
- `MISSING_ACCEPTED_SECONDS`

## Verification

Completed:

- `node --check` for the reader, normalizer, path utils, bridge provider, and
  pipeline components.
- Reader smoke test against `src/fixtures/pipeline/sampleProductionFolder/`.
- Normalizer smoke test confirming absolute paths and partial-state blockers.
- Minimal DOM render smoke test for `PipelineStudio()`.

Not completed:

- `npm run vite:build`

Reason:

`node_modules` is not installed in this checkout, and this task did not permit
installing dependencies.
