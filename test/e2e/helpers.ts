import type { Page, Request } from '@playwright/test';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 뷰어가 로드를 끝낼 때까지 기다린다. `error` 면 그대로 돌려주므로 호출부가 판단한다. */
export async function waitForViewer(page: Page): Promise<'ready' | 'error'> {
  const state = await page
    .locator('#root[data-state]')
    .getAttribute('data-state', { timeout: 60_000 });
  return state === 'error' ? 'error' : 'ready';
}

export async function extents(page: Page): Promise<[number, number, number]> {
  const raw = await page.locator('#root').getAttribute('data-extents');
  return JSON.parse(raw ?? '[]') as [number, number, number];
}

/**
 * 캔버스를 훑어 "정점 → 그 정점으로 스냅되는 대표 픽셀" 맵을 만든다.
 *
 * 카메라 방향을 가정하지 않기 위한 장치다. 각 정점의 대표 픽셀은 **모델의 화면 중심에 가장
 * 가까운** 것으로 고른다 — 실루엣 경계를 피해 면 안쪽을 찍게 하려는 것이다(경계를 찍으면
 * 광선이 모델을 비켜 갈 수 있다).
 */
export async function vertexTargets(
  page: Page,
  step = 4,
): Promise<{ vertex: Point3; screen: { x: number; y: number } }[]> {
  return page.evaluate((gridStep: number) => {
    const seam = (window as unknown as { __modelLens: { probeAt: (x: number, y: number) => Point3 | undefined } })
      .__modelLens;
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();

    const hits: { x: number; y: number; v: Point3 }[] = [];
    for (let y = gridStep; y < rect.height; y += gridStep) {
      for (let x = gridStep; x < rect.width; x += gridStep) {
        const v = seam.probeAt(x, y);
        if (v) {
          hits.push({ x, y, v });
        }
      }
    }
    if (hits.length === 0) {
      return [];
    }
    const cx = hits.reduce((a, h) => a + h.x, 0) / hits.length;
    const cy = hits.reduce((a, h) => a + h.y, 0) / hits.length;

    const best = new Map<string, { d: number; x: number; y: number; v: Point3 }>();
    for (const h of hits) {
      const key = `${Math.round(h.v.x)},${Math.round(h.v.y)},${Math.round(h.v.z)}`;
      const d = Math.hypot(h.x - cx, h.y - cy);
      const prev = best.get(key);
      if (!prev || d < prev.d) {
        best.set(key, { d, x: h.x, y: h.y, v: h.v });
      }
    }
    return [...best.values()].map((b) => ({ vertex: b.v, screen: { x: b.x, y: b.y } }));
  }, step);
}

/** 축에 평행하고 길이가 `gap` 인 정점 쌍을 찾는다. */
export function axisPair(
  targets: { vertex: Point3; screen: { x: number; y: number } }[],
  axis: 'x' | 'y' | 'z',
  gap: number,
): [(typeof targets)[number], (typeof targets)[number]] | undefined {
  const others = (['x', 'y', 'z'] as const).filter((k) => k !== axis);
  for (const a of targets) {
    for (const b of targets) {
      const delta = {
        x: Math.abs(a.vertex.x - b.vertex.x),
        y: Math.abs(a.vertex.y - b.vertex.y),
        z: Math.abs(a.vertex.z - b.vertex.z),
      };
      if (Math.abs(delta[axis] - gap) < 0.01 && others.every((k) => delta[k] < 0.01)) {
        return [a, b];
      }
    }
  }
  return undefined;
}

/** 확장 호스트가 보내는 것과 동일한 메시지. */
export async function sendHostMessage(page: Page, message: unknown): Promise<void> {
  await page.evaluate((m) => window.postMessage(m, '*'), message);
}

export async function renderCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __modelLens: { renderCount: () => number } }).__modelLens.renderCount(),
  );
}

/**
 * 렌더 가능한 상태인 메시 수 / 전체 메시 수.
 *
 * 빈 화면 회귀의 **근본 원인을 직접 본다**: 머티리얼의 셰이더가 준비되지 않은 메시는
 * `Mesh.render()` 가 아무것도 그리지 않고 빠져나간다. 유휴에 들어간 시점에 이 둘이 다르면
 * 사용자는 빈 캔버스를 보고 있다는 뜻이다.
 */
export async function readyMeshes(page: Page): Promise<{ ready: number; total: number }> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __modelLens: { readyMeshes: () => { ready: number; total: number } };
        }
      ).__modelLens.readyMeshes(),
  );
}

export async function isIdle(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __modelLens: { isIdle: () => boolean } }).__modelLens.isIdle(),
  );
}

/** 렌더가 멈출 때까지 기다린다. 멈추지 않으면 false. */
export async function waitForIdle(page: Page, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isIdle(page)) {
      return true;
    }
    await page.waitForTimeout(150);
  }
  return false;
}

/**
 * 콘솔의 경고·에러를 모은다.
 *
 * Babylon 9 는 side-effect import 가 빠지면 **예외 없이 조용히 무력화되고 `Logger.Warn` 만 찍는다**
 * (파트 4/4 에서 `scene.pick` 이 그렇게 빈 결과를 돌려주며 시간을 잡아먹었다). 그래서 렌더링을
 * 건드리는 테스트는 콘솔을 함께 본다.
 */
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** 같은 오리진이 아닌 요청만 모은다 — "외부 네트워크 의존 0건" 불변식의 증거. */
export function collectExternalRequests(page: Page, origin: string): string[] {
  const external: string[] = [];
  page.on('request', (request: Request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      external.push(url);
    }
  });
  return external;
}
