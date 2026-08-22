import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

// esbuild 는 outdir 을 비우지 않는다. 지우지 않으면 이전 빌드의 chunk 가 남아
// "CDN 참조 0건" 같은 산출물 검사가 유령 파일 때문에 실패한다.
rmSync('dist', { recursive: true, force: true });
rmSync('out', { recursive: true, force: true });
const prod = !watch;

const shared = {
  bundle: true,
  minify: prod,
  sourcemap: prod ? false : 'inline',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
};

/** 확장 호스트 — Node 상에서 CommonJS 로 돌고 `vscode` 는 런타임이 제공한다. */
const extensionConfig = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

/**
 * 웹뷰 — ESM + code splitting.
 * 이 형식은 Inspector(파트 2/4) 때문에 선택된 것이다: `await import()` 로 로드하는
 * 무거운 모듈을 별도 chunk 로 떼어내려면 ESM 이어야 한다. chunk 의 상대 경로는
 * importing module 의 URL(이미 웹뷰 URI) 기준으로 해결되므로 <base> 태그가 필요 없다.
 * (ADR 260822-115455b)
 */
const webviewConfig = {
  ...shared,
  // Inspector 가 동적 import 하는 노드/GUI 에디터 5종을 스텁으로 치환한다.
  // 읽기 전용 뷰어에서는 범위 밖이고, 약 10 MB 와 다수의 외부 URL 을 함께 덜어낸다.
  // 근거는 src/webview/unsupportedEditor.ts 주석 참조.
  alias: {
    // Inspector 의 quickCreateToolsService 가 로더 6종 + glTF 확장 42개를 전부 등록해
    // 우리 선별 등록을 런타임에 무효화한다. no-op 으로 치환한다.
    '@babylonjs/loaders/dynamic.js': './src/webview/noopLoaderRegistration.ts',
    '@babylonjs/node-editor': './src/webview/unsupportedEditor.ts',
    '@babylonjs/node-geometry-editor': './src/webview/unsupportedEditor.ts',
    '@babylonjs/node-particle-editor': './src/webview/unsupportedEditor.ts',
    '@babylonjs/node-render-graph-editor': './src/webview/unsupportedEditor.ts',
    '@babylonjs/gui-editor': './src/webview/unsupportedEditor.ts',
  },
  entryPoints: ['src/webview/main.ts'],
  outdir: 'dist/webview',
  entryNames: 'viewer',
  chunkNames: 'chunk-[name]-[hash]',
  assetNames: 'asset-[name]-[hash]',
  platform: 'browser',
  format: 'esm',
  splitting: true,
  target: 'es2022',
};

/** 확장 호스트 통합 테스트 — @vscode/test-cli 가 Mocha 로 CJS 를 실행한다. */
const integrationTestConfig = {
  ...shared,
  minify: false,
  entryPoints: ['test/integration/editor.test.ts'],
  outfile: 'out/test/integration/editor.test.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode', 'mocha'],
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watch 시작');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(integrationTestConfig),
  ]);
}
