<!-- forge-slug: grid-remembered-in-config -->
<!-- task: 11 -->
<!-- tdd: on -->
# 그리드 표시를 VS Code 전역 설정에 기억한다

## 목표 / 비목표

- **목표**: 뷰어 패널의 `Grid` 체크박스 상태가 웹뷰 `setState` 대신 **VS Code 전역 설정**
  `modelLens.grid` 에 저장되고, 열려 있는 모든 뷰어에 즉시 전파된다. 즉 그리드를 끄고 다른
  모델을 열면 그리드가 계속 꺼져 있다.
- **비목표**:
  - **`toggles` 하위 객체 접기.** `TogglesState` 는 이 작업 후 `{ snap }` 하나만 남는다
    (`axes` 는 task 9 에서, `wireframe` 은 task 10 에서 제거). 필드 4개 중 3개가 사라지는 흐름이라
    구조를 다시 볼 값은 있지만, 고장 나지 않은 것을 이 작업에서 건드리지 않는다. 별개 판단이다.
  - **`snap` 을 설정으로 옮기기.** 요청 범위가 아니다. 정점 스냅은 측정 워크플로의 모드이지
    표시 취향이 아니므로 같은 판단이 자동으로 적용되지도 않는다.
  - **저장 상태 버전 올리기.** `VIEWER_STATE_VERSION` 은 1 그대로 (근거: 진실의 출처).
  - **설정을 파일별로 기억하기.** 단위(`unitChanged`)는 파일별이지만 그리드는 배경과 같은
    **사람 단위 표시 취향**이라 전역이다. 파일마다 그리드를 달리 할 이유가 확인된 적 없다.
  - **`modelLens.showGrid` 등 다른 이름.** `background`·`unit`·`decimals` 와 같은 명사형
    일관성을 택했다. 설정 이름은 사용자 대면이라 나중 변경 비용이 코드보다 크다.

## 진실의 출처

- **용어집**: `뷰어 패널` · `뷰어 세션` (최상위 `CONTEXT.md`). **용어 갱신 없음** — 저장 위치가
  바뀌는 것이지 새 개념이 생기지 않는다.
- **관련 ADR**:
  - `adr/260822-195326-viewer-background-three-state-and-pure-white.md` — **이 작업이 그대로
    따르는 선례.** 배경 모드가 전역 설정을 왕복하는 구조(`package.json` 기여 → 패널 변경 →
    `backgroundChanged` → `config.update(..., Global)` → `onDidChangeConfiguration` → 모든 세션에
    `setBackground` → 손편집 쓰레기 값은 폴백이 방어)를 그리드에 복제한다.
  - `.forge/adr/260822-145808-webview-dies-on-tab-switch.md` — 배경 탭 웹뷰는 파괴되므로 전파
    대상은 살아 있는(보이는) 세션뿐이다. 또한 `restoreViewerState` 의 버전 게이트가 전부-아니면-
    전무이므로 `TogglesState.grid` 를 지우되 버전은 올리지 않는다 (task 9·10 과 동일한 판단).
  - `.forge/adr/260822-162443-babylon-fails-silently.md` — **이 작업의 핵심 함정이 이 부류다.**
    아래 "실측으로 확인한 함정" 참조.
- **ADR 신규 없음.** 배경 모드가 이미 이 왕복 구조를 결정·기록했고, 그리드는 그 결정을 한 건 더
  적용하는 것이다. 새로 다툰 트레이드오프가 없다.

### 실측으로 확인한 함정 (계획 단계에서 코드를 읽어 찾음)

**호스트가 보낸 `setGrid` 는 반드시 `viewer.markDirty()` 를 불러야 한다.** 기존 `setBackground`
수신 핸들러는 `markDirty()` 를 부르지 **않는다** — 배경은 CSS 만 바꾸므로 필요가 없다. 하지만
그리드 가시성은 **씬**을 바꾸므로, 유휴 상태에서 호스트 메시지만 받으면 아무도 다시 그리지 않아
**나란히 열린 다른 탭의 화면이 얼어붙은 채 남는다.** 지금 `bindCheckbox('toggle-grid', …)` 가
`markDirty()` 를 부르는 이유가 정확히 그것이다(*"표시가 바뀌면 다시 그려야 한다 — 유휴 상태였다면
화면이 갱신되지 않는다"*). 이것을 S2 의 e2e 로 **먼저** 단정한다.

**초기값의 출처가 바뀐다.** 지금 `webviewHtml.ts` 는 `toggle-grid` 에 `checked` 를 하드코딩한다.
설정이 진실의 출처가 되면 배경처럼 `viewerProvider` → 웹뷰 config → `checked` 속성으로 주입해야
한다. 그러지 않으면 설정은 꺼져 있는데 체크박스는 켜진 채로 시작하고, `bindCheckbox` 의 초기
apply 가 설정을 되살려 버린다.

### 완료의 정의

각 명령은 **작성 시점에 한 번 실행했고**, 아래가 그때의 사전 상태다.

| # | 검사 | 사전 상태 | 성격 |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | 회귀 가드 — 통과가 정상 |
| 2 | `npm run lint` | PASS | 회귀 가드 — 통과가 정상 |
| 3 | `npm run check:bundle` | PASS (파일 508 · 외부 호스트 15) | 회귀 가드 — 통과가 정상 |
| 4 | `grep -c '"modelLens.grid"' package.json` → `1` | **0** (실패) | 전진 — 설정이 기여되어야 한다 |
| 5 | `grep -c gridChanged src/messages.ts` → `1` | **0** (실패) | 전진 — 웹뷰→호스트 계약 |
| 6 | `grep -c setGrid src/messages.ts` → `1` | **0** (실패) | 전진 — 호스트→웹뷰 계약 |
| 7 | `grep -ic grid src/webview/viewerState.ts` → `0` | **3** (실패) | 전진 — 저장 상태에서 사라져야 한다 |
| 8 | `grep -c modelLens.grid README.md` → `1` | **0** (실패) | 전진 — 설정 표에 문서화 |
| 9 | `npm run test:integration` | 12 passing | 전진 — 설정 기여 검사가 **늘어난다** |
| 10 | `npx vitest run` | 104 passed | 전진 — 폴백 방어 유닛이 **늘어난다** |
| 11 | `npx playwright test` | 37 passed | 전진 — 왕복·전파 e2e 가 **늘어난다** |

1~3 만이 회귀 가드다 — 이 작업은 삭제가 아니라 **새 동작 추가**이므로 4~11 이 전부 전진 검사다
(9·10·11 은 숫자가 늘어나야 하므로 사전 통과가 무의미하지 않다).

**부정 검사 인코딩 근거.** 7 번만이 부정 검사다. 범위를 `viewerState.ts` 한 파일로 좁힌 이유는,
`grid` 를 저장소 전체에서 찾으면 **영원히 0 이 될 수 없기** 때문이다 — `toggle-grid` 체크박스,
`buildGrid`, `chrome.setGridVisible`, `modelLens.grid` 자체가 모두 살아남는다. 작성 시점에
`viewerState.ts` 의 `grid` 3줄(46 · 64 · 151)을 직접 확인해 **전부 삭제 대상**임을 대조했고,
그 파일에 살아남을 `grid` 참조가 없음을 확인했다. 4·5·6·8 은 **양성 검사**(→1)라 fail-open
방향이 존재하지 않는다. 교체(`|`)와 `\b` 는 어느 항목에서도 쓰지 않았다.

**#10 과의 순서 의존.** `remove-wireframe-panel-toggle`(#10)과 이 작업은 `main.ts` ·
`webviewHtml.ts` · `viewerState.ts` · `test/unit/viewerState.test.ts` 를 함께 건드린다. 각각
독립된 루프이고 fg-run 이 승격 시 기준선을 다시 재므로 안전하지만, 둘 다 인지해야 하는 것이 하나
있다: **#10 이 렌더 게이트 e2e(`표시 토글도 다시 그리게 만든다`)를 `#toggle-grid` 로 옮긴다.**
이 작업이 그 그리드를 재배선하므로, 나중에 실행되는 쪽이 그 테스트를 계속 통과시켜야 한다.
로컬 즉시 적용 순서(아래 S2)를 지키면 타이밍이 변하지 않아 통과한다. 위 9·10·11 기준선은 #10 이
테스트 수를 바꾸지 않도록 설계됐으므로 **실행 순서와 무관하게 유효하다.**

## 작업 슬라이스

슬라이스 경계를 **파일**로 그었다 — task 8 회고가 "같은 파일을 건드리는 슬라이스는 결국 합쳐지고
TDD 순서가 무너진다"를 지적했으므로, 두 슬라이스가 겹치는 파일이 하나도 없게 나눴다.
게다가 소프트 의존이 아니라 **하드 의존**이다: VS Code 는 기여되지 않은 키에 `config.update` 를
호출하면 거부하므로 S1 없이 S2 는 동작할 수 없다.

- [ ] **S1. `modelLens.grid` 설정을 기여한다.** (파일: `package.json` · `README.md` ·
  `test/integration/editor.test.ts`)
  `package.json` 에 `modelLens.grid` (`type: boolean`, 기본 `true`, `description`) 를 추가하고
  README 설정 표에 한 줄 넣는다. 기본 `true` 는 현재 `DEFAULT_TOGGLES.grid` 와 HTML 의 하드코딩된
  `checked` 와 일치하므로 기존 사용자의 체감 동작이 바뀌지 않는다.
  — **TDD**: 먼저 `test/integration/editor.test.ts` 에 "`modelLens.grid` 가 boolean 으로 기여되고
  기본값이 true 다"를 추가해 **RED 를 확인한 뒤** `package.json` 을 고친다
  (`modelLens.background` 검사 바로 옆, 같은 패턴).
  — 완료 기준: DoD 4·8 이 `1` 이 되고, DoD 9 가 **13 passing** 이 된다.

- [ ] **S2. 왕복을 배선하고 저장 상태에서 그리드를 뺀다.** (depends: S1 — 하드 의존)
  (파일: `src/messages.ts` · `src/viewerProvider.ts` · `src/webviewHtml.ts` ·
  `src/webview/main.ts` · `src/webview/viewerState.ts` · `test/unit/viewerState.test.ts` ·
  `test/e2e/render.spec.ts`)
  배경 모드의 구조를 그대로 복제한다:
  - `messages.ts` — `WebviewToHost` 에 `{ type: 'gridChanged'; grid: boolean }`,
    `HostToWebview` 에 `{ type: 'setGrid'; grid: boolean }` 추가.
  - `viewerProvider.ts` — `case 'gridChanged'` 에서 `config.update('grid', v, Global)`;
    `onDidChangeConfiguration` 에서 `affectsConfiguration('modelLens.grid')` 면 모든 세션에
    `setGrid` 전송; 초기 웹뷰 config 에 `grid: readGrid(config)` 포함. `readGrid` 는
    **boolean 이 아닌 값(손편집된 `"yes"` 등)을 `true` 로 떨어뜨린다** — `readBackgroundMode` 와
    같은 방어.
  - `webviewHtml.ts` — `toggle-grid` 의 하드코딩된 `checked` 를 config 값에서 주입.
  - `main.ts` — `bindCheckbox('toggle-grid', …)` 가 기존의 `setGridVisible` + `markDirty` 를
    **유지한 채** `post({ type: 'gridChanged', grid: on })` 를 추가한다(배경과 같은
    **로컬 즉시 적용 후 통보** 순서 — 이 순서가 렌더 게이트 e2e 의 타이밍을 지킨다).
    `setGrid` 수신 시 그리드를 적용하고 **체크박스 값을 맞추고 `viewer.markDirty()` 를 부른다.**
    `restored.toggles.grid` 를 읽던 `setChecked('toggle-grid', …)` 는 제거한다.
  - `viewerState.ts` — `TogglesState.grid` · `DEFAULT_TOGGLES` 의 `grid` · `readToggles` 의
    `grid:` 줄 제거. **`VIEWER_STATE_VERSION` 은 1 그대로.**
  - `viewerState.test.ts` — `grid` 참조 제거. 쓰레기 입력 방어 테스트는 유지한다.
  — **TDD**: 세 개를 먼저 쓰고 RED 를 확인한 뒤 배선한다 —
  (1) 유닛: `readGrid` 가 `"yes"`·`null`·`undefined` 를 `true` 로 떨어뜨린다,
  (2) e2e: 체크박스를 끄면 `gridChanged` 가 호스트로 나간다,
  (3) e2e: **유휴 상태에서** 호스트가 `setGrid` 를 보내면 그리드가 바뀌고 체크박스가 따라오며
  `renderCount` 가 **증가한다** ← 위 "실측으로 확인한 함정"을 잡는 단정. 이 셋은 구현 전에
  반드시 실패해야 한다.
  — 완료 기준: DoD 5·6 이 `1`, 7 이 `0` 이 되고, DoD 10·11 의 수가 **늘어난 채** 전부 통과하며,
  1~3 과 렌더 게이트 e2e 가 계속 통과한다. 그리드를 끄고 다른 모델을 열면 그리드가 꺼져 있다.
