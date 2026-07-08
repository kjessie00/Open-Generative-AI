# 19. Legacy MuAPI 폴더 완전 정리 (2026-07-08)

## 배경

`15_legacy_muapi_isolation.md` 단계에서 hosted MuAPI 표면을 `src/_deprecated_legacy_muapi/` 폴더로 격리 완료.
그 후 nav 정리(task-A) 와 prod-folder-detect(task-B) 로 메인 UI 가 단일 pipeline 페이지로 수렴하면서,
격리 폴더 안의 11개 파일 중 10개가 dead state 가 되었다.

본 doc 는 Jessie 결정에 따라 dead 10개 + dead shim 1개 + dead Sidebar.js 1개를 정리한 commit 의
근거를 보존한다.

## 정리 범위 (총 13개 파일)

### 이동 (1)
| from | to | 사유 |
|---|---|---|
| `src/_deprecated_legacy_muapi/SettingsModal.js` | `src/components/SettingsModal.js` | 본 modal 은 hosted MuAPI 표면이 아니라 로컬 settings UI 이다. 격리 폴더의 단일 출처 원칙에 따라 밖으로 이동. Header.js(main.js 와 동등)와 main.js 의 dynamic import 양쪽에서 live consume 중. |

### 삭제 (deprecated 폴더, 10)
| 파일 | 사유 |
|---|---|
| `src/_deprecated_legacy_muapi/ImageStudio.js` | 7개 legacy studio. nav 정리 후 라우트 0건. |
| `src/_deprecated_legacy_muapi/VideoStudio.js` | 동일 |
| `src/_deprecated_legacy_muapi/CinemaStudio.js` | 동일 |
| `src/_deprecated_legacy_muapi/LipSyncStudio.js` | 동일 |
| `src/_deprecated_legacy_muapi/McpCliStudio.js` | 동일 |
| `src/_deprecated_legacy_muapi/WorkflowStudio.js` | 동일 |
| `src/_deprecated_legacy_muapi/AgentStudio.js` | 동일 |
| `src/_deprecated_legacy_muapi/UploadPicker.js` | 4개 dead studio(Image/Video/Cinema/LipSync) 의 헬퍼. |
| `src/_deprecated_legacy_muapi/AuthModal.js` | 4개 dead studio + UploadPicker 의 헬퍼. |
| `src/_deprecated_legacy_muapi/muapi.js` | hosted MuAPI 클라이언트 본체. dead studio 들만 consume. |
| `src/_deprecated_legacy_muapi/README.md` | 폴더와 함께 삭제 (folder 단위 이동 정책의 README). |

### 삭제 (외부, 2)
| 파일 | 사유 |
|---|---|
| `src/lib/muapi.js` | re-export shim. consume 측 0건 (오직 dead `_deprecated_legacy_muapi/muapi.js` 를 re-export). |
| `src/components/Sidebar.js` | legacy placeholder. `src/components/pipeline/PipelineSidebar.js` 가 신규. main.js / Header.js / 어디서도 import 하지 않음. |

## import 업데이트 (2)

| 파일 | 변경 |
|---|---|
| `src/components/Header.js` | `from '../_deprecated_legacy_muapi/SettingsModal.js'` → `from './SettingsModal.js'` (static import — Step 3 에서 dynamic 으로 전환 예정, warning 잔존) |
| `src/main.js` | dynamic import 경로 `'./_deprecated_legacy_muapi/SettingsModal.js'` → `'./components/SettingsModal.js'` |

## 검증

- `rg "_deprecated_legacy_muapi" src/ electron/` → 0 hit
- `rg "lib/muapi" src/ electron/` → 0 hit
- `rg "components/Sidebar" src/ electron/` → 0 hit
- `node --test tests/*.test.mjs` → **19/19 PASS**
- `npm run vite:build` → ✓ built in 793ms, 39 modules, 1 warning (Step 3 작업)

## 의도적 비-변경

- `docs/ui_integration/15_legacy_muapi_isolation.md` 는 격리 단계의 historical decision lock 으로 보존.
  본 doc (`19_*`) 가 후속 commit 의 근거를 별도로 기록.
- Sidebar.js / muapi shim / 11개 studio 의 dead reference 가 docs/* lineage 에 다수 인용되어 있으나
  본 commit 은 코드 변경만 다룬다. docs 갱신은 별도 task 로 보류 (의미 있는 깨짐 0건, search 시 hit 만 됨).

## 후속 task (Step 3)

- `src/components/Header.js` 의 SettingsModal static import → dynamic import 전환
- `npm run vite:build` warning 0건 확인
- 별도 worktree `fix/settings-modal-static-import` → main 머지
