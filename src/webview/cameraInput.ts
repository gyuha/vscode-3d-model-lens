import type { OrbitCamera } from './orbitCamera.js';

/**
 * 픽셀당 회전량(라디안). 기존 `ArcRotateCamera` 의 체감을 실측해서 맞춘 값이다 —
 * e2e 에서 42 px 드래그가 `0.311 rad` 를 돌렸으므로 `0.0074 rad/px` 이다.
 * (`angularSensibility = 1000` 에 Babylon 의 관성 증폭 약 10배가 곱해진 결과였다.)
 */
const ROTATE_PER_PIXEL = 0.0074;

/**
 * 픽셀당 팬 거리 = `radius / PAN_DIVISOR`.
 *
 * 기존 값은 `panSpeed = radius / 2` 에 `panningSensibility = 1000` 이 나눠지는 형태였으므로
 * `radius / 2000` 이다. **`radius` 에 비례시키는 것이 핵심이다** — 투영 크기가 거리에
 * 반비례하므로, 비례시키지 않으면 줌 배율에 따라 같은 드래그가 전혀 다르게 움직인다.
 */
const PAN_DIVISOR = 2000;

/** 휠 노치(deltaY 100)당 줌 배율 변화. 기존 `wheelDeltaPercentage = 0.02` 와 같다. */
const ZOOM_PER_NOTCH = 0.02;

/** 관성 꼬리에 넘길 마지막 프레임 속도를 만들 때 쓰는 감쇠 — 튀는 값을 눌러 준다. */
const GLIDE_DAMPING = 0.5;

/**
 * 방향키를 누르고 있는 동안 **프레임당** 회전량(라디안).
 *
 * 기존 `ArcRotateCamera` 는 키를 누른 동안 매 프레임 `angularSpeed = 0.01` 을 속도에 넣고
 * 관성으로 감쇠·적용했으므로, 정상상태 적용량이 `0.01 / (1 - 0.9) = 0.1 rad/frame` 이었다
 * (실측: 120ms 동안 `44°` — 약 7프레임 × 0.1 rad 과 일치). 그래서 프레임 기반으로 같은 값을 쓴다.
 * keydown 이벤트당 처리하면 브라우저의 자동 반복 지연 때문에 훨씬 느려진다.
 */
const KEY_ROTATE_PER_FRAME = 0.1;

/** Alt + 방향키의 프레임당 줌 배율 변화. */
const KEY_ZOOM_PER_FRAME = 0.02;

/** Ctrl + 방향키의 프레임당 팬 거리 = `radius × 이 값`. */
const KEY_PAN_PER_FRAME = 0.01;

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;
type Arrow = (typeof ARROWS)[number];

interface Drag {
  pointerId: number;
  /** `2` 는 오른쪽 버튼 = 팬. 그 외는 회전. */
  button: number;
  x: number;
  y: number;
  /** 마지막 이동의 회전량 — 놓을 때 관성 꼬리의 초기 속도가 된다. */
  lastHorizontal: number;
  lastVertical: number;
}

/**
 * 자유 자세 카메라의 포인터 조작.
 *
 * `ArcRotateCameraPointersInput` 을 쓸 수 없어서 직접 짠다 — 그 입력은 `alpha`/`beta` 누산기에
 * 값을 넣으므로 쿼터니언 자세에 적용할 수 없다.
 *
 * **버튼 매핑은 바꾸지 않는다**: 좌드래그=회전 · 우드래그=팬 · 휠/핀치=줌.
 *
 * `measurement.ts` 의 탭 판정은 `scene.onPointerObservable` 위에 따로 얹혀 있고 이동 임계값으로
 * 드래그와 탭을 가르므로, 여기서 같은 이벤트를 듣는 것과 충돌하지 않는다. 오히려 Babylon 의
 * `POINTERDOUBLETAP` 을 등록하지 않으므로 그 노트가 기록한 300ms 지연 제약이 사라진다.
 */
export class CameraInput {
  private readonly drags = new Map<number, Drag>();
  private readonly pinch = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private readonly detachers: (() => void)[] = [];
  private readonly held = new Set<Arrow>();
  private modifiers = { alt: false, ctrl: false };

  public constructor(
    private readonly orbit: OrbitCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.on('pointerdown', (event) => this.onDown(event as PointerEvent));
    this.on('pointermove', (event) => this.onMove(event as PointerEvent));
    this.on('pointerup', (event) => this.onUp(event as PointerEvent));
    this.on('pointercancel', (event) => this.onUp(event as PointerEvent));
    this.on('wheel', (event) => this.onWheel(event as WheelEvent), { passive: false });
    // 오른쪽 드래그를 팬으로 쓰므로 컨텍스트 메뉴가 떠서는 안 된다.
    this.on('contextmenu', (event) => event.preventDefault());
    this.on('keydown', (event) => this.onKey(event as KeyboardEvent, true));
    this.on('keyup', (event) => this.onKey(event as KeyboardEvent, false));
    // 캔버스에서 포커스가 빠지면 눌린 키가 영원히 눌린 것으로 남는다.
    this.on('blur', () => this.held.clear());
  }

  /**
   * 눌려 있는 방향키를 한 프레임 적용한다. 아직 눌려 있으면 `true` — 렌더 게이트가 이걸로
   * 계속 그린다. 프레임 기반인 이유는 `KEY_ROTATE_PER_FRAME` 주석 참조.
   */
  public tickKeys(): boolean {
    if (this.held.size === 0) {
      return false;
    }
    const horizontal =
      (this.held.has('ArrowLeft') ? 1 : 0) - (this.held.has('ArrowRight') ? 1 : 0);
    const vertical = (this.held.has('ArrowUp') ? 1 : 0) - (this.held.has('ArrowDown') ? 1 : 0);

    if (this.modifiers.alt) {
      // Alt = 줌. 위가 확대(거리 감소)다 — 기존 동작과 같다.
      if (vertical !== 0) {
        this.orbit.zoom(1 - vertical * KEY_ZOOM_PER_FRAME);
      }
      return true;
    }
    if (this.modifiers.ctrl) {
      const step = this.orbit.radiusValue * KEY_PAN_PER_FRAME;
      this.orbit.pan(-horizontal * step, -vertical * step);
      return true;
    }
    // 회전 — **드래그와 같은 방향.** 오른쪽 키는 오른쪽 드래그(dx > 0)와 같아야 하고,
    // 드래그는 `-dx` 를 넣으므로 오른쪽 키도 음수여야 한다. 이 규약은 e2e 2개가 지킨다.
    this.orbit.rotate(horizontal * KEY_ROTATE_PER_FRAME, vertical * KEY_ROTATE_PER_FRAME);
    return true;
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    this.modifiers.alt = event.altKey;
    this.modifiers.ctrl = event.ctrlKey || event.metaKey;
    const key = ARROWS.find((arrow) => arrow === event.key);
    if (!key) {
      return;
    }
    event.preventDefault();
    if (down) {
      this.orbit.stop();
      this.held.add(key);
    } else {
      this.held.delete(key);
    }
  }

  public dispose(): void {
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers.length = 0;
  }

  private on(type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): void {
    this.canvas.addEventListener(type, handler, options);
    this.detachers.push(() => this.canvas.removeEventListener(type, handler, options));
  }

  private onDown(event: PointerEvent): void {
    // 새 조작이 시작되면 이전 관성을 끊는다 — 섞이면 손가락을 따라가지 않는다.
    this.orbit.stop();
    this.canvas.setPointerCapture(event.pointerId);
    this.drags.set(event.pointerId, {
      pointerId: event.pointerId,
      button: event.button,
      x: event.clientX,
      y: event.clientY,
      lastHorizontal: 0,
      lastVertical: 0,
    });
    this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.pinchDistance = this.currentPinchDistance();
  }

  private onMove(event: PointerEvent): void {
    const drag = this.drags.get(event.pointerId);
    if (!drag) {
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // 손가락 둘이면 핀치 줌 — 회전·팬보다 우선한다.
    if (this.pinch.size >= 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) {
        this.orbit.zoom(this.pinchDistance / distance);
      }
      this.pinchDistance = distance;
      return;
    }

    if (drag.button === 2) {
      // 팬 — 화면 오른쪽으로 끌면 모델이 오른쪽으로 따라오도록 타깃을 왼쪽으로 옮긴다.
      const step = this.orbit.radiusValue / PAN_DIVISOR;
      this.orbit.pan(-dx * step, dy * step);
      return;
    }

    // 회전 — 드래그 방향과 같은 방향으로 돈다.
    const horizontal = -dx * ROTATE_PER_PIXEL;
    const vertical = -dy * ROTATE_PER_PIXEL;
    drag.lastHorizontal = horizontal;
    drag.lastVertical = vertical;
    this.orbit.rotate(horizontal, vertical);
  }

  private onUp(event: PointerEvent): void {
    const drag = this.drags.get(event.pointerId);
    this.drags.delete(event.pointerId);
    this.pinch.delete(event.pointerId);
    this.pinchDistance = this.currentPinchDistance();
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (!drag || drag.button === 2) {
      return;
    }
    // 놓는 순간의 속도로 관성 꼬리를 시작한다.
    this.orbit.glide(drag.lastHorizontal * GLIDE_DAMPING, drag.lastVertical * GLIDE_DAMPING);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.orbit.stop();
    this.orbit.zoom(1 + (event.deltaY / 100) * ZOOM_PER_NOTCH);
  }

  private currentPinchDistance(): number {
    const points = [...this.pinch.values()];
    if (points.length < 2) {
      return 0;
    }
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }
}
