import { EventEmitter } from 'events';
import { Writable } from 'stream';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

import { spawn } from 'child_process';
import { PlantUMLPipe } from '../src/PlantUMLPipe';

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
            '-Dfile.encoding=UTF-8', '-jar', '/p/plantuml.jar',
            '-tsvg', '-pipe', '-graphvizdot', '/usr/bin/dot',
        ]);
    });

    test('omits graphvizdot arg when dotPath is empty', async () => {
        const pipe = new PlantUMLPipe('/usr/bin/java', '/p/plantuml.jar', '');
        const p = pipe.render('@startuml\nA\n@enduml');
        mockProc.stdout.emit('data', Buffer.from('<svg></svg>'));
        await p;
        expect(spawn).toHaveBeenCalledWith('/usr/bin/java', [
            '-Dfile.encoding=UTF-8', '-jar', '/p/plantuml.jar', '-tsvg', '-pipe',
        ]);
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
});
