import * as vscode from 'vscode';
import { Controller } from './controller';
import { BoardPanel, SidebarProvider } from './views';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const ctrl = new Controller(ctx);
  ctx.subscriptions.push(ctrl);

  const open = (tab?: string, taskId?: string) => BoardPanel.show(ctrl, ctx.extensionUri, tab, taskId);

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('teamboard.sidebar', new SidebarProvider(ctrl, ctx.extensionUri)),
    vscode.commands.registerCommand('teamboard.openBoard', () => open('board')),
    vscode.commands.registerCommand('teamboard.openTeam', () => open('team')),
    vscode.commands.registerCommand('teamboard.newTask', () => ctrl.quickNewTask()),
    vscode.commands.registerCommand('teamboard.logWork', () => ctrl.quickLogWork()),
    vscode.commands.registerCommand('teamboard.setCurrentTask', () => ctrl.quickPickCurrentTask()),
    vscode.commands.registerCommand('teamboard.linkLastCommit', () => ctrl.linkLastCommit()),
    vscode.commands.registerCommand('teamboard.refresh', () => ctrl.refreshStats())
  );

  await ctrl.init();
}

export function deactivate(): void {}
