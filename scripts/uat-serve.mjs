// 웹뷰 번들을 브라우저에서 그대로 띄우는 UAT 하니스 (`npm run uat`).
//
// VS Code 웹뷰의 조건을 최대한 재현한다:
//   - HTML 은 확장이 실제로 쓰는 `buildWebviewHtml()` 로 생성한다 (CSP 포함)
//   - 같은 CSP 를 HTTP 헤더로도 붙인다 — 외부 요청이 실제로 차단되는지 확인하기 위해
//   - 모델·환경 텍스처·엔트리 스크립트를 모두 같은 오리진에서 서빙한다
//
// 이건 사람 눈으로 F5 를 대신하는 도구이며, 자동 회귀 테스트는 별도 작업
// (playwright-webview-render-tests)의 몫이다.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentSecurityPolicy, buildWebviewHtml } from '../out/uat/webviewHtml.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.UAT_PORT ?? 39176);

const MOUNTS = {
  '/webview': join(ROOT, 'dist', 'webview'),
  '/media': join(ROOT, 'media'),
  '/fixtures': join(ROOT, 'test', 'fixtures'),
};

/**
 * `acquireVsCodeApi` 셰임.
 *
 * VS Code 웹뷰의 `setState`/`getState` 는 "이 웹뷰가 리로드되어도 유지된다"는 의미이고,
 * `sessionStorage` 가 정확히 같은 수명을 갖는다. 그래서 `page.reload()` 가 확장에서와 동일한
 * 저장·복원 경로를 그대로 통과한다. 키를 픽스처별로 나누는 것도 VS Code 의 "문서별 상태"와 맞다.
 *
 * 인라인 스크립트는 CSP(`script-src ${cspSource}`)에 막히므로 같은 오리진의 별도 파일로 서빙한다 —
 * 하니스의 CSP 를 느슨하게 만들지 않기 위해서다.
 */
const VSCODE_API_SHIM = `(function () {
  var params = new URLSearchParams(location.search);
  var key = 'modelLens.uatState:' + (params.get('fixture') || '');
  var state;
  try {
    var raw = sessionStorage.getItem(key);
    state = raw === null ? undefined : JSON.parse(raw);
  } catch (e) {
    state = undefined;
  }
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (message) {
        window.dispatchEvent(new CustomEvent('uat:tohost', { detail: message }));
      },
      getState: function () {
        return state;
      },
      setState: function (next) {
        state = next;
        try {
          sessionStorage.setItem(key, JSON.stringify(next));
        } catch (e) {
          /* 저장 실패는 무시한다 — 확장에서도 setState 는 실패를 던지지 않는다 */
        }
      },
    };
  };
})();
`;

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.stl': 'model/stl',
  '.bin': 'application/octet-stream',
  '.env': 'application/octet-stream',
  '.png': 'image/png',
};

// VS Code 가 웹뷰에 주입하는 테마 변수 중 뷰어가 쓰는 것만 재현한다. UAT 전용 스캐폴딩.
const THEMES = {
  dark: { background: '#1f1f1f', foreground: '#cccccc' },
  light: { background: '#ffffff', foreground: '#3b3b3b' },
};

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const origin = `http://127.0.0.1:${PORT}`;
  const csp = buildContentSecurityPolicy(origin);

  if (url.pathname === '/uat/vscode-shim.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    res.end(VSCODE_API_SHIM);
    return;
  }

  const mount = Object.keys(MOUNTS).find((m) => url.pathname.startsWith(`${m}/`));
  if (mount) {
    const file = join(MOUNTS[mount], normalize(url.pathname.slice(mount.length)));
    if (!file.startsWith(MOUNTS[mount]) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
    return;
  }

  const fixture = url.searchParams.get('fixture') ?? 'cube.glb';
  const theme = THEMES[url.searchParams.get('theme') ?? 'dark'] ?? THEMES.dark;
  const pluginExtension = extname(fixture).toLowerCase();

  let html = buildWebviewHtml({
    cspSource: origin,
    scriptUri: `${origin}/webview/viewer.js`,
    modelUri: `${origin}/fixtures/${fixture}?uat=1`,
    environmentUri: `${origin}/media/environment.env`,
    assetBaseUri: `${origin}/media`,
    fileName: fixture,
    pluginExtension,
    background: url.searchParams.get('background') ?? 'theme',
    grid: url.searchParams.get('grid') !== 'false',
    unitSetting: url.searchParams.get('unit') ?? 'auto',
    decimals: Number(url.searchParams.get('decimals') ?? 3),
  });

  // `acquireVsCodeApi` 셰임을 module 스크립트보다 먼저 실행시킨다.
  // module 은 defer 이므로, head 의 classic 스크립트가 항상 앞선다.
  html = html.replace('</head>', `<script src="${origin}/uat/vscode-shim.js"></script></head>`);

  // 테마 변수를 주입한다 — 실제 웹뷰에서는 VS Code 가 이 역할을 한다.
  html = html.replace(
    '</head>',
    `<style>:root{--vscode-editor-background:${theme.background};--vscode-editor-foreground:${theme.foreground};--vscode-editorWidget-background:${theme.background};--vscode-editorWidget-foreground:${theme.foreground};--vscode-errorForeground:#f14c4c}</style></head>`,
  );

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    // 실제 웹뷰와 같은 CSP 를 헤더로도 강제한다.
    'Content-Security-Policy': csp,
  });
  res.end(html);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`UAT 서버: http://127.0.0.1:${PORT}/?fixture=cube.glb&theme=dark`);
  console.log(`  픽스처: cube.gltf · cube.glb · cube.stl · animated.glb · broken.glb`);
  console.log(`  테마:   dark · light`);
  console.log(`  단위:   ?unit=auto|mm|cm|m|in   자릿수: ?decimals=0..10`);
  console.log(`  배경:   ?background=theme|light|dark`);
  console.log(`  그리드: ?grid=false (기본 true)`);
});
