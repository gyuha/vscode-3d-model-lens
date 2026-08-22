<!-- forge-slug: viewer-background-mode -->
<!-- task: 8 -->
<!-- tdd: on -->
# 뷰어 배경 모드 — 테마 따름 / 라이트 / 다크 전환과 전역 설정 저장

## 목표 / 비목표

- **목표**: 뷰어 패널에서 배경 모드(`theme` · `light` · `dark`)를 고를 수 있고, 그 선택이 전역
  VS Code 설정에 저장되며, 열려 있는 모든 뷰어에 즉시 반영된다.
- **비목표**:
  - **임의 색 지정.** `modelLens.backgroundColor` 를 제거하면서 함께 사라진다 (ADR `260822-195326`).
  - **라이트 배경에서 무광 STL 대비 개선.** 측정으로 한계(대비 63)를 확인했고, 고치려면 기본
    머티리얼 색이나 윤곽선을 손대야 해서 모든 모델의 외형이 바뀐다. 별개 작업이다.
  - **제목 표시줄 아이콘 · 명령 팔레트 노출.** 패널 드롭다운 하나로 끝낸다. Inspector 에서 겪은
    "두 진입점 동기화" 문제를 새로 만들지 않는다.
  - **파일별 배경 기억.** 단위와 달리 파일 고유의 이유가 없다. 전역 하나로 둔다.
  - **웹뷰 `setState` 저장.** 전역 설정을 매번 읽으므로 불필요하다 (ADR `260822-145808` 의
    상태 보존 목록에 넣지 않는다).
  - **`config.update` 왕복의 자동 검증.** 확장 호스트 테스트는 웹뷰 내부를 읽을 수 없다는 기존
    한계 그대로다. 설정 기여(통합)와 배경 적용(e2e)을 각각 단정하고, 실제 왕복은 수동 확인으로
    남긴다 — 직전 작업의 "남은 공백(의도적)" 과 같은 판단이다.

## 진실의 출처

- **용어집**: `배경 모드` (이 브랜치 `CONTEXT.md` 에 신규), `뷰어 패널` (최상위 `CONTEXT.md`)
- **관련 ADR**:
  - `adr/260822-195326-viewer-background-three-state-and-pure-white.md` — 3상태 enum 하나로
    소유하는 이유, 그리고 `light` 가 순백인 측정 근거
  - `.forge/adr/260822-145808-webview-dies-on-tab-switch.md` — 배경 탭 웹뷰는 파괴된다. 그래서
    동시에 살아 있는 웹뷰는 보이는 탭들뿐이고, 전파 대상도 그것뿐이다
  - `.forge/adr/260822-115455c-honest-measurement-reporting.md` — 단위를 `workspaceState` 에
    파일별로 둔 선례. 배경은 그 반대 판단(전역)이며 그 대비가 근거다

### 완료의 정의

각 명령은 **작성 시점에 한 번 실행했고**, 아래가 그때의 사전 상태다.

| # | 검사 | 사전 상태 | 성격 |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | 회귀 가드 — 통과가 정상 |
| 2 | `npm run lint` | PASS | 회귀 가드 — 통과가 정상 |
| 3 | `npm run check:bundle` | PASS | 회귀 가드 — 외부 호스트 0건 유지 |
| 4 | `npm run test:integration` | 11 passing | 회귀 가드 + 전진 (설정 기여 검사가 늘어난다) |
| 5 | `grep -rl backgroundColor src/ \| wc -l` → `0` | **4** (실패) | 전진 — 구 설정이 코드에서 사라져야 한다 |
| 6 | `grep -c '"modelLens.background"' package.json` → `1` | **0** (실패) | 전진 — 새 설정이 기여되어야 한다 |
| 7 | `npx vitest run` | 96 passed | 회귀 가드 + 전진 (배경 모드 매핑 유닛 테스트가 늘어난다) |
| 8 | `npx playwright test` | 30 passed | 회귀 가드 + 전진 (배경 e2e 가 늘어난다) |

1~3 은 이미 통과한다 — 배경 작업이 깨뜨리지 않는지 보는 **회귀 가드**이므로 사전 통과가 정상이다.
5·6 은 지금 실패하는 **전진 검사**다. 4·7·8 은 숫자가 늘어나야 하므로 사전 통과가 무의미하지 않다.

## 작업 슬라이스

- [ ] **S1. 설정 스키마를 3상태 enum 하나로 교체한다.**
  `package.json` 에서 `modelLens.backgroundColor` 를 제거하고 `modelLens.background`
  (`enum: [theme, light, dark]`, 기본 `theme`, 각 값에 `enumDescriptions`)를 추가. README 설정 표도 갱신.
  — 완료 기준: 통합 테스트에 "`modelLens.background` 가 기여되고 기본값이 `theme` 이며 enum 이
  세 값이다"가 추가되어 통과하고, DoD 6 이 `1` 이 된다.

- [ ] **S2. 배경 모드를 실제 색으로 적용한다.** (depends: S1)
  `ViewerConfig.backgroundColor: string` → `background: BackgroundMode`. `theme` 이면 CSS 의
  `--vscode-editor-background` 를 그대로 두고, `light`/`dark` 면 `#ffffff`/`#1f1f1f` 로 덮는다.
  캔버스 투명(`scene.clearColor` 알파 0)은 유지한다 — CSS 만 바꾸면 되는 구조가 이 작업을 싸게 만든다.
  — 완료 기준: 세 모드 각각에서 `body` 의 실제 배경 픽셀이 기대값(테마색 / `#ffffff` / `#1f1f1f`)임을
  e2e 가 단정하고, DoD 5 가 `0` 이 된다.

- [ ] **S3. 뷰어 패널에 배경 드롭다운을 넣고 선택을 전역 설정에 저장한다.** (depends: S2)
  표시 토글 그룹(그리드·축·와이어프레임) 마지막에 단위 행과 같은 `label + select` 패턴으로
  `배경 [테마 따름 / 라이트 / 다크]` 행을 추가. 선택하면 웹뷰가 `backgroundChanged` 를 호스트에
  보내고, 호스트가 `config.update('background', v, ConfigurationTarget.Global)` 을 호출한다.
  — 완료 기준: e2e 에서 드롭다운을 바꾸면 배경이 즉시 바뀌고 `backgroundChanged` 메시지가
  호스트로 나간다(`unitChanged` 와 같은 왕복 패턴).

- [ ] **S4. 설정 변경을 열린 모든 뷰어에 전파한다.** (depends: S3)
  `viewerProvider` 가 `workspace.onDidChangeConfiguration` 을 구독해, `modelLens.background` 가
  바뀌면 `sessions` 의 모든 세션에 `setBackground` 메시지를 보낸다. 구독은 `context.subscriptions`
  에 등록해 확장 비활성화 시 해제한다.
  — 완료 기준: e2e 에서 호스트가 `setBackground` 를 보내면 배경이 바뀌고 드롭다운 값도 따라온다
  (Inspector 에서 세운 "두 진입점이 어긋나지 않는다"와 같은 단정).
