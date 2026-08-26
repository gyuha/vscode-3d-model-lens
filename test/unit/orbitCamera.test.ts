import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import { OrbitCamera } from '../../src/webview/orbitCamera';
import type { Extents } from '../../src/webview/geometry';

const EXTENTS: Extents = {
  min: new Vector3(-5, -10, -15),
  max: new Vector3(5, 10, 15),
};

const INPUT = 0.1; // rad — 5.73°
const deg = (rad: number): string => ((rad * 180) / Math.PI).toFixed(2) + '°';
const angle = (a: Vector3, b: Vector3): number =>
  Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a, b))));

/**
 * **화면 기준 회전의 불변식.**
 *
 * 정의: 좌우 입력 `θ` 는 **시선 방향을 `θ` 만큼 바꾸고 화면의 up 은 그대로 둔다.**
 *
 * `ArcRotateCamera` 는 이 불변식을 만족하지 못한다 — 좌우 회전이 월드 Y 축 기준이라
 * 카메라가 기울어질수록 입력이 시선을 못 움직이고 화면만 돈다.
 * 실측(입력 `5.73°`): `beta=90°` → 방향 `5.73°`/롤 `0.00°` · `beta=34°` → `3.23°`/`4.73°` ·
 * `beta=11.5°` → `1.14°`/`5.62°`. 관계식은 방향 ≈ `θ·sin β`, 롤 ≈ `θ·cos β` 이고
 * 교차점이 `beta = 45°` 다 — 그 아래부터 롤이 이긴다. (ADR `260826-232902`)
 *
 * **기울어진 자세에서 재는 것이 이 테스트의 전부다.** 수평 자세(`beta=90°`)에서는 두 방식이
 * 우연히 일치하므로, 그것만 재면 고치기 전에도 통과한다.
 */
describe('OrbitCamera — 화면 기준 회전 불변식', () => {
  // `frame()` 의 기본 시작 자세(기존 ArcRotateCamera 의 beta = 72° 와 같은 방향)에서
  // **추가로** 얼마나 위로 기울이는지. 클수록 위에서 내려다본다.
  const TILTS = [
    { label: '기본 시작 자세', tilt: 0 },
    { label: '거기서 18° 더', tilt: 0.314 },
    { label: '거기서 56° 더', tilt: 0.977 },
    { label: '거기서 79° 더 (극점을 지난다)', tilt: 1.371 },
  ];

  for (const { label, tilt } of TILTS) {
    it(`${label} — 좌우 입력이 시선을 입력만큼 돌리고 화면 up 을 유지한다`, () => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      try {
        const orbit = new OrbitCamera(scene);
        orbit.applyLimits(EXTENTS);
        orbit.frame(EXTENTS);
        // 위에서 내려다보는 자세를 만든다 — 상하 회전은 이미 화면 기준이므로 이걸로 기울인다.
        orbit.rotate(0, tilt);

        const forwardBefore = orbit.forward.clone();
        const upBefore = orbit.up.clone();

        orbit.rotate(INPUT, 0);

        const turned = angle(forwardBefore, orbit.forward);
        const rolled = angle(upBefore, orbit.up);

        expect(
          turned,
          `시선이 입력만큼 돌지 않았다 — 입력 ${deg(INPUT)}, 실제 ${deg(turned)} (롤 ${deg(rolled)})`,
        ).toBeCloseTo(INPUT, 3);
        expect(
          rolled,
          `화면이 롤했다 — ${deg(rolled)} (시선 변화 ${deg(turned)}). 좌우 회전이 월드 축 기준이면 이렇게 된다`,
        ).toBeCloseTo(0, 3);
      } finally {
        scene.dispose();
        engine.dispose();
      }
    });
  }

  it('상하 입력도 화면 기준이다 — 시선이 입력만큼 돌고 화면 up 이 그 평면 안에 머문다', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const orbit = new OrbitCamera(scene);
      orbit.applyLimits(EXTENTS);
      orbit.frame(EXTENTS);

      const forwardBefore = orbit.forward.clone();
      const rightBefore = orbit.right.clone();

      orbit.rotate(0, INPUT);

      expect(angle(forwardBefore, orbit.forward)).toBeCloseTo(INPUT, 3);
      // 화면 수평축은 상하 회전의 축이므로 그대로여야 한다.
      expect(angle(rightBefore, orbit.right)).toBeCloseTo(0, 3);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
