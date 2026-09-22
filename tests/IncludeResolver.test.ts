import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { resolveIncludes } from '../src/IncludeResolver';

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
        expect(result).toBe('A -> B\nC -> D');
    });

    test('treats !include_once as an alias for !include', async () => {
        await fs.writeFile(path.join(tmp, 'common.iuml'), 'A -> B');
        const src = '!include_once common.iuml\nC -> D';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(result).toBe('A -> B\nC -> D');
    });

    test('handles leading whitespace on !include line', async () => {
        await fs.writeFile(path.join(tmp, 'common.iuml'), 'content');
        const src = '  !include common.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(result).toBe('content');
    });

    test('resolves ../ relative paths', async () => {
        const sub = path.join(tmp, 'sub');
        await fs.mkdir(sub);
        await fs.writeFile(path.join(tmp, 'shared.iuml'), 'shared');
        const src = '!include ../shared.iuml';
        const result = await resolveIncludes(src, path.join(sub, 'test.puml'), [tmp]);
        expect(result).toBe('shared');
    });

    test('passes through !include when file not found on disk', async () => {
        const src = '!include missing.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(result).toBe('!include missing.iuml');
    });

    test('resolves includes recursively', async () => {
        await fs.writeFile(path.join(tmp, 'b.iuml'), 'B content');
        await fs.writeFile(path.join(tmp, 'a.iuml'), '!include b.iuml\nA content');
        const src = '!include a.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        expect(result).toBe('B content\nA content');
    });

    test('breaks circular includes — each file inlined at most once', async () => {
        await fs.writeFile(path.join(tmp, 'a.iuml'), '!include b.iuml\nA line');
        await fs.writeFile(path.join(tmp, 'b.iuml'), '!include a.iuml\nB line');
        const src = '!include a.iuml';
        const result = await resolveIncludes(src, path.join(tmp, 'test.puml'));
        // b.iuml tries to include a.iuml again — that's skipped (cycle)
        expect(result).toBe('B line\nA line');
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
        await expect(resolveIncludes('!include common.iuml', path.join(tmp, 'test.puml'), [tmp, path.join(tmp, 'missing')]))
            .resolves.toBe('A -> B');
    });

    test('preserves approved symlink aliases for nested absolute includes', async () => {
        const real = path.join(tmp, 'real');
        const alias = path.join(tmp, 'alias');
        await fs.mkdir(real);
        await fs.symlink(real, alias);
        await fs.writeFile(path.join(real, 'a.iuml'), `!include ${alias}/b.iuml`);
        await fs.writeFile(path.join(real, 'b.iuml'), 'A -> B');
        await expect(resolveIncludes('!include a.iuml', path.join(alias, 'test.puml'), [alias])).resolves.toBe('A -> B');
    });

    test('resolves nested relative includes through an approved symlink root', async () => {
        const real = path.join(tmp, 'real');
        const alias = path.join(tmp, 'alias');
        await fs.mkdir(real);
        await fs.symlink(real, alias);
        await fs.writeFile(path.join(real, 'a.iuml'), '!include b.iuml');
        await fs.writeFile(path.join(real, 'b.iuml'), 'A -> B');
        await expect(resolveIncludes('!include a.iuml', path.join(alias, 'test.puml'), [alias])).resolves.toBe('A -> B');
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
});
