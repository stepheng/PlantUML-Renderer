import language from './language.json';

export type Kind = 'directive' | 'tag' | 'function' | 'property' | 'color' | 'procedure' | 'variable' | 'name' | 'type' | 'keyword';

export interface Suggestion {
    label: string;
    kind: Kind;
    /** VS Code snippet syntax, when the insert differs from the label */
    snippet?: string;
    detail?: string;
}

export interface Definitions {
    procedures: { name: string; params: string[]; signature: string }[];
    variables: string[];
    names: string[];
}

const TYPES = new RegExp(`^\\s*(?:${language.types.join('|')})\\s+(?:"[^"]*"|([\\w.]+))(?:\\s+as\\s+(\\w+))?`, 'gim');
const PROCEDURE = /^\s*!(?:unquoted\s+)?(?:procedure|function)\s+(\$?\w+)\s*\(([^)]*)\)/gm;
const VARIABLE = /^\s*!(?:global\s+|local\s+)?(\$\w+)\s*\??=/gm;
// Guards added by IncludeResolver, not the user's variables
const INTERNAL = /^\$__include_/;

const escapeSnippet = (s: string) => s.replace(/\$/g, '\\$');

/** Procedures, variables and element names declared in `text` (a document with its includes inlined). */
export function definitions(text: string): Definitions {
    // A file can be inlined more than once (see IncludeResolver); overloads differ in signature
    const seen = new Set<string>();
    const procedures = [...text.matchAll(PROCEDURE)].map(m => ({
        name: m[1],
        params: m[2].split(',').map(p => p.split('=')[0].trim()).filter(Boolean),
        signature: `(${m[2].trim()})`,
    })).filter(p => !seen.has(p.name + p.signature) && seen.add(p.name + p.signature));
    const variables = [...new Set([...text.matchAll(VARIABLE)].map(m => m[1]).filter(v => !INTERNAL.test(v)))];
    const names = [...new Set([...text.matchAll(TYPES)].map(m => m[2] ?? m[1]).filter(Boolean))];
    return { procedures, variables, names };
}

/**
 * Suggestions for the text before the cursor. `from` is how many characters
 * before the cursor the inserted label replaces (sigils such as ! and $ included).
 */
export function suggest(linePrefix: string, defs: Definitions): { from: number; items: Suggestion[] } {
    if (/^\s*'/.test(linePrefix)) return { from: 0, items: [] };
    const [, sigil, word] = linePrefix.match(/([!@$%#]?)(\w*)$/)!;
    const from = sigil.length + word.length;

    switch (sigil) {
        case '!':
            return { from, items: language.preprocessor.map(label => ({ label, kind: 'directive' })) };
        case '@':
            return { from, items: language.keywords.filter(k => k.startsWith('@')).map(label => ({ label, kind: 'tag' })) };
        case '%':
            return { from, items: language.functions.map(label => ({ label, kind: 'function', snippet: `${label}($1)` })) };
        case '#':
            return { from: word.length, items: language.colors.map(label => ({ label, kind: 'color' })) };
        case '$':
            return {
                from,
                items: [
                    ...defs.procedures.map(p => ({
                        label: p.name,
                        kind: 'procedure' as const,
                        snippet: `${escapeSnippet(p.name)}(${p.params.map((a, i) => `\${${i + 1}:${escapeSnippet(a)}}`).join(', ')})`,
                        detail: p.signature,
                    })),
                    ...defs.variables.map(label => ({ label, kind: 'variable' as const })),
                ],
            };
    }
    if (/^\s*skinparam\s+\w*$/.test(linePrefix)) {
        return { from, items: language.skinparams.map(label => ({ label, kind: 'property' })) };
    }
    const seen = new Set<string>();
    const items: Suggestion[] = [
        ...defs.names.map(label => ({ label, kind: 'name' as const })),
        ...language.types.map(label => ({ label, kind: 'type' as const })),
        ...language.keywords.filter(k => !k.startsWith('@')).map(label => ({ label, kind: 'keyword' as const })),
    ].filter(i => !seen.has(i.label) && seen.add(i.label));
    return { from, items };
}
