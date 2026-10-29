import * as vscode from 'vscode';
import { definitions, suggest, type Kind } from './Completion';
import { resolveIncludes } from './IncludeResolver';
import { includeRoots } from './includeRoots';

const KINDS: Record<Kind, vscode.CompletionItemKind> = {
    directive: vscode.CompletionItemKind.Keyword,
    tag: vscode.CompletionItemKind.Keyword,
    keyword: vscode.CompletionItemKind.Keyword,
    function: vscode.CompletionItemKind.Function,
    procedure: vscode.CompletionItemKind.Function,
    property: vscode.CompletionItemKind.Property,
    color: vscode.CompletionItemKind.Color,
    variable: vscode.CompletionItemKind.Variable,
    name: vscode.CompletionItemKind.Reference,
    type: vscode.CompletionItemKind.Class,
};

export function registerCompletion(): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(['plantuml', 'plantuml-include'], {
        async provideCompletionItems(doc, pos) {
            const prefix = doc.lineAt(pos).text.slice(0, pos.character);
            let text = doc.getText();
            try {
                // Macros usually live in included files
                text = await resolveIncludes(text, doc.uri.fsPath, includeRoots(doc.uri));
            } catch {
                // An include outside the approved roots: suggest from this document alone
            }
            const { from, items } = suggest(prefix, definitions(text));
            const range = new vscode.Range(pos.line, pos.character - from, pos.line, pos.character);
            return items.map(s => {
                const item = new vscode.CompletionItem(s.label, KINDS[s.kind]);
                item.range = range;
                if (s.snippet) item.insertText = new vscode.SnippetString(s.snippet);
                if (s.detail) item.detail = s.detail;
                return item;
            });
        },
    }, '!', '@', '%', '$', '#');
}
