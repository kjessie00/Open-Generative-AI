# Replicate 영상 요청 미리보기

## 한 줄 결론

영상 작업에서 Replicate를 고르면 Electron main이 장면의 첫 화면 1장과 5초·10초 길이를 검증해 실제 전송 형식과 같은 비공개 요청 미리보기를 만든다. 작업대에는 `요청 내용 확인 가능`과 다음 행동만 보이며, API 전송·결제·영상 생성은 시작되지 않는다.

## 사용자가 보는 흐름

1. `1 기획·대본`과 `2 설계`에서 직접 내용을 고치거나 에이전트에게 수정안을 요청한다.
2. `3 생성 준비 → 영상 작업`에서 장면별 생성 도구를 `Replicate`로 고른다.
3. 첫 화면, 프롬프트, 길이를 확인하고 기존 `영상 작업 준비`를 누른다.
4. `작업 진행`에서 다음 짧은 안내를 확인한다.

- 상태: `요청 내용 확인 가능`
- 안내: `Replicate에 보낼 영상 요청이 준비되었습니다. 아직 전송되지 않았습니다.`
- 다음 행동: `영상 작업에서 프롬프트·길이·첫 화면을 확인하세요.`

새 버튼이나 상태 배지는 추가하지 않았다. 요청 URL, 데이터 URI, 인증 환경 변수 이름, 내부 token/hash, claim 경로는 renderer로 보내지 않는다.

## 비공개 요청 계약

현재 지원 범위는 `bytedance/seedance-1-pro`의 image-to-video 요청이다.

- 참조: MIME과 파일 서명이 확인된 PNG/JPEG/WebP 정확히 1장
- 참조 크기: data URI 전체가 1 MiB 이하
- 길이: 5초 또는 10초
- 고정 입력: `resolution: 1080p`, `fps: 24`, `camera_fixed: false`
- 이미지가 있으므로 `aspect_ratio`는 보내지 않음
- 요청: `POST https://api.replicate.com/v1/models/bytedance/seedance-1-pro/predictions`
- 헤더 이름: `Authorization`, `Content-Type`, `Prefer`
- 인증: 값은 저장하지 않고 환경 변수 이름 `REPLICATE_API_TOKEN`만 비공개 계약에 기록
- 안전값: `preview_only: true`, `live_submit_allowed: false`, `external_call_performed: false`

공식 근거:

- [Seedance 1 Pro 모델 입력 계약](https://replicate.com/bytedance/seedance-1-pro/llms.txt)
- [Seedance 1 Pro API](https://replicate.com/bytedance/seedance-1-pro/api)
- [Replicate 입력 파일 지침](https://replicate.com/docs/topics/predictions/input-files)

## 출력 선점 계약

요청 미리보기마다 `<task_token>.mp4`가 아직 없는지 확인하고, 같은 출력의 소유권을 나타내는 `<task_token>.claim.json`을 mode `0600`으로 한 번만 만든다.

- claim은 `O_EXCL`·`O_NOFOLLOW`로 생성하고 파일과 부모 디렉터리를 `fsync`한다.
- run revision, task token, request revision, 출력 파일명만 묶는다.
- 반복 inspect는 같은 요청·claim·inode를 유지한다.
- 예상하지 않은 파일, 기존 출력, 바뀐 claim은 조용히 덮어쓰지 않고 실패한다.
- 실제 `.mp4` 파일은 생성하지 않는다.

## 실제 로컬 검증

격리된 `userData`에 유효한 PNG 1장과 5초 Replicate 장면을 만들고 다음을 확인했다.

- 정확한 모델 endpoint, 헤더 이름, prompt, data URI, duration, resolution, fps, camera 설정
- `aspect_ratio` 부재와 1 MiB 제한
- command 빈 값, 복사 불가, live submit 불가
- mode-0600 claim, 재생성 `EEXIST`, 출력 `.mp4` 부재
- 반복 inspect에서 request·claim·inode 동일
- 공개 상태의 요청 본문·인증 이름·data URI·claim/output 경로 비노출
- 외부 호출 0, 모델 호출 0, 생성 실행 0

재현 명령:

```bash
node scripts/verify-replicate-request-preview.mjs <격리-증거-폴더>
```

스크립트는 `<격리-증거-폴더>/result.json`을 mode `0600`으로 새로 만든다. 이번 통합 검증 증거는
`/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/replicate-request-preview-e2e/`에 보관했다.
같은 폴더의 `computer-use-result.json`과 `replicate-video-workbench.png`는 실제 macOS Electron 화면에서 요청 안내와 비공개 값 비노출을 확인한 영수증이다.

기술 연결 PASS는 Replicate 실제 전송, 영상 생성 성공, 결과 품질, Jessie의 최종 승인과 각각 별개다.
