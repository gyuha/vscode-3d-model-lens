// engine.pure 가 아니라 engine.js 를 쓴다 — prefiltered 큐브 텍스처(.env) 로딩에 필요한
// engine.prefilteredCubeTexture 확장이 여기서 등록된다.
import '@babylonjs/core/Engines/engine.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { CubeTextureCreateFromPrefilteredData } from '@babylonjs/core/Materials/Textures/cubeTexture.pure.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { SupportedExtension } from '../formats.js';
import { resolveUnit, type UnitSetting } from '../units.js';
import type { CameraState } from './viewerState.js';
import { Chrome, ensureMaterials } from './chrome.js';
import { computeExtents, extentDiagonal, type Extents } from './geometry.js';
import { MeasurementTool } from './measurement.js';
import { RenderGate } from './renderGate.js';
import { registerModelLensLoaders } from './loaders.js';
import { setInspectorVisible } from './inspector.js';
import { enforceOfflineAssets } from './offline.js';

export interface ViewerConfig {
  modelUri: string;
  /** 확장의 media/ 디렉터리 URI — Babylon 의 에셋 요청을 여기로 돌린다 */
  assetBaseUri: string;
  environmentUri: string;
  fileName: string;
  pluginExtension: SupportedExtension;
  backgroundColor: string;
  unitSetting: UnitSetting;
  decimals: number;
}

export interface Viewer {
  scene: Scene;
  chrome: Chrome;
  measure: MeasurementTool;
  /** 무언가 바뀌었으니 다시 그려야 한다고 알린다. */
  markDirty: () => void;
  /** Inspector 처럼 연속 렌더링이 필요한 동안 켠다. */
  setContinuousRendering: (on: boolean) => void;
  /** 실제로 그린 프레임 수 — 유휴 렌더 중단을 검증하는 관측점. */
  renderCount: () => number;
  /** 유휴 상태인가 — 진단·검증용. */
  isIdle: () => boolean;
  /** 현재 카메라 상태 — 탭 전환 사이에 저장한다. */
  cameraState: () => CameraState;
  extents: Extents;
  meshes: AbstractMesh[];
  resetView: () => void;
  /** 월드 좌표를 캔버스의 CSS 픽셀 좌표로 투영한다. */
  projectToScreen: (point: { x: number; y: number; z: number }) => {
    x: number;
    y: number;
    visible: boolean;
  };
  setInspector: (visible: boolean) => Promise<void>;
  dispose: () => void;
}

registerModelLensLoaders();

export async function createViewer(
  canvas: HTMLCanvasElement,
  labelHost: HTMLElement,
  config: ViewerConfig,
  /** 탭 전환에서 복원된 카메라. 있으면 자동 프레이밍을 건너뛴다 — 사용자가 맞춰 둔 각도를 덮어쓰면 안 된다. */
  restoredCamera: CameraState | null,
  onProgress: (ratio: number | undefined) => void,
): Promise<Viewer> {
  enforceOfflineAssets(config.assetBaseUri);

  // WebGL2 로 고정한다 — WebGPU 는 웹뷰에서 지원이 불안정하고 CSP/워커 요구가 더 크다.
  const engine = new Engine(canvas, true, { alpha: true, stencil: true }, true);
  if (engine.webGLVersion < 2) {
    console.warn('[3D Model Lens] WebGL2 를 쓸 수 없어 WebGL1 로 동작합니다. 렌더링이 제한될 수 있습니다.');
  }

  const scene = new Scene(engine);
  // 캔버스를 투명하게 두고 CSS 의 --vscode-editor-background 가 비쳐 보이게 한다.
  // 이러면 테마 전환이 JS 없이 자동으로 따라온다.
  scene.clearColor = new Color4(0, 0, 0, 0);

  // IBL. glTF 의 PBR 은 환경 맵 없이는 금속 재질이 검게 뜬다.
  // Babylon 의 createDefaultEnvironment() 는 CDN 을 때리므로 쓸 수 없다 (ADR 260822-115455b).
  scene.environmentTexture = CubeTextureCreateFromPrefilteredData(config.environmentUri, scene);
  // IBL 만으로는 형태 인지가 약해서 보조 광원을 하나 둔다.
  const fill = new HemisphericLight('modelLens.fill', new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;

  const container = await LoadAssetContainerAsync(config.modelUri, scene, {
    // 웹뷰 URI 에는 쿼리스트링이 붙어 확장자 스니핑이 어긋날 수 있으므로 명시적으로 넘긴다.
    pluginExtension: config.pluginExtension,
    onProgress: (event) => onProgress(event.lengthComputable ? event.loaded / event.total : undefined),
  });
  container.addAllToScene();

  const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  if (meshes.length === 0) {
    throw new Error('모델에 렌더할 수 있는 메시가 없습니다.');
  }
  ensureMaterials(scene, meshes);

  const extents = computeExtents(scene, meshes);
  const camera = createCamera(scene, canvas, extents, restoredCamera);
  const chrome = new Chrome(scene, extents, meshes);
  const measure = new MeasurementTool(
    scene,
    canvas,
    labelHost,
    extents,
    resolveUnit(config.pluginExtension, config.unitSetting),
    config.decimals,
  );

  // 유휴 상태에서는 프레임을 그리지 않는다. 렌더 루프 자체는 멈추지 않는다 —
  // 그 이유는 renderGate.ts 주석 참조.
  const gate = new RenderGate();
  let renderCount = 0;
  scene.onAfterRenderObservable.add(() => {
    renderCount++;
  });

  // dirty 신호 (1) — 캔버스의 입력 이벤트.
  //
  // **이게 wake 소스여야 한다.** 카메라의 `onViewMatrixChangedObservable` 만으로는 교착에
  // 빠진다: ArcRotateCamera 는 `scene.render()` 안의 `_checkInputs()` 에서 입력을 처리하므로,
  // 그리지 않으면 입력을 읽지 않고 → 뷰 매트릭스가 안 바뀌고 → dirty 가 안 서고 → 영원히
  // 그리지 않는다. 실제로 e2e 가 이 교착을 잡아냈다.
  //
  // `pointermove` 는 버튼이 눌린 동안만 본다 — 단순 호버로 계속 그리면 유휴가 무의미해진다.
  let pointerDown = false;
  const wake = (): void => gate.markDirty();
  canvas.addEventListener('pointerdown', () => {
    pointerDown = true;
    wake();
  });
  canvas.addEventListener('pointerup', () => {
    pointerDown = false;
    wake();
  });
  canvas.addEventListener('pointercancel', () => {
    pointerDown = false;
    wake();
  });
  canvas.addEventListener('pointermove', () => {
    if (pointerDown) {
      wake();
    }
  });
  canvas.addEventListener('wheel', wake, { passive: true });
  canvas.addEventListener('keydown', wake);

  // dirty 신호 (2) — 렌더 도중에 카메라가 바뀌는 경우. 관성 감쇠가 여기로 이어진다.
  // 옵저버 안에서 getViewMatrix() 를 부르지 않는다 — Babylon 문서가 재진입 위험을 경고한다.
  camera.onViewMatrixChangedObservable.add(() => gate.markDirty());
  camera.onProjectionMatrixChangedObservable.add(() => gate.markDirty());

  engine.runRenderLoop(() => {
    // 대기 중인 리소스(텍스처·IBL)가 있으면 아직 준비되지 않은 것으로 본다.
    // `_pendingData.length` 를 보는 O(1) 조회라 매 프레임 불러도 무해하다.
    gate.setSceneReady(scene.getWaitingItemsCount() === 0);
    if (gate.shouldRender()) {
      scene.render();
    }
  });

  const onResize = (): void => {
    engine.resize();
    gate.markDirty();
  };
  window.addEventListener('resize', onResize);

  return {
    scene,
    chrome,
    measure,
    extents,
    meshes,
    resetView: () => {
      frameCamera(camera, extents);
      gate.markDirty();
    },
    markDirty: () => gate.markDirty(),
    setContinuousRendering: (on) => gate.setContinuous(on),
    renderCount: () => renderCount,
    isIdle: () => gate.isIdle,
    cameraState: () => ({
      alpha: camera.alpha,
      beta: camera.beta,
      radius: camera.radius,
      target: [camera.target.x, camera.target.y, camera.target.z],
    }),
    projectToScreen: (point) => projectToScreen(scene, canvas, point),
    setInspector: (visible) => setInspectorVisible(scene, visible),
    dispose: () => {
      window.removeEventListener('resize', onResize);
      scene.dispose();
      engine.dispose();
    },
  };
}

/**
 * 월드 좌표 → 캔버스 CSS 픽셀. 뷰포트를 CSS 픽셀로 잡는 이유는 measurement.ts 와 같다
 * (devicePixelRatio 가 적용된 버퍼 크기를 쓰면 고해상도 화면에서 어긋난다).
 */
function projectToScreen(
  scene: Scene,
  canvas: HTMLCanvasElement,
  point: { x: number; y: number; z: number },
): { x: number; y: number; visible: boolean } {
  const rect = canvas.getBoundingClientRect();
  const projected = Vector3.Project(
    new Vector3(point.x, point.y, point.z),
    Matrix.Identity(),
    scene.getTransformMatrix(),
    new Viewport(0, 0, rect.width, rect.height),
  );
  return {
    x: projected.x,
    y: projected.y,
    visible: projected.z >= 0 && projected.z <= 1,
  };
}

function createCamera(
  scene: Scene,
  canvas: HTMLCanvasElement,
  extents: Extents,
  restored: CameraState | null,
): ArcRotateCamera {
  const camera = new ArcRotateCamera(
    'modelLens.camera',
    -Math.PI / 2.5,
    Math.PI / 2.5,
    1,
    Vector3.Zero(),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.wheelDeltaPercentage = 0.02;
  camera.pinchDeltaPercentage = 0.02;
  applyCameraLimits(camera, extents);

  if (restored) {
    // 순서가 중요하다 — ArcRotateCamera 의 setTarget 은 위치에서 alpha/beta 를 다시 계산한다.
    camera.setTarget(new Vector3(...restored.target));
    camera.alpha = restored.alpha;
    camera.beta = restored.beta;
    camera.radius = restored.radius;
  } else {
    frameCamera(camera, extents);
  }
  return camera;
}

/** 모델 크기에 맞춘 줌·클리핑 한계. 프레이밍과 별개로 항상 적용한다. */
function applyCameraLimits(camera: ArcRotateCamera, extents: Extents): void {
  const diagonal = extentDiagonal(extents) || 1;
  camera.lowerRadiusLimit = diagonal * 0.05;
  camera.upperRadiusLimit = diagonal * 20;
  camera.minZ = diagonal * 0.001;
  camera.maxZ = diagonal * 100;
}

/** 바운딩 박스에 맞춰 카메라를 프레이밍한다. 고정 거리는 모델 스케일이 바뀌면 곧바로 깨진다. */
function frameCamera(camera: ArcRotateCamera, extents: Extents): void {
  camera.setTarget(
    new Vector3(
      (extents.min.x + extents.max.x) / 2,
      (extents.min.y + extents.max.y) / 2,
      (extents.min.z + extents.max.z) / 2,
    ),
  );
  camera.radius = (extentDiagonal(extents) || 1) * 1.6;
}
