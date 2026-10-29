import { definitions, suggest } from '../src/Completion';

const NONE = definitions('');
const labels = (r: ReturnType<typeof suggest>) => r.items.map(i => i.label);

describe('suggest', () => {
    test('offers preprocessor directives after !, replacing from the !', () => {
        const r = suggest('  !inc', NONE);
        expect(r.from).toBe(4);
        expect(labels(r)).toEqual(expect.arrayContaining(['!include', '!include_once', '!if', '!procedure']));
        expect(r.items.every(i => i.kind === 'directive')).toBe(true);
    });

    test('offers diagram tags after @ at the start of a line', () => {
        const r = suggest('@', NONE);
        expect(r.from).toBe(1);
        expect(labels(r)).toEqual(expect.arrayContaining(['@startuml', '@enduml', '@startmindmap']));
    });

    test('offers builtin functions after %, inserting the call parentheses', () => {
        const r = suggest('!if %var', NONE);
        expect(r.from).toBe(4);
        const item = r.items.find(i => i.label === '%variable_exists')!;
        expect(item.kind).toBe('function');
        expect(item.snippet).toBe('%variable_exists($1)');
    });

    test('offers skinparam names after skinparam', () => {
        const r = suggest('skinparam Arr', NONE);
        expect(r.from).toBe(3);
        expect(labels(r)).toContain('ArrowThickness');
        expect(r.items.every(i => i.kind === 'property')).toBe(true);
    });

    test('offers colour names after #, without the #', () => {
        const r = suggest('class Foo #Li', NONE);
        expect(r.from).toBe(2);
        expect(labels(r)).toContain('LightBlue');
    });

    test('offers procedures with parameter placeholders, and variables, after $', () => {
        const defs = definitions([
            '!procedure $extension($name, $type = "class")',
            '!endprocedure',
            '!unquoted function $concatenate($a, $b)',
            '!endfunction',
            '!$is_ios = %true()',
            '!global $current_mvvm = "<undefined>"',
            '!global $__include_0123456789ab = %true()',
        ].join('\n'));
        const r = suggest('  $ex', defs);
        expect(r.from).toBe(3);
        expect(r.items.find(i => i.label === '$extension')).toMatchObject({ kind: 'procedure', snippet: '\\$extension(${1:\\$name}, ${2:\\$type})', detail: '($name, $type = "class")' });
        expect(r.items.find(i => i.label === '$concatenate')?.snippet).toBe('\\$concatenate(${1:\\$a}, ${2:\\$b})');
        expect(labels(r)).toEqual(expect.arrayContaining(['$is_ios', '$current_mvvm']));
        expect(labels(r).some(l => l.startsWith('$__include_'))).toBe(false);
    });

    test('escapes snippet syntax characters in procedure parameters', () => {
        const r = suggest('$p', definitions('!procedure $p($a\\b, $c}d)'));
        expect(r.items[0].snippet).toBe('\\$p(${1:\\$a\\\\b}, ${2:\\$c\\}d})');
    });

    test('lists a procedure once when a file is inlined more than once, but keeps overloads', () => {
        const file = '!procedure $datatype($name)\n!endprocedure\n!procedure $datatype($name, $type)\n!endprocedure';
        const defs = definitions(`${file}\n${file}`);
        expect(defs.procedures.map(p => p.signature)).toEqual(['($name)', '($name, $type)']);
    });

    test('offers keywords, element types and declared names for a plain word', () => {
        const defs = definitions('participant "Web App" as W\nclass Order\nactor Customer');
        const r = suggest('Order --> Cu', defs);
        expect(r.from).toBe(2);
        expect(labels(r)).toEqual(expect.arrayContaining(['Customer', 'Order', 'W', 'class', 'note', 'participant']));
        expect(r.items.find(i => i.label === 'Customer')?.kind).toBe('name');
        expect(labels(r)).not.toContain('@startuml');
    });

    test('offers nothing inside a comment', () => {
        expect(suggest("' some no", NONE).items).toEqual([]);
    });
});
