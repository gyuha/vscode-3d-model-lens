<!-- forge-slug: measure-toggle-in-panel -->
<!-- task: 12 -->
<!-- tdd: on -->
<!-- priority: high -->
# 측정 모드를 뷰어 패널에서 켠다 — 컨트롤 없는 상태 표시를 없앤다

## 목표 / 비목표

- **목표**: 뷰어 패널에서 측정 모드를 켜고 끌 수 있다. 제목 표시줄 아이콘은 **그대로 남고**,
  두 진입점은 `applyInspector` 와 동일한 **하나의 공통 경로**로 수렴해 어긋나지 않는다.
  덧붙여, 측정 모드가 켜진 채 탭을 떠났다 돌아왔을 때 호스트가 그 사실을 모르는 기존 결함을
  같은 경로로 고친다.
- **비목표**:
  - **거리 측정 기능 자체를 만드는 것.** 이미 있다 — `.forge/done/…-babylon-model-viewer-4of4`
    (「점-점 거리 측정」, 2026-08-22 봉인). 정점 스냅·화면 표시·항목별 삭제·`Clear all` 전부
    구현되어 있다. 이 작업은 **켜는 법이 패널에 없다**는 것 하나만 고친다.
  - **모서리 한 번 클릭으로 길이 측정 / 연속 폴리라인.** 그릴링에서 요청의 실체가 발견성
    문제(a)로 확정됐다. 이 두 기능은 별개 작업이며, 원하면 새 계획으로 세운다.
  - **각도 측정.** ADR `260822-115455c` 가 "거리 측정의 인프라를 재사용하므로 나중에 붙이는
    비용이 싸다. 이번 범위에서는 제외"로 이미 미뤄 둔 항목이다. 그 판단을 유지한다.
  - **제목 표시줄 아이콘·명령 삭제.** 그릴링 질문 2에서 **유지**를 택했다. 근거: 측정은
    "켜고 → 재고 → 끄고"를 반복하는 모달 작업이고, `modelLens.toggleMeasureMode` 명령을 지우면
    사용자가 단축키를 바인딩할 수단 자체가 사라진다. 상쇄 이득이 없다.
  - **`measureModeChanged` 같은 새 메시지 타입.** `measureModeState` 가 이미 같은 일을 하고
    호스트 동작이 동일하다. 아래 "진실의 출처" 참조.
  - **측정 모드를 전역 설정에 저장하기.** 배경·그리드와 다르다 — 측정 모드는 표시 취향이 아니라
    **작업 중 상태**다. 파일을 열 때마다 측정 모드로 시작하고 싶은 사람은 없다. 세션 상태로 둔다.
  - **`Vertex snap` 체크박스를 측정 모드가 꺼졌을 때 비활성화하기.** 지금도 효과 없는 컨트롤이
    노출되어 있고 이 작업이 만드는 문제가 아니다. 별개 판단.
  - **제목 표시줄 아이콘에 켜짐 상태 표시.** VS Code 는 when-clause + 명령 2개가 필요해
    비용이 이 작업의 값을 넘는다.
  - **`#measure-state` 삭제 (안 3).** 질문 4에서 기각했다 — 측정이 켜진 채 목록이 비어 있지
    **않은** 상태에서 힌트가 전부 사라지고, 그건 이 작업이 고치려는 문제를 다른 자리에서
    되풀이하는 것이다.

## 진실의 출처

- **용어집**: `측정 모드` (이 브랜치 `CONTEXT.md` 에 **이번 그릴링에서 신규 추가**) ·
  `측정` · `뷰어 패널` · `뷰어 세션` · `Inspector` (최상위 `CONTEXT.md`).
  용어집은 `측정 모드`(상태)와 `측정`(개체)을 명시적으로 분리하며, 진입점이 둘이고 하나의
  공통 경로로 수렴한다는 것을 정의에 포함한다.
- **관련 ADR**:
  - `.forge/adr/260822-115455c-honest-measurement-reporting.md` — 각도·부피·표면적을 범위 밖으로
    둔 근거. 이 작업의 비목표가 그 결정을 그대로 승계한다.
  - `.forge/adr/260822-145808-webview-dies-on-tab-switch.md` — 배경 탭 웹뷰는 파괴되고 상태는
    `setState`/`getState` 로 복원된다. **아래 함정 2가 이 구조에서 나온다.**
  - `adr/260822-233935-wireframe-delegated-to-inspector.md` — 되돌리기 절차가 "체크박스 +
    배선 + **지속성**" 셋을 요구한다고 못 박는다. 측정 모드의 지속성(`measureMode`)은
    `RestorableViewerState` 에 **이미 있으므로** 이 작업은 앞의 둘만 필요하다.
- **ADR 신규 없음.** Inspector 가 이미 "패널 체크박스 + 제목 표시줄 아이콘 + 공통 경로" 구조를
  구현·테스트하고 있다(`main.ts:417-448`, `render.spec.ts:557-585`). 이 작업은 그 선례를 한 건 더
  적용하는 것이고, 새로 다툰 트레이드오프가 없다.

### 실측으로 확인한 것 (계획 단계에서 코드를 읽어 찾음)

**1. `applyInspector` 가 그대로 쓸 수 있는 템플릿이다.** `main.ts:417-423` 의 주석이 이 작업의
불변식을 이미 서술한다 — *"제목 표시줄 아이콘과 패널 체크박스의 **공통 경로**. 둘로 나뉘면
한쪽으로 켠 상태를 다른 쪽이 모른다. 특히 호스트는 `inspectorState` 로만 현재 상태를 아는데,
그게 어긋나면 다음 아이콘 클릭의 토글 방향이 뒤집힌다."* `applyMeasureMode` 는 이것을
`measureModeState` / `session.measureActive` 로 옮긴 것이다.
**따라서 새 메시지 타입은 만들지 않는다** — Inspector 도 `inspectorState`(ack) 하나만 쓴다.
`gridChanged`·`backgroundChanged`·`unitChanged` 가 별도 타입인 이유는 호스트가 `config.update` 라는
**다른 일**을 하기 때문이고, 여기서는 호스트 동작이 `session.measureActive = active` 로 동일하다.

**2. 복원 경로가 호스트에 알리지 않는다 — 기존 결함이다.** `main.ts:112` 는
`viewer.setMeasureMode(restored.measureMode)` 를 부르지만 `post({ type: 'measureModeState' })` 를
하지 않는다. `session.measureActive` 는 `viewerProvider.ts:76` 에서 `false` 로 시작한다. 그러니
측정 모드를 켠 채 탭을 떠났다 돌아오면(세션이 재생성되는 경우) 웹뷰는 ON · 호스트는 `false` 로
어긋나고, 다음 제목 표시줄 클릭이 `!false = true` 를 보내 **이미 켜진 것을 다시 켜므로 아이콘이
한 번 먹히지 않는다.** 정확히 함정 1의 주석이 경고하는 증상이다. 복원도 `applyMeasureMode` 로
보내면 함께 고쳐진다. **이것을 S2 의 e2e 로 먼저 RED 로 재현한다** — 재현 없이 고쳤다고 말하지
않는다.

**3. `bindCheckbox` 를 쓰면 안 된다.** `main.ts:450-454` 의 `bindCheckbox` 는 초기
`apply(input.checked)` 를 실행한다. 여기에 호스트 통보가 섞이면 뷰어를 열 때마다 상태 메시지가
나간다. 직전 작업(task 11)에서 `toggle-grid` 가 정확히 이 이유로 맨 `change` 리스너로 옮겼고
(`main.ts:132-135` 주석), Inspector 도 같은 이유로 `bindCheckbox` 를 쓰지 않는다
(`main.ts:138-141` 주석). 측정 토글도 맨 `change` 리스너다.

**4. 레이아웃 위험은 없다 (확인함).** `#measure-actions` 는 `display:flex;
justify-content:space-between` 이고 자식이 2개다(`.state` span, `Clear all` 버튼).
`.state` 가 빈 문자열이 되어 폭 0이 되더라도 `space-between` 은 마지막 자식을 flex-end 에
붙이므로 **`Clear all` 은 움직이지 않는다.** 힌트를 비우는 데 추가 CSS 가 필요 없다.

**5. 문구는 어떤 테스트도 단정하지 않는다 (확인함).** e2e 는 `data-measure` ·
`data-measure-count` 속성만 본다(`render.spec.ts:115 · 169 · 414` 등). `'Measure off'` ·
`'Turn on measure mode and pick two points'` 두 문자열은 테스트에 걸려 있지 않으므로 교체 비용이
0이다. **`data-measure` / `data-measure-count` 는 계속 갱신되어야 한다** — 기존 e2e 9곳이 이걸
본다.

### 완료의 정의

각 명령은 **작성 시점에 한 번 실행했고**, 아래가 그때의 사전 상태다.

| # | 검사 | 사전 상태 | 성격 |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | 회귀 가드 — 통과가 정상 |
| 2 | `npm run lint` | PASS | 회귀 가드 — 통과가 정상 |
| 3 | `npm run check:bundle` | PASS (파일 507 · 외부 호스트 15) | 회귀 가드 — 통과가 정상 |
| 4 | `grep -c toggleMeasureMode package.json` → `3` | **3** (통과) | **회귀 가드** — 제목 표시줄·명령 팔레트 기여가 살아 있어야 한다 (비목표) |
| 5 | `npm run test:integration` | 13 passing | **회귀 가드** — 설정 기여를 건드리지 않으므로 13 그대로 |
| 6 | `grep -c 'toggle-measure' src/webviewHtml.ts` → `1` | **0** (실패) | 전진 — 체크박스가 마크업에 있어야 한다 |
| 7 | `grep -c 'No measurements' src/webviewHtml.ts` → `1` | **0** (실패) | 전진 — 플레이스홀더가 빈 상태 사실만 말한다 |
| 8 | `grep -c 'Turn on measure mode' src/webviewHtml.ts` → `0` | **1** (실패) | 전진 — 켠 사람에게 켜라는 모순 문구 제거 |
| 9 | `grep -c 'function applyMeasureMode' src/webview/main.ts` → `1` | **0** (실패) | 전진 — 두 진입점의 공통 경로가 존재한다 |
| 10 | `grep -c 'Measure off' src/webview/main.ts` → `0` | **1** (실패) | 전진 — 상태 텍스트가 힌트 전용으로 바뀐다 |
| 11 | `` grep -c 'Measure` checkbox' README.md `` → `1` | **0** (실패) | 전진 — 패널 진입점이 문서화된다 |
| 12 | `npx vitest run` | 107 passed | 전진 — `webviewHtml` 유닛이 **늘어난다** |
| 13 | `npx playwright test` | 40 passed | 전진 — 두 진입점·복원 e2e 가 **늘어난다** |

**부정 검사 인코딩 근거.** 부정 검사는 8·10 둘이다.
- **8** (`'Turn on measure mode'` → 0, `webviewHtml.ts` 한 파일): 작성 시점에 이 문자열은
  `webviewHtml.ts:165` 의 `#measure-list:empty::after` **한 곳뿐**임을 확인했고, 그 한 줄이
  교체 대상 전부다. fail-open(플레이스홀더를 통째로 지워서 0이 되는 것)은 **7번 양성 검사**가
  막는다 — 둘은 짝이다.
- **10** (`'Measure off'` → 0, `main.ts` 한 파일): 작성 시점에 `main.ts:288`
  한 곳뿐임을 확인했다. fail-open(상태 텍스트 갱신을 통째로 지우는 것)은 **13번 e2e** 가
  막는다 — 기존 e2e 9곳이 `data-measure` 를 보고 그 값은 같은 `onChange` 콜백이 쓴다.
- 4·6·7·9·11 은 **양성 검사**(→ 고정값)라 fail-open 방향이 없다.
- 교체(`|`)와 `\b` 는 어느 항목에서도 쓰지 않았다.

**이미 통과하는 항목의 근거.** 1·2·3 은 통상적인 회귀 가드다. **4·5 는 전진 검사가 아니라
의도적 회귀 가드다** — 4는 "제목 표시줄 아이콘을 남긴다"는 비목표를 검사로 고정한 것이고
(질문 2의 (A) 결정이 나중에 조용히 뒤집히는 것을 막는다), 5는 이 작업이 `package.json` 의
`configuration` 을 건드리지 않는다는 것을 고정한다. 둘 다 사전 통과가 정상이며 전진 검사로
오인해선 안 된다.

## 작업 슬라이스

슬라이스 경계를 **파일**로 그었다 — task 8 회고가 "같은 파일을 건드리는 슬라이스는 결국 합쳐지고
TDD 순서가 무너진다"를 지적했으므로, 세 슬라이스가 겹치는 파일이 하나도 없다.
S1→S2 는 **하드 의존**이다: `requireElement` 는 없는 id 에 예외를 던지므로 마크업 없이 배선은
동작할 수 없다.

- [ ] **S1. 패널 마크업에 측정 체크박스를 넣고 측정 블록을 재배치한다.**
  (파일: `src/webviewHtml.ts` · `test/unit/webviewHtml.test.ts`)

  측정 블록을 아래 순서로 바꾼다 (질문 3의 (A) — 위→아래가 원인→결과):
  ```
  <hr />
  <label><input type="checkbox" id="toggle-measure" /> Measure</label>   ← 신규
  <label><input type="checkbox" id="toggle-snap" checked /> Vertex snap</label>
  <div id="measure-actions">  [#measure-state ......... Clear all]        ← 아래로 이동
  <div id="measure-list"></div>
  ```
  `toggle-measure` 는 **`checked` 를 하드코딩하지 않는다** — 측정 모드는 항상 꺼진 채 시작하고,
  복원은 S2 가 담당한다 (`toggle-inspector` 와 동일). 그리고
  `#measure-list:empty::after` 의 `content` 를 `'Turn on measure mode and pick two points'` →
  `'No measurements'` 로 바꾼다. 역할이 이렇게 갈린다 — **체크박스=조작, `#measure-state`=지금
  무엇을 해야 하나, 플레이스홀더=목록이 비었다.**
  — **TDD**: 먼저 `test/unit/webviewHtml.test.ts` 에 두 개를 추가해 **RED 를 확인한 뒤**
  마크업을 고친다 — (1) `id="toggle-measure"` 가 있고 `checked` 가 붙어 있지 않다,
  (2) 플레이스홀더가 `No measurements` 이고 `Turn on measure mode` 문구가 남아 있지 않다.
  기존 `id="dim-x"` 검사(`webviewHtml.test.ts:83`)와 같은 패턴이다.
  — 완료 기준: DoD 6·7 이 `1`, 8 이 `0` 이 되고, DoD 12 가 **107 초과**로 통과. 1·2·3 유지.
  이 시점의 체크박스는 아직 아무 일도 하지 않는다(배선은 S2) — `bindCheckbox` 를 쓰지 않으므로
  깨지는 것은 없다.

- [ ] **S2. 두 진입점을 하나의 공통 경로로 수렴시키고 복원 결함을 고친다.** (depends: S1 — 하드 의존)
  (파일: `src/webview/main.ts` · `test/e2e/render.spec.ts`)

  `applyInspector` 를 본떠 `applyMeasureMode(viewer, active)` 를 만든다:
  - 체크박스 `toggle-measure` 의 `checked` 를 `active` 로 맞춘다 (어느 쪽에서 왔든 수렴).
  - `viewer.setMeasureMode(active)` 를 호출한다 — 이 안에서 `animations.pause()` 와
    `gate.markDirty()` 가 일어난다(`viewer.ts:203-209`). **이 부수효과는 유지 대상이다.**
  - `post({ type: 'measureModeState', active })` 로 호스트에 알린다. **새 메시지 타입 없음.**

  세 호출부를 이 함수로 모은다:
  1. **패널** — `requireElement<HTMLInputElement>('toggle-measure')` 에 맨 `change` 리스너
     (`bindCheckbox` 아님 — 함정 3). `toggle-grid`(`main.ts:132-135`) ·
     `toggle-inspector`(`main.ts:138-141`) 와 같은 형태로 `wirePanel` 안에 둔다.
  2. **호스트 메시지** — `main.ts:405-408` 의 `setMeasureMode` 인라인 2줄을
     `applyMeasureMode(viewer, message.active)` 로 교체.
  3. **복원** — `main.ts:112` 의 `viewer.setMeasureMode(restored.measureMode)` 를
     `applyMeasureMode(viewer, restored.measureMode)` 로 교체 ← **함정 2 수정.**

  그리고 `main.ts:288` 의 상태 텍스트를 힌트 전용으로 바꾼다:
  `measure.isActive ? 'pick two points' : ''`.
  **`root.dataset.measure` 와 `root.dataset.measureCount` 갱신은 그대로 둔다** — 기존 e2e 9곳이
  이걸 본다(함정 5).
  — **TDD**: 세 개를 먼저 쓰고 **RED 를 확인한 뒤** 배선한다 —
  (1) 패널 체크박스를 켜면 `data-measure="on"` 이 되고 `measureModeState` 가 호스트로 나간다
      (`collectHostMessages` 사용 — `render.spec.ts:672` 의 그리드 테스트와 같은 패턴),
  (2) 호스트가 `setMeasureMode` 를 보내면 체크박스가 따라온다
      (`render.spec.ts:570` 의 Inspector 두 진입점 테스트를 그대로 본뜬다),
  (3) **측정 모드를 켠 뒤 reload 하면 체크박스가 켜진 채 복원되고 `measureModeState` 가 다시
      호스트로 나간다** ← 함정 2를 잡는 단정. 이 셋은 구현 전에 반드시 실패해야 한다.
  — 완료 기준: DoD 9 가 `1`, 10 이 `0` 이 되고, DoD 13 이 **40 초과**로 전부 통과.
  1·2·3·4·5 와 기존 측정 e2e 전부 계속 통과.

- [ ] **S3. README 를 새 진입점에 맞춘다.** (depends: S2)
  (파일: `README.md`)

  `## Measurement` 첫 문단이 지금 제목 표시줄과 명령 팔레트만 언급한다. 패널 체크박스를
  **먼저** 오는 진입점으로 넣고, 제목 표시줄·명령 팔레트를 대안으로 남긴다. 정확한 문자열
  `` `Measure` checkbox `` 를 포함시킨다(DoD 11).
  이 슬라이스가 따로 있는 이유: ADR `260822-233935` 가 *"낡은 안내를 남기는 것이 더 나쁘다"* 를
  이 저장소의 교훈으로 못 박았다. 별도 슬라이스로 두어 잊을 수 없게 한다.
  — 완료 기준: DoD 11 이 `1`. 1~5·12·13 유지.

## 수동 확인 (자동화하지 않는 것)

**실제 VS Code 에서 패널 체크박스와 제목 표시줄 아이콘을 번갈아 눌러 토글 방향이 뒤집히지
않는지.** e2e 의 `sendHostMessage` 셰임은 `onDidReceiveMessage` 자리를 대신하지만
`session.measureActive` 를 실제로 들고 있는 것은 확장 호스트이고, 확장 호스트 테스트는 웹뷰
내부를 읽을 수 없다 — task 8·11 과 같은 구조적 한계다. 특히 **함정 2의 수정은 세션 객체가
탭 전환에서 재생성되는지에 따라 증상이 달라지므로**, 측정 모드를 켠 채 탭을 떠났다 돌아와
제목 표시줄 아이콘을 한 번 눌러 즉시 꺼지는지 확인한다.
