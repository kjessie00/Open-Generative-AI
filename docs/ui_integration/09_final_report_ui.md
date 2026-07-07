# Final Stitch and Evidence Report UI

Task J upgrades the Final panel into an evidence report instead of a simple
readiness checklist.

## Updated UI

- `src/components/pipeline/FinalReportPanel.js`
  - Shows final video path only when `final.mp4` evidence exists.
  - Always shows production folder and generator route.
  - Shows an evidence-only known credit total and its source.
  - Shows completion time from `finalReport.completed_at` or completed heartbeat
    history.
  - Shows a clip table with:
    - `clip_id`
    - first-frame image/path
    - prompt pack path
    - submit id
    - status
    - model evidence
    - downloaded file
    - QA verdict
    - accepted seconds
  - Shows heartbeat history including checked time, submit id, queue status,
    generation status, downloaded files, next heartbeat, and blocker.
  - Shows blockers and residual risks.
  - Shows copy-only ffprobe and ffmpeg concat preview cards.

## Current Condition Model

When no final video exists, the panel derives one current condition:

- `queued`
- `blocked before submission`
- `generated but failed QA`
- `missing download`
- `missing accepted seconds`
- `missing final stitch`

The condition is computed from submit records, heartbeat records, QA records,
accepted seconds, file evidence, and `validateFinalReady()` details. It does
not infer success from a generated/downloaded clip alone.

## Final Readiness

`validateFinalReady()` remains false unless:

- `final.mp4` exists.
- `concat_list.txt` exists.
- source clip paths/downloads are recorded.
- submit ids are recorded for submitted/planned clips.
- QA records exist and pass or have explicit exception.
- accepted seconds are recorded.
- blockers are recorded as an array.
- `report.md` exists.
- ffprobe verification exists.

Active blockers in `projectState.blockers` or `finalReport.blockers` keep final
readiness false.

## Preview Commands

The Final panel now renders:

- `ffprobe <file>`
- `ffmpeg -y -f concat -safe 0 -i <concat_list> -c copy <final.mp4>`

These are displayed through `CommandPreviewCard`. The UI does not execute them.
`ffmpeg` remains blocked with `PREVIEW_ONLY_REQUIRED`; `ffprobe` is preview-only
non-consuming status until a later task explicitly enables safe local execution.

## Fixtures

- `finalReadyState()` represents a production with final, concat, report,
  ffprobe, submit id, download, QA, and accepted seconds evidence.
- `finalNotReadyStitchState()` represents a production with source evidence but
  no final stitch evidence.

## Verification

- `node --check` covers Final panel, command builders, validators, and fixtures.
- `node --test tests/*.test.js tests/*.test.mjs` covers ready/not-ready final
  states, final condition derivation, clip evidence rows, and preview command
  side-effect classification.
- No ffmpeg, ffprobe, Dreamina, Gemini, upload, or generation command is
  executed.
