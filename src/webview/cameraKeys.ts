import { ArcRotateCameraKeyboardMoveInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraKeyboardMoveInput.js';

/**
 * 방향키의 **회전 방향을 마우스 드래그와 일치시킨다.**
 *
 * Babylon 기본값은 둘이 반대다. 마우스는 `rotationAccumulatedPixels.x += -offsetX` 로 누산하는데
 * 키보드는 오른쪽 키에 `+1` 을 넣는다 — 그래서 오른쪽 키가 **왼쪽으로 드래그한 것처럼** 돌고,
 * 아래 키가 위로 드래그한 것처럼 돈다. 두 축 모두 그렇다 (실측: 오른쪽 키 `+44.10°` vs
 * 오른쪽 드래그 `-17.84°`, 아래 키 `+24.08°` vs 아래 드래그 `-16.92°`).
 *
 * **키 배열(`keysLeft`/`keysRight`/`keysUp`/`keysDown`)을 맞바꾸는 방식은 쓸 수 없다.** 그 배열은
 * 회전뿐 아니라 **Ctrl 패닝과 Alt 줌** 분기에서도 같이 쓰이므로, 뒤집으면 패닝과 줌 방향까지
 * 반대가 된다. 그래서 대신 이 프레임에 **키보드가 회전 누산기에 더한 몫만** 골라 부호를 뒤집는다 —
 * 패닝과 줌은 각각 다른 누산기(`panAccumulatedPixels` / `zoomAccumulatedPixels`)로 가므로
 * 영향받지 않고, 마우스는 자기 입력 클래스에서 따로 누산하므로 그대로다.
 */
export class InvertedKeyboardRotateInput extends ArcRotateCameraKeyboardMoveInput {
  public override checkInputs(): void {
    const accumulated = this.camera.movement.rotationAccumulatedPixels;
    const beforeX = accumulated.x;
    const beforeY = accumulated.y;

    super.checkInputs();

    accumulated.x = beforeX - (accumulated.x - beforeX);
    accumulated.y = beforeY - (accumulated.y - beforeY);
  }
}
