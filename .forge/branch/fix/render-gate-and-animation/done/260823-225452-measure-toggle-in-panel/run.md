# RUN — 측정 모드를 뷰어 패널에서 켠다

slug: measure-toggle-in-panel · task 12 · tdd: on · 실행 2026-08-23

**워크플로우를 쓰지 않았다.** 슬라이스 3개가 전부 하드 직렬(S1→S2→S3)이라 병렬화 여지가 0이고
변경 규모가 소스 4파일 · 약 40줄이다. 직렬 서브에이전트 3개는 순수 오버헤드이므로 fg-run 의
"단일 에이전트로 충분한 규모면 직접 처리한다" 제약을 적용해 이 세션에서 직접 실행했다.
조건부 코드 리뷰(§3)도 건너뛰었다 — 인증·데이터 변경·공개 API·마이그레이션 어디에도 걸리지
않는 웹뷰 UI 배선이다.

## 슬라이스별 결과

- S1 패널 마크업에 `toggle-measure` 추가 · 측정 블록 재배치 · 플레이스홀더를 `No measurements` 로 — ⚠ `#measure-state` 의 HTML 초기 내용(`Measure off`)도 함께 비웠다 (계획 미명시)
- S2 `applyMeasureMode` 공통 경로 신설 · 세 호출부(패널·호스트·복원) 수렴 · 힌트 문구 교체 — ⚠ 테스트 3이 `page.addInitScript` 를 필요로 했다 (계획 미예측)
- S3 README `## Measurement` 첫 문단에 패널 진입점 추가 — ✅ 계획대로

## 완료의 정의 — 기준선 → 실행 후

| # | 검사 | 기준선 | 실행 후 | 판정 |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | PASS | ✅ 회귀 가드 (변화 없음이 정상) |
| 2 | `npm run lint` | PASS | PASS | ✅ 회귀 가드 (변화 없음이 정상) |
| 3 | `npm run check:bundle` | PASS (파일 507 · 외부 15) | PASS (파일 507 · 외부 15) | ✅ 회귀 가드 (변화 없음이 정상) |
| 4 | `grep -c toggleMeasureMode package.json` | 3 | 3 | ✅ 회귀 가드 — 제목 표시줄·명령 팔레트 기여 유지 |
| 5 | `npm run test:integration` | 13 passing | 13 passing | ✅ 회귀 가드 — 설정 기여 미변경 |
| 6 | `grep -c 'toggle-measure' src/webviewHtml.ts` | 0 | 1 | ✅ 전진 |
| 7 | `grep -c 'No measurements' src/webviewHtml.ts` | 0 | 1 | ✅ 전진 |
| 8 | `grep -c 'Turn on measure mode' src/webviewHtml.ts` | 1 | 0 | ✅ 전진 |
| 9 | `grep -c 'function applyMeasureMode' src/webview/main.ts` | 0 | 1 | ✅ 전진 |
| 10 | `grep -c 'Measure off' src/webview/main.ts` | 1 | 0 | ✅ 전진 |
| 11 | `` grep -c 'Measure` checkbox' README.md `` | 0 | 1 | ✅ 전진 |
| 12 | `npx vitest run` | 107 passed | **109 passed** | ✅ 전진 (+2, S1 유닛) |
| 13 | `npx playwright test` | 40 passed | **43 passed** | ✅ 전진 (+3, S2 e2e) |

13/13. 기준선은 계획서가 작성 시점에 기록한 사전 상태와 완전히 일치했다 — 승급 시점에 다시
측정했고 불일치 경고가 없었다.

## 분기 1 — TDD 증거가 처음에는 불충분했다 (이번 실행의 가장 중요한 발견)

계획서는 *"이것을 S2 의 e2e 로 먼저 RED 로 재현한다 — 재현 없이 고쳤다고 말하지 않는다"* 라고
못 박았다. 그런데 **RED 실행에서 테스트 3은 복원 버그 때문에 실패한 것이 아니었다.** reload
이전의 `data-measure = 'on'` 단정에서 이미 실패했다 — 그 시점에는 패널 체크박스에 리스너가
없었으므로 `.check()` 가 아무 일도 하지 않았다. 즉 복원 단정까지 도달조차 하지 못했고, 구현 후
GREEN 이 되었을 때 **"복원 버그를 잡았다"는 근거는 실제로 없었다.**

그래서 뮤테이션 2회로 양쪽 절반을 각각 실증했다:

1. **복원 경로만** 수정 전(`viewer.setMeasureMode(restored.measureMode)`)으로 되돌림 →
   테스트 3이 `toBeChecked()` 에서 실패 (42 passed / 1 failed). 체크박스 절반 실증.
2. 그런데 그 단정이 먼저 걸려서 **호스트 통보 절반은 여전히 미확인**이었다. 그래서
   `applyMeasureMode` 에서 `post` 한 줄만 제거 → 테스트 1(712행)과 테스트 3(761행)이 각각
   `toContainEqual({ type: 'measureModeState', active: true })` 에서 실패
   (40 passed / 2 failed, 테스트 2는 통과 — 메시지를 보지 않으므로 정상). 통보 절반 실증.

**교훈: 한 테스트에 여러 단정이 순서대로 놓이면 앞의 단정이 뒤의 단정을 가린다.** RED 를 봤다는
것이 "내가 잡으려던 그 결함 때문에 RED 였다"를 뜻하지 않는다. 새 기능과 기존 결함 수정을 한
테스트에 묶으면 항상 이 함정이 생긴다.

## 분기 2 — `collectHostMessages` 는 복원 시점 통보를 볼 수 없다

`collectHostMessages` 는 `page.evaluate` 로 싱크를 심으므로 **문서 로드 이후**에 붙는다. 그런데
복원 통보는 모듈 스크립트 실행 중(로드 도중)에 일어나므로 이미 지나가 버린다. 계획서는 이
타이밍 문제를 예측하지 못했고, 테스트 3에서 `page.addInitScript` 로 문서 생성 전에 싱크를 심어
해결했다. 헬퍼를 고치지 않고 테스트 안에 인라인으로 둔 이유: 이 한 테스트만 로드 시점 메시지를
필요로 하고, `helpers.ts` 를 고치면 기존 6개 호출부의 타이밍이 함께 바뀐다.

## 분기 3 — `#measure-state` 의 HTML 초기 내용

계획 S1은 재배치와 플레이스홀더 문구만 명시했지만, 마크업에 하드코딩된 `Measure off` 를 그대로
두면 JS 가 돌기 전 한 프레임 동안 낡은 문구가 보이고 곧 `''` 로 바뀐다. 빈 span 으로 바꿨다.
DoD 로 검사되지 않는 변경이지만 새 역할 분담(체크박스=조작, 힌트=지금 뭘 할까)과 일관된다.

## 분기 4 — `setChecked` 헬퍼 사용

`applyInspector` 는 `.disabled` 를 다루려고 엘리먼트 ref 를 잡지만, `applyMeasureMode` 는
`.checked` 만 필요하므로 이 파일에 이미 있는 `setChecked(id, checked)` 헬퍼를 썼다. 본뜬 구조는
같고 불필요한 지역 변수만 없다.

## 계획대로 착지한 것

- 새 메시지 타입을 만들지 않았다. `measureModeState` 재사용이 `applyInspector` 의 선례와
  정확히 같은 형태로 동작했고 루프도 생기지 않았다.
- `bindCheckbox` 를 피하고 맨 `change` 리스너를 썼다 (함정 3). 뷰어를 열 때 불필요한
  `measureModeState` 가 나가지 않는다.
- 레이아웃 위험이 실재하지 않았다 (함정 4). `space-between` 이 예상대로 `Clear all` 을
  flex-end 에 붙여 두었고 추가 CSS 가 필요 없었다.
- `root.dataset.measure` / `measureCount` 갱신을 그대로 남겨 기존 e2e 9곳이 전부 통과했다.
- 비목표를 침범하지 않았다. 제목 표시줄 기여 3건 유지(DoD 4), 설정 기여 미변경(DoD 5),
  각도·모서리 클릭·폴리라인·전역 설정 저장·`Vertex snap` 비활성화 전부 손대지 않았다.

## 남은 공백 (의도적)

**실제 VS Code 에서 패널 체크박스와 제목 표시줄 아이콘을 번갈아 눌러 `session.measureActive` 가
어긋나지 않는지는 자동 테스트로 단정하지 못했다.** 계획서의 「수동 확인」에 미리 적어 둔
그대로다 — e2e 의 `sendHostMessage` 셰임은 `onDidReceiveMessage` 자리를 대신하지만
`session.measureActive` 를 실제로 들고 있는 것은 확장 호스트이고, 확장 호스트 테스트는 웹뷰
내부를 읽을 수 없다. task 8·11 과 같은 구조적 한계다.

## 관측한 기존 취약점

**e2e 가 동시 부하에서 간헐 실패한다.** typecheck·lint·vitest·e2e 를 한 명령에 몰아 돌렸을 때
2건 실패했고(그중 하나는 `탭 전환 시 상태 보존 › reload 후 측정·카메라·토글·측정 모드가
복원된다` — 이번 작업이 건드리지 않은 기존 테스트), 단독 실행에서는 **2회 연속 43 통과**했다.
task 10 STATUS 가 기록한 *"e2e 는 부하 시 간헐 실패 1회 관측, 변경 전 코드에서도 재현되지 않아
기존 취약점으로 기록"* 과 같은 증상이다. 이 작업이 만든 것이 아니지만 재발을 확인했다.
