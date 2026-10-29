import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';
import language from '../src/language.json';

const root = path.join(__dirname, '..');
const grammarPath = path.join(root, 'syntaxes', 'plantuml.tmLanguage.json');
let grammar: textmate.IGrammar;

beforeAll(async () => {
    const wasm = fs.readFileSync(path.join(root, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
    const registry = new textmate.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
            createOnigString: s => new oniguruma.OnigString(s),
        }),
        loadGrammar: async () => textmate.parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath),
    });
    grammar = (await registry.loadGrammar('source.plantuml'))!;
});

/** Scopes of the first token covering `text` on the last line of `source`. */
function scopesOf(source: string, text: string): string {
    let state = textmate.INITIAL;
    const lines = source.split('\n');
    let tokens: textmate.IToken[] = [];
    for (const line of lines) {
        const r = grammar.tokenizeLine(line, state);
        state = r.ruleStack;
        tokens = r.tokens;
    }
    const line = lines[lines.length - 1];
    const at = line.indexOf(text);
    if (at < 0) throw new Error(`"${text}" not in "${line}"`);
    const tok = tokens.find(t => t.startIndex <= at && at < t.endIndex)!;
    return tok.scopes.join(' ');
}

describe('PlantUML grammar', () => {
    test('diagram start and end tags', () => {
        expect(scopesOf('@startuml', '@startuml')).toMatch(/keyword\.control\.diagram/);
        expect(scopesOf('@endmindmap', '@endmindmap')).toMatch(/keyword\.control\.diagram/);
    });

    test('line and block comments', () => {
        expect(scopesOf("' a note to self", 'note')).toMatch(/comment\.line/);
        expect(scopesOf("/' first\nstill a comment '/", 'still')).toMatch(/comment\.block/);
        expect(scopesOf("/' done '/\nclass Foo", 'class')).not.toMatch(/comment/);
    });

    test('include directives and their paths', () => {
        expect(scopesOf('!include ../Uml-Macros/Class-Diagram-Macros.iuml', '!include')).toMatch(/keyword\.control\.directive/);
        expect(scopesOf('!include ../Uml-Macros/Class-Diagram-Macros.iuml', 'Uml-Macros')).toMatch(/string/);
        expect(scopesOf('!include <C4/C4_Container>', 'C4_Container')).toMatch(/string/);
        expect(scopesOf('!include_once common.iuml', '!include_once')).toMatch(/keyword\.control\.directive/);
    });

    test('procedure definitions, variables and builtin functions', () => {
        expect(scopesOf('!procedure $extension($name)', '!procedure')).toMatch(/keyword\.control\.directive/);
        expect(scopesOf('!procedure $extension($name)', '$extension')).toMatch(/entity\.name\.function/);
        expect(scopesOf('!unquoted function $f($a)', '$f')).toMatch(/entity\.name\.function/);
        expect(scopesOf('!if %not(%variable_exists("$x"))', '!if')).toMatch(/keyword\.control\.directive/);
        expect(scopesOf('!if %not(%variable_exists("$x"))', '%not')).toMatch(/support\.function/);
        expect(scopesOf('!$pos = %strpos($name, ".")', '$name')).toMatch(/variable/);
        expect(scopesOf('$clean_up_ux_capability_settings()', '$clean_up')).toMatch(/entity\.name\.function|variable\.function/);
    });

    test('element types, keywords, stereotypes and colours', () => {
        expect(scopesOf('class Foo <<Entity>> #LightBlue', 'class')).toMatch(/storage\.type/);
        expect(scopesOf('class Foo <<Entity>> #LightBlue', '<<Entity>>')).toMatch(/stereotype/);
        expect(scopesOf('class Foo <<Entity>> #LightBlue', '#LightBlue')).toMatch(/constant\.other\.color/);
        expect(scopesOf('participant "Web App" as W', 'as')).toMatch(/keyword/);
        expect(scopesOf('participant "Web App" as W', 'Web App')).toMatch(/string\.quoted/);
        expect(scopesOf('note left of A', 'note')).toMatch(/keyword/);
        expect(scopesOf('left to right direction', 'left')).toMatch(/keyword/);
    });

    test('keywords match whole words only', () => {
        expect(scopesOf('classy -> B', 'classy')).not.toMatch(/storage\.type|keyword/);
        expect(scopesOf('Foo -> Bar : astute', 'astute')).not.toMatch(/keyword/);
    });

    test('arrows', () => {
        for (const arrow of ['->', '-->', '<|--', '*--', 'o--', '..>', '-[#red]->', '-up->', '<->', '--|>']) {
            expect(`${arrow}: ${scopesOf(`A ${arrow} B`, arrow)}`).toMatch(/keyword\.operator\.arrow/);
        }
    });

    test('skinparam names', () => {
        expect(scopesOf('skinparam ArrowColor #333', 'skinparam')).toMatch(/keyword/);
        expect(scopesOf('skinparam ArrowColor #333', 'ArrowColor')).toMatch(/support\.type\.property-name/);
    });

    test('highlights every keyword and type PlantUML reports', () => {
        const words = [...language.types, ...language.keywords.filter(k => !k.startsWith('@'))];
        const missed = words.filter(w => !/keyword|storage\.type/.test(scopesOf(`${w} X`, w)));
        expect(missed).toEqual([]);
    });
});
