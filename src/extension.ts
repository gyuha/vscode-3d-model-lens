import * as vscode from 'vscode';
import { ModelLensViewerProvider } from './viewerProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ModelLensViewerProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(ModelLensViewerProvider.viewType, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.commands.registerCommand('modelLens.toggleInspector', () =>
      provider.toggleInspector(),
    ),
    vscode.commands.registerCommand('modelLens.toggleMeasureMode', () =>
      provider.toggleMeasureMode(),
    ),
    vscode.commands.registerCommand('modelLens.togglePanel', () => provider.togglePanel()),
  );
}

export function deactivate(): void {
  // 정리할 전역 자원 없음 — 구독은 context.subscriptions 가 처리한다.
}
