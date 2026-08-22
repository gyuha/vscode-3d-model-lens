import type { UnitSetting } from './units';

/** 확장 호스트 ↔ 웹뷰 메시지. 양쪽이 같은 정의를 쓴다. */

export type HostToWebview =
  | { type: 'setInspector'; visible: boolean }
  | { type: 'setMeasureMode'; active: boolean };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'inspectorState'; visible: boolean }
  | { type: 'inspectorFailed'; message: string }
  | { type: 'measureModeState'; active: boolean }
  /** 사용자가 뷰어 패널 드롭다운에서 단위를 바꿨다 — 호스트가 파일별로 기억한다. */
  | { type: 'unitChanged'; unit: UnitSetting };
