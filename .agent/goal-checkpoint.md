# Goal Checkpoint

Last updated: 2026-07-13T12:46:22+09:00
Main executor: Codex Goals
Supervisor: Pi goal guard / external audit

## Goal Metadata

- thread_id: 019f570c-52f8-7e43-be6c-07b209b1b8f2
- goal_id: production-pipeline-studio

## Objective

Open-Generative-AI를 production 수준의 로컬 Cinematic Pipeline Studio로 완성하여 Jessie가 실제 영상생성 작업대로 안전하게 활용할 수 있게 한다.

## Acceptance Criteria

- [AC1] P0 활성 MuAPI/MuAPI 계정·잔액·구독·마케팅 surface가 Electron/Vite 제품 경로에서 제거되거나 완전히 격리되어 있다.
- [AC2] Electron 보안이 강화되어 webSecurity 우회가 없고 외부 URL/IPC/file access가 allowlist·validation·least privilege 원칙을 따른다.
- [AC3] renderer는 shell을 직접 실행하지 않고 window.filmPipeline preload bridge만 사용하며 main process가 안전한 file/command preview 경계를 소유한다.
- [AC4] 모든 이미지·영상 생성과 Dreamina/Jimeng/Flow/DeepSearchTeam/Gemini/외부 업로드 action은 기본 dry_run 또는 command preview 전용이며 live side effect는 current-turn Jessie confirmation 없이는 불가능하다.
- [AC5] Project Intake부터 Pipeline Settings까지 10개 core panel이 실제 Electron GUI에서 표시·탐색·상태복원·오류처리·폴더선택·blocked command preview까지 검증된다.
- [AC6] production Layout A와 Layout B fixture/실데이터에서 reader·normalizer·validator가 재구성 가능한 UI state와 명확한 fail-safe 오류를 검증한다.
- [AC7] build, unit/integration test, Electron boundary/security regression, git diff check가 모두 통과하고 검증 범위가 production 요구사항을 커버한다.
- [AC8] docs/ui_integration의 audit, contract, plan, handoff, launch/final audit, missing inputs 상태가 현재 코드·검증·남은 blocker와 일치한다.
- [AC9] repo·로그·fixture·UI에 secrets, cookies, browser profiles, auth bundles, API keys, private session zips가 없고 외부 generation/upload/deploy side effect가 발생하지 않는다.
- [AC10] execution success, output quality approval, Jessie-visible dashboard confirmation, backend model verification, accepted seconds selection을 서로 다른 상태로 유지하고 각각 증거로 검증한다.

## Hard Constraints

- 작업 시작 전 current git status/diff를 확인하고 dirty worktree 및 기존/무관한 사용자 변경을 보존하며 덮어쓰기, revert, stage 또는 commit하지 않는다.
- 제품 코드·문서의 변경은 별도 bounded executor와 독립 read-only verifier가 맡고 root coordinator는 manager-only로 acceptance evidence를 감사한다.
- Required harness docs가 없으면 MISSING_PIPELINE_DOC로 fail safe하고 docs/ui_integration/missing_inputs.md에 기록한 뒤 pipeline 구현을 중단한다.
- 결제·production DB·secret/account·service restart·deploy/release·public upload·destructive Git/filesystem·irreversible infrastructure side effect는 policy 2026-07-12-manager-only-v1에 따른 current-turn Jessie confirmation 없이는 금지한다.
- credit-consuming generation, Dreamina/Jimeng/Flow live submit, DeepSearchTeam, imagegen, agy Gemini review, browser automation, external upload를 명시적 승인 없이 실행하지 않는다.

## Required Verification

- git status --short --branch && git diff --check
- npm test -- --runInBand
- npm run build
- Electron GUI evidence: 10 core panels, folder selection, state reconstruction, error handling, blocked command preview를 캡처/체크 로그로 requirement-by-requirement 확인
- Layout A/B reader evidence: representative fixture 또는 승인된 local production paths로 reader/normalizer/validator 결과와 fail-safe cases 확인
- Security regression evidence: MuAPI active surface scan, renderer shell-execution scan, Electron webPreferences/IPC/external URL allowlist tests, secret-pattern scan

## Current Evidence

- 2026-07-13 initial state: `main` at `70b7d4a6bd73d0f01747ac1387a27baa0989e7ec`, aligned with `origin/main`, and clean before checkpoint creation (`git status --short --branch`, exit 0).
- 2026-07-13 Goal Guard initialization: `/Users/jessiek/.local/bin/codex-goal-guard init`, exit 0; thread `019f570c-52f8-7e43-be6c-07b209b1b8f2`, goal `production-pipeline-studio`.
- Approval classification: this checkpoint-only local mutation required no additional Jessie approval; no generation, upload, deploy, account, service, production DB, secret, or destructive side effect was performed. Future gated side effects still require current-turn approval under policy `2026-07-12-manager-only-v1`.
- 2026-07-13 P0 local/security integration: `main` fast-forwarded from `70b7d4a6bd73d0f01747ac1387a27baa0989e7ec` to `4dac3871202b8c1e6dc057d0e53e513ff7fa1678`; tree `b06c418f1190f94d5da067985f034ca47dc037dd`. Default `dev`/`build`/`start` now target Vite/Electron only, active MuAPI key/proxy surfaces are absent, Electron navigation is deny-by-default, and the isolated `window.filmPipeline` preload boundary remains.
- Deterministic independent verifier `p0_deterministic_readonly_verifier`: macOS `sandbox-exec` denied all network and repository/temp writes except `/dev/null`; immutable commit/tree/parent and six changed-file SHA-256 values matched; direct popup/`will-navigate` behavior and policy-before-load wiring passed; desktop security tests passed 6/6; read-only-compatible regression tests passed 51/51; Vite `configFile:false`, `write:false` in-memory build passed with five outputs. Four `filmPipelineListChildren` tests were `READONLY_NOT_APPLICABLE` in that sandbox because they intentionally create temporary directories, not because of assertion failures.
- Post-integration validation with OS-level network denial: `node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs` passed 56/56; `npm run lint` passed; `npm run build` passed with 39 modules; `git diff --check` passed; tracked worktree remained clean; no `release/` directory was recreated.
- Security baseline: executor-reported gitleaks and local-only semgrep each returned zero findings. OSV remains `SCANNER_GAP` because no offline vulnerability database was available; no network refresh was allowed. No credit-consuming generation, browser automation, upload, deploy, account, service, or production DB action occurred.
- Approved cleanup: Jessie explicitly approved deletion of `/Users/jessiek/StudioProjects/Open-Generative-AI/release/` and `/tmp/open-generative-ai-security-review-20260713-p0`; 639MB and 36KB respectively were removed, symlink checks passed, and both paths were confirmed absent.
- 2026-07-13 Layout A/B production reader validation: added a distinct dated-run Layout A fixture and reused the existing root-marker Layout B fixture; reader → normalizer → validator E2E and fail-safe tests passed 8/8. Sensitive-name, `.git`/`node_modules`, symlink/root escape, malformed JSON/JSONL/JS/CSV/markdown, and walker depth/file limits are now regression-covered. Full network-denied test suite passed 64/64; lint, Vite build (39 modules), and `git diff --check` passed. Detailed aggregate-only evidence is in `docs/ui_integration/20_production_reader_validation.md`.
- Actual production read-only aggregate probe (maximum two): `gangnam_shorts_system_income_20260707` detected as partial Layout B with 293 files but no complete structured reader packet; `ep01_apologist` detected as unknown with 524 files. Both remained final-not-ready with required blockers; no raw script, media, private metadata, or secret content was copied and happyVideoFactory was not modified. Residual gaps are `REAL_LAYOUT_A_GAP` and `REAL_LAYOUT_B_PARTIAL`, not fixture failures.
- 2026-07-13 documentation reconciliation: added `docs/ui_integration/21_current_acceptance_status.md`; marked the implementation plan, final audit, handoff, and launch verification as historical snapshots with a current-status pointer; replaced the resolved `MISSING_PIPELINE_DOC` notice with the current real-layout, GUI-evidence, and offline-OSV gaps. Historical evidence remains intact below each notice.
- 2026-07-13 deterministic renderer-contract validation by `renderer_contract_integrator`: added `tests/rendererContract.test.mjs`, which executes the actual vanilla-DOM `PipelineStudio()` product component without Electron/browser launch or a new dependency. Bridge-backed state restoration, folder selection, error recovery, all 11 tabs/10 core panels, dry-run relocking, disabled submit, copy-only command previews, zero active run/execute/generate/submit/upload controls, and zero command/write bridge calls during render/navigation passed. With OS-level network denial, focused test passed 1/1, the full suite passed 65/65, lint passed, Vite build passed with 39 modules, `git diff --check` passed, and `release/` remained absent. Detailed evidence and limitations are in `docs/ui_integration/22_renderer_contract_validation.md`.
- 2026-07-13 offline dependency audit: network-denied `npm audit --offline --omit=dev` returned zero findings and `npm ls` resolved the production tree. All 1,158 HTTPS resolved lockfile entries had integrity data. OSV identified 1,097 packages but explicitly reported that its npm offline database was unavailable, so `OSV_OFFLINE_DB_GAP` remains. Detailed evidence is in `docs/ui_integration/23_offline_dependency_audit.md`.
- 2026-07-13 operator-entry reconciliation: replaced the upstream hosted-generation README with the local Cinematic Pipeline Studio runbook, corrected package/index descriptions and page title, and added a desktop security regression that locks the local product metadata. Network-denied full tests remained 65/65; lint and Vite build (39 modules) passed.

## Acceptance Evidence Map

- AC1: VERIFIED for the active Vite/Electron product path by commit `4dac387`, repository-surface regression tests, and the deterministic active-surface scan.
- AC2: VERIFIED for Electron web preferences and navigation policy by direct event mocks plus 6/6 security tests.
- AC3: VERIFIED by preload exposure scan, main-process wiring tests, and renderer active-import graph checks.
- AC4: VERIFIED at the code/test layer by queue/validator regressions; live generation or upload was not performed.
- AC5: PARTIAL PASS for deterministic renderer-contract evidence: actual `PipelineStudio()` renders and navigates all 11 tabs/10 core panels, restores bridge state, handles folder selection/error surfaces, and exposes blocked copy-only previews under `tests/rendererContract.test.mjs`. Actual Electron window, native dialog/preload IPC, visual layout, console, media, and screenshot evidence remain PENDING.
- AC6: VERIFIED for distinct Layout A/B fixtures, malformed/sensitive/limit fail-safe cases, and bounded real-production aggregate probes by `tests/productionReaderLayouts.test.mjs` (8/8) and `docs/ui_integration/20_production_reader_validation.md`. Real candidates remain honestly partial/unknown rather than claimed fixture-equivalent.
- AC7: PARTIAL PASS for build, 65 tests, reader/security/renderer regressions, and diff/status; actual Electron GUI/runtime scope remains pending.
- AC8: VERIFIED by `docs/ui_integration/21_current_acceptance_status.md` and current-status notices in the plan, final audit, handoff, launch verification, and missing-input records.
- AC9: PARTIAL PASS for active-source scans and zero external generation/upload; OSV offline database gap remains.
- AC10: VERIFIED at state-machine/test level; Jessie-visible GUI confirmation remains part of AC5.

## Pending

- Verify all 10 core panels and the current 11-tab implementation in the actual Electron GUI, including folder selection, state restoration, error handling, and blocked command preview.
- Resolve or explicitly accept the offline OSV database gap without enabling network access implicitly.
- Completion remains blocked on AC5 and the remaining AC7/AC9 runtime evidence; passing code tests alone is insufficient.

## Compaction Reentry Rule

After any compaction, resume, or long pause:

1. Read this checkpoint first.
2. If this is a git repo, run `git status --short` and inspect the relevant diff before trusting prior summaries.
3. If this is not a git repo, inspect the concrete changed files, generated artifacts, and latest command outputs directly.
4. Treat repository/artifact state and fresh command output as stronger evidence than the last assistant report.
5. Before saying done, map each acceptance criterion to concrete evidence in this file.
6. If evidence is missing, run verification or mark the blocker explicitly.
