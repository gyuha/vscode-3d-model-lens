<!-- forge-slug: remove-axes-gizmo -->
<!-- task: 9 -->
<!-- tdd: off -->
<!-- retro-hint: optional -->
# 축 기즈모와 Axes 토글 제거

## 목표 / 비목표

- **목표**: Babylon `AxesViewer` 로 그려지던 XYZ 축 기즈모와 뷰어 패널의 `Axes` 체크박스를
  코드에서 완전히 제거한다. 기즈모는 지금 **기본 켜짐**이므로, 이 작업 후 모든 모델의 첫 화면에서
  XYZ 화살표가 사라진다 — 의도된 사용자 가시 변경이다.
- **비목표**:
  - **치수 표시의 X/Y/Z 라벨.** `webviewHtml.ts` 의 `<span class="axis">` 와 `#dimensions .axis`
    CSS 는 용어집의 **치수(Dimensions)** 에 속하는 별개 개념이고 토글이 없다. 손대지 않는다.
    (`axis` 단수 8곳은 전부 살아남는다 — DoD 4 의 패턴이 이들을 잡지 않는 것이 검사의 전제다.)
  - **저장 상태 버전 올리기.** `VIEWER_STATE_VERSION` 은 1 그대로 둔다. 근거는 아래 "진실의 출처".
  - **`extentDiagonal` 함수 제거.** `chrome.ts` 에서는 안 쓰게 되지만 `measurement.ts`·`viewer.ts`
    가 계속 쓴다. `chrome.ts` 의 import 목록에서만 빠진다.
  - **`Chrome` 클래스 이름 변경.** 남는 것은 그리드와 와이어프레임뿐이지만, 이름을 바꾸면 무관한
    호출부가 함께 흔들린다. 클래스 doc 주석("보조 표시 — 그리드와 축")만 사실에 맞게 고친다.
  - **README · `package.json` 수정.** axes 토글을 개별 문서화한 곳이 없고(README 48행의
    "display toggles" 는 뭉뚱그린 언급) 설정 기여도 없다. 확인했으므로 건드릴 것이 없다.
  - **그리드 픽 방어 재점검.** `makeUnpickable` 은 축 전용 우회였고, 그리드는 `buildGrid` 안에서
    `grid.isPickable = false` 로 직접 방어한다. 축을 지워도 구멍이 생기지 않는다.

## 진실의 출처

- **용어집**: `뷰어 패널` · `치수` · `측정` · `정점 스냅` (최상위 `CONTEXT.md`). 이 작업은 용어를
  새로 만들거나 바꾸지 않는다 — `뷰어 패널` 정의의 "표시 토글" 은 Grid·Wireframe·Vertex snap 이
  남으므로 여전히 유효하다. **CONTEXT.md 갱신 없음.**
- **관련 ADR**:
  - `.forge/adr/260822-145808-webview-dies-on-tab-switch.md` — 웹뷰 상태를 `setState` 로 보존하는
    구조. **이 작업의 유일한 되돌리기 어려운 결정이 여기에 걸린다**: `restoreViewerState` 는
    `raw.version !== VIEWER_STATE_VERSION` 이면 저장 상태 **전체**(카메라·측정 목록·선택 인덱스·
    애니메이션)를 버린다. 따라서 `TogglesState.axes` 를 지우되 버전은 **올리지 않는다** —
    기존 저장 데이터의 `axes` 키는 `readToggles` 가 아는 키만 읽으므로 조용히 무시되고, 깨질
    경로가 없다. 버전을 올리면 장식용 기즈모 하나의 대가로 사용자의 측정값을 잃는다.
  - `.forge/adr/260822-162443-babylon-fails-silently.md` — Babylon 은 조용히 무력화된다. 축 관련
    코드를 지울 때 **지우면 안 되는 코드 네 곳**을 건드리지 않았는지 이 ADR 로 대조한다.
- **ADR 신규 없음.** "버전을 올리지 않는다" 는 되돌리기 어려움·의아함은 있으나 트레이드오프가
  약하고(잃을 것이 없는 쪽이 명백하다) 그 근거를 위 항목과 코드 주석으로 남기면 충분하다.

### 완료의 정의

각 명령은 **작성 시점에 한 번 실행했고**, 아래가 그때의 사전 상태다.

| # | 검사 | 사전 상태 | 성격 |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | 회귀 가드 — 통과가 정상 |
| 2 | `npm run lint` | PASS | 회귀 가드 — 통과가 정상 |
| 3 | `npm run check:bundle` | PASS (파일 508개 · 외부 호스트 15개 모두 허용 목록) | 회귀 가드 — 통과가 정상 |
| 4 | `grep -rni axes src/ test/` 의 결과 줄 수 → `0` | **22** (실패) | 전진 — 기즈모 참조가 전부 사라져야 한다 |
| 5 | `npx vitest run` | 104 passed | 회귀 가드 — **줄지 않아야** 한다 (삭제 작업이므로 전진이 아니다) |
| 6 | `npx playwright test` | 37 passed | 회귀 가드 — 특히 측정·정점 스냅 테스트가 픽 회귀를 지킨다 |
| 7 | `npm run test:integration` | 12 passing | 회귀 가드 — 설정 기여를 건드리지 않았음의 증거 |

1~3·5~7 이 사전에 통과하는 것은 정상이다 — 이 작업은 **순수 삭제**이므로 새로 생기는 동작이 없고,
DoD 의 대부분이 "깨뜨리지 않았다"를 보는 회귀 가드다. 4 만이 유일한 전진 검사다.

**4 의 인코딩 근거 (직전 작업의 부정 검사 함정 대응).** 실행할 명령은 정확히 이것이다 —
교체(`|`)도 `\b` 도 쓰지 않는다:

```
grep -rni axes src/ test/ | wc -l
```

처음에는 `grep -rniE 'axesviewer|\baxes\b' …` 로 적었다가 계획 단계에서 두 결함을 잡았다.
(1) 마크다운 표 안에서 파이프를 `\|` 로 이스케이프해야 하는데 `grep -E` 에서 `\|` 는 교체가 아니라
**리터럴 파이프**라, 표의 문자열을 그대로 복사하면 엉뚱한 것을 찾는다. (2) `\b` 는 GNU 확장이라
BSD grep 에서 보장되지 않는다. 그래서 **단순 부분문자열 + 대소문자 무시** 로 바꿨다.

바꾼 패턴이 오히려 더 정확하다는 것도 실측으로 확인했다 — 옛 `\baxes\b` 는 `setAxesVisible`
(`chrome.ts:31` · `main.ts:136`)을 단어 경계 때문에 **놓치고 있었다**. 새 패턴은 22건을 잡고,
그 22건을 한 줄씩 대조해 **전부 삭제 대상**임을 확인했다
(webviewHtml 1 · chrome 10 · main 4 · viewerState 3 · viewerState.test 4).
살아남는 `axis` 단수 8곳(치수 라벨 4 · `main.ts` 루프 변수 4)은 `axes` 를 부분문자열로 포함하지
않으므로 이 패턴에 걸리지 않는다. 순수 삭제라 새 식별자가 생기지 않으므로 `backgroundColorFor`
때처럼 "영원히 0 이 될 수 없는" 경로도 없다. `test/` 를 범위에 포함한 것은 테스트 갱신 누락을
같은 검사로 잡기 위해서다.

## 작업 슬라이스

- [ ] **S1. 축 기즈모와 Axes 토글을 한 번에 제거한다.**
  **이 작업은 슬라이스를 쪼개지 않는다** — 타입 시스템이 원자성을 강제하기 때문이다.
  `TogglesState.axes` 를 지우면 `main.ts:215` 의 `axes: isChecked('toggle-axes')` 와
  `viewerState.test.ts` 의 객체 리터럴이 즉시 타입 에러가 나고, `chrome.setAxesVisible` 을 지우면
  `main.ts:136` 이 깨진다. 중간 상태가 컴파일되지 않으므로 억지로 나누면 버려질 임시 코드가
  필요하다. (직전 작업의 회고가 지적한 "같은 파일을 건드리는 슬라이스는 결국 합쳐진다"를
  계획 단계에서 미리 받아들인 것이다.)

  건드릴 곳:
  - `src/webview/chrome.ts` — `AxesViewer` import, `axes` 필드, 생성자의 `new AxesViewer(...)` 와
    `makeUnpickable(this.axes)`, `setAxesVisible`, `makeUnpickable` 함수를 제거. `geometry.js`
    import 에서 `extentDiagonal` 을 뺀다(함수 자체는 남는다). 클래스 doc 주석을 그리드만
    가리키게 고친다.
  - `src/webviewHtml.ts` — 244행 `Axes` 체크박스 `<label>` 한 줄 제거.
  - `src/webview/main.ts` — 52행 `setChecked('toggle-axes', ...)`, 135~138행
    `bindCheckbox('toggle-axes', ...)` 블록, 215행 `axes: isChecked('toggle-axes')` 제거.
  - `src/webview/viewerState.ts` — `TogglesState.axes` 필드, `DEFAULT_TOGGLES` 의 `axes: true`,
    `readToggles` 의 `axes:` 줄 제거. **`VIEWER_STATE_VERSION` 은 1 그대로.**
  - `test/unit/viewerState.test.ts` — 4곳(17 · 155 · 159 · 167행)에서 `axes` 제거.
    155~159행의 **쓰레기 입력 방어 테스트는 유지**한다 — `axes: 1` 항목만 빠지고,
    나머지 쓰레기 키(`grid: 'off'`, `wireframe: null`)와 기본값 폴백 단정은 그대로 둔다.

  — 완료 기준: DoD 4 가 `0` 이 되고, 5·6·7 의 테스트 수가 **줄지 않은 채** 전부 통과하며,
  1~3 이 계속 통과한다. 뷰어를 열면 XYZ 화살표가 보이지 않고 패널에 `Axes` 행이 없다.
