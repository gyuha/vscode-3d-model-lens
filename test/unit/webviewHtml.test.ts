import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, buildWebviewHtml } from '../../src/webviewHtml';

const CSP_SOURCE = 'https://file+.vscode-resource.vscode-cdn.net';

const params = {
  cspSource: CSP_SOURCE,
  scriptUri: `${CSP_SOURCE}/dist/webview/viewer.js`,
  modelUri: `${CSP_SOURCE}/models/cube.glb?id=abc`,
  environmentUri: `${CSP_SOURCE}/media/environment.env`,
  assetBaseUri: `${CSP_SOURCE}/media`,
  fileName: 'cube.glb',
  pluginExtension: '.glb' as const,
  backgroundColor: '',
  unitSetting: 'auto' as const,
  decimals: 3,
};

describe('buildContentSecurityPolicy', () => {
  const csp = buildContentSecurityPolicy(CSP_SOURCE);

  it('6개 지시자를 모두 포함한다', () => {
    for (const directive of [
      "default-src 'none'",
      `script-src ${CSP_SOURCE}`,
      `connect-src ${CSP_SOURCE}`,
      `img-src ${CSP_SOURCE} blob: data:`,
      `style-src ${CSP_SOURCE} 'unsafe-inline'`,
      'worker-src blob:',
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("script-src 에 'unsafe-inline' 을 열지 않는다 — 설정은 data 속성으로 넘기므로 필요 없다", () => {
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('connect-src 를 반드시 포함한다 — 없으면 Babylon 의 모델 XHR 이 조용히 막힌다', () => {
    expect(csp).toMatch(/connect-src\s+\S+/);
  });
});

describe('buildWebviewHtml', () => {
  const html = buildWebviewHtml(params);

  it('CSP meta 태그와 엔트리 스크립트 URI 를 담는다', () => {
    expect(html).toContain(`content="${buildContentSecurityPolicy(CSP_SOURCE)}"`);
    expect(html).toContain(`src="${params.scriptUri}"`);
    expect(html).toContain('type="module"');
  });

  it('모델·환경 URI 와 pluginExtension 을 data-config 로 넘긴다', () => {
    const match = /data-config="([^"]*)"/.exec(html);
    expect(match).not.toBeNull();
    const config = JSON.parse(
      match![1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    );
    expect(config.modelUri).toBe(params.modelUri);
    expect(config.environmentUri).toBe(params.environmentUri);
    expect(config.assetBaseUri).toBe(params.assetBaseUri);
    expect(config.pluginExtension).toBe('.glb');
    expect(config.fileName).toBe('cube.glb');
  });

  it('인라인 <script> 로 설정을 주입하지 않는다', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });

  it('파일명에 섞인 HTML 특수문자를 이스케이프한다', () => {
    const html2 = buildWebviewHtml({ ...params, fileName: '<img src=x onerror=1>.glb' });
    expect(html2).not.toContain('<img src=x');
    expect(html2).toContain('&lt;img');
  });

  it('배경색을 지정하지 않으면 VS Code 편집기 배경 변수를 쓴다', () => {
    expect(html).toContain('var(--vscode-editor-background)');
  });

  it('축을 X / Y / Z 로만 표기한다 — 가로/높이/깊이로 추측하지 않는다', () => {
    expect(html).toContain('id="dim-x"');
    expect(html).toContain('id="dim-y"');
    expect(html).toContain('id="dim-z"');
    expect(html).not.toMatch(/가로|높이|깊이|width.*height.*depth/i);
  });

  it('단위 드롭다운이 units.ts 의 목록을 그대로 낸다', () => {
    for (const unit of ['auto', 'mm', 'cm', 'm', 'in']) {
      expect(html).toContain(`value="${unit}"`);
    }
  });

  it('현재 단위 설정이 selected 로 표시된다', () => {
    const mm = buildWebviewHtml({ ...params, unitSetting: 'mm' });
    expect(mm).toContain('value="mm" selected');
    expect(mm).not.toContain('value="auto" selected');
  });

  it('단위 설정과 자릿수를 data-config 로 넘긴다', () => {
    const custom = buildWebviewHtml({ ...params, unitSetting: 'cm', decimals: 5 });
    const match = /data-config="([^"]*)"/.exec(custom);
    const config = JSON.parse(
      match![1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    );
    expect(config.unitSetting).toBe('cm');
    expect(config.decimals).toBe(5);
  });
});
