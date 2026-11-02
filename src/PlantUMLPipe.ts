import { spawn, type ChildProcess } from 'child_process';
import { firstBlock } from './DiagramBlock';

interface Pending {
    resolve: (s: string) => void;
    reject: (e: Error) => void;
}

interface QueueItem extends Pending {
    source: string;
}

// Send exactly one terminated diagram per render. In -pipe mode PlantUML emits
// nothing until it reads the matching @end line, so a source without one (e.g.
// mid-edit) would stall every later render; and each extra block in the source
// would emit an extra SVG, pairing every later response with the wrong request.
function terminate(source: string): string {
    const lines = source.split('\n');
    const block = firstBlock(lines);
    if (!block) return `@startuml\n${source}\n@enduml`;
    if (block.end < 0) return [...lines.slice(block.start), `@end${block.type}`].join('\n');
    return lines.slice(block.start, block.end + 1).join('\n');
}

// Font families a diagram names: skinparam/style `...FontName X` keys and creole `<font:X>`
export function fontsUsed(source: string): string[] {
    const found = new Set<string>();
    for (const m of source.matchAll(/(?:^\s*(?:skinparam\s+)?\w*|[{;]\s*\w*)FontName\s+(?:"([^"]+)"|([^\s;}]+))/gim))
        found.add(m[1] || m[2]);
    for (const m of source.matchAll(/<font:\s*([^>]+)>/gi)) found.add(m[1].trim());
    return [...found];
}

export class PlantUMLPipe {
    private proc: ChildProcess | null = null;
    private outBuf = '';
    private pending: Pending | null = null;
    private queue: QueueItem[] = [];
    private idleTimer: ReturnType<typeof setTimeout> | undefined;
    // Lower-cased: Java and NSFontManager both match family names case-insensitively
    private readonly fonts: Set<string>;

    constructor(
        private readonly javaPath: string,
        private readonly jarPath: string,
        private readonly dotPath: string,
        private readonly nativePath = '',
        private readonly layout: 'graphviz' | 'smetana' = 'graphviz',
        private readonly idleMs = 0,
        // Most of a cold start is the macOS font manager walking every installed font;
        // src/fontallow.m, injected into the native binary, limits the walk to these families
        private readonly fontAllow?: { lib: string; families: string[] },
    ) {
        this.fonts = new Set(fontAllow?.families.map(f => f.toLowerCase()));
    }

    // Pay the cold start before the user needs a render
    warmUp() {
        if (!this.proc && !this.pending) this.render('@startuml\n@enduml').catch(() => {});
    }

    render(source: string): Promise<string> {
        clearTimeout(this.idleTimer);
        return new Promise((resolve, reject) => {
            this.queue.push({ source, resolve, reject });
            if (!this.pending) this.next();
        });
    }

    kill() {
        clearTimeout(this.idleTimer);
        this.stop();
        this.fail(new Error('PlantUML pipe closed'));
    }

    private next() {
        if (this.queue.length === 0) {
            // Free the warm process (~250 MB native) after a quiet spell; the next render respawns it
            if (this.idleMs > 0 && this.proc) this.idleTimer = setTimeout(() => this.stop(), this.idleMs);
            return;
        }
        const item = this.queue.shift()!;
        this.pending = item;
        if (this.fontAllow) {
            const missing = fontsUsed(item.source).map(f => f.toLowerCase()).filter(f => !this.fonts.has(f));
            if (missing.length) {
                missing.forEach(f => this.fonts.add(f));
                this.stop();  // The allowlist is fixed per process: respawn with the bigger one
            }
        }
        try {
            this.ensureRunning();
            this.proc!.stdin!.write(terminate(item.source) + '\n');
        } catch (err) {
            this.pending = null;
            item.reject(err instanceof Error ? err : new Error(String(err)));
            this.next();
        }
    }

    private stop() {
        const proc = this.proc;
        this.proc = null;
        proc?.kill();
    }

    private fail(err: Error) {
        const p = this.pending;
        this.pending = null;
        this.proc = null;
        p?.reject(err);
        this.queue.forEach(item => item.reject(err));
        this.queue = [];
    }

    private ensureRunning() {
        if (this.proc && !this.proc.killed) return;

        // A native (GraalVM) binary takes the same -D flags and runs without java -jar
        const args = ['-Dfile.encoding=UTF-8', '-DPLANTUML_SECURITY_PROFILE=SANDBOX'];
        if (!this.nativePath) args.push('-jar', this.jarPath);
        args.push('-tsvg', '-pipe');
        // Smetana is PlantUML's built-in port of dot: no external process per render
        if (this.layout === 'smetana') args.push('-Playout=smetana');
        else if (this.dotPath) args.push('-graphvizdot', this.dotPath);

        const env = this.fontAllow
            ? { ...process.env, DYLD_INSERT_LIBRARIES: this.fontAllow.lib, PLANTUML_FONT_FAMILIES: [...this.fonts].join(',') }
            : process.env;
        const proc = this.proc = spawn(this.nativePath || this.javaPath, args, { env });
        this.outBuf = '';
        // Events from a process already stopped (idle or killed) must not fail its replacement
        const fail = (err: Error) => { if (proc === this.proc) this.fail(err); };

        proc.stdout!.on('data', (chunk: Buffer) => {
            this.outBuf += chunk.toString('utf-8');
            let end: number;
            while ((end = this.outBuf.indexOf('</svg>')) !== -1) {
                const svg = this.outBuf.slice(0, end + 6);
                this.outBuf = this.outBuf.slice(end + 6);
                if (!this.pending) break;
                const p = this.pending;
                this.pending = null;
                p.resolve(svg);
                this.next();
            }
        });

        proc.stderr!.on('data', () => {});
        proc.stdin!.on('error', fail);
        proc.on('error', fail);
        proc.on('close', (code) => fail(new Error(`PlantUML process exited unexpectedly (code ${code})`)));
    }
}
