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

export function activate(context: vscode.ExtensionContext) {
    let cfg = getConfig();
    let pipe = new PlantUMLPipe(cfg.javaPath, cfg.jarPath, cfg.dotPath);
    let panel: PreviewPanel | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    context.subscriptions.push(
        vscode.commands.registerCommand('plantuml.preview', () => {
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
            pipe.kill();
            cfg = getConfig();
            pipe = new PlantUMLPipe(cfg.javaPath, cfg.jarPath, cfg.dotPath);
            panel?.setPipe(pipe);
        }),
    );
}

export function deactivate() {}
