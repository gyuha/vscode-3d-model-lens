import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { extentDiagonal, type Extents } from './geometry.js';

/** `ArcRotateCamera` 의 기본값과 같은 감쇠 계수. */
const INERTIA = 0.9;
/** 이 아래로 줄어들면 멈춘 것으로 본다 — 유휴 진입을 막지 않기 위해 필요하다. */
const EPSILON = 1e-4;

/** 저장·복원되는 카메라 자세. `alpha`/`beta` 와 달리 롤을 표현할 수 있다. */
export interface OrbitCameraState {
  /** 쿼터니언 `[x, y, z, w]`. */
  orientation: [number, number, number, number];
  radius: number;
  target: [number, number, number];
}

/**
 * **자유 자세 궤도 카메라.**
 *
 * `ArcRotateCamera` 를 쓰지 않는 이유는 하나다 — 그것은 자세를 `alpha`/`beta` 로만 표현하고
 * **롤 파라미터가 없어서 화면 기준 회전을 표현할 수 없다.** 좌우 회전이 월드 Y 축 기준이므로,
 * 카메라가 기울어질수록 입력이 시선을 움직이지 못하고 화면만 돌린다
 * (실측: 방향 ≈ `θ·sin β`, 롤 ≈ `θ·cos β`, 교차점 `beta = 45°`).
 * 자세한 근거와 기각한 대안들은 ADR `260826-232902` 에 있다.
 *
 * `TargetCamera` 는 `rotationQuaternion` 으로 자세를 완전히 받고 up 벡터도 그것에서 유도하므로
 * (`targetCamera.pure.js` 의 `_computeViewMatrix`), 월드 Y 고정이 끼어들지 않는다.
 */
export class OrbitCamera {
  public readonly camera: TargetCamera;

  private readonly orientation = new Quaternion();
  private readonly target = Vector3.Zero();
  private radius = 1;
  private minRadius = 0;
  private maxRadius = Number.MAX_VALUE;

  /**
   * 관성 속도. `ArcRotateCamera` 의 `inertia = 0.9` 와 같은 감쇠를 직접 구현한다 — 입력이 끝난
   * 뒤에도 프레임마다 0.9배로 줄면서 이어진다. 유지하는 이유: 요청 범위는 회전 축이고, 체감
   * 변화를 끼워 넣으면 문제가 생겼을 때 축 탓인지 관성 탓인지 분리할 수 없다 (ADR 260826-232902).
   *
   * **자유 자세에서는 회전축이 프레임마다 바뀌므로** 속도를 월드 벡터로 들고 있으면 안 된다 —
   * 화면 기준 각속도(라디안)로 들고 있다가 매 프레임 그 시점의 로컬 축에 적용한다.
   */
  private velocity = { horizontal: 0, vertical: 0 };

  public constructor(scene: Scene) {
    this.camera = new TargetCamera('modelLens.camera', Vector3.Zero(), scene);
    this.camera.rotationQuaternion = new Quaternion();
    this.apply();
  }

  /**
   * **화면 기준 회전.** `horizontal` 은 화면의 수직축(좌우로 돌린다), `vertical` 은 화면의
   * 수평축(위아래로 돌린다) 기준이며 단위는 라디안이다.
   */
  public rotate(horizontal: number, vertical: number): void {
    this.applyRotation(horizontal, vertical);
  }

  /**
   * 관성 꼬리를 시작한다 — 드래그를 놓는 순간의 속도를 넘긴다.
   *
   * **직접 조작과 꼬리를 분리한 이유.** Babylon 은 입력을 속도에만 넣고 매 프레임 감쇠하며
   * 적용하므로, 입력 `θ` 하나가 결국 `θ · Σ0.9ⁿ = 10θ` 만큼 돈다. 즉시 적용까지 하면 `11θ` 가
   * 되어 드래그가 크게 오버슈트한다. 그래서 `rotate()` 는 **1:1 로 즉시** 적용하고(드래그가
   * 손가락을 정확히 따라가며, 불변식도 이 경로에서 단정된다) 꼬리는 이 메서드가 별도로 만든다.
   * 감쇠 계수는 `ArcRotateCamera` 와 같은 `0.9` 다.
   */
  public glide(horizontal: number, vertical: number): void {
    this.velocity.horizontal = horizontal;
    this.velocity.vertical = vertical;
  }

  /**
   * 관성을 한 프레임 진행한다. 움직임이 남아 있으면 `true` — 렌더 게이트가 이걸로 계속 그린다.
   * 입력이 끝난 뒤에도 감쇠가 이어지므로, 이 값이 `false` 가 될 때가 유휴 진입 시점이다.
   */
  public tick(): boolean {
    const v = this.velocity;
    v.horizontal *= INERTIA;
    v.vertical *= INERTIA;

    if (Math.abs(v.horizontal) <= EPSILON && Math.abs(v.vertical) <= EPSILON) {
      v.horizontal = 0;
      v.vertical = 0;
      return false;
    }
    this.applyRotation(v.horizontal, v.vertical);
    return true;
  }

  /** 관성을 즉시 끊는다 — 새 드래그가 시작될 때 이전 감쇠가 섞이지 않게 한다. */
  public stop(): void {
    this.velocity.horizontal = 0;
    this.velocity.vertical = 0;
  }

  private applyRotation(horizontal: number, vertical: number): void {
    // **두 축 모두 카메라 로컬 축 기준으로 post-multiply 한다.** 이것이 화면 기준 회전이다 —
    // 회전축이 화면에 고정돼 있으므로 시선은 입력만큼 정확히 돌고 그 축 방향은 변하지 않는다.
    // 월드 Y 축으로 돌리면(pre-multiply) 카메라가 기울어진 만큼 입력이 롤로 새어 나간다.
    if (horizontal !== 0) {
      this.orientation.copyFrom(
        this.orientation.multiply(Quaternion.RotationAxis(Vector3.Up(), horizontal)),
      );
    }
    if (vertical !== 0) {
      this.orientation.copyFrom(
        this.orientation.multiply(Quaternion.RotationAxis(Vector3.Right(), vertical)),
      );
    }
    this.apply();
  }

  /** 배율 곱. `1` 보다 크면 멀어진다. */
  public zoom(factor: number): void {
    this.applyZoom(factor);
  }

  /** 화면 기준 팬 — 화면 오른쪽·위 방향으로 타깃을 옮긴다. 단위는 월드 거리. */
  public pan(right: number, up: number): void {
    this.applyPan(right, up);
  }

  private applyZoom(factor: number): void {
    this.radius = Math.min(this.maxRadius, Math.max(this.minRadius, this.radius * factor));
    this.apply();
  }

  private applyPan(right: number, up: number): void {
    this.target.addInPlace(this.right.scale(right)).addInPlace(this.up.scale(up));
    this.apply();
  }

  /** 모델 크기에 맞춘 줌·클리핑 한계. 프레이밍과 별개로 항상 적용한다. */
  public applyLimits(extents: Extents): void {
    const diagonal = extentDiagonal(extents) || 1;
    this.minRadius = diagonal * 0.05;
    this.maxRadius = diagonal * 20;
    this.camera.minZ = diagonal * 0.001;
    this.camera.maxZ = diagonal * 100;
  }

  /** 바운딩 박스에 맞춰 프레이밍한다. 자세는 기본 시작 각도로 되돌린다. */
  public frame(extents: Extents): void {
    this.target.set(
      (extents.min.x + extents.max.x) / 2,
      (extents.min.y + extents.max.y) / 2,
      (extents.min.z + extents.max.z) / 2,
    );
    this.radius = (extentDiagonal(extents) || 1) * 1.6;
    // 기존 `ArcRotateCamera` 의 시작 각도(alpha = -π/2.5, beta = π/2.5)와 같은 방향을 준다.
    this.orientation.copyFrom(Quaternion.RotationYawPitchRoll(-Math.PI / 2.5, Math.PI / 2 - Math.PI / 2.5, 0));
    this.stop();
    this.apply();
  }

  public state(): OrbitCameraState {
    return {
      orientation: [
        this.orientation.x,
        this.orientation.y,
        this.orientation.z,
        this.orientation.w,
      ],
      radius: this.radius,
      target: [this.target.x, this.target.y, this.target.z],
    };
  }

  public restore(state: OrbitCameraState): void {
    this.orientation.copyFromFloats(...state.orientation);
    this.orientation.normalize();
    this.radius = state.radius;
    this.target.set(...state.target);
    this.stop();
    this.apply();
  }

  /** 현재 타깃까지의 거리. 팬 속도를 여기에 비례시켜야 줌 배율과 무관하게 느낌이 일정하다. */
  public get radiusValue(): number {
    return this.radius;
  }

  /** 시선 방향(카메라 → 타깃). */
  public get forward(): Vector3 {
    return this.axis(0, 0, 1);
  }

  /** 화면의 수직축. */
  public get up(): Vector3 {
    return this.axis(0, 1, 0);
  }

  /** 화면의 수평축. */
  public get right(): Vector3 {
    return this.axis(1, 0, 0);
  }

  private axis(x: number, y: number, z: number): Vector3 {
    const out = new Vector3(x, y, z);
    out.rotateByQuaternionToRef(this.orientation, out);
    return out.normalize();
  }

  /** 자세·반지름·타깃에서 카메라의 위치와 회전을 다시 만든다. */
  private apply(): void {
    this.camera.rotationQuaternion?.copyFrom(this.orientation);
    this.camera.position.copyFrom(this.target.subtract(this.forward.scale(this.radius)));
  }
}
