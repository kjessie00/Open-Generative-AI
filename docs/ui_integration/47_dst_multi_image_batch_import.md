# DST 다중 이미지 묶음 연결

## 목표

`dst image`가 이미 저장한 여러 후보를 한 장씩 반복해 가져오지 않고, 하나의 완료 묶음으로 선택한 항목에 연결한다. 연결 후에는 스토리보드에서 전체 후보를 비교하고 필요한 결과만 `다시 만들기`로 고른다.

## 구현 계약

- 완료/프로필/프롬프트와 `metadata.image_count` 1~12를 확인한다.
- `image_01`부터 빈칸 없는 소문자 순번, PNG/JPEG/WebP 실제 형식, 일반 파일, symlink 없음을 묶음 전체 단위로 확인한다. 한 장이라도 틀리면 일부를 노출하지 않는다.
- Renderer에는 대표 opaque token, 장수, 전체 크기만 노출하고 경로·파일명·SHA는 Electron main에 남긴다.
- `묶음 확인` → `N장 연결` 한 번으로 이미지를 CAS에 복사한 뒤, 연속 attempt를 원장에 한 번만 atomic rename한다.
- 단일 이미지의 기존 ID와 plan/confirm IPC payload는 그대로 유지한다.
- 생성 준비·다시 만들기 영역의 중복 상태 댜지를 평문으로 바꾸고, 반드시 필요한 검토 상태만 `미검토`, `수정 필요`, `다시 만들기`로 남겼다.

## 실제 Electron 검증

실제 DST 묶음:

- `role_create_a_three-candidate_production_image_41c261666c`
- manifest SHA-256: `56fa8a40693b5bb9c4d220a66ff8b613b3ab46572f908391454f15688bc768b5`
- metadata SHA-256: `65f52fed904e7de7b392a413fcb05e6b4fe43b2e1721ac9159c088defb3084ea`
- 3장 모두 941×1672 PNG. 원본 묶음은 전후 inventory가 동일했다.

격리 production에서 정상 `electron .` 진입점으로 검증했다.

1. 완료 묶음 1개·3장 탐색 PASS
2. `clip_002`에 attempt 2/3/4 원장 연속 추가 PASS
3. 3장 모두 941×1672로 디코딩되고 한 줄에 표시 PASS
4. attempt 3만 다시 만들기로 선택하고 retry queue 1개 저장 PASS
5. Electron 완전 종료 후 새 프로세스에서 3장·선택 1개·retry plan 1개 복원 PASS
6. 두 실행 모두 외부 요청, renderer warning/error/exception, 실패한 로드 0건. 강제 종료와 잔존 process group 0건.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-batch-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-batch-e2e/relaunch-restored.png`

## 검증 결과와 경계

- 전체 Node: 215/215 PASS
- 최종 영향 테스트: 31/31 PASS
- lint, Vite build 59 modules, `git diff --check`: PASS
- live `dst image`, 영상 생성, API key, 외부 업로드: 0건
- 가져온 이미지 품질은 자동 채택하지 않았다. 사람 검토와 Jessie 최종 승인은 별도 사실이다.
- 실제 캐릭터·장소 3장 묶음은 서로 다른 대상이다. 하나의 retry target에 합치지 않고, 다음 단계에서 각 이미지를 서로 다른 캐릭터/장소에 배치하는 mapping UI로 처리해야 한다.
