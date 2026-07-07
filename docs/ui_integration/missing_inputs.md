# MISSING_PIPELINE_DOC

Date: 2026-07-05

This repository is blocked from Cinematic Pipeline Studio integration because the required local harness documents are missing from the fork.

Local project path:

- `/Users/jessiek/StudioProjects/Open-Generative-AI`

Missing required files:

- `docs/harness/shorts-SKILL.md`
- `docs/harness/Seedance2-SKILL.md`

Current repo facts checked before stopping:

- Repository remote: `https://github.com/kjessie00/Open-Generative-AI.git`
- Current branch: `main`
- Existing Electron/Vite path is present: `src/`, `electron/`, `vite.config.mjs`, `electron/preload.js`, `electron/main.js`
- Existing hosted product path is also present: `app/`, `packages/studio/`, `next.config.mjs`
- `electron/preload.js` currently exposes `window.localAI`; the requested future integration should expose `window.filmPipeline`
- No live image/video generation, Dreamina/Jimeng/Flow submit, browser automation, upload, or external review command was run

Required next input:

Add or copy the two harness documents above into `docs/harness/`. After that, resume with:

1. `docs/ui_integration/00_repo_audit.md`
2. `docs/ui_integration/01_harness_to_ui_contract.md`
3. `docs/ui_integration/02_implementation_plan.md`
4. Mock fixtures before any live command wiring

Until the missing files are present, all executable pipeline work must remain blocked.
