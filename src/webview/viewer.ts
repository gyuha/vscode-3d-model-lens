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
import type { BackgroundMode } from '../background.js';
import type { SupportedExtension } from '../formats.js';
import { resolveUnit, type UnitSetting } from '../units.js';
import type { CameraState } from './viewerState.js';
import { createAnimationController, type AnimationController } from './animation.js';
import { Chrome, ensureMaterials } from './chrome.js';
import { computeExtents, extentDiagonal, type Extents } from './geometry.js';
import { InvertedKeyboardRotateInput } from './cameraKeys.js';
import { applyHandednessFix } from './handedness.js';
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
  background: BackgroundMode;
  unitSetting: UnitSetting;
  decimals: number;
}

export interface Viewer {
  scene: Scene;
  chrome: Chrome;
  measure: MeasurementTool;
  animations: AnimationController;
  /**
   * 측정 모드를 바꾼다. 켜면 애니메이션을 멈춘다 — 메시가 움직이는 동안 찍은 두 점은
   * 서로 다른 시점의 위치라 길이가 의미를 잃는다. 끌 때 자동으로 재개하지는 않는다.
   */
  setMeasureMode: (active: boolean) => void;
  /** 렌더 가능한 메시 수 / 전체 — 빈 화면 회귀를 잡는 관측점. */
  readyMeshes: () => { ready: number; total: number };
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
    console.warn('[3D Model Lens] WebGL2 is unavailable; falling back to WebGL1. Rendering may be limited.');
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
    throw new Error('The model has no renderable mesh.');
  }
  // 치수·프레이밍보다 **먼저** 부른다 — 둘 다 월드 좌표를 본다.
  applyHandednessFix(meshes, config.pluginExtension);
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

  const animations = createAnimationController(container.animationGroups);

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

  // continuous 를 원하는 소스가 둘이다. 렌더 루프가 매 프레임 게이트를 갱신하므로
  // 여기서 OR 로 합치지 않으면 애니메이션이 Inspector 의 설정을 덮어쓴다.
  let inspectorContinuous = false;

  engine.runRenderLoop(() => {
    // `getWaitingItemsCount()` 로는 부족하다 — 그건 `_pendingData`(파일·텍스처 로딩)만 세고
    // **셰이더 컴파일은 세지 않는다**. 머티리얼이 준비되지 않은 메시는 `Mesh.render()` 가
    // 아무것도 그리지 않고 빠져나가므로, 그 상태로 유휴에 들어가면 빈 화면에서 얼어붙는다.
    // `scene.isReady()` 는 머티리얼·렌더타깃까지 확인하고, 준비되지 않은 머티리얼을 만나도
    // 멈추지 않고 전부 순회해 병렬 컴파일을 시작시킨다.
    gate.setSceneReady(scene.isReady());
    // 재생 중인 애니메이션은 `scene.render()` 안에서만 진행된다 — 그리지 않으면 얼어붙는다.
    gate.setContinuous(inspectorContinuous || animations.isPlaying);
    if (gate.shouldRender()) {
      // 오른쪽 드래그(pan)는 Babylon 기본값으로는 픽셀당 이동할 **월드 거리**가 고정된다.
      // 그래서 큰 모델이나 멀리 있는 카메라에서는 같은 드래그가 화면상 거의 움직이지 않는다.
      // 투영 크기는 target 까지의 거리(radius)에 반비례하므로 pan 속도를 radius 에 비례시키면
      // 줌 배율과 관계없이 화면에서 느끼는 이동량이 일정해진다. 매 프레임 갱신해야 휠 줌 직후의
      // 첫 pan 에도 현재 배율이 적용된다.
      camera.movement.panSpeed = camera.radius / 2;
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
    animations,
    setMeasureMode: (active) => {
      measure.setActive(active);
      if (active) {
        animations.pause();
      }
      gate.markDirty();
    },
    readyMeshes: () => ({
      ready: meshes.filter((mesh) => mesh.isReady(true)).length,
      total: meshes.length,
    }),
    extents,
    meshes,
    resetView: () => {
      frameCamera(camera, extents);
      gate.markDirty();
    },
    markDirty: () => gate.markDirty(),
    setContinuousRendering: (on) => {
      inspectorContinuous = on;
    },
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
  // 기본 키보드 입력을 방향이 뒤집힌 것으로 갈아 끼운다 — 이유는 cameraKeys.ts 주석 참조.
  // `attachControl` 보다 앞에서 해야 새 입력이 함께 붙는다.
  camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  camera.inputs.add(new InvertedKeyboardRotateInput());
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
  // **이 두 줄을 지우지 마라.** `ArcRotateCamera` 의 기본값은 `lowerBetaLimit = 0.01`,
  // `upperBetaLimit = Math.PI - 0.01` 이고, 그러면 위/아래로 드래그할 때 정수리(0.6°)와
  // 밑바닥(179.4°)에서 회전이 **완전히 멈춘다** — 추가 입력에도 beta 변화량이 0 이다.
  // 지우려는 유혹이 생길 이유가 셋 있고, 셋 다 실측으로 확인해 기각했다.
  //   (1) "beta < 0 에서 모델이 뒤집혀 보이는 건 버그다" — 아니다. `allowUpsideDown`(기본
  //       `true`)이 화면 연속성을 위해 up 벡터를 뒤집는 것이고, 정수리를 넘어 계속 도는 것의
  //       정의 그 자체다. 없앨 수 있는 대상이 아니다.
  //   (2) "뒤집힌 구간에서 좌우 드래그가 반대로 갈 것이다" — 가지 않는다.
  //       `_applyRotationAndZoomDelta()` 가 `beta < 0` 일 때 alpha 델타의 부호를 뒤집어 보정한다
  //       (실측: beta=+1.2 에서 +0.05 → +0.05, beta=−1.2 에서 +0.05 → −0.05).
  //   (3) "기본값의 0.01 여유는 beta=0 특이점(시선 ∥ up) 회피용이니 필요하다" — 없어도 깨지지
  //       않는다. `LookAtLHToRef` 가 축 퇴화를 x축=(1,0,0) 으로 폴백해 NaN 을 내지 않는다.
  // 회귀 장치는 e2e 의 `연속 수직 회전` 세 케이스다 (alpha 한계는 기본이 `null` 이라 좌우는
  // 원래부터 무제한이었다).
  camera.lowerBetaLimit = null;
  camera.upperBetaLimit = null;

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
