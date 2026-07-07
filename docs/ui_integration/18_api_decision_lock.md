# 18. API 결정 lock — 외부 호출 surface 단일화 (2026-07-07)

## 헤드라인

**Owner 결정 (Jessie, 2026-07-07 승인):** 이 프로젝트(Open-Generative-AI fork)의 Cinematic Pipeline Studio는 **3개 skill surface** 만을 외부 호출 surface로 사용한다. 다른 어떤 image / video / research API도 직접 호출하지 않는다.

| 도메인 | 사용 skill | 글로벌 위치 | 호출 형태 |
|---|---|---|---|
| **이미지 (reference / scene)** | `deepsearch-team` | `/Users/jessiek/.codex/skills/deepsearch-team` | `dst image` 또는 `dst agent` 모드 (goldpure369) |
| **비디오 (Seedance / Dreamina)** | `dreamina-video-cli` | `/Users/jessiek/.codex/skills/dreamina-video-cli` | `dreamina` CLI (seedance2.0mini / fast / 2.0) |
| **비디오 (Google Labs Flow)** | `google-labs-flow-auto` | `/Users/jessiek/.codex/skills/google-labs-flow-auto` | `run_v3_gen.py` + Selenium/Chrome 자동화 |

**금지 표면 (forbidden surfaces):**

- **MuAPI / 호스팅 SaaS API** — `src/_deprecated_legacy_muapi/` 로 격리 완료. 라이브 호출 0.
- **OpenAI / Anthropic / Google Gemini API 직접 호출** — image / video 생성 목적 사용 금지 (review / 문서화 목적의 1-shot 호출은 별도 owner 승인 필요).
- **Replicate / Runway / Pika / Sora / Veo API 직접 호출** — 사용 금지.
- **기타 임의의 image / video 생성 endpoint** — 사용 금지.

---

## 결정의 의미

### 1. UI / Electron 측 contract 고정

`window.filmPipeline` 의 surface 중 외부 호출을 일으키는 것은 **단 3개** 뿐이다:

- `runSafeCommand` (preview 모드 / dry-run 만 허용, 라이브 호출은 future hook)
- `previewCommand` (외부 호출 command preview 만 생성, 실행 X)
- `progress` listener (lib 자체 진행률, 외부 호출 없음)

라이브 외부 호출은 owner 명시 승인 시에만 다음 3 surface 로만 나간다:

```text
runSafeCommand(dreamina, submit, ...)         # dreamina-video-cli CLI
runSafeCommand(dst, image, ...)                # deepsearch-team python -m dst
runSafeCommand(flow-auto, run_v3_gen.py, ...)  # google-labs-flow-auto Selenium
```

다른 표면 (Replicate / Runway / OpenAI 직접 / Anthropic 직접 / Gemini API 직접 / 기타 SaaS) 은 `runSafeCommand` 의 `executorKind` 화이트리스트에 들어가지 못한다.

### 2. 안전 상태 머신과의 정합

본 프로젝트의 safety state machine (`AGENTS.md` §0, `docs/ui_integration/14_side_effect_audit.md` §6 참조) 의 다음 전이들은 위 3 surface 만이 깨뜨릴 수 있다:

| 전이 | 깨뜨리는 surface |
|---|---|
| Planning complete → Generation submitted | `runSafeCommand(dreamina, submit, ...)` 또는 `dst image` |
| Image gen succeeded → Image QA approved | (외부 호출 없음, 사람 reviewer) |
| Clip downloaded → Output quality accepted | (외부 호출 없음, 사람 reviewer) |
| Whole clip gen → Accepted seconds selected | (외부 호출 없음, 사람 reviewer) |

따라서 **이 3 surface 가 호출되지 않는 한 어떤 라이브 외부 호출도 일어나지 않는다.** 이 점이 본 프로젝트의 safety invariant 의 핵심이다.

### 3. Electron 측 executor 화이트리스트

`electron/lib/filmPipelineProvider.js` 의 `runSafeCommand` handler 는 다음 화이트리스트로 제한한다 (구현 시 박을 것):

```js
const LIVE_EXECUTOR_ALLOWLIST = new Set([
  'dreamina',
  'dst',
  'flow-auto',
]);
```

화이트리스트 외 `executorKind` 가 들어오면 `preview-only` 모드로 강제 다운그레이드 (실행 X, command preview 만 emit).

### 4. 보고 의무

- `docs/harness/shorts-SKILL.md`, `docs/harness/Seedance2-SKILL.md` 는 본 결정 lock 을 §0 (안전 invariant) 에 명시한다.
- 모든 panel-side 호출 로그 (`docs/ui_integration/checkpoints/evidence_*.md` 와 future ledger) 는 위 3 surface 만 기록한다. 다른 surface 흔적이 발견되면 즉시 owner escalation.

---

## 적용 범위

| 파일 | 적용 방식 |
|---|---|
| `electron/lib/filmPipelineProvider.js` | `LIVE_EXECUTOR_ALLOWLIST` 추가 (구현 시) |
| `src/_deprecated_legacy_muapi/README.md` | 이미 legacy 격리 완료 — 변경 없음 |
| `docs/harness/shorts-SKILL.md` | §0 에 본 결정 verbatim 인용 |
| `docs/harness/Seedance2-SKILL.md` | §0 에 본 결정 verbatim 인용 |
| `docs/ui_integration/02_implementation_plan.md` | §3 호출 surface 표에 본 결정 반영 |
| `docs/ui_integration/14_side_effect_audit.md` | §6.7 권고 섹션에 본 결정 명시 (선택 보강) |

---

## 향후 변경 절차

이 화이트리스트에 surface 를 추가하려면 다음이 모두 필요하다:

1. Owner 명시 승인 (이번처럼 메시지로 결정 lock)
2. `docs/ui_integration/` 에 새 `XX_new_surface_decision.md` 작성 (현재 surface, 호출 형태, 비용 / credit 영향, 안전 분석)
3. `electron/lib/filmPipelineProvider.js` 의 `LIVE_EXECUTOR_ALLOWLIST` 갱신
4. `docs/harness/*` §0 에 새 surface 추가 인용
5. 새로운 §X side-effect audit (필요 시)

이 절차 없이 추가된 surface 는 즉시 `preview-only` 모드로 다운그레이드되며, owner escalation 대상이 된다.

---

## 결정 일자 / 승인자

- **일자:** 2026-07-07 (Asia/Seoul)
- **승인자:** Jessie
- **결정 lock 코드:** `API_DECISION_2026_07_07_3SURFACE_LOCK`
- **연관 문서:** `14_side_effect_audit.md` §6, `02_implementation_plan.md` §3 (갱신 대상), `shorts-SKILL.md` §0 / `Seedance2-SKILL.md` §0 (인용 대상)