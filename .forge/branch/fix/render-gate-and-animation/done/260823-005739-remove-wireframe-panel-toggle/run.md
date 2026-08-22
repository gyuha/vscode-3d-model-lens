# 실행 기록 — 뷰어 패널에서 Wireframe 토글 제거

- 작업: `remove-wireframe-panel-toggle` (task 10, TDD off)
- 실행 방식: **직접 실행** (Dynamic Workflow 아님). 슬라이스 1개, 파일 7개의 삭제라 병렬 팬아웃
  이점이 없다.

## 슬라이스별 결과

- S1 패널 Wireframe 체크박스·배선·저장 상태 제거 (7개 파일) — ✅ 계획대로 (주석 수정 범위만 축소, 발산 2)

## DoD — baseline → after

| # | 검사 | baseline | after |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | PASS (회귀 가드 — 사전 통과가 정상) |
| 2 | `npm run lint` | PASS | PASS (중간 위반 0건) |
| 3 | `npm run check:bundle` | PASS (파일 508) | PASS (파일 **507** — 발산 5 참조, 이 변경의 효과가 아니다) |
| 4a | `grep -rni toggle-wireframe src/ test/` | 5 | **0** |
| 4b | `grep -ni wireframe src/webview/viewerState.ts` | 3 | **0** |
| 4c | `grep -c setWireframe src/webview/main.ts` | 1 | **0** |
| 5 | `grep -c 'public setWireframe' src/webview/chrome.ts` | 1 | **1** (유지 가드 — 재인코딩함, 발산 1) |
| 6 | `grep -c 'Turn on wireframe' README.md` | 1 | **0** |
| 7 | `npx vitest run` | 104 passed | **104 passed** (줄지 않음 — 요구대로) |
| 8 | `npx playwright test` | 37 passed | **37 passed** (줄지 않음 — 단, 발산 4) |
| 9 | `npm run test:integration` | 12 passing | **12 passing** (줄지 않음) |

## 계획 대비 발산

**1. DoD 5 의 검사가 미흡하게 인코딩돼 있었고, 그걸 깨뜨린 것이 나 자신이다.**
`grep -c setWireframe src/webview/chrome.ts → 1` 은 **정의와 단순 언급을 구분하지 못한다.**
`ensureMaterials` 주석을 고칠 때 그 안에 `setWireframe` 이라는 단어를 넣었더니 값이 2 가 됐다.
의도("메서드 정의가 살아남는다")는 충족됐지만 검사가 그것을 표현하지 못한 것이다.
`grep -c 'public setWireframe'` 로 재인코딩해 정의만 겨냥하게 했다. **fail-closed 방향이라
조용히 통과하지 않고 즉시 걸렸다.** — 이것으로 **세 작업 연속** grep 검사가 실행 시점에
재인코딩을 요구했다(task 9: 단어 경계, task 10: 정의 대 언급). 패턴이다.

**2. `ensureMaterials` 주석의 이유 (1) 은 낡지 않았다 — 계획의 전제가 틀렸다.**
계획은 "(1) 은 낡은 문구가 된다"고 적었지만, `setWireframe` 을 **남기기로** 했으므로 그 메서드가
여전히 `if (mesh.material)` 을 검사한다. 즉 "머티리얼이 없으면 와이어프레임이 동작하지 않는다"는
지금도 사실이다. 낡은 것은 "와이어프레임 **토글**"이라는 표현 하나뿐이었다. 그래서 이유 전체를
다시 쓰지 않고 그 표현만 `setWireframe` 으로 바꾸고, 패널 토글은 제거됐지만 능력은 남아 있다는
사실과 ADR 번호를 덧붙였다 — 계획이 지시한 것보다 **좁은** 수정이다.

**3. 유닛 테스트 수정이 계획보다 한 발 넓었다.**
계획은 쓰레기 입력 방어 테스트에서 "`wireframe: null` 항목만 빠진다"고 적었다. 그대로 하면
`{ grid: 'off' }` 하나만 남아 테스트가 얇아지므로, `{ grid: 'off', snap: null }` 로 바꿔
**비불리언 값 두 개**를 유지했다 — 테스트 이름이 "토글이나 measureMode 가 불리언이 아니면
기본값으로 떨어진다"이므로 그 목적에 더 맞는다. 계획 문구를 벗어난 판단이므로 기록한다.

**4. e2e 스위트가 부하 상황에서 간헐 실패했다 — 이 변경이 원인이 아니라고 판단한다.**
첫 전체 실행에서 2건이 실패했다: `Inspector 를 켜면 연속 렌더링한다` ·
`reload 후 측정·카메라·토글·측정 모드가 복원된다`. **둘 다 이 작업이 건드리지 않은 테스트다.**
원인 판별을 위해 측정했다 — 전체 실행 5회 중 4회 통과(실패는 `tsc`+`lint`+`bundle`+`vitest` 가
같은 셸 체인에서 막 돌아간 첫 회차뿐), 그 두 테스트만 격리 실행 5/5 통과, **코드를 stash 해
변경 전 상태로 돌린 전체 실행도 통과**, 복원 후 2연속 통과. 부하로 인한 타이밍 실패로 본다.
**다만 기존에 잠재한 취약점이고 후속 작업감이다** — 이 두 테스트는 `waitForTimeout(300)` 과
렌더 횟수 비교에 의존하므로 CI 에서 재발할 수 있다.

**5. 번들 파일 수 508 → 507 은 이 변경의 효과가 아니다.** 계획의 508 은 fg-ask 시점에 쟀는데,
`dist/` 는 gitignored 이고 그때 낡은 산출물이었다. 재빌드 후 다시 재니 **변경 전에도 507,
변경 후에도 507** 이다. `dist/` 에 `axesViewer` 흔적이 없으므로 507 은 task 9(축 기즈모 제거)의
효과가 뒤늦게 빌드에 반영된 값이다. 이 작업의 번들 영향은 0 이다.

**침범한 비목표는 없다.** `Chrome.setWireframe`·`wireframeOn`·`wireframe` 게터·`meshes`
필드/매개변수는 전부 남아 있고(DoD 5 가 지킨다), `ensureMaterials` 도 그대로다.
`VIEWER_STATE_VERSION` 은 1 이며, 렌더 게이트 e2e 는 삭제하지 않고 `#toggle-grid` 로 옮겼다.

## 남은 공백 (의도적)

**패널에서 Wireframe 행이 사라졌다는 것을 픽셀로 단정하지 않았다.** DoD 4a 가
`webviewHtml.ts` 원본에서 `toggle-wireframe` 부재를 직접 확인하므로 전이적으로 덮인다.

**Inspector 로 와이어프레임을 켜는 경로가 실제로 쓸 만한지 검증하지 않았다.** ADR
`260822-233935` 가 대가로 명시한 부분이다 — 머티리얼별 스위치라는 사실은 번들 코드에서
확인했지만, 머티리얼이 여러 개인 실제 모델에서의 사용성은 재지 않았다.
