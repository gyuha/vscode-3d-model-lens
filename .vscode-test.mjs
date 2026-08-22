import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  // 픽스처를 워크스페이스 안에 두고 연다 — 워크스페이스 밖 파일 경로는 유닛 테스트가 덮는다.
  workspaceFolder: 'test/fixtures',
  mocha: { timeout: 30000 },
});
