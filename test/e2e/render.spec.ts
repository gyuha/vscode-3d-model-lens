import { expect, test, type Page } from '@playwright/test';
import {
  axisPair,
  collectConsoleProblems,
  collectExternalRequests,
  collectHostMessages,
  extents,
  isIdle,
  readyMeshes,
  renderCount,
  sendHostMessage,
  vertexTargets,
  waitForIdle,
  waitForViewer,
} from './helpers';

const ORIGIN = 'http://127.0.0.1:39177';

/** FIXTURES.md 의 기대 치수. 이 값이 이 스위트의 단일 기준이다. */
const FIXTURES = [
  { file: 'cube.gltf', extents: [2, 3, 4] as const, note: '외부 cube.bin 참조 — 형제 파일 해결' },
  { file: 'cube.glb', extents: [5, 6, 7] as const, note: 'GLB 바이너리 컨테이너' },
  { file: 'cube.stl', extents: [10, 20, 30] as const, note: 'ASCII STL, 파일 좌표 유지' },
  { file: 'cube_large.stl', extents: [1000, 2000, 3000] as const, note: 'cube.stl 의 100배' },
];

test.describe('WebGL2 엔진', () => {
  test('소프트웨어 렌더링 환경에서 WebGL2 로 초기화되고 모델이 로드된다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const webglVersion = await page.evaluate(
      () => (document.createElement('canvas').getContext('webgl2') ? 2 : 1),
    );
    expect(webglVersion, 'WebGL2 를 쓸 수 없으면 PBR/IBL 이 제대로 나오지 않는다').toBe(2);

    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
    expect(Number(await page.locator('#root').getAttribute('data-mesh-count'))).toBeGreaterThan(0);
  });
});

test.describe('외부 네트워크 의존 0건', () => {
  test('모델 로드 중 외부 오리진 요청이 없다', async ({ page }) => {
    const external = collectExternalRequests(page, ORIGIN);
    await page.goto('/?fixture=cube.gltf');
    expect(await waitForViewer(page)).toBe('ready');
    expect(external, `외부 요청: ${external.join(', ')}`).toEqual([]);
  });

  test('Inspector 를 켜도 외부 오리진 요청이 없다 — CSP 가 차단하고 로컬 chunk 만 쓴다', async ({
    page,
  }) => {
    const external = collectExternalRequests(page, ORIGIN);
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setInspector', visible: true });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    // Inspector UI 가 실제로 마운트됐는지 확인 (FluentUI 노드)
    await expect(page.locator('[class*="fui-"]').first()).toBeVisible();

    expect(external, `외부 요청: ${external.join(', ')}`).toEqual([]);
  });

  test('CSP 가 응답 헤더로도 강제된다', async ({ page }) => {
    const response = await page.goto('/?fixture=cube.glb');
    const csp = response?.headers()['content-security-policy'] ?? '';
    for (const directive of [
      "default-src 'none'",
      'script-src',
      'connect-src',
      'img-src',
      'style-src',
      'worker-src',
    ]) {
      expect(csp, `CSP 에 ${directive} 가 없다`).toContain(directive);
    }
  });
});

test.describe('치수', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.file} 의 치수가 FIXTURES.md 기대값과 일치한다 (${fixture.note})`, async ({
      page,
    }) => {
      await page.goto(`/?fixture=${fixture.file}`);
      expect(await waitForViewer(page)).toBe('ready');

      const measured = await extents(page);
      for (const axis of [0, 1, 2]) {
        expect(measured[axis], `축 ${'XYZ'[axis]}`).toBeCloseTo(fixture.extents[axis], 4);
      }
    });
  }

  test('단위 auto 는 glTF 를 미터로, STL 은 라벨 없이 표시한다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb&unit=auto');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-unit', 'm');
    await expect(page.locator('#dim-x')).toHaveText('5.000 m');

    await page.goto('/?fixture=cube.stl&unit=auto');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-unit', 'none');
    await expect(page.locator('#dim-x')).toHaveText('10.000');
  });
});

test.describe('측정', () => {
  test('정점 스냅으로 찍은 모서리 길이가 기대값과 일치한다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    const targets = await vertexTargets(page);
    expect(targets.length, '정점을 하나도 찾지 못했다 — 픽이 동작하지 않는다').toBeGreaterThan(3);

    const canvas = page.locator('#canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    for (const [axis, expected] of [
      ['x', 10],
      ['y', 20],
      ['z', 30],
    ] as const) {
      const pair = axisPair(targets, axis, expected);
      expect(pair, `${axis} 축으로 ${expected} 떨어진 정점 쌍을 찾지 못했다`).toBeTruthy();
      if (!pair || !box) {
        continue;
      }
      // 실제 마우스 클릭 — 상호작용을 우회하지 않는다.
      for (const target of pair) {
        await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
        await page.waitForTimeout(80);
      }
      await expect(page.locator('#measure-list .row .pick').last()).toHaveText(
        `${expected.toFixed(3)} mm`,
      );
    }

    await expect(page.locator('#measure-list .row')).toHaveCount(3);
  });

  test('드래그는 측정을 만들지 않는다 — 궤도 회전이 살아 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    const box = await page.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(cx + i * 10, cy + i * 4);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    await expect(page.locator('#root')).toHaveAttribute('data-measure-count', '0');
    await expect(page.locator('#measure-list .row')).toHaveCount(0);
  });

  test('삭제와 전체 삭제가 목록·라벨을 함께 정리한다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    const targets = await vertexTargets(page);
    const box = await page.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }

    for (const [axis, gap] of [
      ['x', 10],
      ['z', 30],
    ] as const) {
      const pair = axisPair(targets, axis, gap);
      if (!pair) {
        continue;
      }
      for (const target of pair) {
        await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
        await page.waitForTimeout(80);
      }
    }
    await expect(page.locator('#measure-list .row')).toHaveCount(2);
    await expect(page.locator('.measure-label')).toHaveCount(2);

    await page.locator('#measure-list .row button.remove').first().click();
    await expect(page.locator('#measure-list .row')).toHaveCount(1);
    await expect(page.locator('.measure-label')).toHaveCount(1);

    await page.locator('#measure-clear').click();
    await expect(page.locator('#measure-list .row')).toHaveCount(0);
    await expect(page.locator('.measure-label')).toHaveCount(0);
  });

  test('단위를 바꾸면 이미 만든 측정의 라벨도 갱신된다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    const targets = await vertexTargets(page);
    const pair = axisPair(targets, 'x', 10);
    const box = await page.locator('#canvas').boundingBox();
    expect(pair).toBeTruthy();
    expect(box).not.toBeNull();
    if (!pair || !box) {
      return;
    }
    for (const target of pair) {
      await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
      await page.waitForTimeout(80);
    }
    await expect(page.locator('.measure-label').first()).toHaveText('10.000 mm');

    await page.locator('#unit').selectOption('cm');
    await expect(page.locator('.measure-label').first()).toHaveText('10.000 cm');
  });

  test('Inspector 를 켠 상태에서도 측정할 수 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setInspector', visible: true });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    const targets = await vertexTargets(page);
    const pair = axisPair(targets, 'z', 30);
    const box = await page.locator('#canvas').boundingBox();
    expect(pair, 'Inspector 가 캔버스를 가려 정점을 찾지 못했다').toBeTruthy();
    expect(box).not.toBeNull();
    if (!pair || !box) {
      return;
    }
    for (const target of pair) {
      await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
      await page.waitForTimeout(80);
    }
    await expect(page.locator('#measure-list .row .pick').last()).toHaveText('30.000 mm');
  });
});

test.describe('에러 처리', () => {
  test('깨진 파일은 빈 화면이 아니라 파일명과 원인을 표시한다', async ({ page }) => {
    await page.goto('/?fixture=broken.glb');
    expect(await waitForViewer(page)).toBe('error');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error .name')).toContainText('broken.glb');
    const message = await page.locator('#error .message').textContent();
    expect((message ?? '').trim().length, '원인 메시지가 비어 있다').toBeGreaterThan(0);
    await expect(page.locator('#panel')).toBeHidden();
  });
});

test.describe('유휴 렌더 중단', () => {
  test('유휴 상태에서는 렌더 횟수가 늘지 않는다', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page)).toBe('ready');

    expect(await waitForIdle(page), '렌더가 멈추지 않았다 — 유휴 판정이 동작하지 않는다').toBe(true);

    const before = await renderCount(page);
    await page.waitForTimeout(1500);
    const after = await renderCount(page);

    expect(after, `유휴 1.5초 동안 ${after - before} 프레임을 더 그렸다`).toBe(before);
    expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
  });

  test('카메라를 조작하면 렌더가 다시 시작된다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);

    const idleCount = await renderCount(page);

    const box = await page.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + i * 12, cy + i * 5);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    expect(await renderCount(page), '카메라를 돌렸는데 다시 그리지 않았다').toBeGreaterThan(idleCount);

    // 다시 멈춰야 한다 — 관성 감쇠가 끝나면 유휴로 돌아간다
    expect(await waitForIdle(page), '조작 후 다시 멈추지 않았다').toBe(true);
  });

  test('표시 토글도 다시 그리게 만든다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);
    const idleCount = await renderCount(page);

    await page.locator('#toggle-grid').click();
    await page.waitForTimeout(300);

    expect(await renderCount(page), '그리드를 껐는데 화면이 갱신되지 않았다').toBeGreaterThan(
      idleCount,
    );
  });

  test('Inspector 를 켜면 연속 렌더링한다 — fps 카운터와 기즈모가 렌더 루프에 의존한다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);

    await sendHostMessage(page, { type: 'setInspector', visible: true });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');

    expect(await isIdle(page), 'Inspector 가 켜졌는데 유휴로 판정됐다').toBe(false);
    const before = await renderCount(page);
    await page.waitForTimeout(1000);
    expect(await renderCount(page), 'Inspector 가 켜졌는데 그리지 않는다').toBeGreaterThan(before);

    // 끄면 다시 멈춘다
    await sendHostMessage(page, { type: 'setInspector', visible: false });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'off');
    expect(await waitForIdle(page), 'Inspector 를 껐는데 계속 그린다').toBe(true);
  });
});

test.describe('탭 전환 시 상태 보존', () => {
  test('reload 후 측정·카메라·토글·측정 모드가 복원된다', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-restored', 'no');

    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    // 측정 2개를 만든다
    const targets = await vertexTargets(page);
    const box = await page.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    for (const [axis, gap] of [
      ['x', 10],
      ['z', 30],
    ] as const) {
      const pair = axisPair(targets, axis, gap);
      expect(pair, `${axis} 축 정점 쌍을 찾지 못했다`).toBeTruthy();
      if (!pair) {
        continue;
      }
      for (const target of pair) {
        await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
        await page.waitForTimeout(80);
      }
    }
    await expect(page.locator('#measure-list .row')).toHaveCount(2);

    // 토글을 바꾸고 카메라를 돌린다
    await page.locator('#toggle-grid').click();
    await page.locator('#toggle-snap').click();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + i * 14, cy + i * 4);
    }
    await page.mouse.up();
    expect(await waitForIdle(page)).toBe(true);

    const beforeCamera = await page.evaluate(() =>
      JSON.stringify(
        (window as unknown as { __modelLens: { projectToScreen: (p: unknown) => unknown } }).__modelLens.projectToScreen(
          { x: 5, y: 10, z: 15 },
        ),
      ),
    );
    const beforeLabels = await page.locator('#measure-list .row .pick').allTextContents();

    // 탭 전환과 같은 파괴/재생성 — 웹뷰가 처음부터 다시 실행된다
    await page.reload();
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-restored', 'yes');

    await expect(page.locator('#measure-list .row')).toHaveCount(2);
    expect(await page.locator('#measure-list .row .pick').allTextContents()).toEqual(beforeLabels);
    await expect(page.locator('.measure-label')).toHaveCount(2);
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    // 그리드는 세션 상태가 아니라 전역 설정 `modelLens.grid` 가 소유한다 — 그래서 reload 하면
    // 조작 이전이 아니라 **설정 값**으로 돌아온다. 정점 스냅은 여전히 세션 상태다.
    await expect(page.locator('#toggle-grid')).toBeChecked();
    await expect(page.locator('#toggle-snap')).not.toBeChecked();

    // 카메라가 같은 자리로 돌아왔는지 — 같은 월드 좌표가 같은 화면 좌표로 투영된다
    const afterCamera = await page.evaluate(() =>
      JSON.stringify(
        (window as unknown as { __modelLens: { projectToScreen: (p: unknown) => unknown } }).__modelLens.projectToScreen(
          { x: 5, y: 10, z: 15 },
        ),
      ),
    );
    const before = JSON.parse(beforeCamera) as { x: number; y: number };
    const after = JSON.parse(afterCamera) as { x: number; y: number };
    expect(after.x, '카메라가 복원되지 않았다 (x)').toBeCloseTo(before.x, 0);
    expect(after.y, '카메라가 복원되지 않았다 (y)').toBeCloseTo(before.y, 0);

    expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
  });

  test('저장된 상태가 깨져 있어도 뷰어가 정상 로드된다', async ({ page }) => {
    // 확장을 업데이트해 상태 모양이 바뀐 상황을 흉내낸다.
    await page.addInitScript(() => {
      const garbage = [
        '{"version":999,"camera":"nope"}',
        '{"version":1,"camera":{"alpha":null},"measurements":"many","selectedIndex":"x"}',
        'not json at all',
      ];
      sessionStorage.setItem('modelLens.uatState:cube.stl', garbage[1]);
    });

    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.stl');

    expect(await waitForViewer(page), '깨진 상태에 뷰어가 죽었다').toBe('ready');
    await expect(page.locator('#panel')).toBeVisible();
    // 깨진 부분은 버리고 나머지 기본값으로 뜬다
    await expect(page.locator('#measure-list .row')).toHaveCount(0);
    await expect(page.locator('#dim-x')).toHaveText('10.000');
    expect(problems.filter((p) => p.startsWith('pageerror'))).toEqual([]);
  });
});

test.describe('유휴 진입 — 빈 화면 회귀', () => {
  test('입력 없이 유휴에 들어가도 모든 메시가 렌더 가능한 상태다', async ({ page }) => {
    // 사용자가 캔버스를 한 번도 건드리지 않는 상황. 게이트가 셰이더 컴파일이 끝나기 전에
    // 유휴로 잠기면 화면은 비어 있는데 뷰어는 "다 됐다"고 믿는다.
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);

    const { ready, total } = await readyMeshes(page);
    expect(total).toBeGreaterThan(0);
    expect(ready, '유휴인데 렌더되지 않는 메시가 남아 있다 — 빈 화면이다').toBe(total);
  });
});

test.describe('애니메이션', () => {
  test('애니메이션이 있으면 입력 없이도 계속 그린다', async ({ page }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'playing');

    const before = await renderCount(page);
    await page.waitForTimeout(600);
    const after = await renderCount(page);

    expect(after, '재생 중인데 렌더가 멈췄다 — 애니메이션이 얼어붙는다').toBeGreaterThan(before);
    expect(await isIdle(page)).toBe(false);
  });

  test('일시정지하면 유휴로 들어간다', async ({ page }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await page.locator('#animation-toggle').click();

    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'paused');
    expect(await waitForIdle(page)).toBe(true);
  });

  test('측정 모드를 켜면 애니메이션이 멈춘다 — 움직이는 메시에서는 측정이 의미를 잃는다', async ({
    page,
  }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'playing');

    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'paused');
  });

  test('전체 재생에서 개별 그룹으로 좁힐 수 있다', async ({ page }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const select = page.locator('#animation-select');
    await expect(select).toHaveValue('all');
    // '전체' 다음에 파일의 그룹이 순서대로 온다.
    await expect(select.locator('option')).toHaveText(['All', 'rise', 'slide']);

    await select.selectOption('1');

    await expect(select).toHaveValue('1');
    // 개별 그룹도 재생 중이므로 계속 그려야 한다.
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'playing');
  });

  test('reload 후 재생 상태와 선택한 그룹이 복원된다', async ({ page }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await page.locator('#animation-select').selectOption('1');
    await page.locator('#animation-toggle').click();
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'paused');
    // 저장은 렌더 뒤에 디바운스되므로 유휴에 들어갈 때까지 기다린다.
    expect(await waitForIdle(page)).toBe(true);

    await page.reload();
    expect(await waitForViewer(page)).toBe('ready');

    await expect(page.locator('#root')).toHaveAttribute('data-restored', 'yes');
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'paused');
    await expect(page.locator('#animation-select')).toHaveValue('1');
  });

  test('애니메이션이 없는 파일에서는 섹션을 숨긴다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'none');
    await expect(page.locator('#animation-row')).toBeHidden();
  });
});

test.describe('Inspector 패널 토글', () => {
  // 끄는 것은 여기서 시험하지 않는다. Inspector 사이드바가 오른쪽 패널을 완전히 덮어
  // 체크박스를 다시 클릭할 수 없기 때문이다 — 받아들인 한계이며, 끄는 경로는 제목 표시줄
  // 아이콘(아래 테스트의 setInspector 메시지)이다.
  test('패널 체크박스로 Inspector 를 켤 수 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const checkbox = page.locator('#toggle-inspector');
    await expect(checkbox).not.toBeChecked();

    await checkbox.check();

    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    await expect(page.locator('[class*="fui-"]').first()).toBeVisible();
  });

  test('제목 표시줄 경로로 켜도 체크박스가 따라온다 — 두 진입점이 어긋나면 토글 방향이 뒤집힌다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setInspector', visible: true });

    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    await expect(page.locator('#toggle-inspector')).toBeChecked();

    await sendHostMessage(page, { type: 'setInspector', visible: false });

    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'off');
    await expect(page.locator('#toggle-inspector')).not.toBeChecked();
  });
});

test.describe('배경 모드', () => {
  /** 브라우저가 돌려주는 `rgb(r, g, b)` 를 헥사로 정규화한다. */
  async function bodyBackground(page: Page): Promise<string> {
    return page.evaluate(() => {
      const rgb = getComputedStyle(document.body).backgroundColor;
      const m = rgb.match(/\d+/g);
      return m
        ? '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
        : rgb;
    });
  }

  // theme 은 VS Code 편집기 배경색을 따라가고, light/dark 는 그것과 무관하게 고정한다.
  // 그래서 테마와 모드를 **엇갈리게** 줘야 둘이 구분된다.
  const CASES = [
    { background: 'theme', theme: 'dark', expected: '#1f1f1f', note: '테마를 따라 어둡게' },
    { background: 'theme', theme: 'light', expected: '#ffffff', note: '테마를 따라 밝게' },
    { background: 'light', theme: 'dark', expected: '#ffffff', note: '어두운 테마에서도 순백' },
    { background: 'dark', theme: 'light', expected: '#1f1f1f', note: '밝은 테마에서도 어둡게' },
  ];

  for (const c of CASES) {
    test(`background=${c.background} + theme=${c.theme} → ${c.expected} (${c.note})`, async ({
      page,
    }) => {
      await page.goto(`/?fixture=cube.glb&background=${c.background}&theme=${c.theme}`);
      expect(await waitForViewer(page)).toBe('ready');
      expect(await bodyBackground(page)).toBe(c.expected);
    });
  }
});

test.describe('배경 드롭다운', () => {
  test('세 모드를 순서대로 내고 현재 값이 선택되어 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb&background=dark&theme=light');
    expect(await waitForViewer(page)).toBe('ready');

    const select = page.locator('#background-select');
    await expect(select.locator('option')).toHaveText(['Theme', 'Light', 'Dark']);
    await expect(select).toHaveValue('dark');
  });

  test('드롭다운을 바꾸면 배경이 즉시 바뀌고 호스트에 알린다 — 호스트가 전역 설정에 저장한다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb&background=theme&theme=dark');
    expect(await waitForViewer(page)).toBe('ready');
    const messages = await collectHostMessages(page);

    await page.locator('#background-select').selectOption('light');

    await expect(page.locator('#root')).toHaveAttribute('data-background', 'light');
    expect(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ).toBe('rgb(255, 255, 255)');
    expect(await messages()).toContainEqual({ type: 'backgroundChanged', background: 'light' });
  });
  test('호스트가 설정 변경을 알리면 배경과 드롭다운이 함께 따라온다 — 나란히 열린 다른 탭이 이 경로로 갱신된다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb&background=theme&theme=dark');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#background-select')).toHaveValue('theme');

    await sendHostMessage(page, { type: 'setBackground', background: 'light' });

    await expect(page.locator('#root')).toHaveAttribute('data-background', 'light');
    await expect(page.locator('#background-select')).toHaveValue('light');
    expect(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ).toBe('rgb(255, 255, 255)');
  });
});

test.describe('그리드 설정', () => {
  test('설정이 꺼져 있으면 체크박스도 꺼진 채 시작한다 — 초기값의 출처가 전역 설정이다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb&grid=false');
    expect(await waitForViewer(page)).toBe('ready');

    await expect(page.locator('#toggle-grid')).not.toBeChecked();
  });

  test('체크박스를 끄면 호스트에 알린다 — 호스트가 전역 설정에 저장한다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#toggle-grid')).toBeChecked();
    const messages = await collectHostMessages(page);

    await page.locator('#toggle-grid').click();

    expect(await messages()).toContainEqual({ type: 'gridChanged', grid: false });
  });

  test('호스트가 설정 변경을 알리면 체크박스가 따라오고 유휴였어도 다시 그린다 — 나란히 열린 다른 탭이 이 경로로 갱신된다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page), '유휴로 들어가지 않았다').toBe(true);
    const idleCount = await renderCount(page);

    await sendHostMessage(page, { type: 'setGrid', grid: false });

    await expect(page.locator('#toggle-grid')).not.toBeChecked();
    await page.waitForTimeout(300);
    expect(
      await renderCount(page),
      '호스트가 그리드를 껐는데 화면이 갱신되지 않았다 — markDirty 누락',
    ).toBeGreaterThan(idleCount);
  });
});

test.describe('측정 모드 패널 토글', () => {
  test('패널 체크박스로 측정 모드를 켤 수 있고 호스트에 알린다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#toggle-measure')).not.toBeChecked();
    const messages = await collectHostMessages(page);

    await page.locator('#toggle-measure').check();

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    expect(await messages()).toContainEqual({ type: 'measureModeState', active: true });
  });

  test('제목 표시줄 경로로 켜도 체크박스가 따라온다 — 두 진입점이 어긋나면 토글 방향이 뒤집힌다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    await expect(page.locator('#toggle-measure')).toBeChecked();

    await sendHostMessage(page, { type: 'setMeasureMode', active: false });

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'off');
    await expect(page.locator('#toggle-measure')).not.toBeChecked();
  });

  test('복원 시 체크박스가 따라오고 호스트에 다시 알린다 — 알리지 않으면 다음 아이콘 클릭이 먹히지 않는다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await page.locator('#toggle-measure').check();
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    // 복원 통보는 로드 중에 일어나므로 싱크를 문서 생성 전에 심어야 한다 —
    // collectHostMessages 는 로드 후에 붙으므로 이 경로를 볼 수 없다.
    await page.addInitScript(() => {
      const sink: unknown[] = [];
      (window as unknown as { __hostMessages: unknown[] }).__hostMessages = sink;
      window.addEventListener('uat:tohost', (event) =>
        sink.push((event as CustomEvent).detail),
      );
    });

    await page.reload();
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-restored', 'yes');

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    await expect(page.locator('#toggle-measure')).toBeChecked();
    expect(
      await page.evaluate(
        () => (window as unknown as { __hostMessages: unknown[] }).__hostMessages,
      ),
      '복원이 호스트에 알리지 않으면 session.measureActive 가 false 로 남아 아이콘이 한 번 먹히지 않는다',
    ).toContainEqual({ type: 'measureModeState', active: true });
  });
});
