/**
 * 탭 전환 사이에 살아남아야 하는 뷰어 상태.
 *
 * 배경 탭의 웹뷰는 파괴되고 되돌아오면 처음부터 다시 만들어진다 — 메모리를 위해 받아들인
 * 설계이며, 그 대가로 측정·카메라·토글이 사라진다. 그것을 여기서 저장·복원한다
 * (ADR `260822-145808`).
 *
 * **복원은 절대 던지지 않는다.** `setState` 에는 이전 버전의 확장이 남긴 다른 모양의 객체가
 * 들어 있을 수 있고, 그때 뷰어가 죽으면 사용자는 모델을 아예 볼 수 없게 된다. 모양이
 * 이상하면 그 부분만 버리고 나머지를 살린다.
 *
 * 단위는 여기에 넣지 않는다 — 이미 호스트의 `workspaceState` 에 파일별로 저장된다
 * (ADR `260822-115455c`). Inspector 상태도 넣지 않는다 — 복원하면 탭 전환마다 무거운
 * chunk 를 다시 파싱해 이 설계의 목적과 충돌한다.
 */

export const VIEWER_STATE_VERSION = 1;

export type Triple = [number, number, number];

export interface CameraState {
  alpha: number;
  beta: number;
  radius: number;
  target: Triple;
}

/** 길이는 저장하지 않는다 — 좌표에서 다시 계산한다. */
export interface MeasurementState {
  a: Triple;
  b: Triple;
}

/**
 * 재생 상태와 선택한 그룹. 그룹이 없는 파일에서는 `null` 이다.
 *
 * 그룹 인덱스는 파일마다 뜻이 다르므로, 복원한 인덱스가 이 파일의 범위를 벗어나면
 * `AnimationController` 가 `'all'` 로 떨어뜨린다 (animation.ts).
 */
export interface AnimationState {
  playing: boolean;
  selection: 'all' | number;
}

export interface TogglesState {
  snap: boolean;
}

/**
 * 접을 수 있는 패널 섹션의 펼침 여부. 애니메이션 섹션은 여기 없다 — 그룹이 있는 파일에서만
 * 존재하고 있으면 늘 펼쳐진 채 시작하므로 저장할 것이 없다.
 */
export interface SectionsState {
  measure: boolean;
  display: boolean;
  debug: boolean;
}

export interface RestorableViewerState {
  camera: CameraState | null;
  measurements: MeasurementState[];
  selectedIndex: number | null;
  measureMode: boolean;
  toggles: TogglesState;
  animation: AnimationState | null;
  /** 패널 섹션의 펼침 상태. */
  sections: SectionsState;
  /** 뷰어 패널을 통째로 숨겼는지. `modelLens.togglePanel` 이 바꾼다. */
  panelHidden: boolean;
}

export interface PersistedViewerState extends RestorableViewerState {
  version: number;
}

const DEFAULT_TOGGLES: TogglesState = { snap: true };

/** 처음 열었을 때는 세 섹션 모두 접혀 있다 — 패널이 치수 + 단위만큼만 크다. */
const DEFAULT_SECTIONS: SectionsState = { measure: false, display: false, debug: false };

export function serializeViewerState(state: RestorableViewerState): PersistedViewerState {
  return { version: VIEWER_STATE_VERSION, ...state };
}

export function restoreViewerState(raw: unknown): RestorableViewerState | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (raw.version !== VIEWER_STATE_VERSION) {
    return undefined;
  }

  const measurements = readMeasurements(raw.measurements);
  return {
    camera: readCamera(raw.camera),
    measurements,
    selectedIndex: readSelectedIndex(raw.selectedIndex, measurements.length),
    measureMode: raw.measureMode === true,
    toggles: readToggles(raw.toggles),
    animation: readAnimation(raw.animation),
    sections: readSections(raw.sections),
    panelHidden: raw.panelHidden === true,
  };
}

/**
 * 패널 섹션의 펼침 상태를 읽는다.
 *
 * **여기서도 버전은 올리지 않는다** — `readAnimation` 과 같은 이유다. 올리면 버전 불일치로
 * 복원이 통째로 버려져, 이 확장을 업데이트한 사용자의 열려 있는 탭에서 카메라와 측정까지
 * 사라진다. 필드가 없는 예전 상태는 여기서 기본값(전부 접힘)이 되고 나머지는 살아남는다.
 */
function readSections(raw: unknown): SectionsState {
  if (!isRecord(raw)) {
    return { ...DEFAULT_SECTIONS };
  }
  return {
    measure: readBoolean(raw.measure, DEFAULT_SECTIONS.measure),
    display: readBoolean(raw.display, DEFAULT_SECTIONS.display),
    debug: readBoolean(raw.debug, DEFAULT_SECTIONS.debug),
  };
}

/**
 * 애니메이션 상태를 읽는다.
 *
 * **버전은 올리지 않았다.** 올리면 버전 불일치로 복원이 통째로 버려져, 이미 열려 있는 탭의
 * 카메라와 측정까지 사라진다. 필드가 없는 예전 상태는 여기서 `null` 이 되고 나머지는 살아남는다.
 */
function readAnimation(raw: unknown): AnimationState | null {
  if (!isRecord(raw) || typeof raw.playing !== 'boolean') {
    return null;
  }
  const { selection } = raw;
  if (selection !== 'all' && !isIndex(selection)) {
    return { playing: raw.playing, selection: 'all' };
  }
  return { playing: raw.playing, selection };
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function readCamera(raw: unknown): CameraState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const target = readTriple(raw.target);
  if (!target || !isFinite(raw.alpha) || !isFinite(raw.beta) || !isFinite(raw.radius)) {
    return null;
  }
  return { alpha: raw.alpha, beta: raw.beta, radius: raw.radius, target };
}

function readMeasurements(raw: unknown): MeasurementState[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MeasurementState[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const a = readTriple(entry.a);
    const b = readTriple(entry.b);
    if (a && b) {
      out.push({ a, b });
    }
  }
  return out;
}

function readSelectedIndex(raw: unknown, count: number): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw >= count) {
    return null;
  }
  return raw;
}

function readToggles(raw: unknown): TogglesState {
  if (!isRecord(raw)) {
    return { ...DEFAULT_TOGGLES };
  }
  return {
    snap: readBoolean(raw.snap, DEFAULT_TOGGLES.snap),
  };
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function readTriple(raw: unknown): Triple | null {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(isFinite)) {
    return null;
  }
  return [raw[0], raw[1], raw[2]];
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
