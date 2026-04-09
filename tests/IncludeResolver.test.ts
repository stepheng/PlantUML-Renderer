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
        const result = await resolveIncludes(src, path.join(sub, 'test.puml'));
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
});
