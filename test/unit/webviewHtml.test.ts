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
  background: 'theme' as const,
  grid: true,
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

  it('측정 모드 체크박스가 있고 checked 가 붙어 있지 않다 — 측정은 항상 꺼진 채 시작한다', () => {
    expect(html).toContain('id="toggle-measure"');
    const checkbox = /<input type="checkbox" id="toggle-measure"([^>]*)>/.exec(html);
    expect(checkbox).not.toBeNull();
    expect(checkbox?.[1]).not.toContain('checked');
  });

  it('빈 측정 목록 플레이스홀더는 사실만 말한다 — 이미 켠 사람에게 켜라고 하지 않는다', () => {
    expect(html).toContain('No measurements');
    expect(html).not.toContain('Turn on measure mode');
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

describe('buildWebviewHtml — 패널 섹션', () => {
  const html = buildWebviewHtml(params);

  it('접히는 섹션 셋은 aria-expanded=false 로 시작한다 — 처음 열면 패널이 작다', () => {
    for (const name of ['measure', 'display', 'debug']) {
      const header = new RegExp(`id="${name}-header"[^>]*aria-expanded="false"`, 's');
      expect(html).toMatch(header);
      expect(html).toMatch(new RegExp(`id="${name}-body" hidden`));
    }
  });

  it('애니메이션 섹션은 통째로 hidden 으로 시작한다 — 그룹이 있는 파일에서만 드러난다', () => {
    expect(html).toMatch(/id="animation-section"[^>]*hidden/);
    // 있으면 펼쳐진 채다 — 재생/일시정지를 한 단계 뒤에 두지 않는다.
    expect(html).toMatch(/id="animation-header"[^>]*aria-expanded="true"/s);
  });

  it('섹션 헤더는 button 이라 키보드로 조작된다 — div 로 만들면 접근성이 끊긴다', () => {
    for (const name of ['animation', 'measure', 'display', 'debug']) {
      expect(html).toMatch(new RegExp(`<button type="button" class="section-header"\\s+id="${name}-header"`));
    }
  });

  it('모서리 반경은 0 아니면 완전한 원뿐이다 — 그 사이는 없다', () => {
    // `DESIGN.md:376` 이 못 박은 이진 규칙이다: *"almost always 0, sometimes circular.
    // Nothing in between."* — 각진 실루엣이 브랜드이고, 원은 **조작 요소**(아이콘 버튼·토글 필,
    // `DESIGN.md:259`)에만 허용된다. 측정 마커는 조작 요소가 아니지만, 3D 구를 DOM 으로 옮기면서
    // 이전과 같은 원형을 유지하기로 결정해 `50%` 를 예외로 둔다.
    // **`4px` 같은 중간값은 여전히 금지다** — 그것이 이 규칙이 실제로 막으려는 것이다.
    const radii = [...html.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
    const inBetween = radii.filter((r) => r !== '50%');
    expect(inBetween, `0 도 원도 아닌 반경: ${inBetween.join(', ')}`).toEqual([]);
  });

  it('M 트라이컬러는 정확히 두 곳에만 쓴다 — 패널 머리와 로딩', () => {
    expect(html.match(/class="m-stripe"/g)).toHaveLength(2);
  });

  it('본문 굵기에 300 을 쓰지 않는다 — 11px 에서 대비를 만들지 못한다 (ADR 260826-094300)', () => {
    expect(html).not.toMatch(/font-weight:\s*300/);
  });

  it('에러 화면의 가로줄은 트라이컬러가 아니라 M 레드 단색이다 — 실패는 브랜드 순간이 아니다', () => {
    expect(html).toMatch(/#error \.rule[^}]*background:\s*#e22718/s);
  });
});
