<!-- forge-slug: remove-wireframe-panel-toggle -->
<!-- task: 10 -->
<!-- tdd: off -->
# 뷰어 패널에서 Wireframe 토글 제거

## 목표 / 비목표

- **목표**: 뷰어 패널의 `Wireframe` 체크박스와 그 배선·저장 상태를 제거한다. 와이어프레임은
  Babylon Inspector 의 머티리얼별 스위치로만 접근하게 된다 (ADR `260822-233935`).
- **비목표**:
  - **`Chrome.setWireframe` · `wireframeOn` · `wireframe` 게터 · `meshes` 필드/매개변수 제거.**
    사용자가 명시적으로 남기기로 결정했다. 연쇄를 따라가면 `Chrome` 이 그리드만 든 클래스가 되고
    `viewer.ts:119` 의 생성자 호출부까지 바뀌는데, 그 비용을 지금 치르지 않는다.
    **결과적으로 호출자 없는 public 메서드가 남는다 — 의도된 것이고, DoD 5 가 삭제를 막는다.**
  - **`ensureMaterials` 제거.** 이 함수의 주석은 존재 이유를 두 개 대는데 (1) "머티리얼이 없으면
    와이어프레임 토글이 동작하지 않는다" 는 낡은 문구가 되지만 **(2) "PBR 을 쓴다 —
    StandardMaterial 은 IBL 을 쓰지 않아 STL 이 glTF 보다 훨씬 어둡게 보인다" 는 독립적으로
    유효하다.** 지우면 모든 STL 이 머티리얼 없이 렌더돼 외형이 망가진다. 함수는 유지하고
    주석의 (1) 만 고친다.
  - **저장 상태 버전 올리기.** `VIEWER_STATE_VERSION` 은 1 그대로 둔다 (근거: 진실의 출처).
  - **와이어프레임을 대체할 다른 정점 가시화 수단 추가.** ADR 이 대가로 받아들인 부분이다.
    필요해지면 별개 작업이다.
  - **`Chrome` 클래스 이름 변경 · 리팩터링.** 손대지 않는다.

## 진실의 출처

- **용어집**: `뷰어 패널` · `정점 스냅` · `Inspector` (최상위 `CONTEXT.md`). **용어 갱신 없음** —
  `뷰어 패널` 의 "표시 토글" 은 Grid·Vertex snap 이 남으므로 정의가 그대로 유효하고, `Inspector`
  정의("우리 패널과 다른 것")도 사실로 남는다. 바뀐 것은 용어가 아니라 결정이다.
- **관련 ADR**:
  - `adr/260822-233935-wireframe-delegated-to-inspector.md` — **이 작업의 근거 전체.** 알고도
    받아들인 네 가지 대가, `setWireframe` 을 남긴 이유, 되돌리기 전에 읽을 것이 여기 있다.
  - `.forge/adr/260822-145808-webview-dies-on-tab-switch.md` — `restoreViewerState` 는
    `raw.version !== VIEWER_STATE_VERSION` 이면 저장 상태 **전체**(카메라·측정·애니메이션)를
    버린다. 그래서 `TogglesState.wireframe` 을 지우되 버전은 올리지 않는다 — 기존 저장 데이터의
    `wireframe` 키는 `readToggles` 가 조용히 무시한다. 직전 작업(`remove-axes-gizmo`)과 동일한 판단.
  - `.forge/adr/260822-162443-babylon-fails-silently.md` — 지우면 안 되는 코드 네 곳과 대조한다.

### 완료의 정의

각 명령은 **작성 시점에 한 번 실행했고**, 아래가 그때의 사전 상태다.

| # | 검사 | 사전 상태 | 성격 |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | 회귀 가드 — 통과가 정상 |
| 2 | `npm run lint` | PASS | 회귀 가드 — 통과가 정상 |
| 3 | `npm run check:bundle` | PASS (파일 508 · 외부 호스트 15) | 회귀 가드 — 통과가 정상 |
| 4a | `grep -rni toggle-wireframe src/ test/` 줄 수 → `0` | **5** (실패) | 전진 — 체크박스와 그 배선이 사라져야 한다 |
| 4b | `grep -ni wireframe src/webview/viewerState.ts` 줄 수 → `0` | **3** (실패) | 전진 — 저장 상태에서 필드가 사라져야 한다 |
| 4c | `grep -c setWireframe src/webview/main.ts` → `0` | **1** (실패) | 전진 — 패널의 호출이 사라져야 한다 (4a 가 못 잡는 줄) |
| 5 | `grep -c setWireframe src/webview/chrome.ts` → `1` | **1** | **회귀 가드 — 남기기로 한 결정을 지킨다** |
| 6 | `grep -c 'Turn on wireframe' README.md` → `0` | **1** (실패) | 전진 — 낡은 안내가 고쳐져야 한다 |
| 7 | `npx vitest run` | 104 passed | 회귀 가드 — **줄지 않아야** 한다 |
| 8 | `npx playwright test` | 37 passed | 회귀 가드 — **줄지 않아야** 한다 (아래 e2e 교체 후에도) |
| 9 | `npm run test:integration` | 12 passing | 회귀 가드 — 설정 기여를 건드리지 않았음의 증거 |

**5 번은 이 계획에서 가장 이례적인 항목이다.** 사전에 통과하지만 회귀 가드이고, 지키는 대상이
"코드가 있다"가 아니라 **"사용자의 결정이 연쇄 삭제로 뒤집히지 않는다"** 다. 호출자 없는 public
메서드는 `grep` 으로 죽은 코드를 찾는 다음 사람에게 삭제 후보로 보이므로, 검사로 막는다.

**부정 검사 인코딩 근거 (직전 두 작업의 함정 대응).** 4a·4b·4c·6 은 전부 실행할 명령을 그대로
적었다 — 교체(`|`)도 `\b` 도 쓰지 않는다(마크다운 표의 `\|` 이스케이프가 `grep -E` 에서 리터럴
파이프가 되는 함정, 그리고 `\b` 가 BSD grep 에서 보장되지 않는 함정). **범위를 좁힌 이유가
핵심이다**: `grep -rni wireframe src/ test/` 를 통째로 쓰면 **영원히 0 이 될 수 없다** —
`setWireframe`·`wireframeOn`·`material.wireframe`·게터가 `chrome.ts` 에 의도적으로 살아남기
때문이다. 그래서 사라져야 하는 것만 정확히 겨냥해 셋으로 쪼갰고, 살아남아야 하는 것은 5 번의
**양성 검사**로 따로 지킨다. 작성 시점에 `chrome.ts` 의 잔존 참조 6줄을 직접 눈으로 확인했다.

## 작업 슬라이스

- [ ] **S1. 패널에서 Wireframe 토글과 그 배선·저장 상태를 제거한다.**
  타입 시스템이 원자성을 강제하므로 쪼개지 않는다 — `TogglesState.wireframe` 을 지우면
  `main.ts:210` 과 테스트 객체 리터럴이 즉시 타입 에러를 낸다. (직전 작업과 같은 구조.)

  건드릴 곳:
  - `src/webviewHtml.ts` — 244행 `Wireframe` 체크박스 `<label>` 한 줄 제거.
  - `src/webview/main.ts` — 52행 `setChecked('toggle-wireframe', ...)`, 134~136행
    `bindCheckbox('toggle-wireframe', ...)` 블록(`chrome.setWireframe(on)` 호출 포함),
    210행 `wireframe: isChecked('toggle-wireframe')` 제거.
  - `src/webview/viewerState.ts` — `TogglesState.wireframe` 필드, `DEFAULT_TOGGLES` 의
    `wireframe: false`, `readToggles` 의 `wireframe:` 줄 제거. **`VIEWER_STATE_VERSION` 은 1 그대로.**
  - `src/webview/chrome.ts` — **`setWireframe` 은 그대로 두고**, `ensureMaterials` 주석의
    이유 (1) 만 현재 사실에 맞게 고친다(와이어프레임 토글 언급 → 머티리얼이 없으면 렌더가
    깨진다는 사실 자체). 이유 (2) 는 손대지 않는다.
  - `test/e2e/render.spec.ts` — 321행 `표시 토글도 다시 그리게 만든다` 가 `#toggle-wireframe` 을
    **렌더 게이트 회귀 테스트의 수단**으로 쓴다(와이어프레임에 대한 테스트가 아니다).
    `#toggle-grid` 로 교체한다 — `bindCheckbox('toggle-grid', …)` 도 동일하게 `viewer.markDirty()`
    를 부르므로 등가다. **테스트를 삭제하지 않는다** — 삭제하면 유휴 렌더 게이트의 회귀 가드를 잃는다.
  - `test/unit/viewerState.test.ts` — `wireframe` 참조 4곳(17 · 155 · 159 · 167행) 제거.
    155~159행의 **쓰레기 입력 방어 테스트는 유지**한다(`wireframe: null` 항목만 빠진다).
  - `README.md` — 66행의 *"Turn on wireframe to see where the vertices are."* 를 Inspector 경로로
    다시 쓴다. **유휴 렌더 중단이 무력화된다는 대가를 함께 적는다** — ADR 이 받아들인 대가를
    사용자에게 숨기지 않는다.

  — 완료 기준: DoD 4a·4b·4c·6 이 `0`, 5 가 `1` 이 되고, 7·8·9 의 테스트 수가 **줄지 않은 채**
  전부 통과하며, 1~3 이 계속 통과한다. 패널에 `Wireframe` 행이 없고 Grid·Vertex snap 은 남아 있다.
