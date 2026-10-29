import * as path from 'path';
import * as vscode from 'vscode';

/** Directories local !include files may come from: the workspace folder (or the file's own directory) plus configured roots. */
export function includeRoots(uri: vscode.Uri): string[] {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? path.dirname(uri.fsPath);
    const extraRoots = vscode.workspace.getConfiguration('plantumlRenderer').get<string[]>('includeRoots', []);
    return [workspaceRoot, ...extraRoots];
}
