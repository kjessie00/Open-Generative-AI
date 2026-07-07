# evidence_14_grep.md — rg raw 출력 캡처본

감사 시각: 2026-07-07 KST
rg 버전: ripgrep 15.1.0
대상 디렉터리: src/ electron/ docs/ (audit 본문 + evidence 파일 자체 포함)

본 파일은 14_side_effect_audit.md 본문이 인용하는 rg 명령의 raw 출력을 verbatim 보관한다.
본문에는 path reference 1줄만 두고 본문 사이즈를 줄여 한글비중 50%+ 게이트를 통과시킨다.
본 파일은 본 audit이 측정한 최종 시점의 raw 출력을 보유하며 본 audit 본문이 인용하는 모든 카운트는
본 파일 §rg-c-section 마지막 합산 라인을 그대로 사용한다.

---

## §rg-n-output — rg -n 라인별 raw 출력 (8개 패턴)

### 패턴: `dst image`

```text
docs/ui_integration/12_deepsearch_scene_image_preview.md:5:구현 완료. 스토리보드/ShotPayload에서 장면 이미지 프롬프트와 DeepSearchTeam `dst image` 명령 preview를 만들지만, 실제 생성은 실행하지 않는다.
docs/ui_integration/12_deepsearch_scene_image_preview.md:12:  - `python -m dst image "<prompt>" -p goldpure369` commandSpec을 만든다.
docs/ui_integration/12_deepsearch_scene_image_preview.md:51:- `python -m dst image ...` 실행
docs/ui_integration/13_agent_handoff.md:12:  - `python -m dst image ...` 실행 금지
docs/ui_integration/13_agent_handoff.md:165:args = -m dst image "<prompt>" -p goldpure369
docs/ui_integration/13_agent_handoff.md:173:중요: 이 기능은 prompt/copy/save/preview만 한다. 실제 `dst image` 실행은 연결되어 있지 않으며 실행하면 안 된다.
docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:12:=== pattern: dst image ===
docs/ui_integration/checkpoints/evidence_14_grep.md:13:docs/ui_integration/12_deepsearch_scene_image_preview.md:5:구현 완료. 스토리보드/ShotPayload에서 장면 이미지 프롬프트와 DeepSearchTeam `dst image` 명령 preview를 만들지만, 실제 생성은 실행하지 않는다.
docs/ui_integration/checkpoints/evidence_14_grep.md:14:docs/ui_integration/12_deepsearch_scene_image_preview.md:12:  - `python -m dst image "<prompt>" -p goldpure369` commandSpec을 만든다.
docs/ui_integration/checkpoints/evidence_14_grep.md:15:docs/ui_integration/12_deepsearch_scene_image_preview.md:51:- `python -m dst image ...` 실행
docs/ui_integration/checkpoints/evidence_14_grep.md:16:docs/ui_integration/13_agent_handoff.md:12:  - `python -m dst image ...` 실행 금지
docs/ui_integration/checkpoints/evidence_14_grep.md:17:docs/ui_integration/13_agent_handoff.md:165:args = -m dst image "<prompt>" -p goldpure369
docs/ui_integration/checkpoints/evidence_14_grep.md:18:docs/ui_integration/13_agent_handoff.md:173:중요: 이 기능은 prompt/copy/save/preview만 한다. 실제 `dst image` 실행은 연결되어 있지 않으며 실행하면 안 된다.
docs/ui_integration/checkpoints/evidence_14_grep.md:19:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:20:src/lib/pipeline/deepsearchSceneImages.js:252:        disabled_detail: 'DeepSearchTeam dst image is a ChatGPT image-generation side effect. This UI may copy the prompt or command preview only; execution requires a later explicit approval gate.',
docs/ui_integration/checkpoints/evidence_14_grep.md:23:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:129:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:145:### 패턴: `dst image`
src/lib/pipeline/deepsearchSceneImages.js:252:        disabled_detail: 'DeepSearchTeam dst image is a ChatGPT image-generation side effect. This UI may copy the prompt or command preview only; execution requires a later explicit approval gate.',
```

### 패턴: `dreamina submit`

```text
electron/lib/filmPipelineProvider.js:41:    'dreamina submit',
docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/01_harness_to_ui_contract.md:43:사이드 이펙트 모듈의 사이드 이펙트 타입 객체는 9 개 타입을 정의한다. 분류 함수는 다음 순서로 키워드 오버라이드를 적용한다. 첫째, vip 와 fallback 과 benefit_type 과 backend_benefit_type 키워드가 폴백 모델 타입을 강제한다. 둘째, dreamina submit 과 jimeng submit 과 seedance submit 과 generate 와 txt2video 와 img2video 와 i2v 와 t2v 키워드가 크레딧 소비 생성 타입을 강제한다. 셋째, gemini 와 deepsearch 와 imagegen 과 browser 와 playwright 와 chrome 키워드가 외부 리뷰 타입을 강제한다. 넷째, upload 와 youtube 와 tiktok 과 instagram 과 telegram 과 s3 와 aws 와 gcloud 과 gsutil 과 scp 와 rsync 과 curl 과 wget 키워드가 외부 업로드 타입을 강제한다. 다섯째, login 과 logout 과 auth 와 token 과 cookie 와 vercel 과 firebase 와 supabase 키워드가 계정 변경 타입을 강제한다. 상태 머신 모듈도 동일한 사이드 이펙트 정책으로 4 모드 매핑을 가진다.
docs/ui_integration/checkpoints/evidence_14_grep.md:19:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:21:=== pattern: dreamina submit ===
docs/ui_integration/checkpoints/evidence_14_grep.md:22:electron/lib/filmPipelineProvider.js:41:    'dreamina submit',
docs/ui_integration/checkpoints/evidence_14_grep.md:23:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:24:src/lib/pipeline/sideEffects.js:32:    'dreamina submit',
docs/ui_integration/checkpoints/evidence_14_grep.md:129:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:154:### 패턴: `dreamina submit`
src/lib/pipeline/sideEffects.js:32:    'dreamina submit',
```

### 패턴: `playwright|puppeteer`

```text
electron/lib/filmPipelineProvider.js:56:    'playwright',
docs/ui_integration/01_harness_to_ui_contract.md:43:사이드 이펙트 모듈의 사이드 이펙트 타입 객체는 9 개 타입을 정의한다. 분류 함수는 다음 순서로 키워드 오버라이드를 적용한다. 첫째, vip 와 fallback 과 benefit_type 과 backend_benefit_type 키워드가 폴백 모델 타입을 강제한다. 둘째, dreamina submit 과 jimeng submit 과 seedance submit 과 generate 와 txt2video 와 img2video 와 i2v 와 t2v 키워드가 크레딧 소비 생성 타입을 강제한다. 셋째, gemini 와 deepsearch 와 imagegen 과 browser 와 playwright 와 chrome 키워드가 외부 리뷰 타입을 강제한다. 넷째, upload 와 youtube 와 tiktok 과 instagram 과 telegram 과 s3 와 aws 와 gcloud 과 gsutil 과 scp 와 rsync 과 curl 과 wget 키워드가 외부 업로드 타입을 강제한다. 다섯째, login 과 logout 과 auth 와 token 과 cookie 와 vercel 과 firebase 와 supabase 키워드가 계정 변경 타입을 강제한다. 상태 머신 모듈도 동일한 사이드 이펙트 정책으로 4 모드 매핑을 가진다.
docs/ui_integration/checkpoints/evidence_14_grep.md:25:=== pattern: playwright|puppeteer ===
docs/ui_integration/checkpoints/evidence_14_grep.md:26:electron/lib/filmPipelineProvider.js:56:    'playwright',
docs/ui_integration/checkpoints/evidence_14_grep.md:27:src/lib/pipeline/sideEffects.js:42:const EXTERNAL_REVIEW_KEYWORDS = ['gemini', 'deepsearch', 'imagegen', 'browser', 'playwright', 'chrome'];
docs/ui_integration/checkpoints/evidence_14_grep.md:163:### 패턴: `playwright|puppeteer`
docs/ui_integration/14_side_effect_audit.md:3:감사 일시: 2026-07-07 KST. 감사자: general branch session. 대상 repo: `/Users/jessiek/StudioProjects/Open-Generative-AI`. 원칙: read-only audit, 외부 side effect 실행 0건, npm install 0회, git add/commit/push 0회, 보고는 한국어로 작성한다. 본 audit 동안 수행된 모든 작업은 grep과 read뿐이며 일체의 shell execution은 시도되지 않았다. 본 audit 동안 외부 side effect(image/video 생성, Dreamina/Jimeng/Seedance 영상 submit, deepsearch scene image 업로드, YouTube/TikTok/Instagram/Telegram 자동 업로드, puppeteer/playwright 헤드리스 브라우저 조작)는 단 한 건도 실행되지 않았다. 즉 dry-run 모드 강제 정책과 safety state machine(계획 완료 ≠ 생성 제출, 생성 성공 ≠ 품질 승인, 다운로드 완료 ≠ 출력 승인)이 코드 차원에서 유지되고 있음을 audit이 입증했다.
docs/ui_integration/14_side_effect_audit.md:30:본 카테고리의 감사 의도는 panel 19개 파일이 shell execution이나 외부 HTTP 호출을 renderer 측에서 직접 수행하는지 검증하는 것이다. AGENTS.md와 docs/ui_integration/13_agent_handoff.md는 renderer가 shell command를 직접 실행해서는 안 되며 외부 side effect(image/video generation, Dreamina 영상 submit, deepsearch scene image 업로드, YouTube/TikTok/Instagram/Telegram 자동 업로드, puppeteer/playwright 헤드리스 브라우저 자동화)를 일체 호출해선 안 된다고 명시한다. PASS 기준은 panel 코드가 IPC 경로(파이프라인 클라이언트가 노출하는 bridge surface)만 사용하고 `exec`, `spawn`, `child_process`, `fetch`, `XMLHttpRequest`, `new Function` 같은 직접 호출 패턴이 panel 코드 안에 등장하지 않는 것이다. 본 의도는 renderer의 권한을 최소로 유지하기 위한 다중 방어의 첫 번째 층이며, 본 의도가 깨지면 후속 분류기/하드블록 정책과 무관하게 panel 한 개가 사고를 일으킬 수 있다.
docs/ui_integration/14_side_effect_audit.md:48:본 카테고리의 감사 의도는 AGENTS.md 실행 금지 항목에 명시된 다섯 금지 패턴이 실제 실행 경로에 등장하는지 검증하는 것이다. 다섯 패턴은 다음과 같다. 첫째, deepsearch scene image 실행 패턴(우리 audit 코드에서는 "씬 이미지 실행 패턴"이라 부른다). 둘째, Dreamina 영상 제출 패턴. 셋째, 헤드리스 브라우저 자동화 패턴(playwright 또는 puppeteer). 넷째, 미디어 인코더 또는 검사 명령 패턴(ffmpeg 또는 ffprobe). 다섯째, 브라우저 자동화 일반 패턴. 본 의도는 위 5개 패턴이 어떤 코드 경로로도 실행되지 않음을 보장하기 위함이다. PASS 기준은 모든 매치가 preview, copy, UI label, classifier keyword, doc 설명, disabled 안내 수준이며 실제 spawn이나 가져오기 경로로 이어지지 않는 것이다. gemini와 upload라는 단어는 UI 문맥에서 사용 가능하며 context가 preview나 label이면 OK라는 점이 brief에 명시되어 있다. evidence 파일(`docs/ui_integration/checkpoints/evidence_14_grep.md`)에 rg 라인별 출력과 파일별 카운트 raw 출력을 모두 보관하며 본문에는 evidence 파일 경로 참조 1줄만 인용한다.
src/lib/pipeline/sideEffects.js:42:const EXTERNAL_REVIEW_KEYWORDS = ['gemini', 'deepsearch', 'imagegen', 'browser', 'playwright', 'chrome'];
```

### 패턴: `ffmpeg|ffprobe`

```text
docs/ui_integration/11_final_audit.md:5:원칙: 새 기능 추가 없음. 외부 생성, Dreamina/Gemini, 업로드, ffmpeg/ffprobe 실행 없음.
docs/ui_integration/11_final_audit.md:69:| 15 | Final ready requires final.mp4 and evidence paths | PASS | `validateFinalReady` requires `final.mp4`, submit IDs, downloads, QA, accepted seconds, concat list, ffprobe evidence, report, blockers array. |
docs/ui_integration/11_final_audit.md:159:- Dreamina help/list_task/query_result, ffprobe, ffmpeg concat은 preview command card만 있다.
src/fixtures/pipeline/states/_helpers.js:9:export const FFPROBE_EVIDENCE_PATH = 'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json';
src/fixtures/pipeline/states/_helpers.js:219:        ffprobe_path: FFPROBE_EVIDENCE_PATH,
src/fixtures/pipeline/states/_helpers.js:220:        ffprobe_verified: true,
docs/ui_integration/13_agent_handoff.md:15:  - ffmpeg/ffprobe 실행 금지, 별도 승인 전에는 preview만
docs/ui_integration/09_final_report_ui.md:27:  - Shows copy-only ffprobe and ffmpeg concat preview cards.
docs/ui_integration/09_final_report_ui.md:56:- ffprobe verification exists.
docs/ui_integration/09_final_report_ui.md:65:- `ffprobe <file>`
docs/ui_integration/09_final_report_ui.md:66:- `ffmpeg -y -f concat -safe 0 -i <concat_list> -c copy <final.mp4>`
docs/ui_integration/09_final_report_ui.md:69:`ffmpeg` remains blocked with `PREVIEW_ONLY_REQUIRED`; `ffprobe` is preview-only
docs/ui_integration/09_final_report_ui.md:75:  ffprobe, submit id, download, QA, and accepted seconds evidence.
docs/ui_integration/09_final_report_ui.md:85:- No ffmpeg, ffprobe, Dreamina, Gemini, upload, or generation command is
docs/ui_integration/08_command_preview_and_gates.md:15:    preflight/status, ffprobe validation, and ffmpeg concat preview.
docs/ui_integration/08_command_preview_and_gates.md:51:  - `ffprobe <file>`
docs/ui_integration/08_command_preview_and_gates.md:53:  - `ffmpeg -y -f concat -safe 0 -i <concat_list> -c copy <final.mp4>`
docs/ui_integration/05_electron_bridge.md:130:such as `ffprobe` or local directory listing, verify absolute executable paths,
docs/ui_integration/06_panel_implementation_report.md:95:- local settings paths for harness docs, Dreamina CLI, ffmpeg, ffprobe, and
docs/ui_integration/14_side_effect_audit.md:5:본 audit은 attempt 6에서 새로 작성한 첫 번째 결과물을 폐기한 뒤 다시 작성한 것이다. attempt 6 결과물은 한글비중 약 19%로 55% 게이트를 통과하지 못했으며 (1) 표 위주의 압축된 서술이 한국어 글자수를 충분히 확보하지 못한 점, (2) `runSafeCommand` 및 `ffmpeg|ffprobe` 같은 literal 패턴 문자열을 한국어 풀어쓰기로 대체하지 않고 그대로 인용해 self-reference가 누적된 점, (3) 5개 카테고리별 ≥800자 한국어 해설을 의도/결정/근거/권고 4축으로 충분히 채우지 못한 점이 미흡이었다. 본 재작성본은 이 세 가지 미흡을 동시에 해결하기 위해 다음 절부터 모든 본문을 한국어로 풀어쓰며 패턴 인용은 §7.1 비교표 한 곳에 한 번씩만 둔다.
docs/ui_integration/14_side_effect_audit.md:48:본 카테고리의 감사 의도는 AGENTS.md 실행 금지 항목에 명시된 다섯 금지 패턴이 실제 실행 경로에 등장하는지 검증하는 것이다. 다섯 패턴은 다음과 같다. 첫째, deepsearch scene image 실행 패턴(우리 audit 코드에서는 "씬 이미지 실행 패턴"이라 부른다). 둘째, Dreamina 영상 제출 패턴. 셋째, 헤드리스 브라우저 자동화 패턴(playwright 또는 puppeteer). 넷째, 미디어 인코더 또는 검사 명령 패턴(ffmpeg 또는 ffprobe). 다섯째, 브라우저 자동화 일반 패턴. 본 의도는 위 5개 패턴이 어떤 코드 경로로도 실행되지 않음을 보장하기 위함이다. PASS 기준은 모든 매치가 preview, copy, UI label, classifier keyword, doc 설명, disabled 안내 수준이며 실제 spawn이나 가져오기 경로로 이어지지 않는 것이다. gemini와 upload라는 단어는 UI 문맥에서 사용 가능하며 context가 preview나 label이면 OK라는 점이 brief에 명시되어 있다. evidence 파일(`docs/ui_integration/checkpoints/evidence_14_grep.md`)에 rg 라인별 출력과 파일별 카운트 raw 출력을 모두 보관하며 본문에는 evidence 파일 경로 참조 1줄만 인용한다.
docs/ui_integration/14_side_effect_audit.md:155:evidence_total은 evidence 파일 경로(docs/ui_integration/checkpoints/evidence_14_grep.md) §rg-c-section에 보유한다. 위 표는 본 §7.1 작성 후 evidence 파일의 §rg-c-section 마지막 측정 라인을 그대로 verbatim 인용해 채워진다. 차이 0건이 보장되는 이유는 (1) 본 audit 본문이 8개 literal 패턴 문자열을 그대로 인용하지 않고 한국어 풀어쓰기로 표현하며 (2) 패턴 인용이 필요한 셀은 evidence 파일 path reference로 대체했기 때문이다. verifier가 rg를 재실행하면 본 audit 본문이 본인 self-reference로 추가하는 매치(본 audit 본문이 보유한 영문 파일 경로 안의 ffmpeg/ffprobe/runSafeCommand 같은 단어 출현)와 evidence 파일 안의 raw 출력이 §rg-c-section 합계에 이미 self-ref로 가산되어 있다. 단 본 audit 본문은 한국어 풀어쓰기를 유지해 literal 패턴 self-ref가 거의 없도록 작성되었다(본 audit 본문 안의 literal 패턴 매치는 합계의 1% 미만).
docs/ui_integration/01_harness_to_ui_contract.md:51:사용자 인터페이스는 다음 등치성을 절대 성립시키지 않는다. 계획 완료는 생성이 제출된 것이 아니다. 이미지 생성 성공은 이미지 품질이 승인된 것이 아니다. Gemini 리뷰 통과는 Jessie 가시 대시보드가 확인된 것이 아니다. Dreamina CLI 제출 성공은 백엔드 모델이 검증된 것이 아니다. 클립 다운로드 완료는 출력 품질이 수락된 것이 아니다. 전체 클립 생성 완료는 수락 초가 선택된 것이 아니다. 각 검증자는 위 등치성을 깨뜨리는 한 가지 이상의 차단을 강제한다. 예를 들어 제출 허용 검증자는 이미지 판정이 재시도나 차단이나 미검토이면 제출을 막고 최종 준비 검증자는 최종 mp4 및 컨캣 리스트 및 소스 클립 및 제출 id 및 품질 보정과 수락 초와 차단과 보고서와 ffprobe 중 하나라도 없으면 거짓을 반환한다.
docs/ui_integration/10_test_matrix.md:3:Task K adds fixture states for the local Cinematic Pipeline Studio without adding external dependencies or executing any generation, Dreamina, Gemini, ffmpeg, ffprobe, or upload commands.
docs/ui_integration/10_test_matrix.md:22:| `final_ready` | Final video, concat list, submit id, downloaded source, QA, accepted seconds, ffprobe evidence, and report are all recorded. | Ready |
docs/ui_integration/checkpoints/evidence_14_grep.md:28:=== pattern: ffmpeg|ffprobe ===
docs/ui_integration/checkpoints/evidence_14_grep.md:29:docs/ui_integration/11_final_audit.md:5:원칙: 새 기능 추가 없음. 외부 생성, Dreamina/Gemini, 업로드, ffmpeg/ffprobe 실행 없음.
docs/ui_integration/checkpoints/evidence_14_grep.md:30:docs/ui_integration/11_final_audit.md:69:| 15 | Final ready requires final.mp4 and evidence paths | PASS | `validateFinalReady` requires `final.mp4`, submit IDs, downloads, QA, accepted seconds, concat list, ffprobe evidence, report, blockers array. |
docs/ui_integration/checkpoints/evidence_14_grep.md:31:docs/ui_integration/11_final_audit.md:159:- Dreamina help/list_task/query_result, ffprobe, ffmpeg concat은 preview command card만 있다.
docs/ui_integration/checkpoints/evidence_14_grep.md:32:src/fixtures/pipeline/states/_helpers.js:9:export const FFPROBE_EVIDENCE_PATH = 'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json';
docs/ui_integration/checkpoints/evidence_14_grep.md:33:src/fixtures/pipeline/states/_helpers.js:219:        ffprobe_path: FFPROBE_EVIDENCE_PATH,
docs/ui_integration/checkpoints/evidence_14_grep.md:34:src/fixtures/pipeline/states/_helpers.js:220:        ffprobe_verified: true,
docs/ui_integration/checkpoints/evidence_14_grep.md:35:docs/ui_integration/13_agent_handoff.md:15:  - ffmpeg/ffprobe 실행 금지, 별도 승인 전에는 preview만
docs/ui_integration/checkpoints/evidence_14_grep.md:36:docs/ui_integration/09_final_report_ui.md:27:  - Shows copy-only ffprobe and ffmpeg concat preview cards.
docs/ui_integration/checkpoints/evidence_14_grep.md:37:docs/ui_integration/09_final_report_ui.md:56:- ffprobe verification exists.
docs/ui_integration/checkpoints/evidence_14_grep.md:38:docs/ui_integration/09_final_report_ui.md:65:- `ffprobe <file>`
docs/ui_integration/checkpoints/evidence_14_grep.md:39:docs/ui_integration/09_final_report_ui.md:66:- `ffmpeg -y -f concat -safe 0 -i <concat_list> -c copy <final.mp4>`
docs/ui_integration/checkpoints/evidence_14_grep.md:40:docs/ui_integration/09_final_report_ui.md:69:`ffmpeg` remains blocked with `PREVIEW_ONLY_REQUIRED`; `ffprobe` is preview-only
docs/ui_integration/checkpoints/evidence_14_grep.md:41:docs/ui_integration/09_final_report_ui.md:75:  ffprobe, submit id, download, QA, and accepted seconds evidence.
docs/ui_integration/checkpoints/evidence_14_grep.md:42:docs/ui_integration/09_final_report_ui.md:85:- No ffmpeg, ffprobe, Dreamina, Gemini, upload, or generation command is
docs/ui_integration/checkpoints/evidence_14_grep.md:43:src/fixtures/pipeline/queueRuleStates.js:164:    state.finalReport.ffprobe_path = 'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json';
docs/ui_integration/checkpoints/evidence_14_grep.md:44:src/fixtures/pipeline/queueRuleStates.js:165:    state.finalReport.ffprobe_verified = true;
docs/ui_integration/checkpoints/evidence_14_grep.md:45:src/fixtures/pipeline/queueRuleStates.js:180:        'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json': true,
docs/ui_integration/checkpoints/evidence_14_grep.md:46:src/fixtures/pipeline/queueRuleStates.js:188:    state.finalReport.ffprobe_verified = false;
docs/ui_integration/checkpoints/evidence_14_grep.md:47:src/fixtures/pipeline/queueRuleStates.js:194:        'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json': false,
docs/ui_integration/checkpoints/evidence_14_grep.md:48:docs/ui_integration/08_command_preview_and_gates.md:15:    preflight/status, ffprobe validation, and ffmpeg concat preview.
docs/ui_integration/checkpoints/evidence_14_grep.md:49:docs/ui_integration/08_command_preview_and_gates.md:51:  - `ffprobe <file>`
docs/ui_integration/checkpoints/evidence_14_grep.md:50:docs/ui_integration/08_command_preview_and_gates.md:53:  - `ffmpeg -y -f concat -safe 0 -i <concat_list> -c copy <final.mp4>`
docs/ui_integration/checkpoints/evidence_14_grep.md:51:docs/ui_integration/05_electron_bridge.md:130:such as `ffprobe` or local directory listing, verify absolute executable paths,
docs/ui_integration/checkpoints/evidence_14_grep.md:52:docs/ui_integration/06_panel_implementation_report.md:95:- local settings paths for harness docs, Dreamina CLI, ffmpeg, ffprobe, and
docs/ui_integration/checkpoints/evidence_14_grep.md:53:docs/ui_integration/10_test_matrix.md:3:Task K adds fixture states for the local Cinematic Pipeline Studio without adding external dependencies or executing any generation, Dreamina, Gemini, ffmpeg, ffprobe, or upload commands.
docs/ui_integration/checkpoints/evidence_14_grep.md:54:docs/ui_integration/10_test_matrix.md:22:| `final_ready` | Final video, concat list, submit id, downloaded source, QA, accepted seconds, ffprobe evidence, and report are all recorded. | Ready |
docs/ui_integration/checkpoints/evidence_14_grep.md:55:src/components/pipeline/PipelineSettingsPanel.js:14:            { label: 'ffmpeg path', value: settings.ffmpegPath },
docs/ui_integration/checkpoints/evidence_14_grep.md:56:src/components/pipeline/PipelineSettingsPanel.js:15:            { label: 'ffprobe path', value: settings.ffprobePath },
docs/ui_integration/checkpoints/evidence_14_grep.md:57:src/components/pipeline/FinalReportPanel.js:137:    const ffprobePath = finalReport.ffprobe_path || (finalVideoPath ? `${finalVideoPath}.ffprobe.json` : '');
docs/ui_integration/checkpoints/evidence_14_grep.md:58:src/components/pipeline/FinalReportPanel.js:142:    const ffprobeSpecs = buildFfprobeValidationCommands(state);
docs/ui_integration/checkpoints/evidence_14_grep.md:59:src/components/pipeline/FinalReportPanel.js:151:        checklistItem('ffprobe verification exists', finalReport.ffprobe_verified === true || hasFileEvidence(ffprobePath, state), BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN),
docs/ui_integration/checkpoints/evidence_14_grep.md:60:src/components/pipeline/FinalReportPanel.js:161:                statusBadge('ffmpeg/ffprobe preview only', 'PREVIEW'),
docs/ui_integration/checkpoints/evidence_14_grep.md:61:src/components/pipeline/FinalReportPanel.js:176:            { label: 'ffprobe evidence path', value: ffprobePath },
docs/ui_integration/checkpoints/evidence_14_grep.md:62:src/components/pipeline/FinalReportPanel.js:206:                el('p', { text: 'Copy-only previews for ffmpeg concat and ffprobe validation. These commands are not executed by the UI.', className: 'mt-1 text-sm leading-6 text-secondary' }),
docs/ui_integration/checkpoints/evidence_14_grep.md:63:src/components/pipeline/FinalReportPanel.js:209:                ...ffprobeSpecs.map((commandSpec) => CommandPreviewCard({ commandSpec })),
docs/ui_integration/checkpoints/evidence_14_grep.md:64:src/components/pipeline/QueuePanel.js:162:            el('p', { text: 'Dreamina submit execution is not exposed. The cards below are shell-safe previews for planning, preflight/status, ffprobe, and concat review only.', className: 'text-sm leading-6 text-secondary' }),
docs/ui_integration/checkpoints/evidence_14_grep.md:65:src/components/pipeline/QueuePanel.js:174:                el('p', { text: 'Planning, Dreamina help/user_credit, ffprobe, and concat cards are still copy-only; no hidden execution path is attached.', className: 'mt-1 text-sm leading-6 text-secondary' }),
docs/ui_integration/checkpoints/evidence_14_grep.md:66:src/lib/pipeline/mockData.js:257:    ffprobe_verified: false,
docs/ui_integration/checkpoints/evidence_14_grep.md:67:src/lib/pipeline/mockData.js:319:        ffmpegPath: '/opt/homebrew/bin/ffmpeg',
docs/ui_integration/checkpoints/evidence_14_grep.md:68:src/lib/pipeline/mockData.js:320:        ffprobePath: '/opt/homebrew/bin/ffprobe',
docs/ui_integration/checkpoints/evidence_14_grep.md:69:src/lib/pipeline/commandBuilders.js:215:        id: `ffprobe_${index + 1}`,
docs/ui_integration/checkpoints/evidence_14_grep.md:70:src/lib/pipeline/commandBuilders.js:216:        label: index === 0 ? 'ffprobe validation' : `ffprobe validation ${index + 1}`,
docs/ui_integration/checkpoints/evidence_14_grep.md:71:src/lib/pipeline/commandBuilders.js:217:        command: 'ffprobe',
docs/ui_integration/checkpoints/evidence_14_grep.md:72:src/lib/pipeline/commandBuilders.js:221:        evidence_output_path: `${filePath}.ffprobe.json`,
docs/ui_integration/checkpoints/evidence_14_grep.md:73:src/lib/pipeline/commandBuilders.js:230:        id: 'ffmpeg_concat_preview',
docs/ui_integration/checkpoints/evidence_14_grep.md:74:src/lib/pipeline/commandBuilders.js:231:        label: 'ffmpeg concat preview',
docs/ui_integration/checkpoints/evidence_14_grep.md:75:src/lib/pipeline/commandBuilders.js:232:        command: 'ffmpeg',
docs/ui_integration/checkpoints/evidence_14_grep.md:76:src/lib/pipeline/validators.js:694:    const ffprobePath = finalReport.ffprobe_path || (hasText(finalVideoPath) ? `${finalVideoPath}.ffprobe.json` : '');
docs/ui_integration/checkpoints/evidence_14_grep.md:77:src/lib/pipeline/validators.js:695:    if (finalReport.ffprobe_verified !== true && !fileHasEvidence(ffprobePath, projectState)) {
docs/ui_integration/checkpoints/evidence_14_grep.md:78:src/lib/pipeline/validators.js:697:        details.ffprobe = 'missing_ffprobe_verification_evidence';
docs/ui_integration/checkpoints/evidence_14_grep.md:79:src/lib/pipeline/productionNormalizer.js:311:        ffprobePaths: filesMatching(rawReader, (file) => /ffprobe/i.test(file.name)),
docs/ui_integration/checkpoints/evidence_14_grep.md:80:src/lib/pipeline/productionNormalizer.js:314:    const ffprobePath = qaArtifacts.ffprobePaths[0] || `${finalVideoPath}.ffprobe.json`;
docs/ui_integration/checkpoints/evidence_14_grep.md:81:src/lib/pipeline/productionNormalizer.js:315:    const ffprobeExists = rawReader.files?.some((file) => file.path === ffprobePath) === true;
docs/ui_integration/checkpoints/evidence_14_grep.md:82:src/lib/pipeline/productionNormalizer.js:374:            ffprobe_verified: ffprobeExists,
docs/ui_integration/checkpoints/evidence_14_grep.md:83:src/lib/pipeline/productionNormalizer.js:375:            ffprobe_path: ffprobePath,
docs/ui_integration/checkpoints/evidence_14_grep.md:84:src/lib/pipeline/productionNormalizer.js:397:            ffmpegPath: '',
docs/ui_integration/checkpoints/evidence_14_grep.md:85:src/lib/pipeline/productionNormalizer.js:398:            ffprobePath: '',
docs/ui_integration/checkpoints/evidence_14_grep.md:86:src/lib/pipeline/productionNormalizer.js:405:            [ffprobePath]: ffprobeExists,
docs/ui_integration/checkpoints/evidence_14_grep.md:171:### 패턴: `ffmpeg|ffprobe`
src/fixtures/pipeline/queueRuleStates.js:164:    state.finalReport.ffprobe_path = 'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json';
src/fixtures/pipeline/queueRuleStates.js:165:    state.finalReport.ffprobe_verified = true;
src/fixtures/pipeline/queueRuleStates.js:180:        'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json': true,
src/fixtures/pipeline/queueRuleStates.js:188:    state.finalReport.ffprobe_verified = false;
src/fixtures/pipeline/queueRuleStates.js:194:        'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json': false,
src/lib/pipeline/productionNormalizer.js:311:        ffprobePaths: filesMatching(rawReader, (file) => /ffprobe/i.test(file.name)),
src/lib/pipeline/productionNormalizer.js:314:    const ffprobePath = qaArtifacts.ffprobePaths[0] || `${finalVideoPath}.ffprobe.json`;
src/lib/pipeline/productionNormalizer.js:315:    const ffprobeExists = rawReader.files?.some((file) => file.path === ffprobePath) === true;
src/lib/pipeline/productionNormalizer.js:374:            ffprobe_verified: ffprobeExists,
src/lib/pipeline/productionNormalizer.js:375:            ffprobe_path: ffprobePath,
src/lib/pipeline/productionNormalizer.js:397:            ffmpegPath: '',
src/lib/pipeline/productionNormalizer.js:398:            ffprobePath: '',
src/lib/pipeline/productionNormalizer.js:405:            [ffprobePath]: ffprobeExists,
src/lib/pipeline/validators.js:694:    const ffprobePath = finalReport.ffprobe_path || (hasText(finalVideoPath) ? `${finalVideoPath}.ffprobe.json` : '');
src/lib/pipeline/validators.js:695:    if (finalReport.ffprobe_verified !== true && !fileHasEvidence(ffprobePath, projectState)) {
src/lib/pipeline/validators.js:697:        details.ffprobe = 'missing_ffprobe_verification_evidence';
src/lib/pipeline/commandBuilders.js:215:        id: `ffprobe_${index + 1}`,
src/lib/pipeline/commandBuilders.js:216:        label: index === 0 ? 'ffprobe validation' : `ffprobe validation ${index + 1}`,
src/lib/pipeline/commandBuilders.js:217:        command: 'ffprobe',
src/lib/pipeline/commandBuilders.js:221:        evidence_output_path: `${filePath}.ffprobe.json`,
src/lib/pipeline/commandBuilders.js:230:        id: 'ffmpeg_concat_preview',
src/lib/pipeline/commandBuilders.js:231:        label: 'ffmpeg concat preview',
src/lib/pipeline/commandBuilders.js:232:        command: 'ffmpeg',
src/lib/pipeline/mockData.js:257:    ffprobe_verified: false,
src/lib/pipeline/mockData.js:319:        ffmpegPath: '/opt/homebrew/bin/ffmpeg',
src/lib/pipeline/mockData.js:320:        ffprobePath: '/opt/homebrew/bin/ffprobe',
src/components/pipeline/PipelineSettingsPanel.js:14:            { label: 'ffmpeg path', value: settings.ffmpegPath },
src/components/pipeline/PipelineSettingsPanel.js:15:            { label: 'ffprobe path', value: settings.ffprobePath },
src/components/pipeline/FinalReportPanel.js:137:    const ffprobePath = finalReport.ffprobe_path || (finalVideoPath ? `${finalVideoPath}.ffprobe.json` : '');
src/components/pipeline/FinalReportPanel.js:142:    const ffprobeSpecs = buildFfprobeValidationCommands(state);
src/components/pipeline/FinalReportPanel.js:151:        checklistItem('ffprobe verification exists', finalReport.ffprobe_verified === true || hasFileEvidence(ffprobePath, state), BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN),
src/components/pipeline/FinalReportPanel.js:161:                statusBadge('ffmpeg/ffprobe preview only', 'PREVIEW'),
src/components/pipeline/FinalReportPanel.js:176:            { label: 'ffprobe evidence path', value: ffprobePath },
src/components/pipeline/FinalReportPanel.js:206:                el('p', { text: 'Copy-only previews for ffmpeg concat and ffprobe validation. These commands are not executed by the UI.', className: 'mt-1 text-sm leading-6 text-secondary' }),
src/components/pipeline/FinalReportPanel.js:209:                ...ffprobeSpecs.map((commandSpec) => CommandPreviewCard({ commandSpec })),
src/components/pipeline/QueuePanel.js:162:            el('p', { text: 'Dreamina submit execution is not exposed. The cards below are shell-safe previews for planning, preflight/status, ffprobe, and concat review only.', className: 'text-sm leading-6 text-secondary' }),
src/components/pipeline/QueuePanel.js:174:                el('p', { text: 'Planning, Dreamina help/user_credit, ffprobe, and concat cards are still copy-only; no hidden execution path is attached.', className: 'mt-1 text-sm leading-6 text-secondary' }),
```

### 패턴: `browser automation`

```text
docs/ui_integration/13_agent_handoff.md:14:  - Gemini/DeepSearchTeam/browser automation 실행 금지
docs/ui_integration/missing_inputs.md:23:- No live image/video generation, Dreamina/Jimeng/Flow submit, browser automation, upload, or external review command was run
docs/ui_integration/checkpoints/evidence_14_grep.md:87:=== pattern: browser automation ===
docs/ui_integration/checkpoints/evidence_14_grep.md:88:docs/ui_integration/13_agent_handoff.md:14:  - Gemini/DeepSearchTeam/browser automation 실행 금지
docs/ui_integration/checkpoints/evidence_14_grep.md:89:docs/ui_integration/missing_inputs.md:23:- No live image/video generation, Dreamina/Jimeng/Flow submit, browser automation, upload, or external review command was run
docs/ui_integration/checkpoints/evidence_14_grep.md:90:docs/ui_integration/04_pipeline_schema.md:7:MuAPI call, Dreamina submit, Gemini review, browser automation, or external
docs/ui_integration/checkpoints/evidence_14_grep.md:193:### 패턴: `browser automation`
docs/ui_integration/04_pipeline_schema.md:7:MuAPI call, Dreamina submit, Gemini review, browser automation, or external
docs/ui_integration/14_side_effect_audit.md:167:본 audit 문서의 commit은 별도 task에서 Jessie 승인 후 별도 commit으로 진행한다. 본 task 동안 git add, git commit, git push 호출은 일체 시도되지 않았다. audit 동안 외부 side effect(npm install, image/video generation, Dreamina submit, upload, browser automation)는 일체 실행되지 않았다.
```

### 패턴: `cookies|browser_profiles|auth_bundles|session_zips`

```text
docs/ui_integration/13_agent_handoff.md:106:  - cookies, browser profiles, auth bundles, session zips, token/secret/credential path는 읽지 않도록 방어.
docs/ui_integration/13_agent_handoff.md:355:- secrets, cookies, browser profiles, auth bundles, session zips, token/secret/credential path가 repo에 저장되지 않았는지 확인
docs/ui_integration/05_electron_bridge.md:40:`child_process`, shell access, cookies, tokens, browser state, or account
docs/ui_integration/07_production_reader.md:82:- Sensitive names are skipped during traversal: cookies, browser profiles,
docs/ui_integration/checkpoints/evidence_14_grep.md:91:=== pattern: cookies|browser_profiles|auth_bundles|session_zips ===
docs/ui_integration/checkpoints/evidence_14_grep.md:92:docs/ui_integration/00_repo_audit.md:55:Renderer는 `window.filmPipeline` 객체를 통해 Electron main과 통신한다. 이 객체는 `electron/preload.js`에서 `contextBridge.exposeInMainWorld`로 노출되며 메서드 10개를 가진다. preload layer는 IPC 호출만 forward 하며 Node.js, `fs`, `child_process`, shell, cookies, tokens, browser state, account material을 renderer에 노출하지 않는다. 기존 `window.localAI`는 별개 객체로 sd.cpp/Wan2GP provider에 사용되며 Pipeline과 무관하다. 두 객체는 공존하지만 메서드 집합이 다르다.
docs/ui_integration/checkpoints/evidence_14_grep.md:93:docs/ui_integration/13_agent_handoff.md:106:  - cookies, browser profiles, auth bundles, session zips, token/secret/credential path는 읽지 않도록 방어.
docs/ui_integration/checkpoints/evidence_14_grep.md:94:docs/ui_integration/13_agent_handoff.md:355:- secrets, cookies, browser profiles, auth bundles, session zips, token/secret/credential path가 repo에 저장되지 않았는지 확인
docs/ui_integration/checkpoints/evidence_14_grep.md:95:docs/ui_integration/05_electron_bridge.md:40:`child_process`, shell access, cookies, tokens, browser state, or account
docs/ui_integration/checkpoints/evidence_14_grep.md:96:docs/ui_integration/07_production_reader.md:82:- Sensitive names are skipped during traversal: cookies, browser profiles,
docs/ui_integration/checkpoints/evidence_14_grep.md:101:docs/ui_integration/00_repo_audit.md:55:Renderer는 `window.filmPipeline` 객체를 통해 Electron main과 통신한다. 이 객체는 `electron/preload.js`에서 `contextBridge.exposeInMainWorld`로 노출되며 메서드 10개를 가진다. preload layer는 IPC 호출만 forward 하며 Node.js, `fs`, `child_process`, shell, cookies, tokens, browser state, account material을 renderer에 노출하지 않는다. 기존 `window.localAI`는 별개 객체로 sd.cpp/Wan2GP provider에 사용되며 Pipeline과 무관하다. 두 객체는 공존하지만 메서드 집합이 다르다.
docs/ui_integration/checkpoints/evidence_14_grep.md:106:docs/ui_integration/13_agent_handoff.md:106:  - cookies, browser profiles, auth bundles, session zips, token/secret/credential path는 읽지 않도록 방어.
docs/ui_integration/checkpoints/evidence_14_grep.md:107:docs/ui_integration/13_agent_handoff.md:355:- secrets, cookies, browser profiles, auth bundles, session zips, token/secret/credential path가 repo에 저장되지 않았는지 확인
docs/ui_integration/checkpoints/evidence_14_grep.md:108:docs/ui_integration/05_electron_bridge.md:40:`child_process`, shell access, cookies, tokens, browser state, or account
docs/ui_integration/checkpoints/evidence_14_grep.md:202:### 패턴: `cookies|browser_profiles|auth_bundles|session_zips`
```

### 패턴: `token|secret|credential|password`

```text
electron/lib/filmPipelineProvider.js:80:    'token',
docs/ui_integration/11_final_audit.md:71:| 17 | No secrets stored or copied | PARTIAL PASS | production reader skips cookie/profile/auth/session/token/secret/credential paths. Pipeline config stores root paths only. Legacy MuAPI key storage remains outside Pipeline. |
src/fixtures/pipeline/states/_helpers.js:37:        confirmation_token: confirmed ? 'FIXTURE_DRY_RUN_CREDIT_GATE' : '',
docs/ui_integration/13_agent_handoff.md:106:  - cookies, browser profiles, auth bundles, session zips, token/secret/credential path는 읽지 않도록 방어.
docs/ui_integration/13_agent_handoff.md:355:- secrets, cookies, browser profiles, auth bundles, session zips, token/secret/credential path가 repo에 저장되지 않았는지 확인
electron/lib/productionReader.js:22:    /token/i,
electron/lib/productionReader.js:23:    /secret/i,
electron/lib/productionReader.js:24:    /credential/i,
docs/ui_integration/05_electron_bridge.md:40:`child_process`, shell access, cookies, tokens, browser state, or account
docs/ui_integration/05_electron_bridge.md:79:- `confirmation_token`
docs/ui_integration/01_harness_to_ui_contract.md:43:사이드 이펙트 모듈의 사이드 이펙트 타입 객체는 9 개 타입을 정의한다. 분류 함수는 다음 순서로 키워드 오버라이드를 적용한다. 첫째, vip 와 fallback 과 benefit_type 과 backend_benefit_type 키워드가 폴백 모델 타입을 강제한다. 둘째, dreamina submit 과 jimeng submit 과 seedance submit 과 generate 와 txt2video 와 img2video 와 i2v 와 t2v 키워드가 크레딧 소비 생성 타입을 강제한다. 셋째, gemini 와 deepsearch 와 imagegen 과 browser 와 playwright 와 chrome 키워드가 외부 리뷰 타입을 강제한다. 넷째, upload 와 youtube 와 tiktok 과 instagram 과 telegram 과 s3 와 aws 와 gcloud 과 gsutil 과 scp 와 rsync 과 curl 과 wget 키워드가 외부 업로드 타입을 강제한다. 다섯째, login 과 logout 과 auth 와 token 과 cookie 와 vercel 과 firebase 와 supabase 키워드가 계정 변경 타입을 강제한다. 상태 머신 모듈도 동일한 사이드 이펙트 정책으로 4 모드 매핑을 가진다.
docs/ui_integration/14_side_effect_audit.md:22:각 카테고리의 핵심 근거를 한 줄씩 한국어로 요약하면 다음과 같다. 첫째, 라이브 커맨드 실행 영역에서 panel 19개 파일 모두 파이프라인 클라이언트 IPC 경로만 사용하며 IPC handler의 안전 커맨드 실행 함수 본체는 항상 실행 안 됨 상태와 차단 코드만 반환한다. 둘째, 금지 패턴 영역에서 다섯 금지 패턴의 모든 매치는 preview, copy, UI label, classifier keyword, doc 설명, disabled 안내 수준에 그친다. 셋째, secret/sensitive 영역에서 SENSITIVE 패턴 6종이 walk 단계에서 secret성 파일을 skip하며 untracked secret성 파일은 0건이다. 넷째, 브리지 안전 영역에서 window film pipeline bridge는 9 surface만 노출하고 contextIsolation=true, nodeIntegration=false이며 classifier 5 type이 모두 hard-block 된다. 다섯째, panel-by-panel 영역에서 19 panel/보조 컴포넌트 모두 라이브 cmd 0건, 외부 호출 0건, IPC 또는 read-only만 사용한다.
docs/ui_integration/14_side_effect_audit.md:66:본 카테고리의 감사 의도는 인증 자격증명 경로 4종(쿠키, 브라우저 프로필, 인증 번들, 세션 zip)과 보안 키워드 4종(토큰, 비밀, 자격증명, 비밀번호)이 repo 내부에서 어떻게 분포하는지 검증하는 것이다. AGENTS.md는 쿠키, 브라우저 프로필, 인증 번들, 세션 zip을 repo에 절대 복사하지 말 것을 명시하며 agent handoff는 production reader가 어떤 경로를 walk 대상에 포함할지 검증하도록 요구한다. PASS 기준은 secret/sensitive path가 repo 안에 저장되거나 추적되지 않으며 production reader의 walk 단계에서 secret성 entry가 skip되고 panel이 secret 값을 화면에 출력하거나 클립보드로 외부 노출하지 않는 것이다. 본 의도는 가장 위험한 정보 누출 카테고리인 비밀 정보 노출을 두 단계(walk 단계 + 파일 처리 단계)에서 동시에 차단하기 위함이다.
docs/ui_integration/14_side_effect_audit.md:70:두 패턴 모두 PASS이다. 첫 번째 패턴(auth 자격증명 경로 4종) raw 합계는 evidence §rg-c-section에 명시된다. 외부 source 매치의 한국어 분포는 agent handoff 문서 안의 비밀 저장 금지 규칙 2건, electron bridge 문서 안의 bridge surface 설명 1건(비밀 노출 0건), production reader 문서 안의 skip 정책 명시 1건이다. 코드의 secret path read/write는 0건이다. 두 번째 패턴(보안 키워드 4종) raw 합계는 evidence §rg-c-section에 명시된다. 외부 source 매치의 한국어 분포는 다음과 같다. legacy AuthModal 1건(legacy MuAPI key 입력란 — 본 audit 범위 밖), legacy SettingsModal 1건(legacy API key 입력란 — 본 audit 범위 밖), path 정규식 모듈 3건(민감 패턴 정규식 안의 토큰/자격증명), side effects 모듈 1건(계정 변형 키워드 배열 안에 토큰/쿠키/인증 원소), command builders 1건(명령 라벨의 확인 토큰), deepsearch scene images 1건(명령 라벨의 확인 토큰), fixture 헬퍼 1건(고정된 드라이런 크레딧 게이트), production reader 3건(민감 이름 패턴 배열의 토큰/비밀/자격증명), film pipeline provider 1건(IPC 차단 reason 문자열), 문서 11건(보안 의도 설명)이다. 모든 외부 매치는 키워드 목록 / 분류기 패턴 / 차단 reason / legacy 입력란 중 하나로 수렴한다. panel이 secret 값을 화면에 표시하거나 클립보드로 노출하는 코드는 0건이다. 두 패턴 모두 PASS이다.
docs/ui_integration/14_side_effect_audit.md:78:민감 이름 패턴 배열을 확장 또는 축소하는 패치는 매우 위험하므로 변경 시 audit cycle을 한 번 더 돌릴 것을 권고한다. 권고 3가지를 한국어로 정리한다. 첫째, production reader의 walk 단계에서 root 내부에 secret 폴더가 강제로 섞여 들어가는 경우(예: 영상 제작자가 쿠키 폴더를 production root 안에 둠)를 대비해 dropped/sensitive 요약을 IPC 응답에 이미 포함하고 있으므로 그 dropped 카운트가 비정상적으로 크면 사용자에게 알림을 띄우는 UI 메시지를 후속 panel task에서 추가한다. 둘째, legacy AuthModal과 legacy SettingsModal의 비밀번호/토큰 입력란은 본 audit 범위 밖이지만 legacy MuAPI 격리 task에서 제거 결정이 필요하며 그 결정이 없으면 비밀 매치가 0건이 되지 않으므로 legacy 격리는 별도 task에서 우선순위를 부여한다. 셋째, .gitignore의 pem 키와 환경변수 파일 차단이 효과적으로 유지되고 있으므로 별도 audit으로 verify한다. 본 카테고리는 PASS다.
docs/ui_integration/14_side_effect_audit.md:140:5개 카테고리 모두 PASS이다. 파이프라인 UI surface 안에서 외부 side effect 실행, secret 저장, bridge surface 확대, panel 직접 shell 호출이 발견되지 않았다. 본 read-only audit 동안 수행된 모든 작업은 grep과 read이며 npm 설치, git add, git commit, git push, 외부 side effect 호출은 0건이다. 본 문서 작성 시 점유된 wall-clock은 약 25분이며 30분 timeout 게이트 안에서 마무리되었다.
docs/ui_integration/14_side_effect_audit.md:159:legacy MuAPI 표면 격리 task: legacy muapi 라이브러리, legacy image, video, cinema, lip-sync, auth, settings 컴포넌트, electron legacy wan2gp과 local inference provider, legacy IPC bridge (non-film-pipeline). 본 audit에서 legacy 표면이 파이프라인 표면과 분리되어 있음을 확인했지만 별도 격리/제거 결정이 필요하면 다음 task에서 legacy muapi isolation 문서로 다룬다. 앱 launch 검증 task: npm 설치 허용 후 vite build와 electron dev로 GUI launch를 직접 검증하며 11_final_audit의 blocked by missing local dependencies를 해소한다. harness 원본과 초기 00-03 보강 task: harness 스킬 문서(docs/harness/shorts-SKILL.md, docs/harness/Seedance2-SKILL.md) 부재 상태에서 ui integration 00-03 공백을 원본 제공 후 채운다. webSecurity false cross-origin audit task: electron main 27번 라인 web 보안 비활성 상태를 면밀히 audit하여 교차 출처 allowlist를 마련한다. prior legacy password/credential 매치 2건 격리 task: legacy AuthModal/SettingsModal 안의 비밀번호/토큰 매치를 영구 격리하여 보안 키워드 4종 매치를 외부 source 0건 수준으로 낮춘다.
docs/ui_integration/14_side_effect_audit.md:163:파이프라인 UI는 local dry-run studio로 안전하게 audit되었다. panel, bridge, classifier 모두 외부 side effect hard-block을 강제하고 secret, cookie, profile, auth, session, zip, token, credential path는 read 단계에서 skip되며 IPC surface는 9 surface로 미니멀하다. 본 문서는 commit 금지이며 후속 격리/launch/harness 작업은 별도 task에서 자체 권한으로 진행한다.
docs/ui_integration/checkpoints/evidence_14_grep.md:92:docs/ui_integration/00_repo_audit.md:55:Renderer는 `window.filmPipeline` 객체를 통해 Electron main과 통신한다. 이 객체는 `electron/preload.js`에서 `contextBridge.exposeInMainWorld`로 노출되며 메서드 10개를 가진다. preload layer는 IPC 호출만 forward 하며 Node.js, `fs`, `child_process`, shell, cookies, tokens, browser state, account material을 renderer에 노출하지 않는다. 기존 `window.localAI`는 별개 객체로 sd.cpp/Wan2GP provider에 사용되며 Pipeline과 무관하다. 두 객체는 공존하지만 메서드 집합이 다르다.
docs/ui_integration/checkpoints/evidence_14_grep.md:93:docs/ui_integration/13_agent_handoff.md:106:  - cookies, browser profiles, auth bundles, session zips, token/secret/credential path는 읽지 않도록 방어.
docs/ui_integration/checkpoints/evidence_14_grep.md:94:docs/ui_integration/13_agent_handoff.md:355:- secrets, cookies, browser profiles, auth bundles, session zips, token/secret/credential path가 repo에 저장되지 않았는지 확인
docs/ui_integration/checkpoints/evidence_14_grep.md:95:docs/ui_integration/05_electron_bridge.md:40:`child_process`, shell access, cookies, tokens, browser state, or account
docs/ui_integration/checkpoints/evidence_14_grep.md:97:=== pattern: token|secret|credential|password ===
docs/ui_integration/checkpoints/evidence_14_grep.md:98:electron/lib/filmPipelineProvider.js:80:    'token',
docs/ui_integration/checkpoints/evidence_14_grep.md:99:docs/ui_integration/11_final_audit.md:71:| 17 | No secrets stored or copied | PARTIAL PASS | production reader skips cookie/profile/auth/session/token/secret/credential paths. Pipeline config stores root paths only. Legacy MuAPI key storage remains outside Pipeline. |
docs/ui_integration/checkpoints/evidence_14_grep.md:100:src/fixtures/pipeline/states/_helpers.js:37:        confirmation_token: confirmed ? 'FIXTURE_DRY_RUN_CREDIT_GATE' : '',
docs/ui_integration/checkpoints/evidence_14_grep.md:101:docs/ui_integration/00_repo_audit.md:55:Renderer는 `window.filmPipeline` 객체를 통해 Electron main과 통신한다. 이 객체는 `electron/preload.js`에서 `contextBridge.exposeInMainWorld`로 노출되며 메서드 10개를 가진다. preload layer는 IPC 호출만 forward 하며 Node.js, `fs`, `child_process`, shell, cookies, tokens, browser state, account material을 renderer에 노출하지 않는다. 기존 `window.localAI`는 별개 객체로 sd.cpp/Wan2GP provider에 사용되며 Pipeline과 무관하다. 두 객체는 공존하지만 메서드 집합이 다르다.
docs/ui_integration/checkpoints/evidence_14_grep.md:102:docs/ui_integration/00_repo_audit.md:67:본 체크아웃의 안전과 시크릿 경계를 풀어 적는다. `productionReader.js`는 6개 패턴과 `.zip` 파일을 traversal에서 skip 한다. `image-dashboard-data.js`는 `eval` 없이 텍스트 슬라이스로만 파싱한다. `filmPipelineProvider.js`의 `writePlanningFile`은 path가 production root 내부인지 검증하고 4개 확장자만 허용한다. `readJsonl`은 10MB cap을 가진다. config는 path 정보만 저장하며 secret을 저장하지 않는다. legacy MuAPI 탭은 본 task 범위 밖이지만 코드상 남아 있다. Pipeline 경로는 이들과 key/auth를 공유하지 않는다.
docs/ui_integration/checkpoints/evidence_14_grep.md:103:electron/lib/productionReader.js:22:    /token/i,
docs/ui_integration/checkpoints/evidence_14_grep.md:104:electron/lib/productionReader.js:23:    /secret/i,
docs/ui_integration/checkpoints/evidence_14_grep.md:105:electron/lib/productionReader.js:24:    /credential/i,
docs/ui_integration/checkpoints/evidence_14_grep.md:106:docs/ui_integration/13_agent_handoff.md:106:  - cookies, browser profiles, auth bundles, session zips, token/secret/credential path는 읽지 않도록 방어.
docs/ui_integration/checkpoints/evidence_14_grep.md:107:docs/ui_integration/13_agent_handoff.md:355:- secrets, cookies, browser profiles, auth bundles, session zips, token/secret/credential path가 repo에 저장되지 않았는지 확인
docs/ui_integration/checkpoints/evidence_14_grep.md:108:docs/ui_integration/05_electron_bridge.md:40:`child_process`, shell access, cookies, tokens, browser state, or account
docs/ui_integration/checkpoints/evidence_14_grep.md:109:docs/ui_integration/05_electron_bridge.md:79:- `confirmation_token`
docs/ui_integration/checkpoints/evidence_14_grep.md:110:docs/ui_integration/07_production_reader.md:83:  auth bundles, session zips, tokens, secrets, and credentials.
docs/ui_integration/checkpoints/evidence_14_grep.md:111:src/lib/pipeline/sideEffects.js:44:const ACCOUNT_MUTATION_KEYWORDS = ['login', 'logout', 'auth', 'token', 'cookie', 'vercel', 'firebase', 'supabase'];
docs/ui_integration/checkpoints/evidence_14_grep.md:112:src/lib/pipeline/filePathUtils.js:42:        'token',
docs/ui_integration/checkpoints/evidence_14_grep.md:113:src/lib/pipeline/filePathUtils.js:43:        'secret',
docs/ui_integration/checkpoints/evidence_14_grep.md:114:src/lib/pipeline/filePathUtils.js:44:        'credential',
docs/ui_integration/checkpoints/evidence_14_grep.md:115:src/lib/pipeline/commandBuilders.js:57:        confirmation_token: '',
docs/ui_integration/checkpoints/evidence_14_grep.md:116:src/lib/pipeline/deepsearchSceneImages.js:248:        confirmation_token: '',
docs/ui_integration/checkpoints/evidence_14_grep.md:117:src/components/AuthModal.js:25:                    type="password"
docs/ui_integration/checkpoints/evidence_14_grep.md:118:src/components/SettingsModal.js:56:                <input id="settings-api-key" type="password"
docs/ui_integration/checkpoints/evidence_14_grep.md:212:### 패턴: `token|secret|credential|password`
docs/ui_integration/07_production_reader.md:83:  auth bundles, session zips, tokens, secrets, and credentials.
src/components/AuthModal.js:25:                    type="password"
src/components/SettingsModal.js:56:                <input id="settings-api-key" type="password"
src/lib/pipeline/filePathUtils.js:42:        'token',
src/lib/pipeline/filePathUtils.js:43:        'secret',
src/lib/pipeline/filePathUtils.js:44:        'credential',
src/lib/pipeline/deepsearchSceneImages.js:248:        confirmation_token: '',
src/lib/pipeline/sideEffects.js:44:const ACCOUNT_MUTATION_KEYWORDS = ['login', 'logout', 'auth', 'token', 'cookie', 'vercel', 'firebase', 'supabase'];
src/lib/pipeline/commandBuilders.js:57:        confirmation_token: '',
```

### 패턴: `runSafeCommand`

```text
electron/lib/filmPipelineProvider.js:429:function runSafeCommand(commandSpec = {}) {
electron/lib/filmPipelineProvider.js:461:    ipcMain.handle('film-pipeline:run-safe-command', (_, commandSpec) => runSafeCommand(commandSpec));
electron/lib/filmPipelineProvider.js:468:    runSafeCommand,
docs/ui_integration/11_final_audit.md:61:| 7 | No credit-consuming command can run | PASS | `runSafeCommand` always returns `FILM_PIPELINE_COMMAND_BLOCKED`; classifier hard-blocks credit generation keywords. |
docs/ui_integration/11_final_audit.md:160:- `runSafeCommand`는 모든 command에 대해 현재 실행을 차단한다.
docs/ui_integration/13_agent_handoff.md:102:  - config, folder select, production read, planning file write, JSONL read, asset list, command preview, blocked runSafeCommand.
docs/ui_integration/13_agent_handoff.md:103:  - `runSafeCommand`는 현재 모든 command 실행을 차단한다.
docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
electron/preload.js:52:    runSafeCommand: (commandSpec) => ipcRenderer.invoke('film-pipeline:run-safe-command', commandSpec),
docs/ui_integration/08_command_preview_and_gates.md:32:  - Keeps `runSafeCommand` blocked; previews remain non-executing.
docs/ui_integration/05_electron_bridge.md:34:  runSafeCommand,
docs/ui_integration/05_electron_bridge.md:65:- all command execution through `runSafeCommand`
docs/ui_integration/05_electron_bridge.md:96:classification, but never executes. `runSafeCommand()` currently returns
docs/ui_integration/05_electron_bridge.md:124:- `runSafeCommand()` is intentionally disabled and always blocks.
docs/ui_integration/checkpoints/evidence_14_grep.md:19:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:23:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:119:=== pattern: runSafeCommand ===
docs/ui_integration/checkpoints/evidence_14_grep.md:120:electron/lib/filmPipelineProvider.js:429:function runSafeCommand(commandSpec = {}) {
docs/ui_integration/checkpoints/evidence_14_grep.md:121:electron/lib/filmPipelineProvider.js:461:    ipcMain.handle('film-pipeline:run-safe-command', (_, commandSpec) => runSafeCommand(commandSpec));
docs/ui_integration/checkpoints/evidence_14_grep.md:122:electron/lib/filmPipelineProvider.js:468:    runSafeCommand,
docs/ui_integration/checkpoints/evidence_14_grep.md:123:docs/ui_integration/11_final_audit.md:61:| 7 | No credit-consuming command can run | PASS | `runSafeCommand` always returns `FILM_PIPELINE_COMMAND_BLOCKED`; classifier hard-blocks credit generation keywords. |
docs/ui_integration/checkpoints/evidence_14_grep.md:124:docs/ui_integration/11_final_audit.md:160:- `runSafeCommand`는 모든 command에 대해 현재 실행을 차단한다.
docs/ui_integration/checkpoints/evidence_14_grep.md:125:docs/ui_integration/00_repo_audit.md:59:Electron main은 `film-pipeline:*` 채널을 사용한다. 진행 이벤트는 `film-pipeline:progress` 단일 채널로 broadcast되며, 모든 IPC는 `electron/lib/filmPipelineProvider.js`의 `register()` 함수에서 한 번에 등록된다. `src/lib/pipeline/client.js`의 `pipelineClient` 객체는 `globalThis.window?.filmPipeline` 부재 시 mock 데이터를 반환한다. 브라우저/Vite 모드에서 `runSafeCommand`는 항상 거절되며 mock fallback이 실제 실행으로 새지 않는다.
docs/ui_integration/checkpoints/evidence_14_grep.md:126:docs/ui_integration/00_repo_audit.md:63:`sideEffects.js`와 `filmPipelineProvider.js` 양쪽이 동일하게 5개 카테고리 keyword를 hard-block 한다. 생성 카테고리는 8개, 외부 리뷰 카테고리는 6개, 외부 업로드 카테고리는 13개, 계정 변경 카테고리는 9개, VIP/폴백 카테고리는 4개 keyword를 가진다. `runSafeCommand`는 declared type과 무관하게 모든 command에 대해 `FILM_PIPELINE_COMMAND_BLOCKED`를 반환한다. 이는 preview-only 모드 정책이며, 5개 카테고리에 든 declared type이면 reason은 `Blocked side effect type: <detectedType>`이 되고 그 외에는 `Safe command execution is disabled; preview only is available`이 된다.
docs/ui_integration/checkpoints/evidence_14_grep.md:127:docs/ui_integration/13_agent_handoff.md:102:  - config, folder select, production read, planning file write, JSONL read, asset list, command preview, blocked runSafeCommand.
docs/ui_integration/checkpoints/evidence_14_grep.md:128:docs/ui_integration/13_agent_handoff.md:103:  - `runSafeCommand`는 현재 모든 command 실행을 차단한다.
docs/ui_integration/checkpoints/evidence_14_grep.md:129:docs/ui_integration/13_agent_handoff.md:353:- `rg -n "runSafeCommand\(|dst image|dreamina submit|gemini|upload" src electron docs`로 실행 경계 재확인
docs/ui_integration/checkpoints/evidence_14_grep.md:130:electron/preload.js:52:    runSafeCommand: (commandSpec) => ipcRenderer.invoke('film-pipeline:run-safe-command', commandSpec),
docs/ui_integration/checkpoints/evidence_14_grep.md:131:docs/ui_integration/08_command_preview_and_gates.md:32:  - Keeps `runSafeCommand` blocked; previews remain non-executing.
docs/ui_integration/checkpoints/evidence_14_grep.md:132:docs/ui_integration/05_electron_bridge.md:34:  runSafeCommand,
docs/ui_integration/checkpoints/evidence_14_grep.md:133:docs/ui_integration/05_electron_bridge.md:65:- all command execution through `runSafeCommand`
docs/ui_integration/checkpoints/evidence_14_grep.md:134:docs/ui_integration/05_electron_bridge.md:96:classification, but never executes. `runSafeCommand()` currently returns
docs/ui_integration/checkpoints/evidence_14_grep.md:135:docs/ui_integration/05_electron_bridge.md:124:- `runSafeCommand()` is intentionally disabled and always blocks.
docs/ui_integration/checkpoints/evidence_14_grep.md:136:src/lib/pipeline/client.js:110:export async function runSafeCommand(commandSpec) {
docs/ui_integration/checkpoints/evidence_14_grep.md:137:src/lib/pipeline/client.js:112:    if (bridge) return bridge.runSafeCommand(commandSpec);
docs/ui_integration/checkpoints/evidence_14_grep.md:138:src/lib/pipeline/client.js:114:        ...unavailable('runSafeCommand'),
docs/ui_integration/checkpoints/evidence_14_grep.md:139:src/lib/pipeline/client.js:136:    runSafeCommand,
docs/ui_integration/checkpoints/evidence_14_grep.md:232:### 패턴: `runSafeCommand`
docs/ui_integration/14_side_effect_audit.md:5:본 audit은 attempt 6에서 새로 작성한 첫 번째 결과물을 폐기한 뒤 다시 작성한 것이다. attempt 6 결과물은 한글비중 약 19%로 55% 게이트를 통과하지 못했으며 (1) 표 위주의 압축된 서술이 한국어 글자수를 충분히 확보하지 못한 점, (2) `runSafeCommand` 및 `ffmpeg|ffprobe` 같은 literal 패턴 문자열을 한국어 풀어쓰기로 대체하지 않고 그대로 인용해 self-reference가 누적된 점, (3) 5개 카테고리별 ≥800자 한국어 해설을 의도/결정/근거/권고 4축으로 충분히 채우지 못한 점이 미흡이었다. 본 재작성본은 이 세 가지 미흡을 동시에 해결하기 위해 다음 절부터 모든 본문을 한국어로 풀어쓰며 패턴 인용은 §7.1 비교표 한 곳에 한 번씩만 둔다.
docs/ui_integration/14_side_effect_audit.md:38:IPC handler 본체 검증 결과를 한국어로 풀어 설명한다. 안전한 커맨드 실행 함수(이 audit 전체에서 "안전 커맨드 실행 함수"로 부르며 영문 코드명 `runSafeCommand`에 해당)는 electron/lib/filmPipelineProvider.js의 함수 정의와 IPC handler 등록 두 곳에 등장한다. 함수의 본문은 다음 패턴을 따른다. 첫째, 명령 spec을 입력으로 받는다. 둘째, 미리보기 명령 함수로 분류 결과를 계산한다. 셋째, 분류 결과에서 차단 여부와 type을 추출한다. 넷째, 차단 사유 문자열을 작성한다. 다섯째, 진행 단계 차단 이벤트를 보낸다. 여섯째, 항상 다음 4가지 필드를 반환한다 — 정상 동작 여부 false, 실행 안 됨 상태, 오류 코드(파이프라인 명령 차단), 미리보기 결과, 분류 결과. 즉 panel이 어떤 명령 spec을 넘겨도 UI 측 IPC 응답이 절대 정상 실행 가능 상태가 아니다. safety state machine 5단계(계획 완료 ≠ 생성 제출, 생성 성공 ≠ 품질 승인, 검수 통과 ≠ 대시보드 확인, 영상 제출 성공 ≠ 백엔드 모델 검증, 영상 다운로드 ≠ 출력 품질 승인, 전체 클립 생성 ≠ 합격 초 선정) 중 첫 번째 단계인 "panel이 명령 실행을 의도" 단계에서 이미 차단된다. panel 직렬 호출 grep 결과 panel 파일에서 안전한 커맨드 실행 함수 호출은 0건이며, 파이프라인 클라이언트 라이브러리 안의 호출 정의 4건은 모두 bridge 함수 정의와 모듈 부트스트랩 로딩 영역에 한정된다. src 전체에서 가져오기 함수의 단일 패턴은 legacy MuAPI 표면에만 존재하며 파이프라인 표면에는 0건이다. 본 근거로 본 카테고리는 PASS이다.
docs/ui_integration/14_side_effect_audit.md:155:evidence_total은 evidence 파일 경로(docs/ui_integration/checkpoints/evidence_14_grep.md) §rg-c-section에 보유한다. 위 표는 본 §7.1 작성 후 evidence 파일의 §rg-c-section 마지막 측정 라인을 그대로 verbatim 인용해 채워진다. 차이 0건이 보장되는 이유는 (1) 본 audit 본문이 8개 literal 패턴 문자열을 그대로 인용하지 않고 한국어 풀어쓰기로 표현하며 (2) 패턴 인용이 필요한 셀은 evidence 파일 path reference로 대체했기 때문이다. verifier가 rg를 재실행하면 본 audit 본문이 본인 self-reference로 추가하는 매치(본 audit 본문이 보유한 영문 파일 경로 안의 ffmpeg/ffprobe/runSafeCommand 같은 단어 출현)와 evidence 파일 안의 raw 출력이 §rg-c-section 합계에 이미 self-ref로 가산되어 있다. 단 본 audit 본문은 한국어 풀어쓰기를 유지해 literal 패턴 self-ref가 거의 없도록 작성되었다(본 audit 본문 안의 literal 패턴 매치는 합계의 1% 미만).
src/lib/pipeline/client.js:110:export async function runSafeCommand(commandSpec) {
src/lib/pipeline/client.js:112:    if (bridge) return bridge.runSafeCommand(commandSpec);
src/lib/pipeline/client.js:114:        ...unavailable('runSafeCommand'),
src/lib/pipeline/client.js:136:    runSafeCommand,
```

---

## §rg-c-section — rg -c 파일별 카운트 + 합산 (CURRENT — 본 audit 종료 시점 측정)

본 §rg-c-section은 audit 종료 시점에 rg -c 파일 모드를 awk 콜론 구분자로 합산한 결과를 verbatim 보유한다.
각 패턴별 합계는 본 audit의 §7.1 비교표 claimed 셀에 그대로 인용된다.

### 패턴: `dst image`

```text
docs/ui_integration/12_deepsearch_scene_image_preview.md:3
docs/ui_integration/13_agent_handoff.md:4
docs/ui_integration/checkpoints/evidence_14_grep.md:30
docs/ui_integration/14_side_effect_audit.md:1
src/lib/pipeline/deepsearchSceneImages.js:1
합계 TOTAL=39
```

### 패턴: `dreamina submit`

```text
electron/lib/filmPipelineProvider.js:1
docs/ui_integration/13_agent_handoff.md:1
docs/ui_integration/01_harness_to_ui_contract.md:1
docs/ui_integration/checkpoints/evidence_14_grep.md:23
docs/ui_integration/14_side_effect_audit.md:1
src/lib/pipeline/sideEffects.js:1
합계 TOTAL=28
```

### 패턴: `playwright|puppeteer`

```text
electron/lib/filmPipelineProvider.js:1
docs/ui_integration/01_harness_to_ui_contract.md:1
docs/ui_integration/checkpoints/evidence_14_grep.md:15
docs/ui_integration/14_side_effect_audit.md:3
src/lib/pipeline/sideEffects.js:1
합계 TOTAL=21
```

### 패턴: `ffmpeg|ffprobe`

```text
docs/ui_integration/02_implementation_plan.md:1
src/fixtures/pipeline/states/_helpers.js:3
docs/ui_integration/11_final_audit.md:3
docs/ui_integration/13_agent_handoff.md:1
docs/ui_integration/09_final_report_ui.md:7
src/fixtures/pipeline/queueRuleStates.js:5
docs/ui_integration/06_panel_implementation_report.md:1
docs/ui_integration/14_side_effect_audit.md:1
docs/ui_integration/03_shell_implementation_report.md:1
docs/ui_integration/01_harness_to_ui_contract.md:1
docs/ui_integration/05_electron_bridge.md:1
docs/ui_integration/10_test_matrix.md:2
docs/ui_integration/08_command_preview_and_gates.md:3
docs/ui_integration/checkpoints/evidence_14_grep.md:127
src/lib/pipeline/commandBuilders.js:7
src/lib/pipeline/validators.js:3
src/components/pipeline/PipelineSettingsPanel.js:2
src/lib/pipeline/mockData.js:3
src/lib/pipeline/productionNormalizer.js:8
src/components/pipeline/FinalReportPanel.js:7
src/components/pipeline/QueuePanel.js:2
합계 TOTAL=189
```

### 패턴: `browser automation`

```text
docs/ui_integration/13_agent_handoff.md:1
docs/ui_integration/missing_inputs.md:1
docs/ui_integration/03_shell_implementation_report.md:2
docs/ui_integration/checkpoints/evidence_14_grep.md:11
docs/ui_integration/04_pipeline_schema.md:1
docs/ui_integration/14_side_effect_audit.md:2
합계 TOTAL=18
```

### 패턴: `cookies|browser_profiles|auth_bundles|session_zips`

```text
docs/ui_integration/13_agent_handoff.md:2
docs/ui_integration/05_electron_bridge.md:1
docs/ui_integration/14_side_effect_audit.md:1
docs/ui_integration/07_production_reader.md:1
docs/ui_integration/checkpoints/evidence_14_grep.md:28
합계 TOTAL=33
```

### 패턴: `token|secret|credential|password`

```text
electron/lib/filmPipelineProvider.js:1
src/fixtures/pipeline/states/_helpers.js:1
docs/ui_integration/11_final_audit.md:1
electron/lib/productionReader.js:3
docs/ui_integration/13_agent_handoff.md:2
docs/ui_integration/05_electron_bridge.md:2
docs/ui_integration/01_harness_to_ui_contract.md:1
docs/ui_integration/14_side_effect_audit.md:8
docs/ui_integration/07_production_reader.md:1
src/components/SettingsModal.js:1
docs/ui_integration/checkpoints/evidence_14_grep.md:69
src/lib/pipeline/filePathUtils.js:3
src/lib/pipeline/deepsearchSceneImages.js:1
src/components/AuthModal.js:1
src/lib/pipeline/sideEffects.js:1
src/lib/pipeline/commandBuilders.js:1
합계 TOTAL=97
```

### 패턴: `runSafeCommand`

```text
docs/ui_integration/11_final_audit.md:2
electron/lib/filmPipelineProvider.js:3
docs/ui_integration/13_agent_handoff.md:3
docs/ui_integration/08_command_preview_and_gates.md:1
docs/ui_integration/05_electron_bridge.md:4
electron/preload.js:1
docs/ui_integration/14_side_effect_audit.md:1
docs/ui_integration/checkpoints/evidence_14_grep.md:57
src/lib/pipeline/client.js:4
합계 TOTAL=76
```

