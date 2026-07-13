# G3 인간 검토 작업대 v1

작성일: 2026-07-14 KST
구현·최종 통합 담당: `/root/canonical_handoff_adapter_integrator`

## 결과

`클립 QA` 탭에 한국어 중심의 `G3 인간 검토 작업대`를 추가했다. 작업자는
canonical `shot_manifest.json`의 샷마다 승인된 후보 동영상을 직접 고르고,
제공자·대사 소스·비트·테이크 ID·채택 구간·전환·선택 사유와 메모를 기록한다.
기계 QC는 `short-drama-room-qc-report-v1`의 읽기 전용 구조 근거로만 표시되며
사람 선택과 자동으로 합쳐지거나 승인으로 승격되지 않는다.

## 입력 계약

- 필수: exact root `shot_manifest.json`
  (`short-drama-room-shot-manifest-v1`)
- 필수: 모든 manifest 샷을 정확히 한 번 포함하는 exact root `qc_report.json`
  (`short-drama-room-qc-report-v1`)
- 선택: exact root `beats.json` (`short-drama-room-beats-v1`)
- 후보 allowlist:
  - `generated/downloads/`
  - `generated/candidates/`
  - `review_candidates/`
  - `takes/`
- 후보 형식: `.mp4`, `.mov`, `.webm`, `.m4v`

canonical 후보 manifest나 신뢰할 수 있는 샷↔비트 자동 매핑은 현재 production
계약에 없다. 따라서 v1은 파일명으로 샷이나 비트를 추론하지 않는다. 작업자가
opaque 후보 token을 선택한 뒤 샷과 비트를 명시적으로 연결한다.

## 보안·부작용 경계

- production root는 main-owned config만 사용하고 renderer 경로 인수를 받지 않는다.
- renderer에는 절대 경로 대신 relative display path와 세션 HMAC opaque token만 준다.
- 후보 파일은 모든 ancestor의 `lstat`, root containment, 일반 파일, 확장자, 크기,
  `O_NOFOLLOW`, 안정 identity와 전체 SHA-256을 통과해야 한다.
- production reader가 심볼릭 링크를 검색에서 제외하면 해당 사실을 별도 blocker로
  보존하고 strict export를 허용하지 않는다.
- 미리보기는 32 MiB 이하 후보만 재검증 후 bounded base64로 전달한다.
- 초안 저장 위치는
  `<Electron userData>/film-pipeline/drafts/g3-review-v1/<root-fingerprint>/`다.
- 초안 폴더는 mode `0700`, 파일은 mode `0600`, 같은 폴더의 exclusive 임시 파일과
  atomic rename으로 저장한다.
- partial 저장은 `draft.json`만 만든다. strict 내보내기는 userData 안에만
  `draft.json`, `selected_takes.json`, `g3_review_export.json`을 만든다.
- production의 `selected_takes.json`, ledger, happyVideoFactory, release 폴더는 쓰지 않는다.
- command, ffmpeg/ffprobe, 생성, 외부 검토, 업로드, 계정 작업은 실행하지 않는다.
- 모든 IPC 결과는 `executed:false`, 모든 export는 `promotion_ready:false`다.

## canonical 형태와 비승격 envelope

내보낸 `selected_takes.json`은 다음 exact top-level shape를 사용한다.

```text
schema_version, project_id, episode_id, takes
```

각 take는 다음 exact field를 가진다.

```text
shot_id, chosen_provider, video_path, dialogue_source, qc_report_ref,
selected_at, beat_id, take_id, source_in_sec, source_out_sec, transition_in
```

`selected_at`은 main process가 기록한다. 함께 저장되는
`film_pipeline.g3_review_export.v1` envelope는 source snapshot SHA-256, 사람의 선택
사유·메모, machine-QC/human 분리 상태와 `promotion_ready:false`를 보존한다.
이 파일은 canonical 소비자와의 shape 호환을 위한 비승격 초안이지 production
반영 증거가 아니다.

## UI/UX

- 기존 11개 탭을 유지하고 `클립 QA` 안에 집중형 workspace를 배치했다.
- 샷 navigator, 후보/미리보기, 인간 선택 editor를 별도 200줄 미만 컴포넌트로 나눴다.
- `320px`부터 단일 열, `md` 이상에서 샷 navigator와 편집 화면을 분리한다.
- native `button`, `select`, `input`, `textarea`, `fieldset`, `label`, `nav`를 사용한다.
- 주요 interactive target은 최소 `44px`(`min-h-11`)다.
- loading, empty, error, blocked, unsaved, export-ready 상태를 별도로 표시한다.
- 기계 QC와 인간 선택을 별도 제목/landmark로 보여 자동 승인 오해를 방지한다.

## 검증 결과

모든 검증은 self-owned `/tmp` fixture와 임시 userData만 사용하고 외부 네트워크를
차단했다. 첫 focused는 29개 중 28개가 통과했다. 유일한 실패는 production reader가
심볼릭 링크를 후보 목록에 넣기 전에 이미 제외하므로 provider가 후보 단위 링크
코드를 볼 수 없다는 테스트/계약 불일치였다. 허용된 한 번의 국소 self-fix에서
`security.skipped.symlink`를 `G3_PRODUCTION_SCAN_SKIPPED_SYMLINKS`로 정확히 보존했다.
재-focused는 29/29 PASS였다.

```text
network-denied focused: 29/29 PASS
network-denied full suite: 141/141 PASS
npm run lint: PASS
npm run build: PASS, Vite 47 modules
git diff --check: PASS
trailing whitespace scan: PASS
release/: absent
/tmp/open-generative-ai-security-review-20260713-p0: absent
```

focused matrix는 provider 보안·canonical shape·mode 0700/0600 원자 저장·IPC/preload·
결정론적 DOM·컴포넌트 크기를 포함한다. full suite는 기존 production reader,
canonical finishing/delivery, 새 프로젝트 bootstrap, path provenance와 planning write
회귀를 포함한다.

happyVideoFactory는 검증 전후 commit
`caaef48102b94dfe131bca9f4f6b77ae8fff14bd`, tree
`06847a85b6e621f32eb73806095380b9a0eb0f65`,
`git status --short | shasum -a 256` aggregate
`ff49315970f73ec73613234a1642485e4bfd59d9d67d578f1979ef44a43ed094`로 동일했다.
production/happyVideoFactory/real userData write, Electron/GUI, command, 생성·검토·업로드,
외부 네트워크, ffmpeg/ffprobe, release/deploy/package/push는 0건이다.

## 남은 경계

- 실제 Electron GUI/runtime는 이 구현 회차에서 실행하지 않는다.
- native media decoder에서 fixture 후보가 실제 재생되는지는 별도 GUI 검증이 필요하다.
- 후보별 authoritative duration이 없으면 구간의 유한성·순서만 검사하고 영상 길이
  상한 검사는 하지 않는다. UI에 이 사실을 명시한다.
- 실제 승격은 happyVideoFactory가 소유하는 importer/CAS가 필요하다. v1에는 importer,
  production write, ledger write 또는 승인 IPC가 없다.
