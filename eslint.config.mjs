import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      'test/fixtures/**',
      // @vscode/test-cli 가 내려받는 VS Code 본체
      '.vscode-test/**',
      'playwright-report/**',
      'test-results/**',
      '*.vsix',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 빌드/생성 스크립트는 Node 상에서 직접 실행된다.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
);
