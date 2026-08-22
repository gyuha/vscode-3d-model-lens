import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 유닛 테스트만 잡는다. 기본 glob 은 @vscode/test-cli 가 내려받은 VS Code 본체
    // (`.vscode-test/`) 안의 테스트 파일까지 끌어와 실패한다.
    include: ['test/unit/**/*.test.ts'],
    exclude: ['.vscode-test/**', 'dist/**', 'out/**', 'node_modules/**', 'test/e2e/**'],
  },
});
