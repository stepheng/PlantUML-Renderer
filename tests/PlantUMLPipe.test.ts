import { EventEmitter } from 'events';
import { Writable } from 'stream';

jest.mock('child_process', () => ({ spawn: jest.fn(), execFileSync: jest.fn() }));

import { execFileSync, spawn } from 'child_process';
import { PlantUMLPipe, fontsUsed } from '../src/PlantUMLPipe';

function makeMockProc() {
    const proc = new EventEmitter() as any;
    proc.stdin = new Writable({ write(_c: any, _e: any, cb: () => void) { cb(); } });
    proc.stdin.write = jest.fn();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn(() => { proc.killed = true; });
    proc.killed = false;
    return proc;
}

describe('PlantUMLPipe', () => {
    let mockProc: ReturnType<typeof makeMockProc>;

    beforeEach(() => {
        mockProc = makeMockProc();
        (spawn as jest.Mock).mockReturnValue(mockProc);
    });

    afterEach(() => jest.clearAllMocks());

    test('spawns java with jar, tsvg, pipe, and graphvizdot args', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '/usr/bin/dot');
        const p = pipe.render('@startuml\nA -> B\n@enduml');
        mockProc.stdout.emit('data', Buffer.from('<svg viewBox="0 0 10 10"></svg>'));
        await p;
        expect(spawn).toHaveBeenCalledWith('/usr/bin/java', [
            '-Dfile.encoding=UTF-8', '-DPLANTUML_SECURITY_PROFILE=SANDBOX', '-jar', '/p/plantuml.jar',
            '-tsvg', '-pipe', '-graphvizdot', '/usr/bin/dot',
        ], { env: process.env });
    });

    test('omits graphvizdot arg when dotPath is empty', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        const p = pipe.render('@startuml\nA\n@enduml');
        mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
        await p;
        expect(spawn).toHaveBeenCalledWith('/usr/bin/java', [
            '-Dfile.encoding=UTF-8', '-DPLANTUML_SECURITY_PROFILE=SANDBOX', '-jar', '/p/plantuml.jar', '-tsvg', '-pipe',
        ], { env: process.env });
    });

    test('spawns native binary directly, without java or -jar, when nativePath is set', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '/usr/bin/dot', '/p/plantuml-native');
        const p = pipe.render('@startuml\nA -> B\n@enduml');
        mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
        await p;
        expect(spawn).toHaveBeenCalledWith('/p/plantuml-native', [
            '-Dfile.encoding=UTF-8', '-DPLANTUML_SECURITY_PROFILE=SANDBOX',
            '-tsvg', '-pipe', '-graphvizdot', '/usr/bin/dot',
        ], { env: process.env });
    });

    test('selects Smetana layout and skips graphvizdot when layout is smetana', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '/usr/bin/dot', '/p/plantuml-native', 'smetana');
        const p = pipe.render('@startuml\nA -> B\n@enduml');
        mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
        await p;
        expect(spawn).toHaveBeenCalledWith('/p/plantuml-native', [
            '-Dfile.encoding=UTF-8', '-DPLANTUML_SECURITY_PROFILE=SANDBOX',
            '-tsvg', '-pipe', '-Playout=smetana',
        ], { env: process.env });
    });

    test('wraps source in @startuml/@enduml when missing', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        pipe.render('A -> B');
        expect(mockProc.stdin.write).toHaveBeenCalledWith(
            '@startuml\nA -> B\n@enduml\n',
        );
    });

    test('does not double-wrap source that already has @startuml', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        pipe.render('@startuml\nA -> B\n@enduml');
        expect(mockProc.stdin.write).toHaveBeenCalledWith(
            '@startuml\nA -> B\n@enduml\n',
        );
    });

    test('appends @enduml when it is missing, so a mid-edit source cannot stall the pipe', () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        pipe.render('@startuml\nA -> B');
        expect(mockProc.stdin.write).toHaveBeenCalledWith('@startuml\nA -> B\n@enduml\n');
    });

    test('appends @enduml when the end line is only partly typed', () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        pipe.render('@startuml\nA -> B\n@endu');
        expect(mockProc.stdin.write).toHaveBeenCalledWith('@startuml\nA -> B\n@endu\n@enduml\n');
    });

    test('keeps non-uml diagram types and terminates them with their own end tag', () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        pipe.render('@startgantt\n[T] lasts 2 days');
        expect(mockProc.stdin.write).toHaveBeenCalledWith('@startgantt\n[T] lasts 2 days\n@endgantt\n');
    });

    test('does not wrap a complete non-uml diagram in @startuml', () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        pipe.render('@startmindmap\n* Root\n@endmindmap');
        expect(mockProc.stdin.write).toHaveBeenCalledWith('@startmindmap\n* Root\n@endmindmap\n');
    });

    test('sends only the first diagram block, so PlantUML returns exactly one SVG per render', () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        pipe.render("' note\n@startuml\nA -> B\n@enduml\n\n@startuml\nC -> D\n@enduml\n");
        expect(mockProc.stdin.write).toHaveBeenCalledWith('@startuml\nA -> B\n@enduml\n');
    });

    test('resolves with SVG string on stdout', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        const p = pipe.render('A -> B');
        mockProc.stdout.emit('data', Buffer.from('<svg viewBox="0 0 100 100"></svg>'));
        const svg = await p;
        expect(svg).toBe('<svg viewBox="0 0 100 100"></svg>');
    });

    test('handles chunked stdout — resolves only after </svg> arrives', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        const p = pipe.render('A -> B');
        mockProc.stdout.emit('data', Buffer.from('<svg viewBox'));
        // Not resolved yet — no </svg>
        let resolved = false;
        p.then(() => { resolved = true; });
        await Promise.resolve();
        expect(resolved).toBe(false);
        mockProc.stdout.emit('data', Buffer.from('="0 0 10 10"></svg>'));
        await p;
        expect(resolved).toBe(true);
    });

    test('kill() rejects the pending render', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        const p = pipe.render('A -> B');
        pipe.kill();
        await expect(p).rejects.toThrow('PlantUML pipe closed');
    });

    test('kill() rejects queued renders', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        const p1 = pipe.render('A -> B');
        const p2 = pipe.render('C -> D');  // queued
        pipe.kill();
        await expect(p1).rejects.toThrow('PlantUML pipe closed');
        await expect(p2).rejects.toThrow('PlantUML pipe closed');
    });

    test('serialises concurrent renders through the queue', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        const p1 = pipe.render('A -> B');
        const p2 = pipe.render('C -> D');

        // First SVG resolves p1
        mockProc.stdout.emit('data', Buffer.from('<svg>first</svg>'));
        expect(await p1).toBe('<svg>first</svg>');

        // Now p2 is pending — emit its SVG
        mockProc.stdout.emit('data', Buffer.from('<svg>second</svg>'));
        expect(await p2).toBe('<svg>second</svg>');
    });

    describe('idle shutdown', () => {
        const IDLE_MS = 1000;

        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        async function renderOnce(pipe: PlantUMLPipe, proc = mockProc) {
            const p = pipe.render('A -> B');
            proc.stdout.emit('data', Buffer.from('<svg></svg>'));
            await p;
        }

        test('kills the process once the queue has been idle for the timeout', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '', '', 'graphviz', IDLE_MS);
            await renderOnce(pipe);
            jest.advanceTimersByTime(IDLE_MS - 1);
            expect(mockProc.kill).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);
            expect(mockProc.kill).toHaveBeenCalledTimes(1);
        });

        test('spawns a fresh process for the next render after an idle shutdown', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '', '', 'graphviz', IDLE_MS);
            await renderOnce(pipe);
            jest.advanceTimersByTime(IDLE_MS);

            const second = makeMockProc();
            (spawn as jest.Mock).mockReturnValue(second);
            await renderOnce(pipe, second);
            expect(spawn).toHaveBeenCalledTimes(2);
        });

        test('a new render before the timeout keeps the process alive', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '', '', 'graphviz', IDLE_MS);
            await renderOnce(pipe);
            jest.advanceTimersByTime(IDLE_MS - 1);
            const p = pipe.render('C -> D');
            jest.advanceTimersByTime(IDLE_MS);
            expect(mockProc.kill).not.toHaveBeenCalled();
            mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
            await p;
            expect(spawn).toHaveBeenCalledTimes(1);
        });

        test('a timeout of 0 never shuts the process down', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '', '', 'graphviz', 0);
            await renderOnce(pipe);
            expect(jest.getTimerCount()).toBe(0);
        });

        test('kill() clears the idle timer', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '', '', 'graphviz', IDLE_MS);
            await renderOnce(pipe);
            pipe.kill();
            expect(mockProc.kill).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        });

        test('a late close from the idle-killed process does not fail its replacement', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '', '', 'graphviz', IDLE_MS);
            const first = mockProc;
            await renderOnce(pipe);
            jest.advanceTimersByTime(IDLE_MS);

            const second = makeMockProc();
            (spawn as jest.Mock).mockReturnValue(second);
            const p = pipe.render('C -> D');
            first.emit('close', null);
            first.emit('error', new Error('old'));
            first.stdin.emit('error', new Error('old stdin'));

            second.stdout.emit('data', Buffer.from('<svg>new</svg>'));
            expect(await p).toBe('<svg>new</svg>');

            // The replacement is still the live process: no respawn
            await renderOnce(pipe, second);
            expect(spawn).toHaveBeenCalledTimes(2);
        });
    });

    describe('warm-up', () => {
        test('starts the process with an empty diagram when nothing is running', () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
            pipe.warmUp();
            expect(spawn).toHaveBeenCalledTimes(1);
            expect(mockProc.stdin.write).toHaveBeenCalledWith('@startuml\n@enduml\n');
        });

        test('is a no-op while the process is running', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
            const p = pipe.render('A -> B');
            mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
            await p;
            pipe.warmUp();
            expect(spawn).toHaveBeenCalledTimes(1);
            expect(mockProc.stdin.write).toHaveBeenCalledTimes(1);
        });

        test('is a no-op while a render is pending', () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
            pipe.render('A -> B');
            pipe.warmUp();
            expect(mockProc.stdin.write).toHaveBeenCalledTimes(1);
        });

        test('swallows a failed warm-up', async () => {
            const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
            pipe.warmUp();
            mockProc.emit('close', 1);
            await Promise.resolve();  // an unhandled rejection would fail the test run
        });
    });

    describe('font allowlist', () => {
        const fontAllow = { lib: '/ext/out/libfontallow.dylib', families: ['Helvetica', 'Menlo'] };
        const spawnEnv = (call: number) => (spawn as jest.Mock).mock.calls[call][2].env;
        // What NSFontManager lists: it hides Times and Courier, so stock PlantUML never sees them
        const visible = ['Lucida Grande', 'Helvetica', 'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman', 'Menlo'];

        beforeEach(() => (execFileSync as jest.Mock).mockReturnValue(visible.join('\n') + '\n'));

        async function renderOnce(pipe: PlantUMLPipe, source: string) {
            const p = pipe.render(source);
            mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
            await p;
        }

        test('adds only named fonts that macOS lists', async () => {
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native', 'graphviz', 0, fontAllow);
            await renderOnce(pipe, [
                'skinparam defaultFontName "Helvetica Neue"',
                'A -> B : <font:Arial>a</font> <font:Georgia>g</font> <font:Times>t</font> <font:Courier>c</font> <font:Nope>n</font>',
            ].join('\n'));
            expect(spawnEnv(0).PLANTUML_FONT_FAMILIES).toBe('helvetica,menlo,helvetica neue,arial,georgia');
        });

        test('does not restart for a named font macOS hides', async () => {
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native', 'graphviz', 0, fontAllow);
            await renderOnce(pipe, 'A -> B');
            await renderOnce(pipe, 'A -> B : <font:Times>t</font>');
            expect(mockProc.kill).not.toHaveBeenCalled();
            expect(spawn).toHaveBeenCalledTimes(1);
        });

        test('reads the macOS family list once, and only when a diagram names an unlisted font', async () => {
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native', 'graphviz', 0, fontAllow);
            await renderOnce(pipe, 'skinparam defaultFontName Menlo\nA -> B');
            expect(execFileSync).not.toHaveBeenCalled();
            await renderOnce(pipe, '<font:Times>t</font>');
            await renderOnce(pipe, '<font:Courier>c</font>');
            expect(execFileSync).toHaveBeenCalledTimes(1);
            expect((execFileSync as jest.Mock).mock.calls[0][0]).toBe('osascript');
        });

        test('adds no fonts when the macOS family list cannot be read', async () => {
            (execFileSync as jest.Mock).mockImplementation(() => { throw new Error('osascript failed'); });
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native', 'graphviz', 0, fontAllow);
            await renderOnce(pipe, 'skinparam defaultFontName Georgia\nA -> B');
            expect(spawnEnv(0).PLANTUML_FONT_FAMILIES).toBe('helvetica,menlo');
        });

        test('fontsUsed finds fonts named by skinparam, style and creole', () => {
            const src = [
                'skinparam defaultFontName Menlo',
                'skinparam classFontName "Fira Code"',
                '<style>',
                'note { FontName Georgia; FontSize 12 }',
                '</style>',
                'note right: <font:Times New Roman>serif</font> and <font color=red>not a font</font>',
            ].join('\n');
            expect(fontsUsed(src).sort()).toEqual(['Fira Code', 'Georgia', 'Menlo', 'Times New Roman']);
        });

        test('fontsUsed ignores FontName in ordinary diagram text', () => {
            expect(fontsUsed('A -> B: FontName is just text here')).toEqual([]);
        });

        test('injects the dylib with the allowed families', () => {
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native', 'graphviz', 0, fontAllow);
            pipe.render('A -> B');
            expect(spawnEnv(0)).toMatchObject({
                DYLD_INSERT_LIBRARIES: '/ext/out/libfontallow.dylib',
                PLANTUML_FONT_FAMILIES: 'helvetica,menlo',
            });
        });

        test('restarts with a bigger list when a diagram names an unlisted font', async () => {
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native', 'graphviz', 0, fontAllow);
            const first = mockProc;
            const p = pipe.render('A -> B');
            first.stdout.emit('data', Buffer.from('<svg></svg>'));
            await p;

            const second = makeMockProc();
            (spawn as jest.Mock).mockReturnValue(second);
            const q = pipe.render('skinparam defaultFontName Georgia\nA -> B');
            expect(first.kill).toHaveBeenCalledTimes(1);
            expect(spawnEnv(1).PLANTUML_FONT_FAMILIES).toBe('helvetica,menlo,georgia');
            expect(second.stdin.write).toHaveBeenCalledTimes(1);
            first.emit('close', null);
            second.stdout.emit('data', Buffer.from('<svg>georgia</svg>'));
            expect(await q).toBe('<svg>georgia</svg>');
        });

        test('does not restart for a listed font, in any case', async () => {
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native', 'graphviz', 0, fontAllow);
            const p = pipe.render('A -> B');
            mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
            await p;
            pipe.render('skinparam defaultFontName menlo\nA -> B');
            expect(mockProc.kill).not.toHaveBeenCalled();
            expect(spawn).toHaveBeenCalledTimes(1);
        });

        test('leaves the environment alone without an allowlist', () => {
            const pipe = new PlantUMLPipe('', '', '', '/p/plantuml-native');
            pipe.render('skinparam defaultFontName Georgia\nA -> B');
            expect(spawnEnv(0)).toBe(process.env);
        });
    });
});
