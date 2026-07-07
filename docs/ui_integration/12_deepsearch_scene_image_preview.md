# DeepSearchTeam 장면 이미지 Preview 연동

## 상태

구현 완료. 스토리보드/ShotPayload에서 장면 이미지 프롬프트와 DeepSearchTeam `dst image` 명령 preview를 만들지만, 실제 생성은 실행하지 않는다.

## 적용 위치

- `src/lib/pipeline/deepsearchSceneImages.js`
  - storyboard clip을 DeepSearchTeam 장면 이미지 payload로 변환한다.
  - GPT Image 2 프롬프트 가이드 구조를 반영해 장면, 주체, 카메라, 조명, 레퍼런스 역할, 제약, QA 항목을 정리한다.
  - `python -m dst image "<prompt>" -p goldpure369` commandSpec을 만든다.
- `src/components/pipeline/ShotDesignerPanel.js`
  - 선택 clip의 DeepSearchTeam 프롬프트 preview를 표시한다.
  - `Copy DeepSearchTeam prompt`와 `Save DeepSearchTeam prompt draft`만 제공한다.
  - CommandPreviewCard는 copy-only이며 run button이 없다.
- `src/lib/pipeline/commandBuilders.js`
  - Pipeline command preview 목록에 DeepSearchTeam scene image commandSpec을 포함한다.

## DeepSearchTeam 계약

- profile: `goldpure369`
- mode: Thinking image generation
- output: 프롬프트당 완성 이미지 1장
- 기본 차단: collage, storyboard grid, contact sheet, subtitles, captions, logo, watermark, UI text, extra characters, face morphing, warped hands
- 실행 전 stop 조건:
  - `goldpure369` 세션이 확인되지 않음
  - Thinking mode가 확인되지 않음
  - 레퍼런스 파일/역할이 불명확함
  - Jessie의 명시적 생성 승인 없음

## 안전 경계

DeepSearchTeam scene image commandSpec은 항상 다음 값으로 생성된다.

```text
side_effect_type = credit_consuming_generation
preview_only = true
requires_confirmation = true
disabled_reason = CREDIT_CONFIRMATION_REQUIRED
```

따라서 현재 UI에서 가능한 작업은 다음뿐이다.

- 프롬프트 복사
- 프롬프트 draft planning file 저장
- shell-safe command preview 복사

현재 UI에서 불가능한 작업은 다음이다.

- `python -m dst image ...` 실행
- ChatGPT/DeepSearchTeam 브라우저 자동화 실행
- 이미지 생성 크레딧 사용
- Gemini/외부 리뷰 호출
- Dreamina/Seedance submit
- 외부 업로드

## 검증

추가 테스트:

- `src/lib/pipeline/deepsearchSceneImages.test.mjs`

검증 항목:

- storyboard clip이 DeepSearchTeam scene image payload로 변환된다.
- 프롬프트에 `goldpure369`, Thinking mode, one finished image, no collage/no watermark 게이트가 포함된다.
- commandSpec은 `credit_consuming_generation`으로 분류되고 `CREDIT_CONFIRMATION_REQUIRED` 및 `SIDE_EFFECT_BLOCKED`로 차단된다.
