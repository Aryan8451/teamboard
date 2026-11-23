import * as vscode from 'vscode';
import { Controller } from './controller';

function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function html(webview: vscode.Webview, extUri: vscode.Uri, script: string, bodyClass: string): string {
  const n = nonce();
  const uri = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', f));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${uri('styles.css')}" rel="stylesheet">
<title>CommitBoard</title>
</head>
<body class="${bodyClass}">
<div id="app"><div class="loading"><div class="spinner"></div></div></div>
<div id="modal-root"></div>
<div id="toast-root"></div>
<script nonce="${n}" src="${uri('common.js')}"></script>
<script nonce="${n}" src="${uri(script)}"></script>
</body>
</html>`;
}

export class BoardPanel {
  static current: BoardPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static show(ctrl: Controller, extUri: vscode.Uri, tab?: string, taskId?: string): void {
    if (BoardPanel.current) {
      BoardPanel.current.panel.reveal(vscode.ViewColumn.One);
    } else {
      const panel = vscode.window.createWebviewPanel('commitboard.board', 'CommitBoard', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extUri, 'media')],
      });
      BoardPanel.current = new BoardPanel(panel, ctrl, extUri);
    }
    if (tab || taskId) {
      BoardPanel.current.panel.webview.postMessage({ type: 'navigate', tab, taskId });
    }
  }

  private constructor(private panel: vscode.WebviewPanel, ctrl: Controller, extUri: vscode.Uri) {
    panel.iconPath = vscode.Uri.joinPath(extUri, 'media', 'icon.svg');
    panel.webview.html = html(panel.webview, extUri, 'board.js', 'board');
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m) =>
        m.type === 'ready'
          ? panel.webview.postMessage({ type: 'state', state: ctrl.getState() })
          : ctrl.handleMessage(m, (tab, taskId) => BoardPanel.show(ctrl, extUri, tab, taskId))
      ),
      ctrl.onState((state) => panel.webview.postMessage({ type: 'state', state })),
      panel.onDidDispose(() => this.dispose())
    );
  }

  private dispose(): void {
    BoardPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private sub?: vscode.Disposable;

  constructor(private ctrl: Controller, private extUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extUri, 'media')] };
    view.webview.html = html(view.webview, this.extUri, 'sidebar.js', 'sidebar');
    view.webview.onDidReceiveMessage((m) =>
      m.type === 'ready'
        ? view.webview.postMessage({ type: 'state', state: this.ctrl.getState() })
        : this.ctrl.handleMessage(m, (tab, taskId) => BoardPanel.show(this.ctrl, this.extUri, tab, taskId))
    );
    this.sub?.dispose();
    this.sub = this.ctrl.onState((state) => view.webview.postMessage({ type: 'state', state }));
    view.onDidDispose(() => this.sub?.dispose());
  }
}
