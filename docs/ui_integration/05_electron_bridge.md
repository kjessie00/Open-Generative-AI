# Electron Film Pipeline Bridge

Date: 2026-07-05; security boundary updated 2026-07-13

Scope: Task D added a safe Electron IPC bridge named `window.filmPipeline`
plus a renderer client fallback. No Dreamina submit, DeepSearchTeam call,
imagegen call, Gemini review, Flow execution, external upload, or other live
generation path was implemented.

## Files Changed

- `electron/preload.js`
- `electron/main.js`
- `electron/lib/filmPipelineProvider.js`
- `src/lib/pipeline/client.js`
- `src/components/pipeline/PipelineStudio.js`
- `src/main.js`
- `src/components/Sidebar.js`

## Renderer API

`electron/preload.js` exposes:

```js
window.filmPipeline = {
  getConfig,
  selectProductionRoot,
  listProductionChildren,
  readProductionState,
  writePlanningFile,
  listAssets,
  readJsonl,
  previewCommand,
  copyCommandPreview,
  runSafeCommand,
  onProgress,
}
```

The current bridge has 11 methods. It deliberately has no `setConfig` method.
Native selection accepts only `{mode: 'production'}` or `{mode: 'parent'}`;
sidebar activation accepts `{mode: 'child', rootPath}` and main verifies that
the candidate is an immediate real non-symlink child of the configured parent.
The renderer does not supply paths to production-state, child-list, or asset
read IPC.

The preload layer only forwards IPC calls. It does not expose Node.js, `fs`,
`child_process`, shell access, cookies, tokens, browser state, or account
material to the renderer.

## Main Process Provider

`electron/lib/filmPipelineProvider.js` owns the filesystem and command safety
boundary.

Allowed now:

- read the renderer-visible local film-pipeline config under Electron `userData`
- persist production/parent paths only from a native dialog result or a
  main-validated immediate sidebar child
- read shallow production state candidates
- list local assets by extension
- read bounded JSONL files under the selected production root
- write only the three exact planning output patterns documented in
  `29_planning_write_security.md`
- render a shell-safe preview string for a command

Blocked now:

- all credit-consuming generation commands
- all Dreamina/Jimeng/Seedance submit execution
- all Gemini, DeepSearchTeam, browser, imagegen, or external review execution
- all external upload commands
- all account mutation commands
- all command execution through `runSafeCommand`

## Command Safety

The bridge defines `sideEffectClassifier(commandSpec)` around these
`CommandSpec` fields:

- `id`
- `label`
- `command`
- `args`
- `cwd`
- `side_effect_type`
- `requires_confirmation`
- `confirmation_token`
- `related_clip_id`
- `evidence_output_path`

Supported side-effect types:

- `local_read`
- `local_write`
- `non_consuming_status`
- `credit_consuming_generation`
- `external_review`
- `external_upload`
- `account_mutation`

The classifier treats declared side-effect type as a hint, then overrides it
when command text contains known high-risk generation, review, upload, or
account keywords. `previewCommand()` returns a quoted shell string and the
classification, but never executes. `runSafeCommand()` currently returns
`FILM_PIPELINE_COMMAND_BLOCKED` for every command, including local status
commands, until a future task adds a narrow whitelist.

## Renderer Fallback

`src/lib/pipeline/client.js` wraps `window.filmPipeline`. When Electron is not
available, browser/Vite mode returns Task C mock pipeline data and refuses all
execution. This keeps the Pipeline UI usable in a plain Vite renderer while
preserving dry-run safety.

## Pipeline UI Touch

`src/components/pipeline/PipelineStudio.js` now loads state through
`pipelineClient.readProductionState()`. Because the fuller Task B shell was not
present in this checkout, this is a minimal route-level status screen only. It
shows the dry-run banner and permanent side-effect indicator, and it does not
wire any live generator or external review path.

## Security Boundaries

- Renderer never directly reads or writes the filesystem.
- Renderer cannot persist `productionRoot` or `productionParentRoot`; legacy
  configs without main-owned provenance are invalidated and require re-selection.
- Parent selection does not overwrite the current production root.
- Configured parent/root read operations are path-bound in main; unsolicited
  renderer path arguments fail closed.
- Renderer never receives shell execution capability.
- `writePlanningFile()` is constrained to paths inside the selected production
  root, three exact UI output patterns, and a 1 MiB UTF-8 content cap.
- `readJsonl()` is constrained to paths inside the selected production root and
  capped at 10 MB; parent and leaf symlinks are rejected.
- `previewCommand()` performs no side effects.
- `runSafeCommand()` is intentionally disabled and always blocks.
- Main-owned config writes force `allowSafeCommandExecution: false`; renderer
  has no public config-write channel.

## Remaining Work

Before enabling any local non-consuming inspection command, add a tiny allowlist
such as `ffprobe` or local directory listing, verify absolute executable paths,
validate arguments per command, and keep credit-consuming or external side
effects permanently behind a fresh explicit Jessie confirmation gate.
