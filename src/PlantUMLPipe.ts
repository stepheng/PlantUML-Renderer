import { spawn, type ChildProcess } from 'child_process';

interface Pending {
    resolve: (s: string) => void;
    reject: (e: Error) => void;
}

interface QueueItem extends Pending {
    source: string;
}

export class PlantUMLPipe {
    private proc: ChildProcess | null = null;
    private outBuf = '';
    private pending: Pending | null = null;
    private queue: QueueItem[] = [];

    constructor(
        private readonly javaPath: string,
        private readonly jarPath: string,
        private readonly dotPath: string,
    ) {}

    render(source: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.queue.push({ source, resolve, reject });
            if (!this.pending) this.next();
        });
    }

    kill() {
        this.proc?.kill();
        this.proc = null;
        const err = new Error('PlantUML pipe closed');
        this.pending?.reject(err);
        this.pending = null;
        this.queue.forEach(item => item.reject(err));
        this.queue = [];
    }

    private next() {
        if (this.queue.length === 0) return;
        const item = this.queue.shift()!;
        this.pending = item;
        try {
            this.ensureRunning();
            const wrapped = /^\s*@startuml/i.test(item.source)
                ? item.source
                : `@startuml\n${item.source}\n@enduml`;
            this.proc!.stdin!.write(wrapped + '\n');
        } catch (err) {
            this.pending = null;
            item.reject(err instanceof Error ? err : new Error(String(err)));
            this.next();
        }
    }

    private ensureRunning() {
        if (this.proc && !this.proc.killed) return;

        const args = ['-Dfile.encoding=UTF-8', '-jar', this.jarPath, '-tsvg', '-pipe'];
        if (this.dotPath) args.push('-graphvizdot', this.dotPath);

        this.proc = spawn(this.javaPath, args);
        this.outBuf = '';

        this.proc.stdout!.on('data', (chunk: Buffer) => {
            this.outBuf += chunk.toString('utf-8');
            const end = this.outBuf.indexOf('</svg>');
            if (end === -1) return;
            const svg = this.outBuf.slice(0, end + 6);
            this.outBuf = this.outBuf.slice(end + 6);
            const p = this.pending!;
            this.pending = null;
            p.resolve(svg);
            this.next();
        });

        this.proc.stderr!.on('data', () => {});

        this.proc.on('error', (err) => {
            const p = this.pending;
            this.pending = null;
            this.proc = null;
            p?.reject(err);
            this.queue.forEach(item => item.reject(err));
            this.queue = [];
        });

        this.proc.on('close', (code) => {
            this.proc = null;
            if (this.pending) {
                const p = this.pending;
                this.pending = null;
                p.reject(new Error(`PlantUML process exited unexpectedly (code ${code})`));
                if (this.queue.length > 0) this.next();
            }
        });
    }
}
