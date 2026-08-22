# 실행 기록 — 그리드 표시를 VS Code 전역 설정에 기억한다

- 작업: `grid-remembered-in-config` (task 11, **TDD on**)
- 실행 방식: **직접 실행** (Dynamic Workflow 아님). 슬라이스 2개가 하드 의존(S1 없이 S2 불가)이라
  병렬 팬아웃 이점이 없고, TDD 사이클이 대화형으로 얽혀 단일 실행자가 유리하다.

## 슬라이스별 결과

- S1 `modelLens.grid` 설정 기여 (`package.json` · README 표 · 통합 테스트) — ✅ 계획대로
- S2 왕복 배선 + 저장 상태에서 그리드 제거 — ⚠ 계획이 지시한 배선이 버그를 만들 수 있었고, 계획이
  놓친 e2e 하나가 실패했다 (발산 1·2)

## DoD — baseline → after

| # | 검사 | baseline | after |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | PASS (중간에 4건 발생 → 수정, 발산 3) |
| 2 | `npm run lint` | PASS | PASS |
| 3 | `npm run check:bundle` | PASS (파일 508) | PASS (파일 **507** — task 10 의 발산 5 와 같은 이유, 이 변경의 효과가 아니다) |
| 4 | `grep -c '"modelLens.grid"' package.json` | 0 | **1** |
| 5 | `grep -c gridChanged src/messages.ts` | 0 | **1** |
| 6 | `grep -c setGrid src/messages.ts` | 0 | **1** |
| 7 | `grep -ic grid src/webview/viewerState.ts` | 3 | **0** |
| 8 | `grep -c modelLens.grid README.md` | 0 | **1** |
| 9 | `npm run test:integration` | 12 passing | **13 passing** |
| 10 | `npx vitest run` | 104 passed | **107 passed** |
| 11 | `npx playwright test` | 37 passed | **40 passed** |

## TDD 순서를 지켰다 — 4개 테스트 전부 먼저 RED 를 확인했다

task 8 은 같은 모양(설정 기여 + 왕복 + 전파)에서 순서를 어겼다. 이번엔 슬라이스 경계를 **파일**로
그어 그 원인을 계획 단계에서 제거했고, 실제로 순서가 유지됐다. 확인한 RED 는 다음 네 개다:

1. 통합 — `modelLens.grid 기여가 없습니다` (AssertionError)
2. 유닛 — `Cannot find module '../../src/grid'`
3. e2e `?grid=false` — `Expected: not checked / Received: checked` (하드코딩된 `checked`)
4. e2e 체크박스 → 호스트 — `Expected {"grid": false, "type": "gridChanged"} / Received array: []`
   그리고 e2e 호스트 → 체크박스 — `Expected: not checked / Received: checked` (수신 미배선)

즉 빈 통과(구현이 먼저여서 곧바로 초록이 되는 것)가 한 건도 없었다.

## 계획 대비 발산

**1. 계획이 지시한 배선이 버그를 만들 수 있었다 — `bindCheckbox` 의 초기 apply.**
계획은 *"`bindCheckbox('toggle-grid', …)` 가 기존의 `setGridVisible` + `markDirty` 를 유지한 채
`post({ type: 'gridChanged', … })` 를 추가한다"* 라고 적었다. 그런데 `bindCheckbox` 는
**배선 시점에 `apply(input.checked)` 를 즉시 호출한다.** 그대로 따랐다면 **뷰어를 열 때마다
`gridChanged` 가 호스트로 나가 전역 설정 파일을 다시 썼을 것이다.** 배선 전에 `bindCheckbox`
구현을 읽어서 잡았다. 해결: 씬 동기화는 `bindCheckbox` 에 그대로 두고, 호스트 통보는 **별도
`change` 리스너**로 분리했다(사용자 조작에만 반응). 배경 드롭다운이 `change` 리스너를 쓰는 것과
같은 형태다.

이것이 아이러니한 지점이다 — 계획은 **같은 부류의 함정 하나(`setGrid` 수신 시 `markDirty` 누락)를
실측으로 미리 찾아 e2e 로 못박았는데**, 계획이 직접 처방한 배선 안에 두 번째 함정이 있었다.
"찾은 함정은 계획에 적히지만, 처방 자체는 다시 검토되지 않는다."

**2. 계획이 `reload 후 측정·카메라·토글·측정 모드가 복원된다` e2e 를 놓쳤다.**
계획은 S2 의 파일 목록에 `test/e2e/render.spec.ts` 를 넣었지만 영향받는 테스트로는 렌더 게이트
하나만 지목했다. 실제로는 이 복원 테스트가 `#toggle-grid` 를 끄고 reload 후 꺼져 있음을
단정하는데, 그리드를 `setState` 에서 빼고 전역 설정 소유로 옮기면 **설계상 그 단정이 뒤집힌다**
(UAT 하네스에 영속 설정이 없으므로 reload 하면 config 값 `true` 로 돌아온다). 첫 전체 e2e 에서
이 테스트만 실패했다. 줄을 지우는 대신 **새 의미를 명시적으로 단정**하도록 바꿨다 —
`toBeChecked()` + "그리드는 세션 상태가 아니라 전역 설정이 소유한다" 주석. 정점 스냅은 여전히
세션 상태이므로 그 단정은 그대로 뒀다.

**3. 계획의 파일 목록에 `test/unit/webviewHtml.test.ts` 가 없었다.**
`WebviewHtmlParams` 에 `grid: boolean` 을 필수로 추가하니 그 테스트의 기본 파라미터 객체에서
tsc 가 4건 터졌다. 기본 객체에 `grid: true` 한 줄 추가로 해결. 사소하지만 "타입에 필수 필드를
추가하면 모든 생성 지점이 깨진다"를 계획이 세지 않은 결과다.

**4. 순수 리더의 위치와 이름이 계획과 다르다.** 계획은 `viewerProvider.ts` 의 `readGrid` 를
가리켰는데, 그 파일은 `vscode` 를 import 하므로 vitest 로 유닛 테스트할 수 없다 — 계획이 요구한
유닛 테스트와 충돌한다. `background.ts` 선례를 따라 **`src/grid.ts` 의 `readGridSetting`** 으로
두고 `viewerProvider` 가 그것을 쓴다. 유닛 테스트가 `Boolean()` 강제 변환의 함정을 못박는다
(`Boolean('false') === true`, `Boolean(0) === false` — 둘 다 사용자 의도와 무관한 값이 된다).

**침범한 비목표는 없다.** `toggles` 하위 객체는 접지 않았고(`TogglesState` 는 이제 `{ snap }` 하나),
`snap` 은 설정으로 옮기지 않았으며, `VIEWER_STATE_VERSION` 은 1 이고, 설정 이름은
`modelLens.grid` 다.

## 계획대로 착지한 것

- **계획이 실측으로 미리 찾은 `markDirty` 함정이 실제로 함정이었다.** `setGrid` 수신 핸들러에
  `markDirty()` 를 넣지 않으면 유휴 상태의 다른 탭이 얼어붙는다. e2e 3번이 `renderCount` 증가를
  단정해 이것을 회귀 장치로 만들었고, 구현 전 RED 로 확인됐다.
- **초기값의 출처 이전이 계획대로 동작했다.** `webviewHtml.ts` 의 하드코딩된 `checked` 를
  `params.grid` 주입으로 바꾸고 `viewerProvider` 가 `readGridSetting(config)` 을 넘긴다.
  `?grid=false` e2e 가 이것을 단정한다.
- **파일 경계 슬라이싱이 목적을 달성했다.** S1(`package.json`·README·통합)과 S2(`src/*`·유닛·e2e)가
  겹치는 파일이 없어, task 8 처럼 "한 번에 고치는 게 싸다"는 유혹이 발생하지 않았다.

## 남은 공백 (의도적)

**그리드 메시가 실제로 사라졌는지는 단정하지 않았다.** 테스트 심(`__modelLens`)은 주석으로
*"렌더를 유발하는 API 는 노출하지 않는다"* 고 못박고 있고, `gridVisible()` 관측점을 추가하는 것은
테스트를 위해 제품 표면을 늘리는 일이다. 대신 관측 가능한 두 가지로 덮었다 — 체크박스 동기화와
`renderCount` 증가(= `setGridVisible` + `markDirty` 가 실제로 호출됐다는 증거).

**실제 VS Code 에서 `config.update('grid')` 가 전역 설정에 쓰이고 다른 탭으로 전파되는 왕복은
자동 테스트로 단정하지 못했다.** 확장 호스트 테스트가 웹뷰 내부를 읽을 수 없다는 기존 한계
그대로다 — task 8 과 **세 번째로 반복되는** 벽이다. 3겹으로 나눠 덮었다: 설정 기여(통합 13) ·
웹뷰가 보내는 `gridChanged`(e2e) · 호스트가 보낸 `setGrid` 의 수신과 재렌더(e2e).
가운데 고리인 `config.update` → `onDidChangeConfiguration` 은 VS Code 자체 동작이다.
