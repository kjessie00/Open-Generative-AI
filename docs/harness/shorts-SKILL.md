# Shorts 도메인 작업 명세 (Shorts SKILL)

상태: **합성본 (synthesized) — originals MISSING**

작성일: 2026-07-07 KST. 운영 방향 갱신: 2026-07-15 KST. 대상 repo: `/Users/jessiek/StudioProjects/Open-Generative-AI`. 보고 언어: 한국어. 본 문서는 AGENTS.md가 정의한 필수 하네스 문서 중 shorts 도메인 작업 명세 파일이며, 외부 하네스 오리지널 원본은 본 repo에 부재한 상태에서 본 repo의 local UI scaffold (`src/lib/pipeline/`, `src/components/pipeline/`, `src/fixtures/pipeline/sampleProductionFolder/`, `docs/ui_integration/`)에서 추출·합성한 내용이다. 본 문서의 모든 필드명/블로커/상태/검증자는 local UI scaffold가 가진 것을 그대로 인용하며, 오리지널 하네스 원본과 reconcile 되지 않은 상태임을 §10에서 명시한다.

## §1. 본 문서의 의의와 적용 범위

본 문서는 Open-Generative-AI 시네마틱 파이프라인 UI가 다루는 shorts 도메인의 작업 명세를 정의한다. 본 명세의 의의는 사용자 인터페이스가 자체 추정하지 못하는 shorts 도메인의 필드 명세, 차단 명세, 안전 규칙 원본을 한 자리에 모은다는 점이다. 본 명세는 본 repo의 local UI scaffold에서 추출한 합성본이며 오리지널 하네스 원본은 별도 외부 경로에 존재한다. 본 명세의 적용 범위는 shorts 도메인의 10개 패널(프로젝트 인테이크, 스토리보드, 샷 디자이너, 모션 보드, 자산 대시보드, 프롬프트 팩, 리뷰 게이트, 큐, QA, 최종 리포트)과 1개 설정 패널에 한정되며 Seedance2/Dreamina 도메인은 `docs/harness/Seedance2-SKILL.md`에서 별도로 다룬다.

본 명세의 핵심 불변식은 사용자 인터페이스가 자체적으로 영상을 만들지 않는다는 점이다. 사용자 인터페이스는 Jessie가 별도로 운영하는 하네스의 드라이런 사용자 인터페이스 셸이며 그 하네스의 결과물을 읽고 미리보기 전용 명령 표면을 보여 주는 것이 전부다. 본 명세는 그 드라이런 보장을 코드 차원에서 강제하기 위한 필드 명세, 차단 명세, 안전 규칙 원본을 제공한다.

## §2. Shorts 프로덕션 필드 명세

본 절은 shorts 프로덕션이 다루는 모든 필드의 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/schema.js`의 12개 스키마 typedefs에서 추출한 것이며 본 repo의 local UI scaffold가 가진 필드명과 일치한다.

첫째, `ProductionProject` 스키마는 shorts 프로덕션의 최상위 메타 필드를 담는다. 필드는 `production_id`(문자열, 프로덕션 식별자), `title`(문자열, 제목), `root_path`(문자열, 프로덕션 루트 절대경로), `route`(`seedance`/`flow_omni`/`both` 셋 중 하나, 생성 경로), `target_platform`(문자열, 대상 플랫폼), `aspect_ratio`(문자열, 종횡비), `status`(문자열, 상태), `created_at`(문자열, 생성 시각 ISO), `updated_at`(문자열, 갱신 시각 ISO)이다.

둘째, `ProductionBrief` 스키마는 shorts 프로덕션의 브리프 필드를 담는다. 필드는 `concept`(문자열, 콘셉트), `logline`(문자열, 로그라인), `script_path`(문자열, 스크립트 파일 상대경로), `dialogue_required`(불리언, 대사 필요 여부), `subtitles_required`(불리언, 자막 필요 여부), `music_required`(불리언, 음악 필요 여부), `natural_sfx_required`(불리언, 자연 효과음 필요 여부), `stop_loss_rule`(문자열, 손절 규칙)이다.

셋째, `StoryboardClip` 스키마는 스토리보드의 한 클립 필드를 담는다. 필드는 `scene_id`(문자열, 씬 식별자), `clip_id`(문자열, 클립 식별자), `duration`(숫자, 길이 초), `dramatic_beat`(문자열, 드라마틱 비트), `characters`(문자열 배열, 등장 캐릭터), `location`(문자열, 장소), `first_frame`(문자열, 첫 프레임 의도), `action`(문자열, 액션), `camera`(문자열, 카메라), `lighting`(문자열, 조명), `audio_sfx_dialogue`(문자열, 음향/효과음/대사), `reference_dependencies`(문자열 배열, 레퍼런스 의존), `risk`(문자열, 리스크), `dominant_action`(문자열, 지배적 액션), `dominant_camera_strategy`(문자열, 지배적 카메라 전략)이다.

넷째, `MotionBoardShot` 스키마는 모션 보드의 한 샷 필드를 담는다. 필드는 `clip_id`(문자열, 클립 식별자), `shot_size`(문자열, 샷 크기), `camera_movement`(문자열, 카메라 움직임), `movement_risk`(문자열, 움직임 리스크), `identity_risk`(문자열, 정체성 리스크), `continuity_notes`(문자열, 연속성 노트), `duration_lock`(불리언, 길이 잠금)이다.

다섯째, `AssetRecord` 스키마는 자산 대시보드의 한 자산 필드를 담는다. 필드는 `asset_id`(문자열, 자산 식별자), `path`(문자열, 파일 경로), `type`(문자열, 자산 타입), `target_clip_id`(문자열, 대상 클립 식별자), `prompt_path`(문자열, 프롬프트 경로), `review_path`(문자열, 리뷰 경로), `review_verdict`(`PASS`/`FAIL`/`BLOCK`/`RETRY`/`UNREVIEWED`/`EXCEPTION` 셋 중 하나), `video_use_status`(문자열, 비디오 사용 상태), `continuity_notes`(문자열, 연속성 노트), `retry_notes`(문자열, 재시도 노트)이다.

여섯째, `PromptPackRecord` 스키마는 프롬프트 팩의 한 레코드 필드를 담는다. 필드는 `clip_id`(문자열, 클립 식별자), `generator`(문자열, 생성기), `prompt_path`(문자열, 프롬프트 경로), `model`(문자열, 모델), `aspect_ratio`(문자열, 종횡비), `duration`(숫자, 길이 초), `no_bgm_required`(불리언, 배경음악 금지), `negative_constraints`(문자열 배열, 네거티브 제약), `attached_assets`(문자열 배열, 첨부 자산), `review_status`(문자열, 리뷰 상태)이다.

일곱째, `ReviewGate` 스키마는 리뷰 게이트의 한 게이트 필드를 담는다. 필드는 `gate_id`(문자열, 게이트 식별자), `clip_id`(문자열, 클립 식별자), `type`(`image_prompt`/`image_qa`/`dashboard`/`prompt_media`/`preflight`/`submit_confirmation`/`frame_qa`/`accepted_seconds` 셋 중 하나), `status`(`PASS`/`FAIL`/`BLOCK`/`UNREVIEWED`/`EXCEPTION` 셋 중 하나), `evidence_path`(문자열, 증거 경로), `blocker`(문자열, 차단 상수), `notes`(문자열, 노트)이다.

여덟째, `SubmitRecord` 스키마는 제출의 한 레코드 필드를 담는다. 필드는 `clip_id`(문자열, 클립 식별자), `subcommand`(문자열, 서브커맨드), `requested_model`(문자열, 요청 모델), `submitted_cli_model`(문자열, 제출된 CLI 모델), `submit_id`(문자열, 제출 식별자), `logid`(문자열, 로그 ID), `credit_count`(숫자, 크레딧 합계), `status`(문자열, 상태), `next_heartbeat_at`(문자열, 다음 하트비트 시각), `download_dir`(문자열, 다운로드 디렉터리), `command_log_path`(문자열, 커맨드 로그 경로)이다.

아홉째, `HeartbeatRecord` 스키마는 하트비트의 한 레코드 필드를 담는다. 필드는 `checked_at`(문자열, 점검 시각), `submit_id`(문자열, 제출 식별자), `clip_id`(문자열, 클립 식별자), `queue_status`(문자열, 큐 상태), `gen_status`(문자열, 생성 상태), `backend_benefit_type`(문자열, 백엔드 benefit type), `backend_queue_debug`(문자열, 백엔드 큐 디버그), `downloaded_files`(문자열 배열, 다운로드된 파일들), `next_heartbeat_at`(문자열, 다음 하트비트 시각), `blocker`(문자열, 차단 상수)이다.

열째, `QARecord` 스키마는 QA의 한 레코드 필드를 담는다. 필드는 `clip_id`(문자열, 클립 식별자), `file_path`(문자열, 파일 경로), `valid_video`(불리언, 유효 비디오), `duration_ok`(불리언, 길이 OK), `aspect_ratio_ok`(불리언, 종횡비 OK), `identity_ok`(불리언, 정체성 OK), `first_frame_respected`(불리언, 첫 프레임 존중), `camera_ok`(불리언, 카메라 OK), `no_subtitles_or_watermarks`(불리언, 자막/워터마크 없음), `no_background_music`(불리언, 배경음악 없음), `dialogue_ok`(불리언, 대사 OK), `continuity_ok`(불리언, 연속성 OK), `verdict`(문자열, 판정)이다.

열한째, `AcceptedSeconds` 스키마는 수락 초의 한 레코드 필드를 담는다. 필드는 `clip_id`(문자열, 클립 식별자), `source_file`(문자열, 소스 파일), `in_time`(숫자, 시작 초), `out_time`(숫자, 끝 초), `reason`(문자열, 사유), `reviewer_confidence`(문자열, 리뷰어 자신감)이다.

열두째, `FinalReport` 스키마는 최종 리포트의 필드를 담는다. 필드는 `final_video_path`(문자열, 최종 비디오 경로), `production_folder`(문자열, 프로덕션 폴더), `generator_route`(문자열, 생성기 경로), `clip_table`(객체 배열, 클립 표), `known_credits`(숫자, 알려진 크레딧 합계), `heartbeat_history`(HeartbeatRecord 배열, 하트비트 이력), `qa_result`(QARecord 배열, QA 결과), `residual_risks`(문자열 배열, 잔여 리스크), `blockers`(문자열 배열, 차단 상수 배열)이다.

## §3. Shorts 차단 명세 (Blockers)

본 절은 shorts 프로덕션이 다루는 모든 차단 상수의 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/blockers.js`의 `BLOCKERS` 객체 23개 상수에서 추출한 것이다. 본 repo의 local UI scaffold는 다음 23개 차단 상수를 정확한 문자열로 사용하며 신규 차단은 본 23개 상수 중 우선 사용해야 한다.

첫째, `MISSING_PIPELINE_DOC`는 본 필수 하네스 문서(현재 본 문서 포함) 부재 시 발생한다. 둘째, `MISSING_WORK_DECOMPOSITION`은 작업 분해 산출물 부재 시 발생한다. 셋째, `MISSING_PRODUCTION_BRIEF`은 프로덕션 브리프 부재 시 발생한다. 넷째, `MISSING_STORYBOARD_CONTINUITY_PACKET`은 스토리보드 연속성 패킷 부재 시 발생한다. 다섯째, `MISSING_MOTION_BOARD`는 모션 보드 부재 시 발생한다. 여섯째, `MISSING_YOUMIND_TEMPLATE_EVIDENCE`는 YouMind 템플릿 증거 부재 시 발생한다. 일곱째, `MISSING_GPT_IMAGE_GUIDE_EVIDENCE`는 GPT Image Guide 증거 부재 시 발생한다. 여덟째, `IMAGE_PROMPT_TEMPLATE_NOT_REVIEWED`는 이미지 프롬프트 템플릿 미검토 시 발생한다. 아홉째, `IMAGE_GEMINI_REVIEW_REQUIRED`는 이미지 Gemini 리뷰 필요 시 발생한다. 열째, `IMAGE_GEMINI_REVIEW_NOT_PASS`는 이미지 Gemini 리뷰 미통과 시 발생한다.

열한째, `MISSING_IMAGE_DASHBOARD`는 이미지 대시보드 부재 시 발생한다. 열두째, `IMAGE_DASHBOARD_STALE`은 이미지 대시보드 오래됨 시 발생한다. 열세째, `MISSING_REFERENCE_ANNOTATION`은 레퍼런스 주석 부재 시 발생한다. 열넷째, `MISSING_VIDEO_REFERENCE_METADATA`는 비디오 레퍼런스 메타데이터 부재 시 발생한다. 열다섯째, `DURATION_LOCK_MISSING`은 길이 잠금 부재 시 발생한다. 열여섯째, `DREAMINA_PREFLIGHT_BLOCKED`는 Dreamina 사전 점검 차단 시 발생한다. 열일곱째, `GEMINI_REVIEW_BLOCKED`는 Gemini 리뷰 차단 시 발생한다. 열여덟째, `FRAME_EXTRACTION_BLOCKED`는 프레임 추출 차단 시 발생한다. 열아홉째, `GEMINI_VIDEO_REVIEW_BLOCKED`는 Gemini 비디오 리뷰 차단 시 발생한다. 스무번째, `CREDIT_CONFIRMATION_REQUIRED`는 크레딧 확인 필요 시 발생한다. 스물한번째, `MODEL_MISMATCH`는 모델 불일치 시 발생한다. 스물두번째, `MISSING_ACCEPTED_SECONDS`는 수락 초 부재 시 발생한다. 스물세번째, `OUTPUT_QUALITY_NOT_PROVEN`은 출력 품질 미입증 시 발생한다.

## §4. Shorts 상태 머신 명세

본 절은 shorts 프로덕션의 상태 머신을 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/statusMachine.js`에서 추출한 것이다. 본 repo의 local UI scaffold는 다음 7개 모드를 강제한다.

첫째, planning files 모드(planning 파일 저장)는 항상 `allowed`이다. planning 파일 저장은 외부 side effect로 도달하지 않으며 root 내부 정해진 경로만 사용한다. 둘째, local reads/writes 모드(로컬 읽기/쓰기)는 항상 `allowed`이다. 단, secret성 entry는 skip된다. 셋째, non-consuming status commands 모드(비소모 상태 커맨드)는 항상 `preview_only`이다. 해당 커맨드는 결과를 보여 주기만 하며 실제로 실행하지 않는다. 넷째, image generation 모드(이미지 생성)는 항상 `blocked`이다. 다섯째, Dreamina submit 모드(Dreamina 제출)는 항상 `blocked`이다. 여섯째, Gemini review 모드(Gemini 리뷰)는 항상 `blocked`이다. 일곱째, external upload 모드(외부 업로드)는 항상 `blocked`이다.

위 7개 모드 중 allowed는 planning files와 local reads/writes 2개이며 preview_only는 non-consuming status commands 1개이며 blocked는 image generation, Dreamina submit, Gemini review, external upload 4개이다. credit-consuming 또는 외부 액션은 UI에서 표현될 수 있으나 본 스키마 레이어는 live execution에 대해 `blocked`를 반환한다. 본 정책은 future Electron main-process bridge가 확인된 감사된 execution hook을 구현할 때까지 dry-run 거동을 보존한다.

## §5. Shorts 검증자 명세 (Validators)

본 절은 shorts 프로덕션의 검증자 함수 명세를 한국어로 풀어 명시한다. 본 명세는 `src/lib/pipeline/validators.js`에서 추출한 7개 검증자 함수에 기반한다.

첫째, `validateProductionBrief(project)`은 프로덕션 브리프가 필수 필드를 모두 가지는지 검증한다. 둘째, `validateStoryboardClip(clip)`은 스토리보드 클립이 필수 필드를 모두 가지는지 검증한다. 셋째, `validateImageDashboard(projectState)`은 이미지 대시보드가 존재하고 최신인지 검증한다. 넷째, `validatePromptPack(promptPack)`은 프롬프트 팩이 필수 필드와 네거티브 제약을 모두 가지는지 검증한다. 다섯째, `validateSubmitAllowed(clipState)`은 제출 허용 여부를 검증한다. 여섯째, `validateHeartbeatAllowed(lastHeartbeat, now)`은 하트비트 허용 여부를 검증하며 같은 active production 기준 최소 20분 이후만 due로 본다. 일곱째, `validateFinalReady(projectState)`은 최종 준비가 완료되었는지 검증하며 final.mp4, concat list, source clip path, submit id, QA records, accepted seconds, blockers, report evidence가 모두 있어야 true를 반환한다.

위 7개 검증자 각각은 다음 형태를 반환한다. `{ ok: boolean, blockers: string[], details: object }`. 본 형태는 본 repo의 local UI scaffold가 가진 정확한 반환 형식이다. 본 검증자가 다루는 핵심 규칙은 다음과 같다. 첫째, 제출은 이미지 대시보드 누락 또는 오래됨 시 차단된다. 둘째, 제출은 첨부 이미지 판정이 `RETRY`, `BLOCK`, `UNREVIEWED`이면 차단된다(명시적 예외 제외). 셋째, 제출은 Gemini prompt/media review `PASS` 없으면 차단된다. 넷째, 제출은 명시적 credit confirmation 없으면 차단된다. 다섯째, retry는 기본적으로 한 번의 live attempt 이후 차단된다. 여섯째, 하트비트는 이전 active 하트비트로부터 최소 20분 이후에만 due로 본다. 일곱째, 최종 준비는 final 비디오 증거, 다운로드된 클립, 제출 ID, QA 레코드, 수락 초, 차단 기록이 모두 없으면 false다.

## §6. Shorts 안전 규칙 원본

본 절은 shorts 도메인의 안전 규칙 원본을 한국어로 풀어 명시한다. 본 안전 규칙은 §2 필드 명세와 §3 차단 명세와 §4 상태 머신과 §5 검증자 명세 위에 구축되는 cross-cutting 정책이다.

첫째, dry-run 모드 강제 규칙. 본 repo의 local UI scaffold는 production folder 열기 시 dryRunMode true와 안전 커맨드 실행 허용 false를 config에 강제 적용한다. 사용자가 임의로 dry-run 모드를 끄려 해도 시스템은 그 요청을 거부한다. 둘째, IPC surface 최소화 규칙. 본 repo의 Electron 메인 측 IPC handler는 9 surface만 노출하며 그 외 surface는 노출하지 않는다. ipcMain.handle 호출은 단일 film-pipeline 콜론 prefix로 한정된다. 셋째, IPC handler path whitelist 규칙. IPC handler는 root 외부 경로를 거부하며 root traversal escape를 시도하는 경로도 거부한다. 넷째, 분류기 hard-block 규칙. side effects 모듈의 분류기는 5 type(크레딧 소비 생성, 외부 검수, 외부 업로드, 계정 변형, VIP 폴백 모델)을 hard-block 한다. 다섯째, 비밀 정보 노출 차단 규칙. production reader의 walk 단계, 파일 처리 단계, markdown record 단계 3단계 모두에서 민감 이름 패턴 매치 entry를 skip한다.

여섯째, 패널 직접 호출 금지 규칙. 본 repo의 11개 비즈니스 패널(`IntakePanel`, `StoryboardPanel`, `ShotDesignerPanel`, `MotionBoardPanel`, `AssetDashboardPanel`, `PromptPackPanel`, `ReviewGatesPanel`, `QueuePanel`, `QAPanel`, `FinalReportPanel`, `PipelineSettingsPanel`)과 8개 보조 컴포넌트는 exec, spawn, child_process, fetch, XMLHttpRequest, newFunction 같은 직접 호출 패턴이 0건이다. 일곱째, 안전 커맨드 실행 hard-block 규칙. `electron/lib/filmPipelineProvider.js`의 안전 커맨드 실행 함수는 항상 ok false, executed false, error `PIPELINE_COMMAND_BLOCKED`를 반환한다. 여덟째, 명령 미리보기 카드 구조 규칙. 명령 미리보기 카드는 명령, 사이드 이펙트 타입, 허용 상태, 필요 증거 출력, 차단 목록, copy 버튼 6개 필드를 가지며 실행 버튼은 노출하지 않는다.

## §7. 본 명세의 ui_integration lineage 참조

본 절은 본 명세와 ui_integration lineage 사이의 참조 관계를 한국어로 풀어 명시한다. 본 명세는 ui_integration lineage의 §1(하네스 ↔ 사용자 인터페이스 계약)의 §1.1 두 필수 하네스 문서 정의와 §2 사용자 인터페이스 측 의무의 11개 패널 표에 직접 대응한다.

첫째, 본 명세의 §2 필드 명세는 `src/lib/pipeline/schema.js`의 12개 typedefs와 1:1 매핑된다. 후속 단계 에이전트는 본 §2 필드명을 코드와 reconcile할 때 `src/lib/pipeline/schema.js`를 직접 참조해야 한다. 둘째, 본 명세의 §3 차단 명세는 `src/lib/pipeline/blockers.js`의 `BLOCKERS` 객체 23개 상수와 1:1 매핑된다. 셋째, 본 명세의 §4 상태 머신은 `src/lib/pipeline/statusMachine.js`의 7개 모드 정의와 1:1 매핑된다. 넷째, 본 명세의 §5 검증자 명세는 `src/lib/pipeline/validators.js`의 7개 검증자 함수와 1:1 매핑된다.

본 명세는 또한 다음 ui_integration 문서들과 lineage로 연결된다. 첫째, `docs/ui_integration/00_repo_audit.md`(repo 구조 감사). 둘째, `docs/ui_integration/01_harness_to_ui_contract.md`(하네스 ↔ UI 계약). 셋째, `docs/ui_integration/02_implementation_plan.md`(구현 계획). 넷째, `docs/ui_integration/03_shell_implementation_report.md`(셸 구현 보고). 다섯째, `docs/ui_integration/04_pipeline_schema.md`(파이프라인 스키마 layer). 여섯째, `docs/ui_integration/05_electron_bridge.md`(Electron bridge). 일곱째, `docs/ui_integration/06_panel_implementation_report.md`(패널 구현 보고). 여덟째, `docs/ui_integration/07_production_reader.md`(프로덕션 reader). 아홉째, `docs/ui_integration/08_command_preview_and_gates.md`(명령 미리보기와 게이트). 열째, `docs/ui_integration/09_final_report_ui.md`(최종 리포트 UI). 열한째, `docs/ui_integration/10_test_matrix.md`(테스트 매트릭스). 열두째, `docs/ui_integration/11_final_audit.md`(최종 감사). 열세째, `docs/ui_integration/12_deepsearch_scene_image_preview.md`(DeepSearchTeam scene image 미리보기). 열넷째, `docs/ui_integration/13_agent_handoff.md`(에이전트 핸드오프). 열다섯째, `docs/ui_integration/14_side_effect_audit.md`(사이드 이펙트 안전 감사).

## §8. Shorts 프로덕션 레이아웃

본 절은 shorts 프로덕션이 다루는 두 가지 디렉터리 레이아웃을 한국어로 풀어 명시한다. 본 레이아웃 명세는 `electron/lib/productionReader.js`의 `detectLayout` 함수에 기반한다.

첫째, Layout A(`docs/short_drama_pipeline_runs/<YYYYMMDD>-<slug>/`)는 날짜별 슬러그 폴더 안에 `intake/`, `storyboard/`, `prompts/`, `generated/`, `final/`, `qa/` 서브디렉터리와 `report.md` 파일을 둔다. 둘째, Layout B(`production/`)는 루트 안에 `brief.md`, `script.md`, `assets/`, `video_references/`, `image_generation/`, `image_dashboard/`, `storyboard/`, `motion_board/`, `prompts/`, `dreamina_outputs/`, `reviews/`, `edit/` 서브디렉터리와 `ledger.csv` 파일을 둔다.

두 레이아웃 모두 `productionReader.readProductionFolder`가 읽는다. 본 repo의 sample fixture `src/fixtures/pipeline/sampleProductionFolder/`는 Layout B 형태를 따른다. 구조화 데이터가 없으면 fake success를 만들지 않고 blocker를 기록한다.

## §9. 본 명세의 누락 항목과 향후 reconcile

본 절은 본 명세에서 다루지 못한 항목과 향후 외부 하네스 오리지널과 reconcile할 때 따라야 할 절차를 한국어로 풀어 명시한다.

첫째, 본 명세는 외부 하네스 오리지널 원본과 reconcile되지 않은 합성본이다. 외부 오리지널 원본이 별도 경로에 존재하며 그 원본이 본 §2 ~ §8 명세와 다른 필드명이나 다른 차단 상수나 다른 상태 모드를 가진다면 본 명세는 즉시 그 오리지널로 교체되어야 한다. 둘째, 본 명세는 `src/lib/pipeline/`의 코드와 직접 reconcile되어야 한다. 코드와 본 명세 사이에 불일치가 발견되면 둘 중 어느 한 쪽이 정정되어야 한다. 셋째, 본 명세는 ui_integration lineage의 §1.1 두 필수 하네스 문서 정의와 직접 대응하며 본 repo가 본 명세를 닫는다는 주장은 AGENTS.md의 blocker `MISSING_PIPELINE_DOC`를 해소하지 않는다. blocker 해소는 외부 오리지널 원본의 직접 인용 또는 외부 오리지널과의 reconcile된 사본이 필요함을 명시한다.

넷째, 본 명세는 향후 다음 audit cycle에서 다음 4가지 항목을 재검증해야 한다. 첫째, §2 필드명 12개 스키마가 코드와 일치하는지. 둘째, §3 차단 상수 23개가 코드와 일치하는지. 셋째, §4 상태 모드 7개가 코드와 일치하는지. 넷째, §5 검증자 7개 함수의 반환 형태와 규칙이 코드와 일치하는지.

## §10. STOP — 본 문서의 한계 인정

본 audit/문서 작성 동안 외부 side effect 실행 0건, npm install 0회, git add/commit/push 0회, 셸 실행 0회이다. 본 문서는 외부 하네스 오리지널 원본이 아닌 local UI scaffold에서 합성한 것이며 외부 오리지널과 reconcile되지 않은 상태임을 본 §10에서 명시한다. 향후 외부 오리지널이 제공되면 본 문서는 즉시 그 오리지널로 교체되어야 한다. 본 명세의 모든 필드명/차단 상수/상태 모드/검증자 함수는 local UI scaffold가 가진 그대로의 것이며 external claim이 아님을 분명히 한다.
## §11. 외부 호출 surface 방향 (owner 갱신, 2026-07-15)

본 §11은 2026-07-07의 3-surface owner 결정을 역사적 기록으로 보존하되, 2026-07-15의 현재 owner 방향이 이를 대체했음을 명시한다. 현재 방향은 provider 후보 지정과 Open-Generative-AI의 실제 실행 가능 상태를 서로 다른 사실로 다룬다.

shorts의 reference / scene 이미지 생성 surface는 deepsearch-team의 `dst image`, profile `goldpure369`, Thinking으로 한정한다. 비디오 생성 후보는 `google-labs-flow-auto`, `grok-imagine`, Replicate API, ByteDance API다. 현재 Open-Generative-AI에서 DST는 로컬 완료 묶음의 다중 이미지 비교·정확한 한 장 연결·복원까지 동작하지만 `dst image` 자체에 no-submit 모드가 없어 앱에서 실제 생성을 시작하지 않는다. Flow는 no-submit 미리보기와 정확한 `0장 또는 2장` 참조 계약을 검사하지만 비공개 runtime/result staging과 라이브 제출은 연결되지 않았다. Grok은 로컬 미리보기와 결과 가져오기 표면이 있으나 지원 길이·화면비·참조·non-submit 경계가 모두 맞아야 하며 라이브 생성은 연결되지 않았다. Replicate는 요청 미리보기, 요청-결과 동일성 영수증, 로컬 결과 발행·선택·재생까지 동작하지만 인증 제출·상태 조회·다운로드 실행기는 없다. ByteDance는 결과 receipt 계약만 있고 직접 생성 adapter와 실제 결과 증거가 없다. 후보 지정은 라이브 생성 허용이나 성공 증거가 아니다.

Renderer는 셸·CLI·API를 직접 실행하지 않고 `window.filmPipeline`만 호출한다. Electron main이 provider allowlist, 불변 실행 계획, 입력과 출력 root를 소유한다. 기본 상태는 `preview_only` 또는 `dry_run`이며 `.env`나 API key는 Jessie의 사전 승인 없이 읽거나 사용하지 않는다. live generation, 파일 다운로드, 출력 품질 QA, Jessie의 최종 승인은 각각 별도 상태로 기록한다.

본 §11의 근거 문서는 `docs/ui_integration/18_api_decision_lock.md`다. adapter가 구현·검증되기 전에는 어떤 후보도 라이브 실행으로 승격하지 않는다.
