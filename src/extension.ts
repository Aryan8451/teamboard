import * as vscode from 'vscode';
import { Controller } from './controller';
import { BoardPanel, SidebarProvider } from './views';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const ctrl = new Controller(ctx);
  ctx.subscriptions.push(ctrl);

  const open = (tab?: string, taskId?: string) => BoardPanel.show(ctrl, ctx.extensionUri, tab, taskId);

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('commitboard.sidebar', new SidebarProvider(ctrl, ctx.extensionUri)),
    vscode.commands.registerCommand('commitboard.openBoard', () => open('board')),
    vscode.commands.registerCommand('commitboard.openTeam', () => open('team')),
    vscode.commands.registerCommand('commitboard.newTask', () => ctrl.quickNewTask()),
    vscode.commands.registerCommand('commitboard.logWork', () => ctrl.quickLogWork()),
    vscode.commands.registerCommand('commitboard.setCurrentTask', () => ctrl.quickPickCurrentTask()),
    vscode.commands.registerCommand('commitboard.linkLastCommit', () => ctrl.linkLastCommit()),
    vscode.commands.registerCommand('commitboard.refresh', () => ctrl.refreshStats())
  );

  await ctrl.init();
}

export function deactivate(): void {}
