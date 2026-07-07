# evidence_00 — 00_repo_audit 증거 자료

수집 시각: 2026-07-07 00:21 KST
수집 대상: `/Users/jessiek/StudioProjects/Open-Generative-AI`
본 파일은 `docs/ui_integration/00_repo_audit.md`의 증거 자료 모음이다. 본문에는 1줄 reference만 두고 verbatim 출력은 본 파일이 보관한다.

## 1. 작업트리 상태 (git status --short)

verbatim:

```text
 M electron/main.js
 M electron/preload.js
 M src/components/Sidebar.js
 M src/main.js
?? .mavis/
?? .mavis_decision/
?? AGENTS.md
?? docs/ui_integration/
?? electron/lib/filmPipelineProvider.js
?? electron/lib/productionReader.js
?? scripts/test_pipeline_validators.js
?? src/components/pipeline/
?? src/fixtures/
?? src/lib/pipeline/
?? tests/pipelineQueueRules.test.mjs
```

해석: modified 4건은 이전 task A-L의 진입점 추가 산출물이다. untracked 항목은 task A-L의 신규 surface와 본 task의 4개 audit 문서와 4개 evidence 파일이다.

## 2. 테스트 결과 (node scripts/test_pipeline_validators.js)

verbatim (마지막 20줄):

```text
✔ final ready is false when final.mp4 evidence is missing (0.138833ms)
✔ image dashboard is stale when asset or review files are newer than dashboard timestamp (0.110125ms)
✔ attached image RETRY BLOCK or UNREVIEWED blocks submit unless explicit exception exists (0.1535ms)
✔ final ready is false when ffprobe verification evidence is missing (0.167875ms)
✔ production reader prefers edit/accepted_seconds.md when present (5.686458ms)
✔ final ready fixture passes strict readiness and exposes clip evidence rows (0.447083ms)
✔ not-ready final fixture reports missing final stitch (0.160417ms)
✔ final stitch preview commands remain non-executing previews (0.371375ms)
✔ withWan2gpAvailability marks models unavailable when the server probe fails (0.581583ms)
✔ withWan2gpAvailability uses resolved api_name when endpoint metadata matches (0.0675ms)
✔ withWan2gpAvailability keeps default api_name available when Gradio omits endpoint metadata (0.096666ms)
✔ withWan2gpAvailability rejects unmatched models when endpoint metadata is present (0.054959ms)
ℹ tests 45
ℹ suites 0
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 609.508667
```

해석: 45개 테스트 모두 PASS, 0 fail. 본 task 종료 시 재실행해도 동일 결과를 내야 한다.

## 3. DeepSearchTeam scene image 테스트

verbatim (마지막 15줄):

```text
(node:76468) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/jessiek/StudioProjects/Open-Generative-AI/src/lib/pipeline/blockers.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/jessiek/StudioProjects/Open-Generative-AI/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ storyboard clips become DeepSearchTeam scene image payloads (0.713125ms)
✔ DeepSearchTeam image prompt encodes one-image and operator gates (0.303917ms)
✔ DeepSearchTeam image command is preview-only and blocked as credit-consuming generation (0.730875ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 570.273292
```

해석: 3개 테스트 모두 PASS. `MODULE_TYPELESS_PACKAGE_JSON` 경고는 정보성이며, `package.json`의 `"type": "module"` 추가는 blast radius 때문에 13_agent_handoff.md 명시대로 본 task가 수행하지 않는다.

## 4. whitespace 검사 (git diff --check)

verbatim: (출력 없음, exit 0)

해석: whitespace / line-ending 충돌 없음, clean 상태.

## 5. self-check 결과 (한글비중)

본 task self-check 단계에서 실행한 결과 (verbatim):

```text
docs/ui_integration/00_repo_audit.md: total=    7078 hangul=4367 ratio=61%
docs/ui_integration/01_harness_to_ui_contract.md: total=   18974 hangul=10879 ratio=57%
docs/ui_integration/02_implementation_plan.md: total=   17101 hangul=10334 ratio=60%
docs/ui_integration/03_shell_implementation_report.md: total=   17455 hangul=9843 ratio=56%
```

해석: 4개 문서 모두 한글비중 55% 이상 통과. 모두 한글 4000자 이상.

## 6. 신규 4개 문서 존재 확인

본 task 종료 시 별도 검증 단계에서 `ls -la`로 4개 파일이 모두 0 byte가 아닌지, 한글비중 55% 임계치를 통과했는지 본 evidence 파일 §5와 대조한다.
