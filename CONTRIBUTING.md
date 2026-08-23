# Contributing

## Development

```bash
npm install
npm run build              # extension host + webview bundles
npm run watch              # watch mode
npm test                   # unit tests (vitest)
npm run test:integration   # extension host integration tests (launches a real VS Code)
npm run test:e2e           # webview render tests (Playwright, headless Chromium)
npm run check:bundle       # check build output for external dependencies
npm run fixtures           # regenerate test fixtures
npm run uat                # serve the webview in a browser (a fast alternative to F5)
npm run package            # produce a .vsix
```

Press F5 to launch the extension development host, then open a model from `test/fixtures/`.

## Verification

Verification comes in three layers.

| Layer | What it catches | Command |
|---|---|---|
| Unit (vitest) | Distance, snapping, unit, and dimension math; CSP generation; fixture integrity. Also runs the real loaders through NullEngine | `npm test` |
| Extension host (`@vscode/test-cli`) | CustomEditor registration, command and setting contributions, title bar exposure | `npm run test:integration` |
| Webview render (Playwright) | **The real traps** — does the CSP block external requests, does the IBL load, are the dimensions right across all three formats, is a distance measured by actual mouse clicks correct | `npm run test:e2e` |

The webview render tests serve the very same `buildWebviewHtml()` output the extension uses, **with the same
CSP applied as an HTTP header**, and clicks are real mouse events — no API that bypasses the interaction.

## Releasing

`README.md` uses relative image paths (`images/…`). `vsce` rewrites them against the `repository` field to
`https://github.com/gyuha/vscode-3d-model-lens/raw/HEAD/images/…`, and `HEAD` resolves to the **default
branch** — so the screenshots must be committed and pushed to `main` *before* packaging, or the marketplace
page shows broken images.

```bash
npm run package            # build + bundle check + vsce package
```
