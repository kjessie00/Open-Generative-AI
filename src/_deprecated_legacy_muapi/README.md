# Legacy MuAPI 표면 격리 (Deprecated)

작성일: 2026-07-07 KST. 격리 결정자: opencode session. 격리 사유: AGENTS.md가 정의한 "Remove or isolate MuAPI, hosted account, balance, marketing, agents, and subscription assumptions" 정책 준수.

## §1. 격리 범위

본 폴더는 `src/_deprecated_legacy_muapi/`이며 다음 11개 legacy 파일을 포함한다. 본 폴더 안의 파일들은 본 repo의 local UI scaffold의 일부가 아니며 `docs/ui_integration/` lineage로 다뤄지지 않는다. 본 폴더 안의 파일들은 향후 Jessie 결정에 따라 완전 삭제되거나 별도 archived repo로 이동될 수 있다.

| 파일 | 격리 사유 |
| --- | --- |
| `muapi.js` | hosted MuAPI client (`https://api.muapi.ai` 호출, `localStorage.muapi_key` 사용) |
| `ImageStudio.js` | legacy SaaS Image 생성 UI (hosted MuAPI 호출) |
| `VideoStudio.js` | legacy SaaS Video 생성 UI (hosted MuAPI 호출) |
| `CinemaStudio.js` | legacy Cinema 생성 UI (hosted MuAPI 호출) |
| `LipSyncStudio.js` | legacy LipSync 생성 UI (hosted MuAPI 호출) |
| `McpCliStudio.js` | legacy MCP CLI 설정 UI (`github.com/SamurAIGPT/muapi-cli`, `api.muapi.ai/mcp` 레퍼런스) |
| `UploadPicker.js` | hosted MuAPI 업로더 (`muapi.uploadFile` 호출) |
| `AuthModal.js` | legacy API key 입력 모달 (`https://muapi.ai/access-keys` 링크) |
| `SettingsModal.js` | legacy Settings 모달 (`localStorage.muapi_key` 관리) |
| `WorkflowStudio.js` | legacy Workflows UI (hosted agent 가정) |
| `AgentStudio.js` | legacy Agents UI (hosted agent 가정) |

## §2. 격리 후 import 경로

본 폴더로 이동된 11개 파일들은 외부에서 다음 경로로 import된다.

| 파일 | import 경로 (from `src/main.js`) |
| --- | --- |
| `ImageStudio.js` | `./_deprecated_legacy_muapi/ImageStudio.js` |
| `VideoStudio.js` | `./_deprecated_legacy_muapi/VideoStudio.js` (dynamic import) |
| `CinemaStudio.js` | `./_deprecated_legacy_muapi/CinemaStudio.js` (dynamic import) |
| `LipSyncStudio.js` | `./_deprecated_legacy_muapi/LipSyncStudio.js` (dynamic import) |
| `McpCliStudio.js` | `./_deprecated_legacy_muapi/McpCliStudio.js` (dynamic import) |
| `SettingsModal.js` | `./_deprecated_legacy_muapi/SettingsModal.js` (dynamic import, main.js + `../components/Header.js`) |
| `WorkflowStudio.js` | `./_deprecated_legacy_muapi/WorkflowStudio.js` (dynamic import) |
| `AgentStudio.js` | `./_deprecated_legacy_muapi/AgentStudio.js` (dynamic import) |
| `UploadPicker.js`, `AuthModal.js`, `muapi.js` | deprecated 폴더 내부 cross-import (업데이트 완료) |

## §3. 격리 후 남아 있는 reference

본 격리는 hosted MuAPI 표면을 폴더 단위로 격리한 것이며 다음 reference들은 의도적으로 그대로 유지된다. 첫째, `src/lib/pendingJobs.js` 안의 localStorage key `muapi_pending_jobs` (inert storage key, hosted 호출 없음). 둘째, `src/lib/uploadHistory.js` 안의 localStorage key `muapi_uploads` (inert storage key, hosted 호출 없음). 셋째, `src/lib/i18n.js` 안의 i18n strings `Muapi API Key`, `api.muapi.ai` (inert strings, 더 이상 UI에서 active 사용처 없음). 넷째, `docs/ui_integration/14_side_effect_audit.md` 안의 "MuAPI" audit 본문 (감사 산출물, historical record). 다섯째, `docs/ui_integration/owner_decision_summary_20260707.md` 안의 "MuAPI" override 근거 (override 결정 record).

위 reference들은 본 격리의 의도된 잔존이며 향후 다음 audit cycle에서 다음 중 하나로 처리된다. 첫째, `pendingJobs.js`와 `uploadHistory.js`의 localStorage key를 rename하여 hosted brand 흔적 제거. 둘째, `i18n.js`의 미사용 strings 제거. 셋째, audit/decision doc의 historical record는 그대로 보존(향후 reconcile 시 historical trace 용도).

## §4. 격리 후 안전 거동 보장

본 격리 후 본 repo의 local UI scaffold 안전 거동은 다음 4가지 측면에서 강화된다. 첫째, 파이프라인 UI surface (`src/components/pipeline/`)는 본 격리의 영향이 0건이며 19 패널 모두 그대로 동작한다. 둘째, `src/components/pipeline/ShotDesignerPanel.js`의 status badge 라벨이 `No MuAPI calls` → `No hosted API calls`로 sanitize되어 hosted brand 흔적 없이 안전 거동 사실을 명시한다. 셋째, `electron/main.js`의 web 보안 false 설정과 IPC bridge 표면은 변경되지 않으며 그대로 유지된다. 넷째, `src/lib/pipeline/` 안의 schema, validators, blockers, sideEffects, commandBuilders는 변경되지 않으며 그대로 유지된다.

## §5. 격리 후 향후 결정 사항

본 격리는 hosted MuAPI 표면을 폴더 단위로 격리한 것이며 본 repo의 production deployment에는 포함되지 않아야 한다. 향후 다음 4가지 결정이 Jessie에 의해 내려져야 한다. 첫째, 본 deprecated 폴더의 완전 삭제 여부. 둘째, `pendingJobs.js`, `uploadHistory.js`, `i18n.js`의 inert reference 정리 여부. 셋째, `src/main.js`의 legacy page routes (image, video, cinema, lipsync, workflows, agents, mcp-cli, settings) 제거 여부. 넷째, Sidebar.js 안의 image/video/library nav 항목이 legacy 페이지로 라우팅되는지 또는 신규 페이지로 라우팅되는지의 정리.

위 4가지 결정이 내려질 때까지 본 deprecated 폴더는 그대로 보존되며 본 격리 산출물은 git mv로 추적된다. 본 격리 결정은 `docs/ui_integration/15_legacy_muapi_isolation.md`에 기록되며 본 audit cycle의 후속 task 후보로 분리된다.

## §6. 격리 commit 정책

본 격리의 commit은 별도 task에서 Jessie 승인 후 진행한다. 본 task 동안 git add, git commit, git push 호출은 git mv를 제외하고는 일체 시도되지 않았다. 본 격리 후 git status에서 본 폴더 안 11개 파일은 `R` (renamed) 상태로 표시되며 src/main.js와 src/components/Header.js는 `M` (modified) 상태로 표시된다. 본 격리 산출물의 commit 결정은 Jessie 승인 후 별도 commit으로 진행한다.