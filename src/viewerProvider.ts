import * as vscode from 'vscode';
import { isBackgroundMode, type BackgroundMode } from './background';
import { pluginExtensionFor } from './formats';
import type { HostToWebview, WebviewToHost } from './messages';
import { computeLocalResourceRootPaths } from './resourceRoots';
import { UnitMemory } from './unitMemory';
import { isUnitSetting, type UnitSetting } from './units';
import { buildWebviewHtml } from './webviewHtml';

/** 열려 있는 뷰어 하나의 상태. 명령이 "활성 탭"을 찾아 조작하는 데 쓴다. */
interface ViewerSession {
  panel: vscode.WebviewPanel;
  documentUri: vscode.Uri;
  inspectorVisible: boolean;
  measureActive: boolean;
}

export class ModelLensViewerProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'modelLens.viewer';

  private readonly sessions = new Set<ViewerSession>();
  private readonly unitMemory: UnitMemory;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.unitMemory = new UnitMemory(context.workspaceState);

    // 배경은 전역 설정이므로, 한쪽 탭에서 바꿨는데 나란히 열린 다른 탭이 그대로면
    // 고장처럼 보인다. 설정 파일을 손으로 고친 경우도 같은 경로로 따라온다.
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('modelLens.background')) {
          return;
        }
        const background = readBackgroundMode(vscode.workspace.getConfiguration('modelLens'));
        for (const session of this.sessions) {
          void this.send(session, { type: 'setBackground', background });
        }
      }),
    );
  }

  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    // 읽기 전용이므로 문서는 URI 하나만 들고 있으면 된다.
    return { uri, dispose: (): void => {} };
  }

  public resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    const { webview } = webviewPanel;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const config = vscode.workspace.getConfiguration('modelLens');

    // 파일의 디렉터리를 항상 허용 목록에 넣는다 — 이게 없으면 워크스페이스 밖의
    // 파일을 열었을 때 빈 화면이 된다 (ADR 260822-115455a).
    const roots = computeLocalResourceRootPaths(
      document.uri.fsPath,
      workspaceFolder?.uri.fsPath,
      this.context.extensionUri.fsPath,
    ).map((fsPath) => vscode.Uri.file(fsPath));

    webview.options = { enableScripts: true, localResourceRoots: roots };

    const session: ViewerSession = {
      panel: webviewPanel,
      documentUri: document.uri,
      inspectorVisible: false,
      measureActive: false,
    };
    this.sessions.add(session);
    webviewPanel.onDidDispose(() => this.sessions.delete(session));

    webview.onDidReceiveMessage((message: WebviewToHost) => {
      switch (message.type) {
        case 'ready':
          if (config.get<boolean>('inspectorOnStart', false)) {
            void this.send(session, { type: 'setInspector', visible: true });
          }
          break;
        case 'inspectorState':
          session.inspectorVisible = message.visible;
          break;
        case 'inspectorFailed':
          session.inspectorVisible = false;
          void vscode.window.showErrorMessage(`Cannot open Inspector: ${message.message}`);
          break;
        case 'measureModeState':
          session.measureActive = message.active;
          break;
        case 'unitChanged':
          // 파일별로 기억한다 — STL 은 단위가 없어서 매번 다시 고르게 되기 때문이다.
          void this.unitMemory.remember(session.documentUri.toString(), message.unit);
          break;
        case 'backgroundChanged':
          // 배경은 파일이 아니라 사람 단위로 정해지는 값이므로 전역 설정에 저장한다.
          // 이 쓰기가 onDidChangeConfiguration 을 깨워 열려 있는 모든 뷰어로 전파된다.
          void config.update(
            'background',
            message.background,
            vscode.ConfigurationTarget.Global,
          );
          break;
      }
    });

    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'viewer.js'),
    );

    webview.html = buildWebviewHtml({
      cspSource: webview.cspSource,
      scriptUri: scriptUri.toString(),
      modelUri: webview.asWebviewUri(document.uri).toString(),
      environmentUri: webview.asWebviewUri(
        vscode.Uri.joinPath(mediaUri, 'environment.env'),
      ).toString(),
      assetBaseUri: webview.asWebviewUri(mediaUri).toString(),
      fileName: pathBasename(document.uri.fsPath),
      // 웹뷰 URI 에는 쿼리스트링이 붙으므로 확장자 추론에 맡기지 않고 원본 경로에서 뽑아 넘긴다.
      pluginExtension: pluginExtensionFor(document.uri.fsPath),
      background: readBackgroundMode(config),
      unitSetting: this.initialUnit(document.uri, config),
      decimals: config.get<number>('decimals', 3),
    });
  }

  /**
   * 이 파일에 쓸 단위 초기값.
   * 우선순위: 이 파일에 저장된 선택 → 설정 `modelLens.unit` → `auto`.
   */
  private initialUnit(uri: vscode.Uri, config: vscode.WorkspaceConfiguration): UnitSetting {
    const configured = config.get<unknown>('unit');
    return this.unitMemory.initialFor(
      uri.toString(),
      isUnitSetting(configured) ? configured : 'auto',
    );
  }

  /** 활성 탭의 Inspector 를 토글한다. 활성 뷰어가 없으면 아무것도 하지 않는다. */
  public async toggleInspector(): Promise<void> {
    const session = this.activeSession('Inspector');
    if (!session) {
      return;
    }

    const next = !session.inspectorVisible;
    // Inspector chunk 는 처음 켤 때 수 MB 를 로드하므로 진행 상태를 보여 준다.
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Opening Inspector…' },
      async () => {
        await this.send(session, { type: 'setInspector', visible: next });
        await waitFor(() => session.inspectorVisible === next, 20_000);
      },
    );
  }

  /** 활성 탭의 측정 모드를 토글한다. */
  public async toggleMeasureMode(): Promise<void> {
    const session = this.activeSession('measure mode');
    if (!session) {
      return;
    }
    const next = !session.measureActive;
    await this.send(session, { type: 'setMeasureMode', active: next });
    await waitFor(() => session.measureActive === next, 5_000);
  }

  private activeSession(what: string): ViewerSession | undefined {
    const session = [...this.sessions].find((s) => s.panel.active);
    if (!session) {
      void vscode.window.showInformationMessage(
        `${what} can only be toggled while a 3D Model Lens viewer is active.`,
      );
    }
    return session;
  }

  private async send(session: ViewerSession, message: HostToWebview): Promise<void> {
    await session.panel.webview.postMessage(message);
  }
}

/** 설정 파일에는 손으로 아무 문자열이나 들어갈 수 있으므로 검증하고 폴백한다. */
function readBackgroundMode(config: vscode.WorkspaceConfiguration): BackgroundMode {
  const raw = config.get<unknown>('background');
  return isBackgroundMode(raw) ? raw : 'theme';
}

function pathBasename(fsPath: string): string {
  const parts = fsPath.split(/[\\/]/);
  return parts[parts.length - 1] ?? fsPath;
}

/** 웹뷰의 확인 응답을 기다린다. 타임아웃되면 조용히 포기한다(진행 표시만 닫힌다). */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
