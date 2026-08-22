# 실행 기록 — 뷰어 배경 모드

- 작업: `viewer-background-mode` (task 8, TDD on)
- 실행 방식: **직접 실행** (Dynamic Workflow 아님). 슬라이스 4개가 전부 순차 의존이라
  병렬 팬아웃 이점이 없고, TDD 사이클이 대화형으로 얽혀 단일 실행자가 유리하다고 판단.
  fg-run 의 "단일 에이전트로 충분한 규모면 워크플로를 건너뛰라"는 제약을 따랐다.

## 슬라이스별 결과

- S1 설정 스키마를 3상태 enum 하나로 교체 (`package.json` · README) — ✅ 계획대로
- S2 배경 모드를 실제 색으로 적용 (`background.ts` 신규 · 5개 파일 배선) — ✅ 계획대로
- S3 패널 드롭다운 + 전역 설정 저장 — ⚠ S4 구현을 여기서 함께 넣어 TDD 순서를 어겼다
- S4 설정 변경을 열린 모든 뷰어에 전파 — ⚠ 테스트보다 구현이 먼저였다 (아래 발산 1)

## DoD — baseline → after

| # | 검사 | baseline | after |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | PASS (회귀 가드 — 사전 통과가 정상) |
| 2 | `npm run lint` | PASS | PASS (중간에 1건 발생 → 수정, 아래 발산 3) |
| 3 | `npm run check:bundle` | PASS | PASS, 외부 호스트 0건 유지 (회귀 가드) |
| 4 | `npm run test:integration` | 11 passing | **12 passing** |
| 5 | 구 설정 `backgroundColor` 참조 | 4 | **0** (명령은 재인코딩함 — 발산 2) |
| 6 | `modelLens.background` 기여 | 0 | **1** |
| 7 | `npx vitest run` | 96 passed | **104 passed** |
| 8 | `npx playwright test` | 30 passed | **37 passed** |

## 계획 대비 발산

**1. S3 과 S4 의 구현을 한 번에 넣어 TDD 순서를 어겼다.**
S3(드롭다운 + 저장)을 배선하면서 `setBackground` 수신 핸들러와 `onDidChangeConfiguration` 구독까지
같은 커밋 단위로 넣었다. 그래서 S4 의 e2e 를 나중에 썼을 때 **곧바로 통과했고 RED 를 보지 못했다.**
빈 통과를 그대로 두지 않고, 핸들러를 `if (false && …)` 로 무력화해 재실행 → `Expected "light",
Received "theme"` 로 실패를 확인한 뒤 원복했다. 테스트가 실제로 무언가를 잡는다는 증거는 확보했지만,
순서 자체는 규율 위반이다. 원인은 두 슬라이스가 같은 파일(`main.ts`·`viewerProvider.ts`)을 건드려
"한 번에 고치는 게 싸다"고 판단한 것 — 그 판단이 TDD 를 앞질렀다.

**2. DoD 5 의 명령이 잘못 인코딩돼 있었다 (fg-ask 가 만든 결함).**
계획은 `grep -rl backgroundColor src/ | wc -l → 0` 이라고 적었는데, 새로 만든 함수 이름이
`backgroundColorFor` 라 이 명령은 **영원히 0 이 될 수 없다**. PLAN-FORMAT 이 경고한 "부정 검사"
함정에 그대로 걸렸다 — 다만 fail-open(깨진 명령이 0 을 내는) 방향이 아니라 fail-closed 라
조용히 통과하지는 않았다. 의도("구 설정 참조가 사라졌다")에 맞게
`grep -rn '\bbackgroundColor\b' src/ | grep -v backgroundColorFor | wc -l → 0` 으로 재인코딩해
확인했다. 계획 작성 시점에 한 번 실행해 봤는데도 걸러지지 않은 이유는, **그때는 아직 새 함수가
없어서 명령이 의도대로 동작하는 것처럼 보였기 때문이다.**

**3. `import()` 타입 어노테이션이 lint 에 걸렸다.**
e2e 헬퍼에 `page: import('@playwright/test').Page` 를 인라인으로 썼다가
`@typescript-eslint/consistent-type-imports` 위반. 상단 `import type { Page }` 로 고쳤다.
전체 DoD 를 돌리기 전까지 몰랐다 — 슬라이스마다 lint 를 돌리지 않은 결과다.

**침범한 비목표는 없다.** 임의 색 지정은 계획대로 제거했고, 라이트 모드 대비 개선·제목 표시줄
아이콘·파일별 기억·`setState` 저장에는 손대지 않았다.

## 계획대로 착지한 것

- `light` = `#ffffff` 결정과 그 측정 근거를 `background.ts` 주석과 ADR 양쪽에 남겼다.
  주석은 "고치려 들기 전에 다시 재라"라고 명시한다.
- 설정 파일에 손으로 아무 문자열이나 들어갈 수 있다는 전제를 `isBackgroundMode` + 폴백으로
  방어했고, 유닛 테스트 8개 중 2개가 그 방어 케이스다.
- 웹뷰가 자기 선택을 호스트를 거쳐 되돌려받는 구조(드롭다운 → `backgroundChanged` →
  `config.update` → `onDidChangeConfiguration` → `setBackground`)에서 루프가 생기지 않는 이유를
  코드 주석에 적었다 — `applyBackground` 는 멱등이고 프로그래매틱 `value` 대입은 `change` 를
  다시 쏘지 않는다.

## 남은 공백 (의도적)

**실제 VS Code 에서 `config.update` 가 전역 설정에 쓰이고 그것이 다른 탭으로 전파되는 왕복은
자동 테스트로 단정하지 못했다.** 계획의 비목표에 미리 적어 둔 그대로다 — 확장 호스트 테스트는
웹뷰 내부를 읽을 수 없다. 대신 세 겹으로 나눠 덮었다: 설정 기여(통합 12) · 웹뷰가 보내는 메시지
(e2e, UAT 셰임이 `onDidReceiveMessage` 자리를 대신) · 호스트가 보낸 메시지의 수신(e2e, mutation 으로
검증). 가운데 고리인 `config.update` → `onDidChangeConfiguration` 은 VS Code 자체 동작이다.
