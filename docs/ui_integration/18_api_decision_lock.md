# 18. API 결정 lock — 외부 호출 surface와 실제 연결 상태 (2026-07-15)

## 헤드라인

**현재 Owner 방향 (Jessie, 2026-07-15):** 이미지 생성은 deepsearch-team의 `dst image` goldpure369 Thinking만 사용한다. 비디오 생성 후보는 `google-labs-flow-auto`, `grok-imagine`, Replicate API, ByteDance API다. 이는 아래에 보존한 2026-07-07의 3-surface 결정을 대체한다.

| 도메인 | 후보 surface | 호출 형태 | 현재 Open-Generative-AI 상태 |
|---|---|---|---|
| **이미지 (reference / scene)** | `deepsearch-team` | `dst image` · profile `goldpure369` · Thinking | main-owned 재시도 계획과 명령 미리보기 연결, live 실행 adapter 없음 |
| **비디오 (Google Labs Flow)** | `google-labs-flow-auto` | no-submit command preview | main-owned no-submit 미리보기 연결, 제출·브라우저 자동화는 연결되지 않음 |
| **비디오 (Grok)** | `grok-imagine` | 로컬 CLI 후보 | CLI는 탐지됐으나 runtime dependency와 reference staging 계약 미충족으로 `BLOCK` |
| **비디오 (Replicate)** | Replicate API | 외부 Seedance adapter 후보 | 외부 후보만 탐지, `MISSING_PROVIDER_ADAPTER` |
| **비디오 (ByteDance)** | ByteDance/Volcengine API | 외부 Seedance adapter 후보 | 외부 후보만 탐지, `MISSING_PROVIDER_ADAPTER` |

위 표는 후보 방향과 현재 연결 상태를 분리한다. 후보로 지정됐다는 사실은 라이브 제출 가능, 생성 성공, 다운로드 완료 또는 출력 품질 승인을 뜻하지 않는다.

**계속 금지되는 표면:**

- **MuAPI / 호스팅 SaaS API** — `src/_deprecated_legacy_muapi/` 로 격리 완료. 라이브 호출 0.
- **OpenAI / Anthropic / Google Gemini API 직접 호출** — image / video 생성 목적 사용 금지 (review / 문서화 목적의 1-shot 호출은 별도 owner 승인 필요).
- **Runway / Pika / Sora / Veo 및 승인되지 않은 임의 API 직접 호출** — 사용 금지.
- **기타 임의의 image / video 생성 endpoint** — 사용 금지.

---

## 결정의 의미

### 1. UI / Electron 측 contract 고정

Renderer는 셸, CLI, API를 직접 실행하지 않는다. Renderer가 요청한 실행 계획은 `window.filmPipeline`을 거쳐 Electron main이 소유한 provider allowlist, 입력 검증, 출력 경로, side-effect 분류와 불변 계획으로 변환되어야 한다.

- `previewCommand`: 외부 호출 command preview만 생성, 실행하지 않는다.
- `runSafeCommand`: 현재 provider adapter가 확인되기 전에는 실행하지 않는다.
- `progress` listener: 로컬 진행 상태만 표시하며 외부 호출을 만들지 않는다.

현재 표시 가능한 계획은 다음처럼 모두 fail-closed다:

```text
previewCommand(dst-image, ...)         # goldpure369 Thinking, no submit
previewCommand(flow-auto, ...)         # no-submit preview contract
BLOCK(grok-imagine)                    # runtime dependency missing
MISSING_PROVIDER_ADAPTER(replicate)    # external candidate only
MISSING_PROVIDER_ADAPTER(bytedance)    # external candidate only
```

기본 모드는 `preview_only` 또는 `dry_run`이다. `.env`나 API key를 Renderer가 읽거나 저장해서는 안 되며, Electron main도 Jessie의 사전 승인 없이 키를 사용하지 않는다.
Renderer가 보낸 범용 command spec은 클립보드에도 복사하지 않는다. provider 실행·복사는 future main-owned plan token과 최신 production 재검증이 구현되기 전까지 차단한다.

### 2. 안전 상태 머신과의 정합

본 프로젝트의 safety state machine (`AGENTS.md` §0, `docs/ui_integration/14_side_effect_audit.md` §6 참조)은 provider 후보와 실행 사실을 분리한다:

| 전이 | 깨뜨리는 surface |
|---|---|
| Planning complete → Generation submitted | 현재 어떤 후보도 Open-Generative-AI에서 이 전이를 수행하지 않음 |
| Image gen succeeded → Image QA approved | (외부 호출 없음, 사람 reviewer) |
| Clip downloaded → Output quality accepted | (외부 호출 없음, 사람 reviewer) |
| Whole clip gen → Accepted seconds selected | (외부 호출 없음, 사람 reviewer) |

따라서 라이브 생성이 성공해도 결과물 품질은 자동 승인되지 않는다. 다운로드된 이미지·영상은 별도 QA와 Jessie의 최종 검토 전까지 `UNREVIEWED`다.

### 3. Electron 측 executor 화이트리스트

`electron/lib/filmPipelineProvider.js`의 future 실행 hook은 provider 이름만으로 열지 않는다. main-owned allowlist와 불변 execution plan이 모두 준비된 adapter만 등록한다:

```js
const LIVE_EXECUTOR_ALLOWLIST = new Set([
  // empty until a provider adapter is implemented and verified
]);
```

화이트리스트 밖 provider, 계획 hash 불일치, 출력 root 이탈, credential 미승인, runtime dependency 누락은 실행하지 않고 각각 `MISSING_PROVIDER_ADAPTER`, `PIPELINE_COMMAND_BLOCKED` 또는 provider별 `BLOCK` 상태로 남긴다.

### 4. 보고 의무

- `docs/harness/shorts-SKILL.md`, `docs/harness/Seedance2-SKILL.md`는 현재 owner 방향과 adapter 상태를 §11에 명시한다.
- future ledger는 provider 후보, preview, 실제 제출, 다운로드, QA와 사람 승인을 서로 다른 상태로 기록한다.

---

## 적용 범위

| 파일 | 적용 방식 |
|---|---|
| `electron/lib/filmPipelineProvider.js` | verified provider adapter만 main-owned allowlist/plan으로 추가 (future) |
| `src/_deprecated_legacy_muapi/README.md` | 이미 legacy 격리 완료 — 변경 없음 |
| `docs/harness/shorts-SKILL.md` | §11에 현재 방향과 adapter 상태 반영 |
| `docs/harness/Seedance2-SKILL.md` | §11에 현재 방향과 adapter 상태 반영 |
| `docs/ui_integration/02_implementation_plan.md` | §3 호출 surface 표에 본 결정 반영 |
| `docs/ui_integration/14_side_effect_audit.md` | §6.7 권고 섹션에 본 결정 명시 (선택 보강) |

---

## 향후 변경 절차

실행 surface를 추가하려면 다음이 모두 필요하다:

1. 현재 owner 방향 안의 provider임을 확인
2. Electron main-owned adapter, 입력 allowlist, 출력 root와 불변 실행 계획 구현
3. credential을 Renderer와 repo에 노출하지 않고 사전 승인 뒤에만 사용
4. preview/dry-run 검증과 별도의 라이브 실행 증거 기록
5. 생성 성공과 출력 품질/사람 승인을 분리 기록

이 조건을 충족하지 못한 surface는 `preview_only`, `BLOCK` 또는 `MISSING_PROVIDER_ADAPTER`로 유지한다.

---

## 결정 일자 / 승인자

- **현재 방향 일자:** 2026-07-15 (Asia/Seoul)
- **승인자:** Jessie
- **현재 결정 코드:** `API_DIRECTION_2026_07_15_PROVIDER_CANDIDATES`
- **역사적 결정:** `API_DECISION_2026_07_07_3SURFACE_LOCK`은 당시 승인 사실로 보존하되 현재 방향에 의해 superseded됨
- **연관 문서:** `14_side_effect_audit.md` §6, `02_implementation_plan.md` §3 (갱신 대상), `shorts-SKILL.md` §11 / `Seedance2-SKILL.md` §11
