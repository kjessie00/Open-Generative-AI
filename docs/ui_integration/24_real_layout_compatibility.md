# 실제 production 레이아웃 호환성 검증

기준일: 2026-07-13 (Asia/Seoul)

실행자: `real_layout_reader_integrator`

범위: 두 승인된 happyVideoFactory production 포맷의 구조-only reader → normalizer → validator 호환성. 외부 네트워크, 생성, 업로드, Electron/browser 실행은 사용하지 않았다.

## 결론

기존 Layout A/B 계약을 유지하면서 실제 포맷을 Layout B의 명시적 variant로 분류한다.

- `gangnam_scene_bundle`: `SUMMARY.md`, `story_scene_bundle.json`, `dreamina_outputs/` 조합
- `markdown_scene_pack`: `script.md`, `storyboard/`, `motion_board/`, `prompts/` 조합

두 variant 모두 project/brief와 존재하는 storyboard·motion·prompt·queue·report·media 구조를 UI state로 복원한다. 구조-only 증거는 완성된 continuity packet, motion approval, dashboard review, accepted seconds 또는 output quality로 승격하지 않는다. `final_ready`는 두 실제 경로 모두 `false`다.

## 데이터 최소화 계약

- `story_scene_bundle.json`: scene/clip 식별자, 양의 duration, aspect ratio, 구조 존재 여부만 반환한다. narrative/prompt/dialogue 필드는 폐기한다.
- storyboard/motion Markdown: scene/beat/clip 식별자, heading 수와 상대경로만 반환한다. heading 본문이나 narrative는 구조 레코드에 복사하지 않는다.
- `submit_*.txt`: 파일명에서 구조적 clip 순서와 `artifact_present_unverified`만 만든다. 본문, submit id, backend model 또는 성공 상태를 추론하지 않는다.
- `cost_ledger.csv`: credits/cost/amount 계열 열만 남긴다.
- `capcut_report.json`: 안전한 key 목록과 존재만 남기고 값을 폐기한다. report 존재는 output quality approval이 아니다.
- 합성 fixture만 저장소에 추가했다. 실제 production 원문, 프롬프트, dialogue, 이미지·영상, 계정·private metadata는 저장소와 본 보고서에 복사하지 않았다.

## 합성 fixture와 회귀

| fixture | 증거 | 기대 결과 |
| --- | --- | --- |
| `realLayoutVariants/gangnamSceneBundle` | summary, scene bundle, root prompt, submit text, cost CSV, CapCut report | `gangnam_scene_bundle`; story/prompt/queue/report 복원; review/final blocker 유지 |
| `realLayoutVariants/markdownScenePack` | script, beat board, scene motion file, prompt pack, media placeholders | `markdown_scene_pack`; brief/story/motion/prompt/media 복원; duration/dashboard/accepted/final blocker 유지 |

기존 Layout A/B, nested production, malformed JSON/JSONL/JS/CSV/Markdown, sensitive name, symlink/root escape, dashboard traversal, walker limit 회귀를 함께 실행했다. 새 parser에 대한 narrative 제거와 unsafe scene id 정규화도 테스트한다.

## 실제 aggregate-only probe

이전 기준은 `docs/ui_integration/20_production_reader_validation.md`다. 당시 Gangnam 후보는 partial B이고 Ep01 후보는 unknown이었으며 구조화 state를 복원하지 못했다.

| production | 이전 | 현재 관측 | 남은 blocker | 결과 |
| --- | --- | --- | --- | --- |
| `gangnam_shorts_system_income_20260707` | partial B, 구조화 packet 미검출 | B / `gangnam_scene_bundle`; 293 files; storyboard 12, prompt 1, queue artifact 6, report 있음, asset 20 | storyboard structure-only, motion 없음, dashboard 없음, accepted seconds 없음, output quality 미입증 | `final_ready:false` |
| `ep01_apologist` | unknown, 구조화 packet 미검출 | B / `markdown_scene_pack`; 524 files; storyboard 4, motion 구조 레코드 존재, prompt 2, asset 218 | storyboard/motion structure-only, dashboard 없음, accepted seconds 없음, final report/quality 미입증 | `final_ready:false` |

Ep01 probe에서는 heading 기반 motion 레코드 14개가 관측되었다. 최종 구현은 `scene_*.md` 하나를 motion item 하나로 고정하는 file-level dedup을 적용했고, 합성 fixture 회귀로 고정했다. probe 제한 때문에 실제 경로를 다시 읽어 숫자를 재출력하지 않았다.

각 경로는 probe 전후 상대경로·종류·크기·mtime manifest SHA-256가 동일했다.

- Gangnam: `12cb10fb93f1e62f2b4a73aaf3027e3b68aae22465a97dc74fdd0a155e80a0d6`
- Ep01: `f6495c4e8fe71c10b2def2db4b219f8fc077193284f5826cb8d0634263352c9a`

## 검증

모든 명령은 exit code 0이며 `(deny network*)` sandbox에서 실행했다.

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test tests/productionReaderLayouts.test.mjs
  10/10 PASS

/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test tests/*.test.js tests/*.test.mjs src/lib/pipeline/*.test.mjs
  67/67 PASS

/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' npm run lint
  PASS

/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' npm run build
  PASS, Vite 39 modules

git diff --check
  PASS

test ! -d release
  PASS
```

Artifact SHA-256:

- `electron/lib/productionReader.js`: `3b46417847f74687f137181f811f4cf26d073e6e8e4d4fab2440c4382994c220`
- `src/lib/pipeline/productionNormalizer.js`: `22c4a808df55276a85c31cd1be1d93074af47bb77a17a861bd768558ec80fd86`
- `tests/productionReaderLayouts.test.mjs`: `4f29120c7c6fd0be97b8f18a924e1ef046a4d1ca7e816bec677eb19a043ecc3d`
- 합성 variant fixture manifest: `1f420d5ff49fcb2cf95319d97c8709baedbf7336baeadaca9d05726724ed9e4c`

## 잔여 한계

- 구조 존재는 continuity/motion 검토 PASS가 아니다.
- media 파일 존재는 image dashboard, QA 또는 accepted seconds 증거가 아니다.
- submit text 존재는 실제 제출, submit id, backend model 확인 또는 credit 사용 증거가 아니다.
- 실제 Electron GUI와 native folder dialog 검증은 본 회차 범위가 아니다.
