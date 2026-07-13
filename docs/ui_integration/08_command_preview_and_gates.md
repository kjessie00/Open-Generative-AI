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

- Canonical pack validation:
  - `python3 /Users/jessiek/StudioProjects/happyVideoFactory/scripts/validate_short_drama_pipeline_pack.py <main-owned-production-root> --json`
  - `cwd`는 fixed happyVideoFactory root이고 `local_read`/copy-only다.
  - stdout을 파일 증거로 저장한다고 주장하지 않는다.
- Canonical pack build:
  - 현재 UI는 새 출력 폴더가 비어 있음을 main process에서 증명할 수 없으므로
    명령 자체와 복사를 모두 차단한다.
  - 기존 production에 덮어쓰기 옵션을 추가하지 않는다.
  - route mapping은 `seedance -> seedance`, `flow_omni -> flow`,
    `both -> both`이며 그 외 값은 fail-closed다.
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
`copy_allowed:false`인 계약/입력 누락 명령은 버튼이 실제 disabled이고 click
listener도 없어 clipboard IPC가 0회다. Side-effect BLOCK 명령의 기존 copy-only
정책은 그대로다.

## Execution Boundary

This task did not add any execution path for Dreamina submit, image generation,
Gemini review, Flow/Omni generation, external upload, account mutation, or
VIP/fallback model behavior. Command cards are previews only.

## Verification

- `node --check` passed for the new command/gate modules, `QueuePanel.js`, and
  `electron/lib/filmPipelineProvider.js`.
- Canonical builder/validator, route, missing input, disabled-copy와 renderer
  clipboard 0회 계약은 `tests/canonicalHandoffAdapter.test.mjs`와
  `tests/rendererContract.test.mjs`에서 실제 command/DOM 경로로 검증한다.
- `git diff --check` passed.
