import type { HostToWebview, WebviewToHost } from '../messages.js';
import { formatLength, isUnitSetting, resolveUnit, type UnitSetting } from '../units.js';
import type { Chrome } from './chrome.js';
import { extentSizes } from './geometry.js';
import type { MeasurementTool } from './measurement.js';
import { createViewer, type Viewer, type ViewerConfig } from './viewer.js';
import {
  restoreViewerState,
  serializeViewerState,
  type RestorableViewerState,
} from './viewerState.js';

const root = requireElement<HTMLDivElement>('root');
const canvas = requireElement<HTMLCanvasElement>('canvas');
const panel = requireElement<HTMLDivElement>('panel');
const loading = requireElement<HTMLDivElement>('loading');
const errorBox = requireElement<HTMLDivElement>('error');
const labelHost = requireElement<HTMLDivElement>('labels');

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

function post(message: WebviewToHost): void {
  host?.postMessage(message);
}

/** 카메라는 드래그 도중 매 프레임 바뀌므로 저장을 디바운스한다. */
const SAVE_DEBOUNCE_MS = 400;
/** 디바운스가 무한히 밀리지 않도록 두는 상한. */
const MAX_SAVE_INTERVAL_MS = 2000;

const config = readConfig(root);

/**
 * 탭 전환에서 복원된 상태.
 *
 * 배경 탭의 웹뷰는 파괴되므로 이 스크립트는 탭을 볼 때마다 처음부터 다시 실행된다.
 * `getState()` 는 그 사이클을 넘어 살아남는 유일한 채널이다 (ADR `260822-145808`).
 * 복원은 절대 던지지 않는다 — 모양이 이상하면 그 부분만 버린다.
 */
const restored = restoreViewerState(host?.getState());

if (restored) {
  // 토글은 뷰어를 만들기 전에 DOM 에 반영해 둔다 — wirePanel 이 현재 checked 상태를 적용한다.
  setChecked('toggle-grid', restored.toggles.grid);
  setChecked('toggle-axes', restored.toggles.axes);
  setChecked('toggle-wireframe', restored.toggles.wireframe);
  setChecked('toggle-snap', restored.toggles.snap);
}

if (config.backgroundColor) {
  // 사용자가 배경색을 지정한 경우에만 덮어쓴다. 기본값은 CSS 의 테마 변수를 그대로 둔다.
  document.body.style.background = config.backgroundColor;
}

void boot();

async function boot(): Promise<void> {
  try {
    const viewer = await createViewer(canvas, labelHost, config, restored?.camera ?? null, (ratio) => {
      loading.textContent =
        ratio === undefined
          ? '모델을 불러오는 중…'
          : `모델을 불러오는 중… ${Math.round(ratio * 100)}%`;
    });

    loading.hidden = true;
    panel.hidden = false;
    wirePanel(viewer.chrome, viewer);

    // 뷰어 상태를 DOM 에 노출한다 — 자동 검증(헤드리스 렌더 테스트)이 붙을 지점이고,
    // 파트 3/4 의 치수·측정 단정도 여기를 읽는다.
    const sizes = extentSizes(viewer.extents);
    wireUnits(sizes, viewer.measure);
    wireMeasurePanel(viewer.measure, viewer);
    wireAnimationPanel(viewer);

    root.dataset.state = 'ready';
    root.dataset.meshCount = String(viewer.meshes.length);
    root.dataset.extents = JSON.stringify(sizes);
    root.dataset.inspector = 'off';

    if (restored) {
      if (restored.animation && viewer.animations.available) {
        viewer.animations.select(restored.animation.selection);
        if (restored.animation.playing) {
          viewer.animations.play();
        } else {
          viewer.animations.pause();
        }
      }
      viewer.measure.restore(
        restored.measurements.map((m) => ({
          a: { x: m.a[0], y: m.a[1], z: m.a[2] },
          b: { x: m.b[0], y: m.b[1], z: m.b[2] },
        })),
        restored.selectedIndex,
      );
      viewer.setMeasureMode(restored.measureMode);
    }
    root.dataset.restored = restored ? 'yes' : 'no';

    wireHostMessages(viewer);
    wireStatePersistence(viewer);
    exposeTestSeam(viewer);
    post({ type: 'ready' });
    window.addEventListener('unload', () => viewer.dispose(), { once: true });
  } catch (error) {
    showError(error);
  }
}

function wirePanel(chrome: Chrome, viewer: Viewer): void {
  // 표시가 바뀌면 다시 그려야 한다 — 유휴 상태였다면 화면이 갱신되지 않는다.
  bindCheckbox('toggle-grid', (on) => {
    chrome.setGridVisible(on);
    viewer.markDirty();
  });
  bindCheckbox('toggle-axes', (on) => {
    chrome.setAxesVisible(on);
    viewer.markDirty();
  });
  bindCheckbox('toggle-wireframe', (on) => {
    chrome.setWireframe(on);
    viewer.markDirty();
  });

  // Inspector 는 꺼진 채로 시작하므로 `bindCheckbox` 의 초기 apply 를 쓰지 않는다.
  requireElement<HTMLInputElement>('toggle-inspector').addEventListener('change', (event) => {
    applyInspector(viewer, (event.target as HTMLInputElement).checked);
  });
}

/**
 * 치수 표시와 단위 드롭다운.
 *
 * 축은 `X / Y / Z` 로만 표기한다 — glTF 로더의 좌표계 변환과 STL 의 Z-up 관행 때문에
 * "가로/높이/깊이"로 부르면 절반은 틀린다 (ADR 260822-115455c).
 */
function wireUnits(
  sizes: readonly [number, number, number],
  measure: MeasurementTool,
): void {
  const select = requireElement<HTMLSelectElement>('unit');
  const cells = (['x', 'y', 'z'] as const).map((axis) =>
    requireElement<HTMLSpanElement>(`dim-${axis}`),
  );

  const render = (setting: UnitSetting): void => {
    const unit = resolveUnit(config.pluginExtension, setting);
    cells.forEach((cell, axis) => {
      cell.textContent = formatLength(sizes[axis], unit, config.decimals);
    });
    // 이미 만든 측정의 라벨도 함께 갱신한다.
    measure.setUnit(unit, config.decimals);
    root.dataset.unit = unit;
  };

  select.value = config.unitSetting;
  render(config.unitSetting);

  select.addEventListener('change', () => {
    if (!isUnitSetting(select.value)) {
      return;
    }
    render(select.value);
    // 호스트가 파일별로 기억한다.
    post({ type: 'unitChanged', unit: select.value });
  });
}

/**
 * 상태를 `setState` 에 저장한다.
 *
 * 카메라는 드래그 도중 매 프레임 바뀌므로 그대로 저장하면 초당 60번 쓴다. 그래서 디바운스하고,
 * 탭이 숨겨지는 순간(`pagehide`/`visibilitychange`)에는 즉시 비운다 — 디바운스가 끝나기 전에
 * 웹뷰가 파괴되면 그 사이의 변경이 사라지기 때문이다.
 */
function wireStatePersistence(viewer: Viewer): void {
  if (!host) {
    return;
  }
  let timer: number | undefined;
  let lastFlush = 0;

  const collect = (): RestorableViewerState => ({
    camera: viewer.cameraState(),
    measurements: viewer.measure.snapshot().map((m) => ({
      a: [m.a.x, m.a.y, m.a.z],
      b: [m.b.x, m.b.y, m.b.z],
    })),
    selectedIndex: viewer.measure.selectedIndex,
    measureMode: viewer.measure.isActive,
    animation: viewer.animations.available
      ? { playing: viewer.animations.isPlaying, selection: viewer.animations.selection }
      : null,
    toggles: {
      grid: isChecked('toggle-grid'),
      axes: isChecked('toggle-axes'),
      wireframe: isChecked('toggle-wireframe'),
      snap: isChecked('toggle-snap'),
    },
  });

  const flush = (): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    lastFlush = Date.now();
    host?.setState(serializeViewerState(collect()));
  };

  const schedule = (): void => {
    // 최대 대기 시간을 둔다. 그냥 디바운스만 하면 Inspector 가 켜져 연속 렌더링하는 동안
    // 타이머가 계속 밀려 저장이 영원히 일어나지 않는다.
    if (Date.now() - lastFlush > MAX_SAVE_INTERVAL_MS) {
      flush();
      return;
    }
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  viewer.scene.onAfterRenderObservable.add(() => schedule());
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
  // 최초 상태를 한 번 남긴다 — 복원 직후 아무 조작 없이 탭을 옮겨도 유지되게.
  flush();
}

function setChecked(id: string, checked: boolean): void {
  requireElement<HTMLInputElement>(id).checked = checked;
}

function isChecked(id: string): boolean {
  return requireElement<HTMLInputElement>(id).checked;
}

/**
 * 브라우저에서의 자동 검증이 붙는 **좁은 이음매**.
 *
 * 노출하는 것은 좌표 변환 하나뿐이다 — 테스트가 "이 정점이 화면 어디에 있나"를 알아야
 * **실제 포인터 이벤트**로 클릭할 수 있기 때문이다. 측정 자체를 호출하는 API 는 노출하지
 * 않는다. 그러면 상호작용을 우회해 버려서 검증의 의미가 없어진다.
 *
 * `npm run uat` 의 수동 확인과 후속 작업(playwright-webview-render-tests)이 이걸 쓴다.
 */
function exposeTestSeam(viewer: Viewer): void {
  (window as unknown as Record<string, unknown>).__modelLens = {
    projectToScreen: viewer.projectToScreen,
    extents: extentSizes(viewer.extents),
    // 읽기 전용 질의 — 측정을 만들지 않는다. measurement.ts 의 probeAt 주석 참조.
    probeAt: (x: number, y: number) => viewer.measure.probeAt(x, y),
    // 유휴 렌더 중단을 검증하는 관측점. 렌더를 유발하는 API 는 노출하지 않는다.
    renderCount: () => viewer.renderCount(),
    isIdle: () => viewer.isIdle(),
    // 빈 화면 회귀의 관측점 — 유휴인데 렌더되지 않는 메시가 남아 있으면 화면이 비어 있다.
    readyMeshes: () => viewer.readyMeshes(),
  };
}

/** 측정 목록 · 정점 스냅 토글 · 전체 삭제. */
function wireMeasurePanel(measure: MeasurementTool, viewer: Viewer): void {
  const list = requireElement<HTMLDivElement>('measure-list');
  const state = requireElement<HTMLSpanElement>('measure-state');
  const clear = requireElement<HTMLButtonElement>('measure-clear');

  bindCheckbox('toggle-snap', (on) => measure.setSnap(on));
  clear.addEventListener('click', () => measure.clear());

  measure.onChange = (): void => {
    // 측정이 추가·삭제·선택되면 선·마커가 바뀌므로 다시 그린다.
    viewer.markDirty();
    state.textContent = measure.isActive ? '측정 켜짐 — 두 점을 찍으세요' : '측정 꺼짐';
    root.dataset.measure = measure.isActive ? 'on' : 'off';
    root.dataset.measureCount = String(measure.list.length);

    list.replaceChildren(
      ...measure.list.map((measurement) => {
        const row = document.createElement('div');
        row.className = measurement.id === measure.selected ? 'row selected' : 'row';

        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'pick';
        pick.textContent = measure.labelFor(measurement);
        pick.title = '선택';
        pick.addEventListener('click', () =>
          measure.select(measurement.id === measure.selected ? undefined : measurement.id),
        );

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '✕';
        remove.title = '삭제';
        remove.addEventListener('click', () => measure.remove(measurement.id));

        row.append(pick, remove);
        return row;
      }),
    );
  };
  measure.onChange();
}

/**
 * 애니메이션 재생 컨트롤.
 *
 * 그룹 이름은 파일에서 오므로 항목을 런타임에 채운다. 그룹이 없는 파일(STL, 정적 glTF)에서는
 * 섹션 자체를 숨긴 채로 둔다.
 */
function wireAnimationPanel(viewer: Viewer): void {
  const row = requireElement<HTMLDivElement>('animation-row');
  const separator = requireElement<HTMLHRElement>('animation-sep');
  const toggle = requireElement<HTMLButtonElement>('animation-toggle');
  const select = requireElement<HTMLSelectElement>('animation-select');
  const { animations } = viewer;

  if (!animations.available) {
    root.dataset.animation = 'none';
    return;
  }

  select.replaceChildren(
    ...['전체', ...animations.names].map((label, index) => {
      const option = document.createElement('option');
      // 첫 항목이 '전체'이므로 그룹 인덱스는 하나씩 밀린다.
      option.value = index === 0 ? 'all' : String(index - 1);
      option.textContent = label;
      return option;
    }),
  );

  toggle.addEventListener('click', () =>
    animations.isPlaying ? animations.pause() : animations.play(),
  );
  select.addEventListener('change', () =>
    animations.select(select.value === 'all' ? 'all' : Number(select.value)),
  );

  animations.onChange = (): void => {
    toggle.textContent = animations.isPlaying ? '일시정지' : '재생';
    select.value = animations.selection === 'all' ? 'all' : String(animations.selection);
    root.dataset.animation = animations.isPlaying ? 'playing' : 'paused';
    // 일시정지 직후의 정리 렌더. 재생 중에는 렌더 루프가 알아서 계속 그린다.
    viewer.markDirty();
  };
  animations.onChange();

  row.hidden = false;
  separator.hidden = false;
}

/** 확장 호스트의 명령(제목 표시줄 아이콘 · 명령 팔레트)을 받는다. */
function wireHostMessages(viewer: Viewer): void {
  window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
    const message = event.data;
    if (message?.type === 'setMeasureMode') {
      viewer.setMeasureMode(message.active);
      post({ type: 'measureModeState', active: message.active });
      return;
    }
    if (message?.type !== 'setInspector') {
      return;
    }
    applyInspector(viewer, message.visible);
  });
}

/**
 * Inspector 를 켜고 끈다 — 제목 표시줄 아이콘과 패널 체크박스의 **공통 경로**.
 *
 * 둘로 나뉘면 한쪽으로 켠 상태를 다른 쪽이 모른다. 특히 호스트는 `inspectorState` 로만
 * 현재 상태를 아는데, 그게 어긋나면 다음 아이콘 클릭의 토글 방향이 뒤집힌다.
 */
function applyInspector(viewer: Viewer, visible: boolean): void {
  const checkbox = requireElement<HTMLInputElement>('toggle-inspector');
  checkbox.checked = visible;
  // chunk 가 수 MB 라 켜는 데 시간이 걸린다. 그동안 중복 클릭을 막는다.
  checkbox.disabled = true;

  // Inspector 는 fps 카운터와 기즈모가 렌더 루프에 의존하므로, 켜진 동안은
  // 유휴 판정을 끄고 연속으로 그린다. 켜지 않으면 0 fps 로 보여 고장난 것처럼 된다.
  viewer.setContinuousRendering(visible);
  void viewer
    .setInspector(visible)
    .then(() => {
      root.dataset.inspector = visible ? 'on' : 'off';
      post({ type: 'inspectorState', visible });
    })
    .catch((error: unknown) => {
      root.dataset.inspector = 'off';
      checkbox.checked = false;
      viewer.setContinuousRendering(false);
      post({ type: 'inspectorFailed', message: describeError(error) });
      console.error('[3D Model Lens] Inspector 실패', error);
    })
    .finally(() => {
      checkbox.disabled = false;
    });
}

function bindCheckbox(id: string, apply: (on: boolean) => void): void {
  const input = requireElement<HTMLInputElement>(id);
  apply(input.checked);
  input.addEventListener('change', () => apply(input.checked));
}

/**
 * 로드 실패를 빈 검은 화면으로 남기지 않는다 — 파일명과 원인을 표시한다.
 * 참고 레포의 "빈 화면" FAQ 가 정확히 이걸 안 해서 생긴 문제다.
 */
function showError(error: unknown): void {
  root.dataset.state = 'error';
  loading.hidden = true;
  panel.hidden = true;
  errorBox.hidden = false;
  const name = errorBox.querySelector<HTMLDivElement>('.name');
  const message = errorBox.querySelector<HTMLDivElement>('.message');
  if (name) {
    name.textContent = `${config.fileName} 을(를) 열 수 없습니다`;
  }
  if (message) {
    message.textContent = describeError(error);
  }
  console.error('[3D Model Lens] 모델 로드 실패', error);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function readConfig(element: HTMLElement): ViewerConfig {
  const raw = element.dataset.config;
  if (!raw) {
    throw new Error('뷰어 설정(data-config)이 없습니다.');
  }
  return JSON.parse(raw) as ViewerConfig;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`필수 요소를 찾을 수 없습니다: #${id}`);
  }
  return element as T;
}
