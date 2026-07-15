# DST 캐릭터·장소 시트 개별 연결

## 목표

하나의 `dst image` 완료 묶음에 들어 있는 캐릭터·장소 이미지를 한 대상에 몰아넣지 않는다. 모든 이미지를 동시에 보여주고, 각 이미지 바로 아래에서 서로 다른 캐릭터 또는 장소 대상을 고른 뒤 한 번에 작업대로 연결한다.

## 연결 계약

- 캐릭터 묶음은 캐릭터 대상에만, 장소 묶음은 장소 대상에만 연결한다.
- 묶음의 1번부터 마지막 이미지까지 빠짐없이 순서대로 지정해야 한다.
- 같은 재생성 대상은 한 묶음 안에서 두 번 선택할 수 없다.
- 각 대상은 저장된 `dst` 재생성 항목이어야 하며 Renderer가 임의 경로·대상 ID를 쓰지 못한다.
- 계획 후 원장·검토 초안·묶음 내용·대상 대응이 바뀌면 확인 단계에서 중단한다.
- 모든 이미지를 내용 주소 저장소에 복사한 뒤 원장은 한 번의 atomic rename으로 공개한다.
- 기존 단일 이미지 연결과 여러 장면 후보를 한 장면에 연결하는 계약은 유지한다. 여러 캐릭터·장소 이미지를 단일 대상에 연결하는 요청만 차단한다.

## UI

- 각 실제 이미지를 9:16 비율의 `object-contain` 미리보기로 모두 표시한다.
- 이미지 바로 아래에 `이미지 N 대상` 선택 상자를 둔다.
- 가능한 대상만 보여주고 이미 고른 대상은 다른 선택 상자에서 숨긴다.
- 대상 지정이 덜 되었으면 `묶음 확인`을 누를 수 없다.
- 상태 코드는 노출하지 않고 `불러오는 중`, `미리보기를 불러오지 못했습니다`, `N장의 연결을 확인했습니다`, `N장을 각각 연결했습니다`처럼 짧은 한글만 쓴다.
- 320/768/1024/1440px에서 각각 1/2/2/3열이며 선택 상자는 최소 44px이다.

## 실제 Electron 검증

정상 `electron .` 진입점과 실제 DST 장소 묶음을 격리된 production에 복사해 Renderer→preload→main 전체 경로를 확인했다.

- 묶음: `ep02_location_assets_batch_b_talk-room_doorway_0b31082ed6`
- manifest SHA-256: `41f3f3f019794de766c0514f94953fd84e8524721b3716563ba5ae3a3cbd25f4`
- metadata SHA-256: `aa9501a7c8d20f3a80266c4b2b8e6cabc559b141eab5860da146b2498c95658a`

| 이미지 | 연결 대상 | 크기 | 원본 SHA-256 |
|---|---|---:|---|
| `image_01.png` | `loc_school_talk_room_doorway` | 941×1672 | `70db338e23d92567b871ce317d235ee8bb1054530d6d5fe98bb1875e58dffaa6` |
| `image_02.png` | `loc_old_car_rain_evening` | 941×1672 | `925bca814d198fb592eba06160dd161e0e86c9605d8ae0247e15adc45693bfd6` |
| `image_03.png` | `loc_zhixia_bedroom_ep02_night` | 941×1672 | `02228f8423af8c304af733fe38387a7b3eb2c3e7dca08dbfbf2a9937df79e999` |

결과:

1. Computer Use로 실제 Electron 화면을 읽고 3개 선택 상자의 초기값이 비어 버리는 문제를 발견했다.
2. 선택 상자 option 구성 뒤 값을 설정하도록 수정하고, 세 대상의 초기 1:1 연결을 실제 접근성 트리에서 다시 확인했다.
3. 세 이미지가 서로 다른 장소 대상으로 attempt 2에 연결되고, 원장 3건이 한 번에 추가됐다.
4. 오래된 자동차 이미지만 `다시 만들기`로 선택해 retry queue 1개를 저장했다.
5. Electron을 완전히 종료하고 새 프로세스로 다시 실행했을 때 세 결과와 선택 1개가 복원됐다.
6. 두 실행 모두 외부 요청, console warning/error, 예외, 실패한 로드 0건이었다. 강제 종료와 잔존 process group도 0건이었다.
7. 320/768/1024/1440px에서 가로 넘침 0, 열 수 1/2/2/3, 선택 상자 최소 높이 44px를 실제 Electron에서 확인했다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-reference-mapping-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-reference-mapping-e2e/reference-mapping.png`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-dst-reference-mapping-e2e/relaunch-restored.png`

## 화면 충실도 기록

기준 화면은 `/Users/jessiek/.codex/visualizations/2026/07/15/generation-prep-queue-1440.png`, 최종 화면은 위 `reference-mapping.png`를 `view_image`로 직접 비교했다.

1. 정보 구조: 기존 5단계 작업대와 DST 결과 연결 영역 안에만 개별 배치를 추가했다.
2. 레이아웃: 기존 사이드바·본문 밀도를 유지하고 1440px에서 세 카드를 한 줄에 배치했다.
3. 글자: 기존 크기와 굵기 체계를 재사용했다.
4. 색: 기존 검정·중성색·청록 강조색을 유지했다.
5. 이미지: 원본 9:16을 자르지 않고 전체가 보이게 했다.
6. 조작: label과 select를 연결했고, 터치 높이 44px와 네 대표 너비의 가로 넘침 0을 확인했다.
7. 상태 표현: 새 badge나 내부 상태 코드를 만들지 않고 짧은 한글 문장만 사용했다.

전역 header와 navigation 문구는 바꾸지 않았다. 새 문구는 이미지별 연결에 필요한 조작 설명뿐이며, 확인된 중대한 시각 차이는 없다. Electron 전용 화면이므로 일반 Browser/IAB 대신 실제 Electron Computer Use와 loopback CDP 캡처를 사용했다.

## 현재 경계

- 기술 검증: 영향 테스트 36/36, 전체 순차 테스트 254/254, lint, Vite build 59 modules, diff check와 실제 Electron 연결·부분 재생성 선택·재시작 복원까지 PASS. 병렬 전체 실행에서는 기존 실제 ffmpeg 테스트가 런타임 탐색 실패로 한 번 실패했지만 단독 재실행과 순차 전체 실행에서 각각 PASS했다.
- 실제 생성: 새 `dst image`, 영상 생성, API key 사용, 외부 업로드는 0건이다.
- 결과물 품질: 세 원본이 서로 다른 장소임은 육안으로 확인했지만 영상미·연속성·최종 채택 품질은 자동 승인하지 않았다.
- 사람 승인: Jessie의 최종 품질 승인은 별도 단계다.
- 최초 생성 대상: 이번 연결은 저장된 재생성 항목을 권한으로 사용한다. 기존 결과가 전혀 없는 최초 캐릭터·장소 대상 연결은 다음 구현 범위다.
