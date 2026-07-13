# Production Reader 검증 보고서

검증 시각: 2026-07-13 (Asia/Seoul)

검증 범위: AC6 Layout A/B reader → normalizer → validator, fail-safe, 실제 production read-only aggregate probe

외부 네트워크: macOS `sandbox-exec`의 `(deny network*)`로 테스트·lint·build 동안 차단

외부 생성·업로드·브라우저·패키징: 실행하지 않음

## 결론

fixture 기준 Layout A와 Layout B의 구조 차이, 상태 복원, 필수 필드, queue/QA/final 상태 분리와 validator fail-safe를 확인했다. 형식이 깨진 JSON·JSONL·dashboard JavaScript·CSV·accepted-seconds markdown은 성공으로 처리되지 않는다. `.git`, `node_modules`, 민감 이름, symlink root escape, dashboard 상대경로 escape, depth/file limit도 fail-closed 테스트로 고정했다.

실제 production은 승인된 두 후보만 원문을 출력하지 않고 읽었다. `gangnam_shorts_system_income_20260707`은 `dreamina_outputs/` marker 때문에 Layout B로 감지되지만 현재 구조화 reader 계약의 필수 JSON/JSONL/markdown은 없어 **부분 Layout B**로만 판정한다. `ep01_apologist`는 markdown 기반 storyboard/motion 자산은 있으나 현재 구조화 marker 계약에는 맞지 않아 `unknown`이다. 따라서 실제 데이터에 대해 fixture와 같은 완전한 복원 성공을 주장하지 않는다.

## Fixture 매트릭스

| 사례 | 감지 | reader/normalize | validator | 결과 |
| --- | --- | --- | --- | --- |
| `layoutAProduction/20260713-studio-fixture` | A, 날짜 실행 폴더 + `intake/`/`final/` | project/brief/storyboard/motion/dashboard/queue/accepted/final 경로 복원 | brief·storyboard PASS, dashboard missing 아님, final quality는 명시적 BLOCK | PASS |
| `sampleProductionFolder` | B, root `brief.md` + assets/edit 계열 | B 경로와 route `both`, queue/QA/accepted/final 상태 복원 | brief·storyboard PASS, dashboard missing 아님, 실제 final 증거 없음으로 BLOCK | PASS |
| nested `production/` | parent 선택 후 nested B root | selectedRoot와 rootPath 분리 | 필수 구조 부재는 blocker 유지 | PASS |
| malformed 묶음 | B | JSON/JSONL/JS/CSV/markdown `parsed:false` | storyboard/motion/dashboard/accepted blocker | PASS |
| sensitive/root escape | B 또는 unknown | 민감 이름·ignored dir·symlink 미수집 | raw marker·외부 경로 미노출 | PASS |
| walker 제한 | unknown | maxFiles/maxDepth와 truncation/skip count 노출 | 부분 스캔을 완전 성공으로 숨기지 않음 | PASS |

상태 분리 확인: accepted-seconds gate가 `PASS`여도 submit-confirmation은 `BLOCK`이고, 파일 존재·parse·review·quality acceptance는 서로 다른 필드다. fixture의 placeholder `.mp4`는 생성 영상이 아니며 품질 승인 증거로 사용하지 않는다.

## 실제 production aggregate probe

원문, 스크립트, 이미지·영상 내용, 계정 정보, private metadata는 출력하거나 보고서에 복사하지 않았다.

| production id | 감지 | 파일 수 | walker | 구조화 필드 | 결과 |
| --- | --- | ---: | --- | --- | --- |
| `gangnam_shorts_system_income_20260707` | B (부분 marker) | 293 | truncation 없음, skip 0 | storyboard/motion/dashboard/submit/heartbeat/accepted/report 모두 미검출 | `final_ready:false`; 6개 필수 blocker 유지 |
| `ep01_apologist` | unknown | 524 | truncation 없음, skip 0 | 구조화 storyboard/motion/dashboard/submit/heartbeat/accepted/report 미검출 | `final_ready:false`; 6개 필수 blocker 유지 |

잔여 gap:

- `REAL_LAYOUT_A_GAP`: 이번 최대 2개 실제 probe에는 reader 계약을 완전히 충족하는 실제 Layout A가 없었다. Layout A fixture E2E는 PASS다.
- `REAL_LAYOUT_B_PARTIAL`: 실제 B 감지 후보는 있으나 구조화 계약을 완전히 충족하지 않아 fixture 수준의 복원 성공으로 승격하지 않았다.
- 실제 자산 2개 모두 final quality ready로 오인하지 않았다.

## Fail-safe 보강

- directory/file 판정은 `lstat` 기반이며 symlink root와 내부 symlink를 읽지 않는다.
- walker는 민감 이름, `.git`, `node_modules`, unsupported entry, root escape, depth/file limit, read error를 집계한다.
- 민감 이름 또는 root 밖 dashboard path는 normalized UI state에서 빈 경로로 제거한다.
- 빈 CSV header와 required header가 없는 accepted-seconds 표는 `parsed:false`다.
- brief에서는 UI 복원에 필요한 `Concept:`/`Logline:`만 구조화하고 raw markdown 본문을 reader 결과에 포함하지 않는다.

## 검증 명령과 결과

모든 명령 exit code 0:

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test tests/productionReaderLayouts.test.mjs
  8/8 PASS

/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs
  64/64 PASS

/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' npm run lint
  PASS

/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' npm run build
  PASS, Vite 39 modules

git diff --check
  PASS
```

실제 probe는 `readProductionFolder` → `normalizeProductionReaderState` → `validateFinalReady`를 각 후보에 적용하고 위 aggregate만 출력했다. happyVideoFactory는 수정하지 않았다.

## Artifact integrity

- Layout A fixture manifest SHA-256: `d17e2ef71c4d33a438ad6fba30a3a20fc6d24de2c1a52872d19cdfdded0a3cab`
- `tests/productionReaderLayouts.test.mjs`: `e086593af0690d65787a3e9915232c56f2dbf081893632beda028f7019d13a9a`
- `electron/lib/productionReader.js`: `43df136a84ba40479c187b919394db52e536c6c24bd0e1c20f314e2fd013ba3c`
- `src/lib/pipeline/productionNormalizer.js`: `030f8442834c9c0338184ca5f38512a47069d4bcf274fd3e8836da3a6123f935`

보고서와 checkpoint hash는 최종 commit 후 acceptance evidence에서 별도 기록한다.
