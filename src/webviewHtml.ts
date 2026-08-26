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
    background: var(--vscode-editor-background);
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

  #labels { position: absolute; inset: 0; pointer-events: none; }
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
