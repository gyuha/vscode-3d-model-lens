import * as vscode from 'vscode';
import { isBackgroundMode, type BackgroundMode } from './background';
import { readGridSetting } from './grid';
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
  panelVisible: boolean;
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
        const settings = vscode.workspace.getConfiguration('modelLens');
        if (event.affectsConfiguration('modelLens.background')) {
          const background = readBackgroundMode(settings);
          for (const session of this.sessions) {
            void this.send(session, { type: 'setBackground', background });
          }
        }
        if (event.affectsConfiguration('modelLens.grid')) {
          const grid = readGridSetting(settings.get<unknown>('grid'));
          for (const session of this.sessions) {
            void this.send(session, { type: 'setGrid', grid });
          }
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
      // 패널은 보인 채로 시작한다. 웹뷰가 복원한 숨김 상태는 `panelState` 로 곧 따라온다.
      panelVisible: true,
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
        case 'panelState':
          session.panelVisible = message.visible;
          break;
        case 'unitChanged':
          // 파일별로 기억한다 — STL 은 단위가 없어서 매번 다시 고르게 되기 때문이다.
          void this.unitMemory.remember(session.documentUri.toString(), message.unit);
          break;
        case 'gridChanged':
          // 그리드도 배경과 같은 부류 — 사람 단위 표시 취향이므로 전역 설정에 저장한다.
          void config.update('grid', message.grid, vscode.ConfigurationTarget.Global);
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
      grid: readGridSetting(config.get<unknown>('grid')),
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

  /**
   * 활성 탭의 뷰어 패널을 통째로 숨기거나 되살린다.
   *
   * 되살리는 경로가 웹뷰 밖(이 명령)에 있어야 뷰포트를 완전히 비울 수 있다 — 웹뷰 안에
   * 되살릴 버튼을 남기면 모델만 보고 싶을 때도 무언가가 계속 떠 있게 된다.
   */
  public async togglePanel(): Promise<void> {
    const session = this.activeSession('The viewer panel');
    if (!session) {
      return;
    }
    const next = !session.panelVisible;
    await this.send(session, { type: 'setPanelVisible', visible: next });
    await waitFor(() => session.panelVisible === next, 5_000);
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
