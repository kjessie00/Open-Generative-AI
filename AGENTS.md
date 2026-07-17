# Open-Generative-AI Project Agents

Scope:
This `AGENTS.md` applies only to this local project checkout:

`/Users/jessiek/StudioProjects/Open-Generative-AI`

It is not a reusable global Codex policy file. Global Jessie-local routing and
safety rules still apply from the outer Codex/AGENTS context, but this file is
the project-local contract for work inside this repository.

You are working on a local fork of Anil-matcha/Open-Generative-AI.

Goal:
Convert this fork into a local cinematic video pipeline UI for Jessie's existing harnesses. The app is not a SaaS MuAPI client anymore. Treat Open-Generative-AI only as a UI scaffold: Electron/Vite shell, media studio components, settings modal, model/status UI, upload/preview/history/progress patterns.

Hard direction:
- Prefer the Electron/Vite path under src/ and electron/.
- Do not build on the hosted Next.js/MuAPI product path unless explicitly needed.
- Remove or isolate MuAPI, hosted account, balance, marketing, agents, and subscription assumptions.
- Build a local UI that controls, previews, audits, and reports the existing harness pipeline.
- Do not run any credit-consuming image/video generation.
- Do not run Dreamina/Jimeng/Flow live submit commands.
- Do not call DeepSearchTeam, imagegen, agy Gemini review, browser automation, or external upload unless the current task explicitly asks and confirms that side effect.
- Default all executable pipeline actions to dry_run or command preview mode.

Required local harness documents:
- docs/harness/shorts-SKILL.md
- docs/harness/Seedance2-SKILL.md

If these files are missing, stop with blocker MISSING_PIPELINE_DOC and create docs/ui_integration/missing_inputs.md.

Core UI mission:
Build a local "Cinematic Pipeline Studio" with these panels:
1. Project Intake
2. Storyboard / Shot List
3. Motion Board
4. First-Frame / Reference Image Dashboard
5. Prompt Pack Builder
6. Review Gates
7. Seedance/Dreamina Queue + Heartbeat
8. Clip QA / Accepted Seconds
9. Final Stitch / Report
10. Pipeline Settings

Architecture:
- Renderer never directly executes shell commands.
- Renderer calls window.filmPipeline exposed by Electron preload.
- Electron main process owns file reads/writes, command preview, safe non-consuming commands, and future execution hooks.
- UI state must be reconstructable from local files: production/, docs/short_drama_pipeline_runs/, JSONL ledgers, markdown reports, and dashboard data.
- Store secrets nowhere. Never copy cookies, browser profiles, auth bundles, API keys, or private session zips into the repo.
- On another local machine, never edit provider source paths to find generated media. Use the main-owned result-folder selectors described in `docs/ui_integration/83_external_media_root_contract.md`; the external Codex agent performs setup and generation, while the UI remains a review workspace without an embedded agent chat.

Safety state machine:
- Planning complete is not generation submitted.
- Image generation succeeded is not image quality approved.
- Gemini review PASS is not Jessie-visible dashboard confirmed.
- Dreamina CLI submit succeeded is not backend model verified.
- Clip downloaded is not output quality accepted.
- Whole clip generated is not accepted seconds selected.

Implementation discipline:
- Before changing code, inspect existing files and write docs/ui_integration/00_repo_audit.md.
- Then write docs/ui_integration/01_harness_to_ui_contract.md.
- Then write docs/ui_integration/02_implementation_plan.md.
- Make small commits or checkpoint notes after each phase.
- Add mock fixtures before wiring live commands.
- All reports to Jessie must be in Korean unless explicitly asked otherwise.
