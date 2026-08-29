import { defineConfig } from '@playwright/test';

// 포트를 고정하면 **다른 프로젝트의 개발 서버가 이 포트를 잡고 있을 때
// `reuseExistingServer` 가 그 서버에 붙어 엉뚱한 앱을 테스트한다** — 자매 프로젝트
// `3d-model-lens` 는 DOM 이 거의 같아 대부분 초록으로 통과해 버려서 알아채기도 어렵다.
// 실제로 한 번 당했다. 충돌하면 `UAT_PORT` 로 비켜 간다.
const PORT = Number(process.env.UAT_PORT ?? 39177);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './test/e2e',
  // 3D 로딩과 Inspector chunk 로드는 소프트웨어 렌더링에서 느리다.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    // 실패 시 원인을 알 수 있는 아티팩트를 남긴다.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      // 헤드리스에서 WebGL2 를 쓰려면 소프트웨어 래스터라이저를 명시해야 한다.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-lcd-text',
      ],
    },
  },
  webServer: {
    // 확장이 실제로 쓰는 buildWebviewHtml() 출력을 같은 CSP 와 함께 서빙한다.
    command: 'npm run uat:serve',
    env: { UAT_PORT: String(PORT) },
    url: `${BASE_URL}/?fixture=cube.glb`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
