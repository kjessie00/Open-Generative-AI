# Goal Checkpoint

Last updated: 2026-07-12T15:59:02.955Z
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

## Pending

- AC1-AC10 remain unaccepted until each has fresh artifact-specific evidence recorded here.
- First implementation slice: remove active MuAPI surfaces and harden Electron security without weakening renderer/main boundaries.
- Then verify dry-run command surfaces, all 10 panels in the actual Electron GUI, Layout A/B readers, build/tests/security regression, and documentation consistency.
- Completion remains blocked on requirement-by-requirement production evidence; a green narrow test alone is insufficient.

## Compaction Reentry Rule

After any compaction, resume, or long pause:

1. Read this checkpoint first.
2. If this is a git repo, run `git status --short` and inspect the relevant diff before trusting prior summaries.
3. If this is not a git repo, inspect the concrete changed files, generated artifacts, and latest command outputs directly.
4. Treat repository/artifact state and fresh command output as stronger evidence than the last assistant report.
5. Before saying done, map each acceptance criterion to concrete evidence in this file.
6. If evidence is missing, run verification or mark the blocker explicitly.
