# 다른 로컬의 생성 결과 연결 계약

## 한 줄 결론

이미지·영상 생성 도구의 설치 위치가 달라도 소스 코드를 수정하지 않는다. 각 컴퓨터에서 `설정 → 결과 폴더`의 실제 저장 폴더를 한 번 선택하면, 작업대와 외부 에이전트가 기존의 미리보기·연결·검토 흐름을 그대로 사용한다.

## 에이전트가 하는 일

1. 사용자가 쓸 생성 도구를 확인한다.
2. 작업대 설정에서 해당 결과 폴더만 선택한다.
3. 외부 스킬이나 CLI로 생성한 뒤 작업대의 결과 목록을 새로고침한다.
4. 후보를 미리 보고 정확한 작업에 연결한다.
5. 기술 연결 성공과 결과물 품질 승인, 사용자의 최종 승인을 따로 기록한다.

작업대 안에 별도 에이전트 채팅을 만들지 않는다. Codex 같은 외부 에이전트가 이 문서와 현재 프로젝트 파일을 읽고 위 순서를 수행한다.

## 폴더 구조

- 이미지 결과: DST의 `output/images` 폴더. 하위 bundle은 `manifest.json`, `metadata.json`, `images/`를 가진다.
- Flow 영상: `outputs/generated` 폴더. 하위 결과는 `<result-id>/result_1.mp4` 형식이다.
- Grok 영상: Grok output 폴더. 결과는 `<result-id>.mp4` 형식이다.
- Replicate 영상: canonical receipt 결과 루트. 하위 결과는 `<result-id>/{result.mp4,receipt.json}` 형식이다.
- ByteDance 영상: canonical receipt 결과 루트. 하위 결과는 `<result-id>/{result.mp4,receipt.json}` 형식이다.

정해진 구조가 아니면 작업대의 스캐너를 느슨하게 만들지 않는다. 생성 도구 쪽 export adapter가 위 구조를 만들거나, 에이전트가 기존 안전한 import 계약에 맞춰 결과를 준비한다.

## 경로와 안전 경계

- 경로 선택은 Electron main process의 native folder dialog만 사용한다.
- renderer는 provider 이름만 요청하며 절대경로를 입력하거나 저장하지 않는다.
- 선택한 경로는 해당 컴퓨터의 Electron userData 설정에만 남고 Git에는 들어가지 않는다.
- 화면과 연결 요청에는 기존처럼 opaque candidate token만 사용한다.
- 환경변수는 CI나 명시적 운영 override로 유지하며 우선순위는 `테스트 옵션 → 환경변수 → 로컬 설정 → 기존 기본값`이다.
- 앱은 홈 폴더, 네트워크 드라이브, 다른 저장소를 자동으로 재귀 탐색하지 않는다.

## 최소 검증

다른 로컬을 흉내 낸 임시 폴더에서 다음을 확인한다.

1. native picker로 선택한 provider 루트만 저장된다.
2. 앱 재시작 뒤 같은 로컬 설정이 복원된다.
3. DST·Flow·Grok·Replicate·ByteDance 후보가 기존 형식으로 발견된다.
4. symlink, 변조 파일, 잘못된 결과 구조는 계속 차단된다.
5. 제작 폴더 선택과 외부 결과 폴더 선택은 서로 덮어쓰지 않는다.
