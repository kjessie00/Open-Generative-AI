# Pipeline UI Fixture And Validator Test Matrix

Task K adds fixture states for the local Cinematic Pipeline Studio without adding external dependencies or executing any generation, Dreamina, Gemini, ffmpeg, ffprobe, or upload commands.

## Fixture States

| Fixture | Purpose | Primary expected blocker or state |
| --- | --- | --- |
| `complete_planning_no_generation` | Planning evidence is present, credit gate is fixture-confirmed, no submit or generation exists. | `OUTPUT_QUALITY_NOT_PROVEN`, `MISSING_ACCEPTED_SECONDS` |
| `missing_storyboard` | Storyboard packet is absent. | `MISSING_STORYBOARD_CONTINUITY_PACKET` |
| `missing_motion_board` | Motion board is absent. | `MISSING_MOTION_BOARD` |
| `dashboard_missing` | Image dashboard object is absent. | `MISSING_IMAGE_DASHBOARD` |
| `dashboard_stale` | Dashboard timestamp is older than asset/review evidence. | `IMAGE_DASHBOARD_STALE` |
| `image_unreviewed` | Attached first-frame image has not passed image QA. | `IMAGE_GEMINI_REVIEW_REQUIRED` |
| `prompt_media_review_blocked` | Seedance prompt/media review is not PASS. | `GEMINI_REVIEW_BLOCKED` |
| `credit_confirmation_required` | Planning is otherwise valid but explicit credit confirmation is absent. | `CREDIT_CONFIRMATION_REQUIRED` |
| `submitted_waiting_heartbeat` | Clip has `submit_id`, but `next_heartbeat_at` is in the future. | `DREAMINA_PREFLIGHT_BLOCKED` |
| `heartbeat_due` | Clip has `submit_id` and heartbeat interval has elapsed. | Heartbeat validation PASS |
| `downloaded_qa_missing` | Download evidence exists but QA record is missing. | `GEMINI_VIDEO_REVIEW_BLOCKED`, `OUTPUT_QUALITY_NOT_PROVEN` |
| `qa_failed` | Download and accepted seconds exist, but QA verdict is FAIL. | `OUTPUT_QUALITY_NOT_PROVEN` |
| `accepted_seconds_missing` | Download, QA, and final evidence exist, but accepted seconds are absent. | `MISSING_ACCEPTED_SECONDS` |
| `final_ready` | Final video, concat list, submit id, downloaded source, QA, accepted seconds, ffprobe evidence, and report are all recorded. | Ready |

All fixtures live under `src/fixtures/pipeline/states/` and export functions that return fresh mutable state objects.

## Validator Coverage

| Test | Fixture | Expected result |
| --- | --- | --- |
| Submit blocked without dashboard | `dashboard_missing` | `MISSING_IMAGE_DASHBOARD` |
| Submit blocked with stale dashboard | `dashboard_stale` | `IMAGE_DASHBOARD_STALE` |
| Submit blocked with unreviewed image | `image_unreviewed` | `IMAGE_GEMINI_REVIEW_REQUIRED` |
| Submit blocked without prompt/media PASS | `prompt_media_review_blocked` | `GEMINI_REVIEW_BLOCKED` |
| Submit blocked without credit confirmation | `credit_confirmation_required` | `CREDIT_CONFIRMATION_REQUIRED` |
| Retry blocked after one live attempt | `complete_planning_no_generation` plus one attempt override | `DREAMINA_PREFLIGHT_BLOCKED` |
| Heartbeat blocked before 20 minutes | `submitted_waiting_heartbeat` | `DREAMINA_PREFLIGHT_BLOCKED`, exact `nextHeartbeatAt` |
| Heartbeat allowed when due | `heartbeat_due` | PASS |
| Final blocked without accepted seconds | `accepted_seconds_missing` | `MISSING_ACCEPTED_SECONDS` |
| Final blocked without `final.mp4` | `final_ready` with final evidence removed | `OUTPUT_QUALITY_NOT_PROVEN` |
| Final ready only with all evidence | `final_ready` | PASS |

## Test Entry Points

Primary test file:

```bash
node --test src/lib/pipeline/validators.test.mjs
```

Repository helper script:

```bash
node scripts/test_pipeline_validators.js
```

The helper script runs the existing lightweight `node:test` files plus `src/lib/pipeline/validators.test.mjs`.
