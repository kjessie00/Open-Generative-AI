# Command Preview and Side-Effect Gates

Task G added copy-only command preview cards to the local Cinematic Pipeline
Studio queue surface. No command card exposes a run button, and no live submit
execution path was added.

## Added Files

- `src/lib/pipeline/sideEffects.js`
  - Defines pipeline side-effect types.
  - Renders shell-safe preview strings.
  - Classifies commands as allowed, preview-only, or blocked.
- `src/lib/pipeline/commandBuilders.js`
  - Builds preview-only `CommandSpec` objects for local planning, Dreamina
    preflight/status, ffprobe validation, and ffmpeg concat preview.
- `src/components/pipeline/SideEffectGate.js`
  - Renders the side-effect classification badges for a command spec.
- `src/components/pipeline/CommandPreviewCard.js`
  - Renders command, side-effect type, allowed status, evidence output, blocker
    badges, and a copy command button.

## Updated Files

- `src/components/pipeline/QueuePanel.js`
  - Replaced the old submit-preview action with a command preview grid.
  - Keeps submit disabled.
  - Keeps heartbeat non-executable and indicates whether the 20 minute gate is
    clear or blocked.
- `electron/lib/filmPipelineProvider.js`
  - Accepts `local_planning_write` and `vip_fallback_model` side-effect types.
  - Stops classifying all Dreamina commands as credit-consuming by name alone.
  - Keeps `runSafeCommand` blocked; previews remain non-executing.

## Previewed Commands

The command builders generate these preview-only command families:

- Contract plan:
  - `python scripts/build_ai_video_pipeline_plan.py --production-id <id> --goal <goal> --target-lane <seedance|flow_omni> --asset <abs_path>:image:start_frame --output <abs_path>/pipeline_plan.json --packets-output <abs_path>/agent_work_packets.json`
- Contract-only run:
  - `python scripts/run_ai_video_pipeline.py --production-id <id> --goal <goal> --target-lane <seedance|flow_omni> --asset <abs_path>:image:start_frame --output-dir <abs_path>/pipeline_run`
- Dreamina preflight/help:
  - `dreamina -h`
  - `dreamina user_credit`
  - `dreamina list_task -h`
  - `dreamina query_result -h`
- Dreamina queue checks:
  - `dreamina list_task --submit_id=<id> --limit=1`
  - `dreamina query_result --submit_id=<id> --download_dir <abs_path>`
- Video validation:
  - `ffprobe <file>`
- Concat preview:
  - `ffmpeg -y -f concat -safe 0 -i <concat_list> -c copy <final.mp4>`

## Side-Effect Model

- `local_planning_write`: allowed, but exposed only as copyable preview text.
- `local_read`: allowed, but exposed only as copyable preview text.
- `local_write`: allowed by policy for local files, but command specs can still
  block execution with `disabled_reason`.
- `non_consuming_status`: preview only by default.
- `credit_consuming_generation`: blocked.
- `external_review`: blocked.
- `external_upload`: blocked.
- `account_mutation`: blocked.
- `vip_fallback_model`: blocked.

The UI card always displays the rendered command, side-effect type, allowed
status, required evidence output, blocker list, and copy command control.

## Execution Boundary

This task did not add any execution path for Dreamina submit, image generation,
Gemini review, Flow/Omni generation, external upload, account mutation, or
VIP/fallback model behavior. Command cards are previews only.

## Verification

- `node --check` passed for the new command/gate modules, `QueuePanel.js`, and
  `electron/lib/filmPipelineProvider.js`.
- Command-builder smoke test produced 10 preview specs and verified the contract
  plan/run asset argument is absolute.
- Queue panel render smoke test completed with mock data.
- `git diff --check` passed.
