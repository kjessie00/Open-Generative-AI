# 장면 참조 이미지 연결

## 한 줄 결론

인물·장소 결과를 장면 이미지 작업에 실제 파일로 연결할 수 있다. 작업대에는 쉬운 한글 안내만 보이고, 파일 경로·해시·명령·프로바이더 정보는 Electron main과 비공개 CLI 안에만 남는다.

## 사용자가 보는 흐름

1. `기획·대본`과 `설계`에서 직접 수정하거나 에이전트 수정안을 적용한다.
2. `생성 준비 → 이미지 작업`에서 인물 시트와 장소 시트 결과를 연결한다.
3. 장면 이미지 프롬프트를 직접 고치거나 에이전트에게 수정을 요청한다.
4. `작업 진행 → 실행 목록 준비`를 누른다.
5. 장면 카드의 `실행 전 확인`에서 다음만 확인한다.

- `참조 이미지와 작업 내용이 준비되었습니다.`
- `다음 행동: 이미지 작업에서 장면 프롬프트를 확인하세요.`
- `예상 결과: 이미지 1장`
- `이 내용을 펼쳐도 실행은 시작되지 않습니다.`

참조가 없어졌거나 현재 이미지 계획과 맞지 않으면 `참조 이미지를 다시 연결해야 합니다.`라고 안내한다. 새 상태 배지나 프로바이더 이름은 표시하지 않는다.

## 비공개 연결 계약

- 결과는 저장 당시 MIME, 바이트 수, SHA-256, 이미지 서명을 다시 검증한다.
- 허용 형식은 PNG, JPEG, WebP다.
- 장면 실행별 `references/` 디렉터리는 `0700`, 파일과 manifest는 `0600`이다.
- 확장자는 검증된 MIME에서만 정한다.
- 같은 결과를 다시 준비하면 기존의 동일한 파일과 manifest를 그대로 사용한다.
- 심볼릭 링크, 변조된 바이트, 오래된 설계·이미지 계획, 결과 토큰 불일치는 실패로 닫힌다.
- renderer와 preload에는 참조 파일 resolver나 raw path IPC를 추가하지 않았다.

비공개 handoff는 `film_pipeline.new_project_execution_handoff.v4`, 참조 manifest는 `film_pipeline.new_project_execution_references.v1`이다. DST 장면 미리보기는 연결된 파일마다 정확히 한 번씩 `--attach <absolute-path>`를 구성하지만 다음 값은 계속 고정된다.

```json
{
  "preview_only": true,
  "live_submit_allowed": false,
  "copy_allowed": false
}
```

## 실제 검증

격리된 실제 `userData`에 PNG 인물 결과와 JPEG 장소 결과를 연결했다. 실제 macOS Electron에서 Computer Use로 `생성 준비 → 실행 목록 준비 → 실행 전 확인`을 직접 눌렀고, 장면 한 건이 참조 두 장을 받는지 로컬 CLI로 다시 검사했다.

- 장면 작업: 1건
- 참조 파일: 2건, PNG 1장 + JPEG 1장
- `--attach` 순서와 handoff 참조 순서: 일치
- 참조 디렉터리/파일 권한: `0700` / `0600`
- MIME·이미지 서명·바이트 수·SHA-256·manifest: 모두 일치
- 재검사 후 inode와 manifest 바이트: 동일
- 같은 실행을 동시에 두 번 준비: 두 요청 모두 통과, 임시 파일 잔여 0건
- receipt: 0건
- 외부 호출·모델 호출·생성 실행: 모두 0건
- 작업 화면의 프로바이더명·내부 토큰·해시·절대경로: 0건

독립 읽기 전용 재검토는 최초 동시 준비에서 한 요청이 다른 요청의 임시 파일을 보고 중단하는 P2를 찾았다. 임시 파일을 최종 `references/` 밖의 비공개 run 디렉터리로 분리한 뒤 같은 barrier 재현에서 두 요청 모두 통과했고, 최종 재검토는 남은 P1/P2 없음으로 판정했다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/reference-staging-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/reference-staging-e2e/computer-use-result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/reference-staging-e2e/desktop-reference-staging.png`

## 현재 경계와 다음 작업

DST 장면 입력의 참조 연결과 명령 미리보기는 기술적으로 통과했다. 실제 DST 제출·생성 결과 품질·사람 승인은 아직 수행하지 않았다.

다음 구현 단위는 참조를 요구하는 영상 작업이다. Flow는 정확한 참조 개수와 비공개 런타임/result staging, Grok은 지원 시간·화면비와 non-submit 경계, Replicate·ByteDance는 안전한 직접 어댑터가 각각 필요하다.
