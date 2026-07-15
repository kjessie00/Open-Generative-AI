# Provider 결과 영수증 연결

검증일: 2026-07-15 KST

## 목적

과거 Replicate 파일의 고정 이름과 SHA 허용목록에만 의존하지 않고, 새로 완료된 영상이 작업대의 `완료 영상 가져오기`에 자동으로 나타나게 한다. Renderer는 경로·해시·셸 권한을 받지 않으며 Electron main이 영수증과 영상을 검증한다.

## 생산자 계약

`happyVideoFactory`의 새 Seedance 생성 영상이 기존 ffprobe 검증을 통과하면 다음 구조를 기록한다.

```text
outputs/provider_results/<provider>/<result-id>/
├── receipt.json
└── result.mp4
```

- schema: `film_pipeline.external_video_result.v1`
- provider: `replicate` 또는 `bytedance`
- result id: provider + 영상 SHA-256 앞 24자리
- 결과 폴더: `0700`, 두 파일: `0600`
- 영수증에는 프롬프트, 원본 경로, URL, API key를 기록하지 않는다.
- 영수증 기록 실패는 이미 성공한 유료 생성을 다시 제출하지 않고 오류 로그만 남긴다.
- `skip_existing`로 재사용한 파일은 이번 생성의 출처가 아니므로 새 영수증을 만들지 않는다.

## 작업대 검증

Electron main은 Replicate와 ByteDance의 표준 결과 폴더를 먼저 읽고, Replicate의 기존 역사 허용목록을 fallback으로 유지한다. 표준 결과는 exact 8-key JSON, exact 2-file 폴더, provider/result id, SHA-256, byte size, ISO 완료 시각, symlink·경로 이탈, 읽기 전후 안정성, MP4 magic과 실제 ffprobe를 모두 통과해야 후보가 된다. 공개 후보는 기존 8필드만 유지해 절대 경로·파일명·SHA를 노출하지 않는다.

## 실제 증거

- 원본 실제 영상: Replicate Seedance 1, `6,349,367` bytes, `5.041667s`, `1088×1920`
- 원본·표준 결과·작업대 CAS SHA-256: `a685206f1e318fe12611c210ff411b3160b02608cf967c81233ba1e81db451ee`로 모두 일치
- 표준 결과 ID: `replicate_a685206f1e318fe12611c210`
- 실제 Electron: 후보 선택, Blob 미리보기 `readyState=4`/오류 없음, 장면 연결, `replicate · 시도 2`, 다시 만들기 선택과 검토 초안 저장 확인
- 완전 종료 후 재실행: 카드·선택 상태 복원, 영상 `readyState=4`, `5.041667s`, `1088×1920`, 가로 넘침 0, 표준 후보 재표시 확인
- 원장: `generation_status=imported`, `review_status=unreviewed`, `source_provenance=provider_result_receipt_v1`
- 생산자 집중 테스트 `11/11`, 작업대 집중 테스트 `18/18`, 작업대 전체 테스트 `211/211`, lint/build/diff check PASS

## 분리해서 보는 현재 상태

- 기술 연결: PASS
- 실제 로컬 영상으로 작업대 확인: PASS
- 라이브 영상 생성/API key/외부 업로드: 실행 0건
- 실제 ByteDance 결과: 없음. 계약과 MOCK ffprobe 경로만 PASS
- 영상 품질: 아직 `unreviewed`
- Jessie 최종 승인: 아직 아님
- strict Electron stderr clean: Chromium의 `Unsupported pixel format: -1` 진단 때문에 BLOCK이지만, 영상 메타데이터와 재생 준비는 PASS
