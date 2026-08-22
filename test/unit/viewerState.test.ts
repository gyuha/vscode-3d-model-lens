import { describe, expect, it } from 'vitest';
import {
  VIEWER_STATE_VERSION,
  restoreViewerState,
  serializeViewerState,
  type RestorableViewerState,
} from '../../src/webview/viewerState';

const sample: RestorableViewerState = {
  camera: { alpha: 1.25, beta: 0.5, radius: 42, target: [1, 2, 3] },
  measurements: [
    { a: [-5, -10, -15], b: [5, -10, -15] },
    { a: [0, 0, 0], b: [1, 1, 1] },
  ],
  selectedIndex: 1,
  measureMode: true,
  toggles: { snap: false },
  animation: { playing: false, selection: 1 },
};

describe('serializeViewerState / restoreViewerState', () => {
  it('왕복하면 그대로 돌아온다', () => {
    const round = restoreViewerState(JSON.parse(JSON.stringify(serializeViewerState(sample))));
    expect(round).toEqual(sample);
  });

  it('직렬화 결과에 버전이 붙는다', () => {
    expect(serializeViewerState(sample).version).toBe(VIEWER_STATE_VERSION);
  });

  it('측정 길이는 저장하지 않는다 — 좌표에서 다시 계산한다', () => {
    const raw = JSON.stringify(serializeViewerState(sample));
    expect(raw).not.toMatch(/length/);
  });
});

describe('restoreViewerState — 애니메이션', () => {
  const withAnimation = (animation: unknown): unknown => ({
    ...serializeViewerState(sample),
    animation,
  });

  it('전체 선택을 왕복시킨다', () => {
    const state: RestorableViewerState = {
      ...sample,
      animation: { playing: true, selection: 'all' },
    };
    expect(restoreViewerState(JSON.parse(JSON.stringify(serializeViewerState(state))))).toEqual(
      state,
    );
  });

  it('애니메이션 필드가 없는 예전 상태도 나머지를 살려 복원한다 — 버전을 올리지 않았다', () => {
    const legacy = { ...serializeViewerState(sample) } as unknown as Record<string, unknown>;
    delete legacy.animation;
    const restored = restoreViewerState(legacy);
    expect(restored?.animation).toBeNull();
    expect(restored?.camera).toEqual(sample.camera);
    expect(restored?.measurements).toEqual(sample.measurements);
  });

  it('재생 여부를 알 수 없으면 통째로 버린다 — 이 상태의 핵심이다', () => {
    for (const bad of [null, 42, 'all', [], { selection: 0 }, { playing: 'yes' }]) {
      expect(restoreViewerState(withAnimation(bad))?.animation, JSON.stringify(bad)).toBeNull();
    }
  });

  it('선택만 이상하면 재생 여부는 살리고 전체로 떨어뜨린다 — 다른 파일에서 온 상태일 수 있다', () => {
    for (const bad of [-1, 1.5, Number.NaN, '0', undefined]) {
      expect(
        restoreViewerState(withAnimation({ playing: true, selection: bad }))?.animation,
        String(bad),
      ).toEqual({ playing: true, selection: 'all' });
    }
  });
});

describe('restoreViewerState — 깨진 입력 방어', () => {
  it('없거나 객체가 아니면 복원할 것이 없다고 답한다', () => {
    for (const bad of [undefined, null, 0, 42, 'state', true, [], () => {}]) {
      expect(restoreViewerState(bad), String(bad)).toBeUndefined();
    }
  });

  it('버전이 다르면 버린다 — 확장 업데이트 후 이전 모양이 남아 있는 경우', () => {
    const older = { ...serializeViewerState(sample), version: VIEWER_STATE_VERSION - 1 };
    expect(restoreViewerState(older)).toBeUndefined();
    const newer = { ...serializeViewerState(sample), version: VIEWER_STATE_VERSION + 1 };
    expect(restoreViewerState(newer)).toBeUndefined();
    expect(restoreViewerState({ ...serializeViewerState(sample), version: 'one' })).toBeUndefined();
  });

  it('카메라에 유한하지 않은 값이 있으면 카메라만 버리고 나머지는 살린다', () => {
    const broken = {
      ...serializeViewerState(sample),
      camera: { alpha: Number.NaN, beta: 0.5, radius: 42, target: [1, 2, 3] },
    };
    const restored = restoreViewerState(broken);
    expect(restored?.camera).toBeNull();
    expect(restored?.measurements).toHaveLength(2);
  });

  it('카메라 target 이 3개 숫자가 아니면 카메라를 버린다', () => {
    for (const target of [[1, 2], [1, 2, 3, 4], ['a', 'b', 'c'], null, undefined, 5]) {
      const broken = { ...serializeViewerState(sample), camera: { alpha: 1, beta: 1, radius: 1, target } };
      expect(restoreViewerState(broken)?.camera, JSON.stringify(target)).toBeNull();
    }
  });

  it('모양이 깨진 측정만 골라 버린다 — 나머지는 살린다', () => {
    const broken = {
      ...serializeViewerState(sample),
      measurements: [
        { a: [0, 0, 0], b: [1, 1, 1] },
        { a: [0, 0, 0] },
        { a: [0, 0, 0], b: [Number.POSITIVE_INFINITY, 1, 1] },
        { a: [0, 0], b: [1, 1, 1] },
        'nope',
        null,
        { a: [2, 2, 2], b: [3, 3, 3] },
      ],
    };
    const restored = restoreViewerState(broken);
    expect(restored?.measurements).toEqual([
      { a: [0, 0, 0], b: [1, 1, 1] },
      { a: [2, 2, 2], b: [3, 3, 3] },
    ]);
  });

  it('measurements 자체가 배열이 아니면 빈 목록으로 본다', () => {
    const broken = { ...serializeViewerState(sample), measurements: 'many' };
    expect(restoreViewerState(broken)?.measurements).toEqual([]);
  });

  it('선택 인덱스가 범위를 벗어나면 선택 없음으로 만든다', () => {
    for (const index of [2, 99, -1, 1.5, 'one', null, undefined]) {
      const broken = { ...serializeViewerState(sample), selectedIndex: index };
      expect(restoreViewerState(broken)?.selectedIndex, String(index)).toBeNull();
    }
  });

  it('측정이 걸러져 줄어들면 선택 인덱스도 함께 무효화된다', () => {
    const broken = {
      ...serializeViewerState(sample),
      measurements: [{ a: [0, 0, 0], b: [1, 1, 1] }, 'nope'],
      selectedIndex: 1,
    };
    expect(restoreViewerState(broken)?.selectedIndex).toBeNull();
  });

  it('토글이나 measureMode 가 불리언이 아니면 기본값으로 떨어진다', () => {
    const broken = {
      ...serializeViewerState(sample),
      measureMode: 'yes',
      toggles: { snap: null },
    };
    const restored = restoreViewerState(broken);
    expect(restored?.measureMode).toBe(false);
    expect(restored?.toggles).toEqual({ snap: true });
  });

  it('toggles 가 아예 없어도 기본값으로 복원된다', () => {
    const broken = { ...serializeViewerState(sample) } as Record<string, unknown>;
    delete broken.toggles;
    expect(restoreViewerState(broken)?.toggles).toEqual({
      snap: true,
    });
  });
});
