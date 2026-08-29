import { BACKGROUND_MODES, type BackgroundMode } from './background';
import type { SupportedExtension } from './formats';
import { UNIT_SETTINGS, type UnitSetting } from './units';

export interface WebviewHtmlParams {
  /** `webview.cspSource` */
  cspSource: string;
  /** `asWebviewUri` 로 만든 뷰어 엔트리 스크립트 URI */
  scriptUri: string;
  /** `asWebviewUri` 로 만든 모델 파일 URI — Babylon 이 직접 fetch 한다 */
  modelUri: string;
  /** `asWebviewUri` 로 만든 prefiltered 환경 텍스처(.env) URI */
  environmentUri: string;
  /** `asWebviewUri` 로 만든 확장 media/ 디렉터리 URI — Babylon 의 에셋 요청을 여기로 돌린다 */
  assetBaseUri: string;
  /** 표시용 파일명 (에러 메시지에 쓰인다) */
  fileName: string;
  /** Babylon `SceneLoader` 에 넘길 플러그인 확장자 — 원본 경로에서 뽑은 값 */
  pluginExtension: SupportedExtension;
  /** 배경 모드. `theme` 은 VS Code 편집기 배경색을 따른다 */
  background: BackgroundMode;
  /** 그리드 표시 여부. 전역 설정 `modelLens.grid` 가 진실의 출처다 */
  grid: boolean;
  /** 단위 초기값. `auto` 는 포맷에서 유추한다 */
  unitSetting: UnitSetting;
  /** 표시 소수점 자릿수 */
  decimals: number;
}

/**
 * 웹뷰 CSP 지시자.
 *
 * - `script-src` 는 nonce 대신 origin(`cspSource`)을 쓴다 — 동적 import chunk 로의
 *   CSP3 nonce 전파는 구현 편차가 있어 신뢰할 수 없다.
 * - `connect-src` 가 없으면 Babylon 의 XHR 이 막혀 모델과 `.bin` 로드가 조용히 실패한다.
 * - `style-src 'unsafe-inline'` 은 Inspector(파트 2/4)가 스타일을 인라인 주입하기 때문에 필요하다.
 * (ADR 260822-115455a, 260822-115455b)
 */
export function buildContentSecurityPolicy(cspSource: string): string {
  return [
    `default-src 'none'`,
    `script-src ${cspSource}`,
    `connect-src ${cspSource}`,
    `img-src ${cspSource} blob: data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `worker-src blob:`,
  ].join('; ');
}

export function buildWebviewHtml(params: WebviewHtmlParams): string {
  const csp = buildContentSecurityPolicy(params.cspSource);

  // 설정은 인라인 <script> 가 아니라 data 속성으로 넘긴다.
  // `script-src` 에 'unsafe-inline' 을 열지 않아도 되므로 CSP 를 좁게 유지할 수 있다.
  const config = escapeAttribute(
    JSON.stringify({
      modelUri: params.modelUri,
      environmentUri: params.environmentUri,
      assetBaseUri: params.assetBaseUri,
      fileName: params.fileName,
      pluginExtension: params.pluginExtension,
      background: params.background,
      unitSetting: params.unitSetting,
      decimals: params.decimals,
    }),
  );

  // 배경 목록의 단일 출처는 background.ts 다. 라벨만 여기서 붙인다.
  const BACKGROUND_LABELS: Record<BackgroundMode, string> = {
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
  };
  const backgroundOptions = BACKGROUND_MODES.map(
    (mode) =>
      `        <option value="${mode}"${mode === params.background ? ' selected' : ''}>` +
      `${BACKGROUND_LABELS[mode]}</option>`,
  ).join('\n');

  // 단위 목록의 단일 출처는 units.ts 다 — 여기서 하드코딩하지 않는다.
  const unitOptions = UNIT_SETTINGS.map(
    (unit) =>
      `        <option value="${unit}"${unit === params.unitSetting ? ' selected' : ''}>` +
      `${unit === 'auto' ? 'Auto' : unit}</option>`,
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeText(params.fileName)}</title>
<style>
  /*
   * 형태 언어는 DESIGN.md 를 따르고 색은 VS Code 테마를 따른다 (ADR 260826-094348).
   * 굵기는 700 / 400 만 쓴다 — 300 은 11px 에서 대비를 만들지 못한다 (ADR 260826-094300).
   * 모서리 반경은 어디에도 선언하지 않는다(전부 0) — 각진 실루엣이 브랜드다.
   */
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  body {
    /* 바탕색은 커스텀 속성 하나가 소유한다 — 배경 모드가 색을 고정하면 main.ts 의
       applyBackground 가 여기에 써 넣고, theme 모드면 선언을 지워 아래 폴백이 드러난다.
       축 삼각대의 문자 헤일로가 같은 값을 읽어야 하기 때문이다(.triad-label). */
    background: var(--model-lens-backdrop, var(--vscode-editor-background));
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  #root { position: relative; width: 100%; height: 100vh; }
  #canvas { width: 100%; height: 100%; display: block; outline: none; touch-action: none; }

  /*
   * M 트라이컬러 — 이 시스템의 유일한 유채색 예외이자 브랜드 서명이다.
   * 정확히 두 곳에만 쓴다(패널 머리 · 로딩). 상태를 뜻하지 않으므로 색을 해석할 필요가 없다.
   */
  .m-stripe {
    flex: none; height: 3px;
    background: linear-gradient(90deg,
      #0066b1 0 33.33%, #1c69d4 33.33% 66.66%, #e22718 66.66% 100%);
  }

  /* 대문자 + 1.4px 트래킹의 "machined" 라벨 — 굵기가 아니라 이것이 대비를 진다. */
  .caption, #panel label, .section-header, .overlay-title {
    text-transform: uppercase; font-weight: 700; letter-spacing: 1.4px;
  }

  .overlay {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 0.625rem;
    pointer-events: none; text-align: center; padding: 2rem; box-sizing: border-box;
  }
  .overlay[hidden] { display: none; }
  .overlay-title { font-size: 0.9em; }
  .overlay-detail {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em; color: var(--vscode-descriptionForeground);
  }
  /*
   * 두 오버레이 모두 불투명하다. 로딩 중에는 캔버스가 비어 있어 배경이 없어도 읽히지만,
   * 그건 "지금은 뒤에 아무것도 없다"에 기대는 것이다 — 기대지 않는다.
   */
  #loading { background: var(--vscode-editor-background); }
  #loading .m-stripe { width: 4rem; }
  #error { pointer-events: auto; background: var(--vscode-editor-background); }
  /* 실패는 브랜드 순간이 아니다 — 트라이컬러가 아니라 M 레드 단색을 쓴다. */
  #error .rule { flex: none; width: 4rem; height: 3px; background: #e22718; }
  #error .name { text-transform: uppercase; font-weight: 700; letter-spacing: 1.4px; font-size: 0.9em; }
  #error .message {
    color: var(--vscode-errorForeground, #f14c4c);
    max-width: 48rem; word-break: break-word; white-space: pre-wrap;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em;
  }

  #panel {
    position: absolute; top: 0.75rem; right: 0.75rem; width: 13.5rem;
    display: flex; flex-direction: column;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground);
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    font-size: 0.85em;
  }
  #panel[hidden] { display: none; }
  #panel label {
    display: flex; align-items: center; gap: 0.5rem;
    cursor: pointer; user-select: none; font-size: 0.8em;
  }
  #panel select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent);
    font-family: inherit; font-size: inherit; padding: 0.125rem 0.25rem;
  }
  #panel button.action {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    font: inherit; font-size: 0.8em; text-transform: uppercase;
    font-weight: 700; letter-spacing: 1.4px;
    padding: 0.125rem 0.5rem; cursor: pointer; white-space: nowrap;
  }

  /* 늘 열려 있는 머리 — 치수와 모델 단위. 패널 섹션이 아니다. */
  .panel-head {
    display: flex; flex-direction: column; gap: 0.5rem;
    padding: 0.625rem 0.75rem 0.75rem;
  }
  .caption { font-size: 0.8em; color: var(--vscode-descriptionForeground); }

  #dimensions {
    display: grid; grid-template-columns: auto 1fr;
    gap: 0.125rem 0.625rem; align-items: baseline;
  }
  #dimensions .value {
    font-family: var(--vscode-editor-font-family, monospace);
    font-weight: 700; font-size: 1.45em; line-height: 1.15;
    text-align: right; font-variant-numeric: tabular-nums;
  }

  #unit-row, #background-row {
    display: flex; align-items: center; gap: 0.5rem; justify-content: space-between;
  }

  /* 패널 섹션 — 접었다 펼 수 있는 컨트롤 묶음. */
  .panel-section {
    display: flex; flex-direction: column;
    border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
  }
  .panel-section[hidden] { display: none; }
  .section-header {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    width: 100%; box-sizing: border-box; padding: 0.4375rem 0.75rem;
    background: none; border: none; color: inherit;
    font-family: inherit; font-size: 0.8em; text-align: left; cursor: pointer;
  }
  .section-header:hover { background: var(--vscode-list-hoverBackground); }
  .section-header:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .section-header .chevron {
    color: var(--vscode-descriptionForeground); letter-spacing: 0; font-size: 0.9em;
  }
  .section-body {
    display: flex; flex-direction: column; gap: 0.375rem;
    padding: 0 0.75rem 0.75rem;
  }
  /* display:flex 가 hidden 속성을 덮으므로 명시적으로 되돌린다. */
  .section-body[hidden] { display: none; }

  /*
   * 내비게이션 큐브 — 뷰포트 좌상단. 패널의 right: 0.75rem 과 대칭 위치다.
   *
   * 크기 134px = 큐브 90 + 화살표 여백 22 x 2 다 — navCube.ts 의 BOX_SIZE 와 **같아야** 한다.
   * 그렇지 않으면 뷰박스와 CSS 픽셀의 1:1 대응이 깨지고 라벨 배치 행렬이 어긋난다.
   *
   * **좁은 뷰포트에서는 패널과 겹친다 — 알려진 한계이고, 화살표가 들어오면서 나빠졌다.**
   * 재실측(320x400): 큐브 x 12-146 · 패널 x 90-308 로 **56px 띠**가 겹치고(90px 상자 시절에는
   * 12px 였다), DOM 순서상 뒤인 패널이 그 띠의 클릭을 가져간다. **띠가 생기기 시작하는 폭**도
   * 332 -> **376px** (146 + 218 + 12)로 올라갔다(옛 90px 상자는 102 + 218 + 12 = 332 였다).
   *
   * **두 기준을 섞지 말 것** — 띠가 생기는 폭과 조작기가 실제로 먹히는 폭은 다르다. 폭을
   * 1px 씩 줄이며 각 조작기 중심의 elementFromPoint 를 다시 쟀다(패널 좌변 = 폭 - 230):
   *   - 오른쪽 화살표: 폭 366 까지 자기 자신, **365 부터 패널**(중심 x = 135)
   *   - 홈 버튼: 폭 358 까지 자기 자신, **357 부터 패널**(중심 x = 127)
   * 즉 둘이 깨지는 간격은 **8px** 이고, 띠가 생기는 376 에서 곧바로 깨지는 것도 아니다.
   * 그 아래로는 맞히는 것이 바뀐다 — 340/320 에서 홈 버튼 중심은 label[for=unit](실측:
   * textContent "Unit"), 오른쪽 화살표는 dimensions · dim-y 다. 셋 다 클릭해도 값이 바뀌지는
   * 않지만(label 이 select 로 포커스를 넘길 뿐이다) **조작기 둘을 통째로 잃는다** — part 1/2
   * 실측대로 정면 자세에서는 인접 4면이 후면 제거되므로, 오른쪽 화살표가 이웃 면으로 가는
   * 유일한 수단이다. 즉 360px 대에서는 큐브만으로 이웃 면에 갈 길이 사라진다.
   * 홈 버튼을 왼쪽으로 옮기면 그것만은 피할 수 있으나 그 자리는 이제 축 삼각대가 쓰고 있고,
   * 오른쪽 아래는 plan 이 지정한 위치다.
   * **축 삼각대만은 이 띠에 들어오지 않는다** — 실측(320x400): 삼각대 x 18.33-47.44 vs 패널
   * 좌변 90 으로 겹침 0px 이고, 애초에 pointer-events: none 이라 클릭을 다투지도 않는다.
   *
   * 그래도 고치지 않는다 — 회피 두 경로(패널을 좁힌다 / 큐브를 패널 위로 올린다)가 모두 정상
   * 폭 쪽을 나쁘게 만들고, 패널 위치는 plan 의 DoD 가 지키는 값이다. 화살표를 큐브 안으로
   * 넣는 세 번째 안도 기각했다: 큐브가 58px 로 줄면 라벨(7 뷰박스 단위)이 면 밖으로 나간다.
   *
   * svg 는 pointer-events: none 이고 클릭 대상 path 만 auto 다 — 큐브 상자의 빈 공간
   * (꼭짓점 사이의 여백)을 드래그하면 그 아래 캔버스가 그대로 궤도 회전을 받아야 한다.
   * 면 채움은 currentColor + 낮은 불투명도이므로 테마 전환이 JS 없이 따라온다.
   * (이 블록은 템플릿 리터럴 안이다 — 주석에 백틱을 쓰면 문자열이 끊긴다.)
   */
  #nav-cube {
    position: absolute; top: 0.75rem; left: 0.75rem; width: 134px; height: 134px;
    pointer-events: none; color: var(--vscode-editorWidget-foreground);
  }
  #nav-cube[hidden] { display: none; }
  /* 외접반지름에 딱 맞춘 투영이라 폴리곤이 상자 경계에 닿는다 — 테두리 선이 반쪽 잘리지
     않도록 넘침을 허용한다. */
  #nav-cube svg { display: block; width: 100%; height: 100%; overflow: visible; }
  #nav-cube .region {
    fill: currentColor; fill-opacity: 0.1;
    stroke: var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    stroke-width: 1;
  }
  #nav-cube .region.clickable { pointer-events: auto; cursor: pointer; }
  #nav-cube .region.clickable:hover { fill-opacity: 0.3; }
  /* 라벨도 대문자 + 1.4px 트래킹 + 700 이다 — 패널과 같은 "machined" 서명.
     7px 는 CSS px 가 아니라 viewBox 사용자 단위(134 = 상자 한 변)다 — 실측으로 상자를 90 -> 180px
     로 키우면 라벨 렌더 폭이 20.5 -> 40.99px 로 정확히 2배가 되고 computed style 은 그대로 7px 다.
     즉 라벨은 패널 글자가 아니라 **큐브 크기**를 따른다. em 으로 바꾸면 면과 무관하게 커져
     라벨이 면 밖으로 나간다 — 스케일을 원하면 상자 크기(위 134px = 큐브 90 + 여백) 쪽을
     손대야 한다. 여백을 위한 translate 는 배율이 없으므로 라벨 크기에 영향이 없다. */
  #nav-cube .label {
    fill: currentColor; font-size: 7px; font-weight: 700; letter-spacing: 1.4px;
    text-transform: uppercase; text-anchor: middle; dominant-baseline: middle;
  }
  /* 4방향 화살표 — 큐브 바깥 상·하·좌·우. 면보다 진하게 채워 조작기로 읽히게 한다.
     색은 currentColor 이므로 테마를 그대로 따르고, 삼각형이라 모서리 반경이 애초에 없다
     (RGB 는 축 삼각대에서만 쓴다 — ADR 260826-094348 · 260828-204140). */
  #nav-cube .arrow {
    fill: currentColor; fill-opacity: 0.45;
    pointer-events: auto; cursor: pointer;
  }
  #nav-cube .arrow:hover { fill-opacity: 0.9; }
  /* 홈 버튼 — 큐브 오른쪽 아래의 작은 등각 큐브. 채움은 화살표와 같고, 안쪽 모서리 3개를
     드러내는 선을 더한다(선이 없으면 육각형으로만 읽힌다). 선도 currentColor 이므로 테마와
     대비 관계가 채움과 함께 움직인다 — 테두리 토큰을 쓰면 다크/라이트 한쪽에서 묻힌다.
     **안쪽 모서리는 별도 path 다** — 실루엣과 같은 path 에 넣으면 감김 방향이 반대인 삼각형이
     채움을 상쇄해 아이콘에 구멍이 뚫린다(navCube.ts 의 homeCubePaths 실측 주석).
     pointer-events: none 이라 실루엣 위에 그려도 히트 영역에 구멍을 내지 않고, :hover 도
     그대로 실루엣이 받는다. */
  #nav-cube .home {
    fill: currentColor; fill-opacity: 0.45;
    stroke: currentColor; stroke-opacity: 0.85; stroke-width: 1;
    pointer-events: auto; cursor: pointer;
  }
  #nav-cube .home:hover { fill-opacity: 0.9; }
  #nav-cube .home-edges {
    fill: none;
    stroke: currentColor; stroke-opacity: 0.85; stroke-width: 1;
    pointer-events: none;
  }
  /* RGB 축 삼각대 — 큐브 왼쪽 아래. 색은 navCube.ts 의 TRIAD_AXES 가 attribute 로 붙이므로
     이 CSS 는 색을 모른다(hex 를 스타일시트로 번지게 하지 않는다 — ADR 260826-094348 은 chrome 의
     모든 색을 var(--vscode-*) 로 묶었고, 축 색만이 두 번째 예외다 — ADR 260828-204140).
     pointer-events: none 을 명시한다: svg 에서 물려받는 값과 같지만, .arrow / .home 처럼 auto 로
     여는 것이 이 상자의 관용이라 삼각대가 클릭을 먹지 않는 것은 우연이 아니라 요구다 — 삼각대
     위를 드래그하면 아래 캔버스가 궤도 회전을 받아야 한다.
     문자는 라벨과 같은 700 이되 트래킹이 없다 — 한 글자에 자간은 위치만 밀어낸다. */
  #nav-cube .triad { pointer-events: none; }
  #nav-cube .triad-line { stroke-width: 1.5; }
  /* 문자 뒤에 **바탕색 헤일로**를 깐다 — 장식이 아니라 판독성 요구다. 시선과 나란한 축은 투영
     길이가 0 이라 문자가 삼각대 원점에 놓이고, 나머지 두 축 선이 정확히 그 점에서 출발한다
     (실측 FRONT 정규 자세: Z 문자 (21,113) = 원점 · X 선 (21,113)->(8,113) · Y 선
     (21,113)->(21,100)). 헤일로가 없으면 1.5px 선 두 개가 3.42x7px 글리프의 가운데와 위를
     관통해 얼룩으로만 보인다. 붕괴하는 축은 자세에 따라 바뀌므로(FRONT/BACK->Z ·
     RIGHT/LEFT->X · TOP/BOTTOM->Y) 큐브 면 클릭이 만드는 6개 자세 전부에서 셋 중 하나가 이
     상태가 된다. 문자를 못 읽으면 RGB 예외의 근거 절반(색맹 전달)이 무너진다 — ADR 260828-204140.
     paint-order 를 뒤집어야 획이 글자 **아래로** 간다: 기본 순서면 배경색 획이 글자 위에 덮여
     글자를 갉아먹는다. 색은 body 와 같은 커스텀 속성이라 배경 고정 모드에서도 어긋나지 않는다. */
  #nav-cube .triad-label {
    font-size: 6px; font-weight: 700;
    text-anchor: middle; dominant-baseline: middle;
    paint-order: stroke fill;
    stroke: var(--model-lens-backdrop, var(--vscode-editor-background));
    stroke-width: 2.5px; stroke-linejoin: round;
  }

  #labels { position: absolute; inset: 0; pointer-events: none; }
  /* 측정 점 마커. **크기를 픽셀로 고정한다** — 3D 구였을 때는 원근 때문에 확대하면 커지고
     멀어지면 작아졌다. 색은 measurement.ts 의 재질과 같은 값이다(주황 = 측정, 하늘색 = 선택). */
  .measure-marker {
    position: absolute; top: 0; left: 0;
    width: 0.625rem; height: 0.625rem; border-radius: 50%;
    background: rgb(255, 140, 26);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  }
  .measure-marker.selected { background: rgb(64, 204, 255); }
  .measure-label {
    position: absolute; top: 0; left: 0; white-space: nowrap;
    padding: 0.0625rem 0.375rem;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground);
    border: 1px solid var(--vscode-editorWidget-border, transparent);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.8em; font-variant-numeric: tabular-nums;
  }
  /*
   * 선택 표시는 색과 **형태**를 함께 바꾼다 — 색에만 의존하면 색맹 사용자에게 전달되지 않는다.
   * outline 을 지우지 말 것 (ADR 260826-094348).
   */
  .measure-label.selected {
    outline: 1px solid var(--vscode-focusBorder);
    color: var(--vscode-textLink-foreground);
  }

  #measure-list { display: flex; flex-direction: column; gap: 0.125rem; max-height: 11rem; overflow-y: auto; }
  #measure-list:empty::after {
    content: 'No measurements';
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase; font-weight: 700; letter-spacing: 1.4px; font-size: 0.8em;
  }
  #measure-list .row { display: flex; align-items: center; gap: 0.375rem; }
  #measure-list .row button.pick {
    flex: 1; text-align: right; background: none; border: none; padding: 0.0625rem 0.25rem;
    color: inherit; font: inherit;
    font-family: var(--vscode-editor-font-family, monospace);
    font-variant-numeric: tabular-nums; cursor: pointer;
  }
  #measure-list .row button.pick:hover { background: var(--vscode-list-hoverBackground); }
  #measure-list .row.selected button.pick { color: var(--vscode-textLink-foreground); }
  #measure-list .row button.remove {
    background: none; border: none; color: var(--vscode-descriptionForeground);
    cursor: pointer; padding: 0 0.125rem; font: inherit;
  }
  #measure-list .row button.remove:hover { color: var(--vscode-errorForeground, #f14c4c); }

  #measure-actions { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  #measure-actions .state { color: var(--vscode-descriptionForeground); font-size: 0.8em; }

  #animation-row { display: flex; align-items: center; gap: 0.5rem; }
  #animation-row select { flex: 1; min-width: 0; }
</style>
</head>
<body>
<div id="root" data-config="${config}">
  <canvas id="canvas" tabindex="0"></canvas>

  <!-- 내비게이션 큐브. 안의 SVG 는 navCube.ts 가 채운다. -->
  <div id="nav-cube"></div>

  <div id="panel" hidden>
    <div class="m-stripe"></div>

    <div class="panel-head">
      <span class="caption">Dimensions</span>
      <div id="dimensions">
        <span class="axis caption">X</span><span class="value" id="dim-x">—</span>
        <span class="axis caption">Y</span><span class="value" id="dim-y">—</span>
        <span class="axis caption">Z</span><span class="value" id="dim-z">—</span>
      </div>

      <div id="unit-row">
        <label for="unit">Unit</label>
        <select id="unit">
${unitOptions}
        </select>
      </div>
    </div>

    <section class="panel-section" id="animation-section" hidden>
      <button type="button" class="section-header" id="animation-header"
              aria-expanded="true" aria-controls="animation-body">
        <span>Animation</span><span class="chevron" aria-hidden="true">▾</span>
      </button>
      <div class="section-body" id="animation-body">
        <div id="animation-row">
          <button type="button" class="action" id="animation-toggle">Pause</button>
          <select id="animation-select" aria-label="Animation"></select>
        </div>
      </div>
    </section>

    <section class="panel-section" id="measure-section">
      <button type="button" class="section-header" id="measure-header"
              aria-expanded="false" aria-controls="measure-body">
        <span>Measure</span><span class="chevron" aria-hidden="true">▸</span>
      </button>
      <div class="section-body" id="measure-body" hidden>
        <label><input type="checkbox" id="toggle-measure" /> Enabled</label>
        <label><input type="checkbox" id="toggle-snap" checked /> Vertex snap</label>
        <div id="measure-actions">
          <span class="state" id="measure-state"></span>
          <button type="button" class="action" id="measure-clear">Clear all</button>
        </div>
        <div id="measure-list"></div>
      </div>
    </section>

    <section class="panel-section" id="display-section">
      <button type="button" class="section-header" id="display-header"
              aria-expanded="false" aria-controls="display-body">
        <span>Display</span><span class="chevron" aria-hidden="true">▸</span>
      </button>
      <div class="section-body" id="display-body" hidden>
        <label><input type="checkbox" id="toggle-grid"${params.grid ? ' checked' : ''} /> Grid</label>
        <div id="background-row">
          <label for="background-select">Background</label>
          <select id="background-select">
${backgroundOptions}
          </select>
        </div>
      </div>
    </section>

    <section class="panel-section" id="debug-section">
      <button type="button" class="section-header" id="debug-header"
              aria-expanded="false" aria-controls="debug-body">
        <span>Debug</span><span class="chevron" aria-hidden="true">▸</span>
      </button>
      <div class="section-body" id="debug-body" hidden>
        <label><input type="checkbox" id="toggle-inspector" /> Inspector</label>
      </div>
    </section>
  </div>

  <div id="labels"></div>

  <div class="overlay" id="loading">
    <div class="m-stripe"></div>
    <div class="overlay-title">Loading model</div>
    <div class="overlay-detail">${escapeText(params.fileName)}</div>
    <div class="overlay-detail" id="loading-progress"></div>
  </div>

  <div class="overlay" id="error" hidden>
    <div class="rule"></div>
    <div class="name"></div>
    <div class="message"></div>
  </div>
</div>
<script type="module" src="${escapeAttribute(params.scriptUri)}"></script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
