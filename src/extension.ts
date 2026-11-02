import * as vscode from 'vscode';
import { existsSync } from 'fs';
import { registerCompletion } from './CompletionProvider';
import { PlantUMLPipe } from './PlantUMLPipe';
import { PreviewPanel } from './PreviewPanel';

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('plantumlRenderer');
    return {
        jarPath:  cfg.get<string>('jarPath', ''),
        javaPath: cfg.get<string>('javaPath', '/usr/bin/java'),
        dotPath:  cfg.get<string>('dotPath', '/opt/homebrew/bin/dot'),
        nativePath: cfg.get<string>('nativePath', ''),
        layoutEngine: cfg.get<'graphviz' | 'smetana'>('layoutEngine', 'graphviz'),
        idleShutdownMinutes: cfg.get<number>('idleShutdownMinutes', 5),
        fontFamilies: cfg.get<string[]>('fontFamilies', []),
    };
}

function createPipe(cfg: ReturnType<typeof getConfig>, fontLib: string) {
    // Only the native binary takes the injected font allowlist: a hardened-runtime java ignores it
    const fontAllow = process.platform === 'darwin' && cfg.nativePath && cfg.fontFamilies.length && existsSync(fontLib)
        ? { lib: fontLib, families: cfg.fontFamilies }
        : undefined;
    return new PlantUMLPipe(cfg.javaPath, cfg.jarPath, cfg.dotPath, cfg.nativePath, cfg.layoutEngine,
        cfg.idleShutdownMinutes * 60_000, fontAllow);
}

export function activate(context: vscode.ExtensionContext) {
    // Editing help works without PlantUML configured
    context.subscriptions.push(registerCompletion());
    let cfg = getConfig();
    if (!cfg.jarPath && !cfg.nativePath) {
        vscode.window.showErrorMessage(
            'PlantUML Renderer: set plantumlRenderer.nativePath or plantumlRenderer.jarPath in Settings, then reload the window.',
        );
        return;
    }
    const fontLib = context.asAbsolutePath('out/libfontallow.dylib');
    let pipe = createPipe(cfg, fontLib);
    pipe.warmUp();
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
            // No debounce: PreviewPanel coalesces renders and holds back mid-edit errors
            panel?.renderDocument(e.document);
        }),

        // Re-render when the user switches to a different .puml/.iuml tab
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || !panel) return;
            const lang = editor.document.languageId;
            if (lang !== 'plantuml' && lang !== 'plantuml-include') return;
            panel.renderDocument(editor.document);
        }),

        // Hide the cold start after an idle shutdown
        vscode.window.onDidChangeWindowState(state => {
            if (state.focused) pipe.warmUp();
        }),

        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('plantumlRenderer')) return;
            pipe.kill();
            cfg = getConfig();
            pipe = createPipe(cfg, fontLib);
            panel?.setPipe(pipe);
        }),
    );
}

export function deactivate() {}
