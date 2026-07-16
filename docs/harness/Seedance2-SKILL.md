# Seedance2 도메인 작업 명세 (Seedance2 SKILL)

상태: **합성본 (synthesized) — originals MISSING**

작성일: 2026-07-07 KST. 운영 방향 갱신: 2026-07-15 KST. 대상 repo: `/Users/jessiek/StudioProjects/Open-Generative-AI`. 보고 언어: 한국어. 본 문서는 AGENTS.md가 정의한 필수 하네스 문서 중 Seedance2/Dreamina 도메인 작업 명세 파일이며, 외부 하네스 오리지널 원본은 본 repo에 부재한 상태에서 본 repo의 local UI scaffold (`src/lib/pipeline/`, `src/components/pipeline/`, `src/fixtures/pipeline/sampleProductionFolder/prompts/clip_001_seedance.md`, `docs/ui_integration/`)에서 추출·합성한 내용이다. 본 문서의 모든 필드명/블로커/검증자/제출 흐름은 local UI scaffold가 가진 것을 그대로 인용하며, 오리지널 하네스 원본과 reconcile 되지 않은 상태임을 §10에서 명시한다. shorts 도메인의 명세는 `docs/harness/shorts-SKILL.md`를 참조한다.

## §1. 본 문서의 의의와 적용 범위

본 문서는 Open-Generative-AI 시네마틱 파이프라인 UI가 다루는 Seedance2/Dreamina 도메인의 작업 명세를 정의한다. 본 명세의 의의는 사용자 인터페이스가 자체 추정하지 못하는 Seedance2 도메인의 제출 흐름, 하트비트, 품질 보정, 수락 초, 게이트 정의 원본을 한 자리에 모은다는 점이다. 본 명세는 본 repo의 local UI scaffold에서 추출한 합성본이며 오리지널 하네스 원본은 별도 외부 경로에 존재한다. 본 명세의 적용 범위는 Seedance2 모델과 Dreamina/Jimeng/Flow 계열을 다루는 큐 패널과 QA 패널과 최종 리포트 패널의 제출/하트비트/QA/수락 초 흐름에 한정된다.

본 명세의 핵심 불변식은 사용자 인터페이스가 자체적으로 영상을 만들지 않는다는 점이다. 사용자 인터페이스는 Jessie가 별도로 운영하는 하네스의 드라이런 셸이며 그 하네스의 결과물인 제출/하트비트/QA/수락 초를 읽고 미리보기 전용 표면을 보여 주는 것이 전부다. 본 명세는 그 드라이런 보장을 코드 차원에서 강제하기 위한 제출 흐름, 하트비트 명세, QA 명세, 수락 초 명세를 제공한다.

## §2. Seedance2 라우트와 모델

본 절은 Seedance2 도메인이 다루는 라우트와 모델의 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/schema.js`의 `ROUTES` enum과 `ProductionProject.route` 필드에서 추출한 것이다.

첫째, 라우트 enum은 `seedance`, `flow_omni`, `both` 셋 중 하나이다. 둘째, `seedance` 라우트는 Seedance2 모델 호출만 사용한다. 셋째, `flow_omni` 라우트는 Flow Omni 계열 호출만 사용한다. 넷째, `both` 라우트는 두 호출을 모두 사용한다.

본 repo의 local UI scaffold는 라우트 enum을 정확한 문자열로 사용하며 신규 라우트 추가는 본 셋 중 우선 사용해야 한다. 라우트별 호출 경로는 `src/lib/pipeline/commandBuilders.js`에서 정의되며 본 명세는 호출 경로의 정의를 다루지 않는다(외부 호출은 본 repo에서 항상 blocked). 모델 식별자는 `SubmitRecord.requested_model`과 `SubmitRecord.submitted_cli_model` 두 필드에 별도로 기록되며 두 필드 불일치 시 `MODEL_MISMATCH` 차단이 발생한다.

## §3. Seedance2 제출 흐름 명세

본 절은 Seedance2 도메인의 제출 흐름 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/validators.js`의 `validateSubmitAllowed(clipState)`와 `src/lib/pipeline/schema.js`의 `SubmitRecord` 스키마에서 추출한 것이다.

첫째, 제출 허용의 핵심 규칙은 다음 6가지이다. 첫째, 제출은 이미지 대시보드가 존재하지 않거나 오래되면 차단된다(blocker: `MISSING_IMAGE_DASHBOARD` 또는 `IMAGE_DASHBOARD_STALE`). 둘째, 제출은 첨부 이미지의 판정이 `RETRY`, `BLOCK`, `UNREVIEWED`이면 차단된다(명시적 예외 제외). 셋째, 제출은 Gemini prompt/media review `PASS` 없으면 차단된다(blocker: `IMAGE_GEMINI_REVIEW_REQUIRED` 또는 `IMAGE_GEMINI_REVIEW_NOT_PASS`). 넷째, 제출은 명시적 credit confirmation 없으면 차단된다(blocker: `CREDIT_CONFIRMATION_REQUIRED`). 다섯째, 제출은 duration lock 없으면 차단된다(blocker: `DURATION_LOCK_MISSING`). 여섯째, retry는 기본적으로 한 번의 live attempt 이후 차단된다(blocker: `DREAMINA_PREFLIGHT_BLOCKED`).

둘째, 제출이 허용되면 다음 11개 필드가 `SubmitRecord`에 기록된다. `clip_id`, `subcommand`, `requested_model`, `submitted_cli_model`, `submit_id`, `logid`, `credit_count`, `status`, `next_heartbeat_at`, `download_dir`, `command_log_path`. 본 repo의 local UI scaffold는 live submission을 실행하지 않으며 미리보기 카드 형태의 spec만 반환한다.

셋째, 제출 흐름의 Dreamina 사전 점검(`DREAMINA_PREFLIGHT_BLOCKED`)은 다음 조건을 모두 만족해야 PASS이다. 첫째, `ReviewGate.type`이 `preflight`인 게이트가 존재하고 status가 `PASS`이다. 둘째, `ReviewGate.type`이 `submit_confirmation`인 게이트가 존재하고 status가 `PASS`이다. 셋째, 첨부 이미지가 모두 `PASS`이다. 넷째, Gemini prompt review가 `PASS`이다. 다섯째, Gemini media review가 `PASS`이다.

넷째, 본 repo는 외부 제출 호출(`runSafeCommand` 등)을 실행하지 않으며 항상 ok false, executed false, error `PIPELINE_COMMAND_BLOCKED`를 반환한다. 본 정책은 본 repo의 local UI scaffold가 가진 그대로이며 dry-run 거동을 보존한다.

## §4. Seedance2 하트비트 명세

본 절은 Seedance2 도메인의 하트비트 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/validators.js`의 `validateHeartbeatAllowed(lastHeartbeat, now)`와 `src/lib/pipeline/schema.js`의 `HeartbeatRecord` 스키마에서 추출한 것이다.

첫째, 하트비트 허용의 핵심 규칙은 다음 1가지이다. 하트비트는 같은 active production 기준 이전 active 하트비트로부터 최소 20분 이후에만 due로 본다. 본 규칙은 `now - lastHeartbeat.checked_at >= 20 minutes` 형태로 강제된다.

둘째, 하트비트 레코드의 10개 필드는 다음과 같다. `checked_at`(점검 시각 ISO), `submit_id`(제출 식별자), `clip_id`(클립 식별자), `queue_status`(큐 상태), `gen_status`(생성 상태), `backend_benefit_type`(백엔드 benefit type), `backend_queue_debug`(백엔드 큐 디버그), `downloaded_files`(다운로드된 파일 문자열 배열), `next_heartbeat_at`(다음 하트비트 시각 ISO), `blocker`(차단 상수). 본 repo의 local UI scaffold는 하트비트 호출을 실행하지 않으며 미리보기 카드 형태의 spec만 반환한다.

셋째, 하트비트 흐름의 3가지 액션. 첫째, 큐 상태 조회(submit_id 기준 백엔드 큐 상태). 둘째, 생성 상태 조회(submit_id 기준 백엔드 생성 상태). 셋째, 다운로드 디렉터리 점검(download_dir 안 파일 목록 수집). 본 repo는 본 3가지 액션을 실행하지 않으며 local mock 또는 mock fallback 데이터만 반환한다.

넷째, 하트비트가 활성화되지 않는 경우는 다음 4가지이다. 첫째, 제출이 아직 안 된 경우. 둘째, 제출 후 20분이 지나지 않은 경우. 셋째, 백엔드가 명시적으로 blocked를 반환한 경우. 넷째, 사용자가 임의로 하트비트를 끈 경우.

## §5. Seedance2 품질 보정과 QA 명세

본 절은 Seedance2 도메인의 품질 보정과 QA 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/schema.js`의 `QARecord` 스키마와 `src/lib/pipeline/validators.js`의 `validateFinalReady(projectState)`에서 추출한 것이다.

첫째, QA의 13개 필드는 다음과 같다. `clip_id`, `file_path`, `valid_video`(불리언, 유효 비디오), `duration_ok`(불리언, 길이 OK), `aspect_ratio_ok`(불리언, 종횡비 OK), `identity_ok`(불리언, 정체성 OK), `first_frame_respected`(불리언, 첫 프레임 존중), `camera_ok`(불리언, 카메라 OK), `no_subtitles_or_watermarks`(불리언, 자막/워터마크 없음), `no_background_music`(불리언, 배경음악 없음), `dialogue_ok`(불리언, 대사 OK), `continuity_ok`(불리언, 연속성 OK), `verdict`(문자열, 최종 판정).

둘째, QA 핵심 규칙 13개. 첫째, `valid_video`는 ffprobe로 영상이 정상 디코딩 가능함을 검증한 결과이다(본 repo에서 ffprobe 실행은 항상 preview only). 둘째, `duration_ok`는 길이가 `StoryboardClip.duration`과 일치함을 검증한 결과이다. 셋째, `aspect_ratio_ok`는 종횡비가 `ProductionProject.aspect_ratio`와 일치함을 검증한 결과이다. 넷째, `identity_ok`는 정체성(얼굴/의상/소품)이 첫 프레임 의도와 일치함을 검증한 결과이다. 다섯째, `first_frame_respected`는 첫 프레임이 의도한 첫 프레임과 일치함을 검증한 결과이다. 여섯째, `camera_ok`는 카메라 워킹이 의도한 카메라 전략과 일치함을 검증한 결과이다. 일곱째, `no_subtitles_or_watermarks`는 자막과 워터마크가 없음을 검증한 결과이다. 여덟째, `no_background_music`은 배경음악이 없음을 검증한 결과이다(허용된 경우 제외). 아홉째, `dialogue_ok`는 대사가 의도한 대사와 일치함을 검증한 결과이다. 열째, `continuity_ok`는 이전 클립과의 연속성이 유지됨을 검증한 결과이다. 열한째, `verdict`는 13개 필드의 종합 판정으로 `PASS`/`FAIL`/`BLOCK`/`RETRY`/`UNREVIEWED`/`EXCEPTION` 중 하나이다. 열두째, `GEMINI_VIDEO_REVIEW_BLOCKED`는 Gemini 비디오 리뷰가 차단될 때 발생한다. 열세째, `FRAME_EXTRACTION_BLOCKED`는 프레임 추출이 차단될 때 발생한다.

셋째, QA는 본 repo의 local UI scaffold에서 mock fallback 데이터로만 시뮬레이션되며 실제 ffprobe 호출은 실행되지 않는다. 본 repo는 QA 결과로 `UNREVIEWED` placeholder를 사용하며 실제 QA는 외부 하네스에서 수행된다.

## §6. Seedance2 수락 초 명세

본 절은 Seedance2 도메인의 수락 초 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/schema.js`의 `AcceptedSeconds` 스키마에서 추출한 것이다.

첫째, 수락 초의 6개 필드는 다음과 같다. `clip_id`(클립 식별자), `source_file`(소스 파일 경로), `in_time`(시작 초, 숫자), `out_time`(끝 초, 숫자), `reason`(수락 사유 문자열), `reviewer_confidence`(리뷰어 자신감 문자열).

둘째, 수락 초의 핵심 규칙 3가지. 첫째, `in_time`과 `out_time`은 `out_time > in_time`을 만족해야 한다. 둘째, `source_file`은 root 내부 정해진 경로의 파일이어야 하며 root 외부 경로 파일은 거부된다. 셋째, `reviewer_confidence`는 `high`, `medium`, `low` 셋 중 하나이다.

셋째, 수락 초 부재 시 `MISSING_ACCEPTED_SECONDS` 차단이 발생하며 `validateFinalReady(projectState)`가 false를 반환한다. 본 repo의 mock fixture는 `accepted_seconds` placeholder를 가지며 실제 수락 초 데이터는 외부 하네스에서 결정된다.

## §7. Seedance2 게이트 정의 명세

본 절은 Seedance2 도메인의 게이트 정의를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/schema.js`의 `REVIEW_GATE_TYPES`와 `REVIEW_GATE_STATUSES` enum에서 추출한 것이다.

첫째, 게이트 타입 8종. `image_prompt`(이미지 프롬프트), `image_qa`(이미지 QA), `dashboard`(대시보드), `prompt_media`(프롬프트 미디어), `preflight`(사전 점검), `submit_confirmation`(제출 확인), `frame_qa`(프레임 QA), `accepted_seconds`(수락 초).

둘째, 게이트 상태 5종. `PASS`, `FAIL`, `BLOCK`, `UNREVIEWED`, `EXCEPTION`.

셋째, 각 게이트 타입별 blocker 매핑. 첫째, `image_prompt` → `IMAGE_PROMPT_TEMPLATE_NOT_REVIEWED`, `IMAGE_GEMINI_REVIEW_REQUIRED`, `IMAGE_GEMINI_REVIEW_NOT_PASS`. 둘째, `image_qa` → `MISSING_REFERENCE_ANNOTATION`, `MISSING_VIDEO_REFERENCE_METADATA`. 셋째, `dashboard` → `MISSING_IMAGE_DASHBOARD`, `IMAGE_DASHBOARD_STALE`. 넷째, `prompt_media` → `GEMINI_REVIEW_BLOCKED`, `MISSING_YOUMIND_TEMPLATE_EVIDENCE`, `MISSING_GPT_IMAGE_GUIDE_EVIDENCE`. 다섯째, `preflight` → `DREAMINA_PREFLIGHT_BLOCKED`. 여섯째, `submit_confirmation` → `CREDIT_CONFIRMATION_REQUIRED`. 일곱째, `frame_qa` → `FRAME_EXTRACTION_BLOCKED`, `GEMINI_VIDEO_REVIEW_BLOCKED`. 여덟째, `accepted_seconds` → `MISSING_ACCEPTED_SECONDS`.

넷째, 게이트의 6개 필드는 다음과 같다. `gate_id`, `clip_id`, `type`, `status`, `evidence_path`(증거 경로), `blocker`(차단 상수), `notes`(노트). 본 repo의 mock fixture는 각 게이트 타입별 placeholder를 가지며 실제 게이트 결과는 외부 하네스에서 결정된다.

## §8. Seedance2 프롬프트 명세

본 절은 Seedance2 도메인의 프롬프트 명세를 한국어로 풀어 명시한다. 본 명세는 본 repo의 sample fixture `src/fixtures/pipeline/sampleProductionFolder/prompts/clip_001_seedance.md`와 `src/lib/pipeline/schema.js`의 `PromptPackRecord` 스키마에서 추출한 것이다.

첫째, `PromptPackRecord`의 10개 필드. `clip_id`, `generator`(생성기, 보통 Seedance2), `prompt_path`(프롬프트 파일 경로), `model`(모델, 보통 Seedance2), `aspect_ratio`, `duration`, `no_bgm_required`(불리언, 기본 true), `negative_constraints`(네거티브 제약 문자열 배열), `attached_assets`(첨부 자산 문자열 배열), `review_status`(문자열).

둘째, 본 repo의 sample fixture 프롬프트 예시는 다음과 같다. 본 예시는 `src/fixtures/pipeline/sampleProductionFolder/prompts/clip_001_seedance.md`에 저장되어 있다.

```text
# Seedance Prompt

Use the approved first frame. No subtitles, no logo, no watermark, no
background music, no extra characters, no face morphing, no warped hands.
```

셋째, 본 예시에서 추출한 핵심 네거티브 제약 7종은 다음과 같다. 첫째, `No subtitles`. 둘째, `No logo`. 셋째, `No watermark`. 넷째, `No background music`. 다섯째, `No extra characters`. 여섯째, `No face morphing`. 일곱째, `No warped hands`. 본 7개 네거티브 제약은 `negative_constraints` 배열에 문자열로 저장되며 QA의 `no_subtitles_or_watermarks`, `no_background_music` 필드 검증의 기준선이 된다.

넷째, 프롬프트 명세는 또한 `attached_assets`(첨부 자산) 필드를 가진다. 첨부 자산은 첫 프레임 의도와 정체성을 유지하기 위한 레퍼런스 자산의 경로 배열이다. 첨부 자산이 없을 경우 `MISSING_REFERENCE_ANNOTATION` 또는 `MISSING_VIDEO_REFERENCE_METADATA` 차단이 발생할 수 있다.

## §9. Seedance2 최종 준비 명세

본 절은 Seedance2 도메인의 최종 준비 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/validators.js`의 `validateFinalReady(projectState)`와 `src/lib/pipeline/schema.js`의 `FinalReport` 스키마에서 추출한 것이다.

첫째, 최종 준비의 핵심 규칙 7가지. 첫째, `final_video_path` 필드가 비어있지 않아야 한다. 둘째, `production_folder` 필드가 비어있지 않아야 한다. 셋째, `clip_table`이 최소 1개 이상의 클립을 가져야 한다. 넷째, `submit_id`가 최소 1개 이상 기록되어 있어야 한다. 다섯째, `qa_result`가 `PASS` 판정을 가진 클립을 가져야 한다. 여섯째, `accepted_seconds`가 `clip_table`의 모든 클립에 대해 기록되어 있어야 한다. 일곱째, `blockers` 배열이 비어있어야 한다(즉 활성 차단이 없어야 한다).

둘째, 위 7가지 규칙 중 하나라도 실패하면 `validateFinalReady(projectState)`는 `{ ok: false, blockers: [...], details: {...} }`를 반환하며 `OUTPUT_QUALITY_NOT_PROVEN` 차단이 `blockers` 배열에 추가된다.

셋째, `FinalReport`의 9개 필드는 다음과 같다. `final_video_path`, `production_folder`, `generator_route`, `clip_table`(객체 배열), `known_credits`(숫자), `heartbeat_history`(HeartbeatRecord 배열), `qa_result`(QARecord 배열), `residual_risks`(문자열 배열), `blockers`(문자열 배열). 본 repo의 mock fixture는 `OUTPUT_QUALITY_NOT_PROVEN`과 `CREDIT_CONFIRMATION_REQUIRED` 두 차단을 활성화 상태로 두며 live generation이 차단됨을 사용자에게 명시적으로 알린다.

## §10. STOP — 본 문서의 한계 인정

본 audit/문서 작성 동안 외부 side effect 실행 0건, npm install 0회, git add/commit/push 0회, 셸 실행 0회이다. 본 문서는 외부 하네스 오리지널 원본이 아닌 local UI scaffold에서 합성한 것이며 외부 오리지널과 reconcile되지 않은 상태임을 본 §10에서 명시한다. 향후 외부 오리지널이 제공되면 본 문서는 즉시 그 오리지널로 교체되어야 한다. 본 명세의 모든 필드명/차단 상수/검증자/제출 흐름은 local UI scaffold가 가진 그대로의 것이며 external claim이 아님을 분명히 한다.
## §11. 외부 호출 surface 방향 (owner 갱신, 2026-07-15)

본 §11은 2026-07-07의 3-surface owner 결정을 역사적 기록으로 보존하되, 2026-07-15의 현재 owner 방향이 이를 대체했음을 명시한다. 현재 방향은 provider 후보 지정과 Open-Generative-AI의 실제 실행 가능 상태를 서로 다른 사실로 다룬다.

Seedance2의 reference / scene 이미지 생성 surface는 deepsearch-team의 `dst image`, profile `goldpure369`, Thinking으로 한정한다. 비디오 생성 후보는 `google-labs-flow-auto`, `grok-imagine`, Replicate API, ByteDance API다. 현재 Open-Generative-AI에서 DST는 로컬 완료 묶음의 다중 이미지 비교·정확한 한 장 연결·복원까지 동작하지만 `dst image` 자체에 no-submit 모드가 없어 앱에서 실제 생성을 시작하지 않는다. Flow는 no-submit 미리보기와 정확한 `0장 또는 2장` 참조 계약을 검사하지만 비공개 runtime/result staging과 라이브 제출은 연결되지 않았다. Grok은 로컬 미리보기와 결과 가져오기 표면이 있으나 지원 길이·화면비·참조·non-submit 경계가 모두 맞아야 하며 라이브 생성은 연결되지 않았다. Replicate는 요청 미리보기, 요청-결과 동일성 영수증, 로컬 결과 발행·선택·재생까지 동작하지만 인증 제출·상태 조회·다운로드 실행기는 없다. ByteDance는 결과 receipt 계약만 있고 직접 생성 adapter와 실제 결과 증거가 없다. 후보 지정은 라이브 생성 허용이나 성공 증거가 아니다.

Renderer는 셸·CLI·API를 직접 실행하지 않고 `window.filmPipeline`만 호출한다. Electron main이 provider allowlist, 불변 실행 계획, 입력과 출력 root를 소유한다. 기본 상태는 `preview_only` 또는 `dry_run`이며 `.env`나 API key는 Jessie의 사전 승인 없이 읽거나 사용하지 않는다. live generation, 파일 다운로드, 출력 품질 QA, Jessie의 최종 승인은 각각 별도 상태로 기록한다.

본 §11의 근거 문서는 `docs/ui_integration/18_api_decision_lock.md`다. adapter가 구현·검증되기 전에는 어떤 후보도 라이브 실행으로 승격하지 않는다.
