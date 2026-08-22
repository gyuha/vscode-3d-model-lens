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
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  #root { position: relative; width: 100%; height: 100vh; }
  #canvas { width: 100%; height: 100%; display: block; outline: none; touch-action: none; }

  .overlay {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    pointer-events: none; text-align: center; padding: 2rem; box-sizing: border-box;
  }
  .overlay[hidden] { display: none; }
  #error {
    pointer-events: auto; flex-direction: column; gap: 0.75rem;
    background: var(--vscode-editor-background);
  }
  #error .name { font-weight: 600; }
  #error .message {
    color: var(--vscode-errorForeground, #f14c4c);
    max-width: 48rem; word-break: break-word; white-space: pre-wrap;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  #panel {
    position: absolute; top: 0.75rem; right: 0.75rem;
    display: flex; flex-direction: column; gap: 0.375rem;
    padding: 0.625rem 0.75rem; border-radius: 4px;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground);
    border: 1px solid var(--vscode-editorWidget-border, transparent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    font-size: 0.85em;
  }
  #panel[hidden] { display: none; }
  #panel label { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none; }
  #panel hr {
    border: none; border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    margin: 0.125rem 0;
  }

  #dimensions { display: grid; grid-template-columns: auto 1fr; gap: 0.125rem 0.5rem; }
  #dimensions .axis { color: var(--vscode-descriptionForeground); }
  #dimensions .value {
    font-family: var(--vscode-editor-font-family, monospace);
    text-align: right; font-variant-numeric: tabular-nums;
  }

  #unit-row, #background-row {
    display: flex; align-items: center; gap: 0.5rem; justify-content: space-between;
  }
  #labels { position: absolute; inset: 0; pointer-events: none; }
  .measure-label {
    position: absolute; top: 0; left: 0; white-space: nowrap;
    padding: 0.0625rem 0.375rem; border-radius: 3px;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground);
    border: 1px solid var(--vscode-editorWidget-border, transparent);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.8em; font-variant-numeric: tabular-nums;
  }
  .measure-label.selected {
    outline: 1px solid var(--vscode-focusBorder);
    color: var(--vscode-textLink-foreground);
  }

  #measure-list { display: flex; flex-direction: column; gap: 0.125rem; max-height: 11rem; overflow-y: auto; }
  #measure-list:empty::after {
    content: 'Turn on measure mode and pick two points';
    color: var(--vscode-descriptionForeground); font-style: italic;
  }
  #measure-list .row { display: flex; align-items: center; gap: 0.375rem; }
  #measure-list .row button.pick {
    flex: 1; text-align: right; background: none; border: none; padding: 0.0625rem 0.25rem;
    color: inherit; font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; border-radius: 2px;
  }
  #measure-list .row button.pick:hover { background: var(--vscode-list-hoverBackground); }
  #measure-list .row.selected button.pick { color: var(--vscode-textLink-foreground); }
  #measure-list .row button.remove {
    background: none; border: none; color: var(--vscode-descriptionForeground);
    cursor: pointer; padding: 0 0.125rem; font: inherit;
  }
  #measure-list .row button.remove:hover { color: var(--vscode-errorForeground, #f14c4c); }

  #measure-actions { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  #measure-actions .state { color: var(--vscode-descriptionForeground); }
  #measure-actions button {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    border-radius: 2px; font: inherit; padding: 0.0625rem 0.375rem; cursor: pointer;
  }

  #animation-row { display: flex; align-items: center; gap: 0.5rem; }
  #animation-row[hidden], #animation-sep[hidden] { display: none; }
  #animation-row select { flex: 1; min-width: 0; }
  #animation-row button {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    border-radius: 2px; font: inherit; padding: 0.0625rem 0.375rem; cursor: pointer;
    white-space: nowrap;
  }

  #unit-row select, #animation-row select, #background-row select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent);
    font-family: inherit; font-size: inherit; padding: 0.125rem 0.25rem; border-radius: 2px;
  }
</style>
</head>
<body>
<div id="root" data-config="${config}">
  <canvas id="canvas" tabindex="0"></canvas>

  <div id="panel" hidden>
    <div id="dimensions">
      <span class="axis">X</span><span class="value" id="dim-x">—</span>
      <span class="axis">Y</span><span class="value" id="dim-y">—</span>
      <span class="axis">Z</span><span class="value" id="dim-z">—</span>
    </div>

    <div id="unit-row">
      <label for="unit">Unit</label>
      <select id="unit">
${unitOptions}
      </select>
    </div>

    <hr id="animation-sep" hidden />

    <div id="animation-row" hidden>
      <button type="button" id="animation-toggle">Pause</button>
      <select id="animation-select" aria-label="Animation"></select>
    </div>

    <hr />

    <div id="measure-actions">
      <span class="state" id="measure-state">Measure off</span>
      <button type="button" id="measure-clear">Clear all</button>
    </div>
    <label><input type="checkbox" id="toggle-snap" checked /> Vertex snap</label>
    <div id="measure-list"></div>

    <hr />

    <label><input type="checkbox" id="toggle-grid" checked /> Grid</label>
    <label><input type="checkbox" id="toggle-axes" checked /> Axes</label>
    <label><input type="checkbox" id="toggle-wireframe" /> Wireframe</label>

    <div id="background-row">
      <label for="background-select">Background</label>
      <select id="background-select">
${backgroundOptions}
      </select>
    </div>

    <hr />

    <label><input type="checkbox" id="toggle-inspector" /> Inspector</label>
  </div>

  <div id="labels"></div>

  <div class="overlay" id="loading">Loading model…</div>

  <div class="overlay" id="error" hidden>
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
