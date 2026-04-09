import * as vscode from 'vscode';
import { PlantUMLPipe } from './PlantUMLPipe';
import { PreviewPanel } from './PreviewPanel';

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('plantumlRenderer');
    return {
        jarPath:  cfg.get<string>('jarPath', ''),
        javaPath: cfg.get<string>('javaPath', '/usr/bin/java'),
        dotPath:  cfg.get<string>('dotPath', '/opt/homebrew/bin/dot'),
    };
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext) {
    let cfg = getConfig();
    if (!cfg.jarPath) {
        vscode.window.showErrorMessage(
            'PlantUML Renderer: plantumlRenderer.jarPath is not set. Configure it in Settings, then reload the window.',
        );
        return;
    }
    let pipe = new PlantUMLPipe(cfg.javaPath, cfg.jarPath, cfg.dotPath);
    let panel: PreviewPanel | null = null;

    context.subscriptions.push(
        { dispose: () => pipe.kill() },

        vscode.commands.registerCommand('plantumlRenderer.preview', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            if (!panel) {
                panel = new PreviewPanel(context, pipe);
                panel.onDispose(() => { panel = null; });
            }
            panel.reveal();
            panel.renderDocument(editor.document);
        }),

        vscode.workspace.onDidChangeTextDocument(e => {
            const lang = e.document.languageId;
            if (lang !== 'plantuml' && lang !== 'plantuml-include') return;
            if (!panel) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                panel?.renderDocument(e.document);
            }, 500);
        }),

        // Re-render when the user switches to a different .puml/.iuml tab
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || !panel) return;
            const lang = editor.document.languageId;
            if (lang !== 'plantuml' && lang !== 'plantuml-include') return;
            panel.renderDocument(editor.document);
        }),

        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('plantumlRenderer')) return;
            clearTimeout(debounceTimer);
            pipe.kill();
            cfg = getConfig();
            pipe = new PlantUMLPipe(cfg.javaPath, cfg.jarPath, cfg.dotPath);
            panel?.setPipe(pipe);
        }),
    );
}

export function deactivate() {
    clearTimeout(debounceTimer);
}
