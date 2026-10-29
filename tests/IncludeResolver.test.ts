import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { resolveIncludes } from '../src/IncludeResolver';

// Drops the include-guard lines so assertions read as the inlined content
const GUARD_LINE = /^(!if %not\(%variable_exists\("\$__include_\w+"\)\)|!global \$__include_\w+ = %true\(\)|!endif)$/;
const body = (s: string) => s.split('\n').filter(l => !GUARD_LINE.test(l)).join('\n');

describe('resolveIncludes', () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'puml-'));
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true });
    });

    test('returns source unchanged when no !include lines', async () => {
        const src = '@startuml\nA -> B\n@enduml';
        expect(await resolveIncludes(src, path.join(tmp, 'test.puml'))).toBe(src);
    });

    test('inlines a sibling include file', async () => {
        await fs.writeFile(path.join(tmp, 'common.iuml'), 'A -> B');
        const src = '!include common.iuml\nC -> D';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('A -> B\nC -> D');
    });

    test('treats !include_once as an alias for !include', async () => {
        await fs.writeFile(path.join(tmp, 'common.iuml'), 'A -> B');
        const src = '!include_once common.iuml\nC -> D';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('A -> B\nC -> D');
    });

    test('handles leading whitespace on !include line', async () => {
        await fs.writeFile(path.join(tmp, 'common.iuml'), 'content');
        const src = '  !include common.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('content');
    });

    test('resolves ../ relative paths', async () => {
        const sub = path.join(tmp, 'sub');
        await fs.mkdir(sub);
        await fs.writeFile(path.join(tmp, 'shared.iuml'), 'shared');
        const src = '!include ../shared.iuml';
        const result = await resolveIncludes(src, path.join(sub, 'test.puml'), [tmp]);
        expect(body(result)).toBe('shared');
    });

    test('passes through !include when file not found on disk', async () => {
        const src = '!include missing.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('!include missing.iuml');
    });

    test('resolves includes recursively', async () => {
        await fs.writeFile(path.join(tmp, 'b.iuml'), 'B content');
        await fs.writeFile(path.join(tmp, 'a.iuml'), '!include b.iuml\nA content');
        const src = '!include a.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('B content\nA content');
    });

    test('breaks circular includes — each file inlined at most once', async () => {
        await fs.writeFile(path.join(tmp, 'a.iuml'), '!include b.iuml\nA line');
        await fs.writeFile(path.join(tmp, 'b.iuml'), '!include a.iuml\nB line');
        const src = '!include a.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        // b.iuml tries to include a.iuml again — that's skipped (cycle)
        expect(body(result)).toBe('B line\nA line');
    });

    test('rejects parent traversal outside the diagram directory', async () => {
        const workspace = path.join(tmp, 'workspace');
        await fs.mkdir(workspace);
        await fs.writeFile(path.join(tmp, 'outside.iuml'), 'private marker');
        await expect(resolveIncludes('!include ../outside.iuml', path.join(workspace, 'test.puml')))
            .rejects.toThrow('outside approved roots');
    });

    test('rejects absolute paths outside the diagram directory', async () => {
        const workspace = path.join(tmp, 'workspace');
        await fs.mkdir(workspace);
        const outside = path.join(tmp, 'outside.iuml');
        await fs.writeFile(outside, 'private marker');
        await expect(resolveIncludes(`!include ${outside}`, path.join(workspace, 'test.puml')))
            .rejects.toThrow('outside approved roots');
    });

    test('rejects symlinks that escape the diagram directory', async () => {
        const workspace = path.join(tmp, 'workspace');
        await fs.mkdir(workspace);
        await fs.writeFile(path.join(tmp, 'outside.iuml'), 'private marker');
        await fs.symlink(path.join(tmp, 'outside.iuml'), path.join(workspace, 'link.iuml'));
        await expect(resolveIncludes('!include link.iuml', path.join(workspace, 'test.puml')))
            .rejects.toThrow('outside approved roots');
    });

    test('renders a diagram without includes when an unused shared root is unavailable', async () => {
        const src = '@startuml\nA -> B\n@enduml';
        await expect(resolveIncludes(src, path.join(tmp, 'test.puml'), [tmp, path.join(tmp, 'unmounted')])).resolves.toBe(src);
    });

    test('resolves workspace includes when an unused shared root is missing', async () => {
        await fs.writeFile(path.join(tmp, 'common.iuml'), 'A -> B');
        expect(body(await resolveIncludes('!include common.iuml', path.join(tmp, 'test.puml'), [tmp, path.join(tmp, 'missing')])))
            .toBe('A -> B');
    });

    test('preserves approved symlink aliases for nested absolute includes', async () => {
        const real = path.join(tmp, 'real');
        const alias = path.join(tmp, 'alias');
        await fs.mkdir(real);
        await fs.symlink(real, alias);
        await fs.writeFile(path.join(real, 'a.iuml'), `!include ${alias}/b.iuml`);
        await fs.writeFile(path.join(real, 'b.iuml'), 'A -> B');
        expect(body(await resolveIncludes('!include a.iuml', path.join(alias, 'test.puml'), [alias]))).toBe('A -> B');
    });

    test('resolves nested relative includes through an approved symlink root', async () => {
        const real = path.join(tmp, 'real');
        const alias = path.join(tmp, 'alias');
        await fs.mkdir(real);
        await fs.symlink(real, alias);
        await fs.writeFile(path.join(real, 'a.iuml'), '!include b.iuml');
        await fs.writeFile(path.join(real, 'b.iuml'), 'A -> B');
        expect(body(await resolveIncludes('!include a.iuml', path.join(alias, 'test.puml'), [alias]))).toBe('A -> B');
    });

    test('rejects nested symlink escapes with an approved alias root', async () => {
        const real = path.join(tmp, 'real');
        const alias = path.join(tmp, 'alias');
        await fs.mkdir(real);
        await fs.symlink(real, alias);
        await fs.writeFile(path.join(tmp, 'outside.iuml'), 'private marker');
        await fs.symlink(path.join(tmp, 'outside.iuml'), path.join(real, 'escape.iuml'));
        await fs.writeFile(path.join(real, 'a.iuml'), `!include ${alias}/escape.iuml`);
        await expect(resolveIncludes('!include a.iuml', path.join(alias, 'test.puml'), [alias]))
            .rejects.toThrow('outside approved roots');
    });

    test('inlines only the body of an included file wrapped in @startuml/@enduml, as PlantUML does', async () => {
        await fs.writeFile(path.join(tmp, 'inner.iuml'), "' header\n@startuml\nA -> B\n@enduml\nafter end");
        const src = '@startuml\n!include inner.iuml\nB -> C\n@enduml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('@startuml\nA -> B\nB -> C\n@enduml');
    });

    test('inlines only the first block of an included file with several diagrams', async () => {
        await fs.writeFile(path.join(tmp, 'two.iuml'), '@startuml\nfirst\n@enduml\n@startuml\nsecond\n@enduml');
        const result = await resolveIncludes('!include two.iuml', path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('first');
    });

    test('wraps each inlined file in a PlantUML include guard', async () => {
        await fs.writeFile(path.join(tmp, 'common.iuml'), 'A -> B');
        const result = await resolveIncludes('!include common.iuml\nC -> D', path.join(tmp, 'test.puml'));
        expect(result).toMatch(/^!if %not\(%variable_exists\("(\$__include_\w+)"\)\)\n!global \1 = %true\(\)\nA -> B\n!endif\nC -> D$/);
    });

    test('inlines a file included in two !if branches into both, under one guard id', async () => {
        await fs.writeFile(path.join(tmp, 'shared.iuml'), 'shared');
        const src = '!if $v == 0\n!include shared.iuml\n!elseif $v == 1\n!include shared.iuml\n!endif';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        const ids = [...result.matchAll(/!global (\$__include_\w+)/g)].map(m => m[1]);
        expect(ids).toHaveLength(2);
        expect(ids[0]).toBe(ids[1]);
        expect(result.split('\n').filter(l => l === 'shared')).toHaveLength(2);
    });

    test('does not repeat a file already inlined unconditionally', async () => {
        await fs.writeFile(path.join(tmp, 'macros.iuml'), 'macros');
        await fs.writeFile(path.join(tmp, 'a.iuml'), '!include macros.iuml\na');
        await fs.writeFile(path.join(tmp, 'b.iuml'), '!if $x\n!include macros.iuml\n!endif\nb');
        const result = await resolveIncludes('!include a.iuml\n!include b.iuml\n!include macros.iuml', path.join(tmp, 'test.puml'));
        expect(result.split('\n').filter(l => l === 'macros')).toHaveLength(1);
    });

    test('repeats a file whose earlier inclusion sat inside a procedure body', async () => {
        await fs.writeFile(path.join(tmp, 'shared.iuml'), 'shared');
        const src = '!procedure $p()\n!include shared.iuml\n!endprocedure\n!include shared.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(result.split('\n').filter(l => l === 'shared')).toHaveLength(2);
    });

    test('treats a one-line !function as closed when tracking conditional depth', async () => {
        await fs.writeFile(path.join(tmp, 'shared.iuml'), 'shared');
        const src = '!function $double($a) !return $a + $a\n!include shared.iuml\n!include shared.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(result.split('\n').filter(l => l === 'shared')).toHaveLength(1);
    });

    test('applies the same unwrapping to nested includes', async () => {
        await fs.writeFile(path.join(tmp, 'leaf.iuml'), '@startuml\nleaf\n@enduml');
        await fs.writeFile(path.join(tmp, 'mid.iuml'), '@startuml\n!include leaf.iuml\nmid\n@enduml');
        const result = await resolveIncludes('!include mid.iuml\nouter', path.join(tmp, 'test.puml'));
        expect(body(result)).toBe('leaf\nmid\nouter');
    });
});
