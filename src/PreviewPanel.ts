import * as path from 'path';
import * as vscode from 'vscode';
import { resolveIncludes } from './IncludeResolver';
import { PlantUMLPipe } from './PlantUMLPipe';

const CACHE_LIMIT = 30;

export class PreviewPanel {
    private readonly _panel: vscode.WebviewPanel;
    private _pipe: PlantUMLPipe;
    private readonly _cache = new Map<string, string>();
    private _currentFilePath: string | undefined;
    private _disposeCallback: (() => void) | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        pipe: PlantUMLPipe,
    ) {
        this._pipe = pipe;
        this._panel = vscode.window.createWebviewPanel(
            'plantumlPreview',
            'PlantUML Preview',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(_context.extensionUri, 'out'),
                ],
            },
        );
        this._panel.webview.html = this._getHtml();
        this._panel.webview.onDidReceiveMessage(msg => this._handleMessage(msg));
        this._panel.onDidDispose(() => this._disposeCallback?.());
    }

    onDispose(cb: () => void) {
        this._disposeCallback = cb;
    }

    setPipe(pipe: PlantUMLPipe) {
        this._pipe = pipe;
        this._cache.clear();
    }

    reveal() {
        this._panel.reveal(vscode.ViewColumn.Beside, true);
    }

    async renderDocument(doc: vscode.TextDocument) {
        this._currentFilePath = doc.uri.fsPath;
        const source = doc.getText();
        try {
            const resolved = await resolveIncludes(source, this._currentFilePath);
            let svg = this._cache.get(resolved);
            if (!svg) {
                svg = await this._pipe.render(resolved);
                if (this._cache.size >= CACHE_LIMIT) {
                    this._cache.delete(this._cache.keys().next().value!);
                }
                this._cache.set(resolved, svg);
            }
            this._panel.webview.postMessage({ type: 'svg', data: svg });
        } catch (err) {
            this._panel.webview.postMessage({
                type: 'error',
                data: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async _handleMessage(msg: { type: string; format?: string; data?: string; message?: string }) {
        if (msg.type !== 'export' || !this._currentFilePath) return;

        const dir = path.dirname(this._currentFilePath);
        const base = path.basename(this._currentFilePath, path.extname(this._currentFilePath));

        try {
            if (msg.format === 'svg') {
                const uri = vscode.Uri.file(path.join(dir, `${base}.svg`));
                await vscode.workspace.fs.writeFile(uri, Buffer.from(msg.data!, 'utf-8'));
                vscode.window.showInformationMessage(`Exported: ${uri.fsPath}`);
            } else if (msg.format === 'png') {
                const b64 = msg.data!.replace(/^data:image\/png;base64,/, '');
                const uri = vscode.Uri.file(path.join(dir, `${base}.png`));
                await vscode.workspace.fs.writeFile(uri, Buffer.from(b64, 'base64'));
                vscode.window.showInformationMessage(`Exported: ${uri.fsPath}`);
            }
        } catch (err) {
            vscode.window.showErrorMessage(
                `Export failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    private _getHtml(): string {
        const webview = this._panel.webview;
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'out', 'webview.js'),
        );
        const csp = webview.cspSource;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; script-src ${csp}; style-src 'unsafe-inline'; img-src data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #1e1e1e; overflow: hidden; width: 100vw; height: 100vh; }
        #container {
            width: 100%; height: 100%;
            position: relative; overflow: hidden;
            cursor: grab;
        }
        #container.grabbing { cursor: grabbing; }
        #error {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            color: #f48; font-family: monospace; font-size: 13px;
            white-space: pre-wrap; max-width: 80%; text-align: center;
            display: none;
        }
        #toolbar {
            position: absolute; bottom: 12px; right: 12px; z-index: 10;
            display: flex; gap: 6px;
        }
        #toolbar button {
            background: rgba(40,40,40,0.85); color: #ccc;
            border: 1px solid #555; border-radius: 4px;
            padding: 4px 10px; font-size: 12px; cursor: pointer;
        }
        #toolbar button:hover { background: rgba(70,70,70,0.95); color: #fff; }
    </style>
</head>
<body>
    <div id="container">
        <div id="error"></div>
        <div id="toolbar">
            <button id="btn-svg">Export SVG</button>
            <button id="btn-png">Export PNG</button>
            <button id="btn-reset">↺ Reset</button>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
