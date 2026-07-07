# Legacy MuAPI 격리 결정 문서 (15)

작성일: 2026-07-07 KST. 결정자: opencode session. 본 문서는 `docs/ui_integration/14_side_effect_audit.md` §7.2 후속 task 후보 첫째 항목 "레거시 MuAPI 표면 격리 task"의 격리 결정 산출물이다.

## §1. 격리 의의

본 격리는 본 repo의 hosted MuAPI 표면을 파이프라인 UI surface에서 분리하기 위한 작업이다. AGENTS.md는 "Remove or isolate MuAPI, hosted account, balance, marketing, agents, and subscription assumptions" 정책을 명시하며 본 repo의 local UI scaffold는 hosted MuAPI 호출을 일체 사용하지 않는다. 따라서 hosted MuAPI 흔적은 deprecated 격리 대상이 된다.

## §2. 격리 대상

격리 대상 11개 파일은 다음과 같다. 첫째, `src/lib/muapi.js` (hosted MuAPI client). 둘째, `src/components/ImageStudio.js`. 셋째, `src/components/VideoStudio.js`. 넷째, `src/components/CinemaStudio.js`. 다섯째, `src/components/LipSyncStudio.js`. 여섯째, `src/components/McpCliStudio.js`. 일곱째, `src/components/UploadPicker.js`. 여덟째, `src/components/AuthModal.js`. 아홉째, `src/components/SettingsModal.js`. 열째, `src/components/WorkflowStudio.js`. 열한째, `src/components/AgentStudio.js`.

본 11개 파일은 모두 `src/_deprecated_legacy_muapi/` 폴더로 `git mv` 되었다. 본 폴더는 hosted MuAPI 표면 격리의 단일 출처이며 향후 Jessie 결정에 따라 완전 삭제되거나 archived repo로 이동될 수 있다.

## §3. 격리 방식

격리 방식은 폴더 단위 이동이다. 본 방식은 다음 4가지 장점을 가진다. 첫째, 코드 본문은 변경되지 않으며 git mv만 수행된다 (surgical). 둘째, import 경로만 업데이트되며 외부 API는 변경되지 않는다. 셋째, 격리 폴더가 명확히 표시되어 다음 audit cycle에서 외부 source 매치 감소를 즉시 검증할 수 있다. 넷째, 향후 완전 삭제 결정이 쉽다 (rm -rf src/_deprecated_legacy_muapi/ 한 줄로 완료).

본 격리는 다음 4가지 import 경로 업데이트를 동반한다. 첫째, `src/main.js`의 8개 component import 경로 (ImageStudio, VideoStudio, CinemaStudio, LipSyncStudio, McpCliStudio, SettingsModal, WorkflowStudio, AgentStudio). 둘째, `src/components/Header.js`의 SettingsModal import 경로. 셋째, deprecated 폴더 내부 cross-import 3건 (`CinemaStudio.js` → `../components/CameraControls.js`, `SettingsModal.js` → `../components/LocalModelManager.js`, `muapi.js` → `../lib/models.js`). 넷째, `src/components/pipeline/ShotDesignerPanel.js`의 status badge 라벨 (`No MuAPI calls` → `No hosted API calls`).

## §4. 격리 후 의존성 그래프

격리 후 본 repo의 의존성 그래프는 다음과 같다. 첫째, `src/main.js` → `_deprecated_legacy_muapi/ImageStudio.js` (legacy). 둘째, `src/main.js` → `_deprecated_legacy_muapi/VideoStudio.js` (legacy). 셋째, `src/main.js` → `_deprecated_legacy_muapi/CinemaStudio.js` (legacy). 넷째, `src/main.js` → `_deprecated_legacy_muapi/LipSyncStudio.js` (legacy). 다섯째, `src/main.js` → `_deprecated_legacy_muapi/McpCliStudio.js` (legacy). 여섯째, `src/main.js` → `_deprecated_legacy_muapi/SettingsModal.js` (legacy). 일곱째, `src/main.js` → `_deprecated_legacy_muapi/WorkflowStudio.js` (legacy). 여덟째, `src/main.js` → `_deprecated_legacy_muapi/AgentStudio.js` (legacy). 아홉째, `src/components/Header.js` → `_deprecated_legacy_muapi/SettingsModal.js` (legacy). 열째, `src/components/pipeline/PipelineStudio.js` → `src/components/pipeline/*Panel.js` (신규). 열한째, deprecated 폴더 내부 cross-import는 8개 (AuthModal↔UploadPicker↔LipSync/Video/Cinema/Image).

## §5. 격리 후 검증

본 격리 후 다음 5가지 항목을 verify 한다. 첫째, `rg -n "muapi|MuAPI" src/components/pipeline/` 0건이어야 한다. 둘째, `rg -n "from .*components/" src/_deprecated_legacy_muapi/` 결과는 cross-import 8건만 매치되어야 한다. 셋째, `rg -n "from .*components/" src/_deprecated_legacy_muapi/CinemaStudio.js` 결과는 `../components/CameraControls.js` 1건만 매치되어야 한다. 넷째, `rg -n "from .*components/" src/_deprecated_legacy_muapi/SettingsModal.js` 결과는 `../components/LocalModelManager.js` 1건만 매치되어야 한다. 다섯째, `node --check src/_deprecated_legacy_muapi/*.js` 결과는 11개 파일 모두 syntax error 0건이어야 한다.

위 5가지 verify 항목은 본 격리 결정 후 자동 또는 반자동으로 검증될 수 있다.

## §6. 격리 결정의 한계 인정

본 격리는 hosted MuAPI 표면을 폴더 단위로 격리한 것이며 다음 한계를 가진다. 첫째, deprecated 폴더의 코드는 여전히 본 repo에 남아 있다. 향후 완전 삭제는 Jessie 결정 후 별도 commit으로 진행된다. 둘째, `pendingJobs.js`, `uploadHistory.js`, `i18n.js`의 inert reference는 그대로 유지된다. 셋째, `src/main.js`의 legacy page routes는 그대로 유지된다. 넷째, Sidebar.js의 image/video nav 항목은 여전히 legacy 페이지로 라우팅된다.

위 한계는 본 격리의 의도된 잔존이며 향후 Jessie 결정에 따라 추가 격리 또는 완전 삭제로 진행된다.

## §7. 격리 commit 결정

본 격리 결정의 commit은 별도 task에서 Jessie 승인 후 진행한다. 본 task 동안 git mv를 제외한 git add, git commit, git push 호출은 일체 시도되지 않았다. 본 격리 결정은 owner 보고 후 Jessie 승인을 받으며 그 후 별도 commit으로 진행된다.

## §8. 격리 후 후속 task

본 격리 후 다음 4가지 후속 task가 Jessie 결정으로 진행될 수 있다. 첫째, deprecated 폴더의 완전 삭제 (commit 후 rm -rf). 둘째, `pendingJobs.js`, `uploadHistory.js`, `i18n.js`의 inert reference 정리. 셋째, `src/main.js`의 legacy page routes 제거. 넷째, Sidebar.js의 image/video nav 항목 라우팅 정리.

위 4가지 후속 task는 본 격리의 일부가 아니며 별도 task로 진행된다. 본 격리는 위 4가지 후속 task의 prerequisite이며 본 격리 완료 후 위 4가지 후속 task를 안전하게 진행할 수 있다.