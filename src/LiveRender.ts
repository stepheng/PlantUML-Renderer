export type PreviewMessage = { type: 'svg' | 'error'; data: string };

type Job = () => Promise<string>;

// PlantUML tags every successfully rendered SVG with data-diagram-type;
// its syntax-error images never carry it.
const isGood = (svg: string) => /\bdata-diagram-type="/.test(svg);

/**
 * Renders on every edit without flashing broken diagrams while the user types.
 * One job runs at a time and only the newest waiting job is kept. A failed
 * render keeps the last good diagram on screen; the failure is shown only if
 * no good render arrives within errorDelayMs.
 */
export class LiveRender {
    private running = false;
    private next: Job | null = null;
    private hasGood = false;
    private errorTimer: ReturnType<typeof setTimeout> | undefined;
    private generation = 0;

    constructor(
        private readonly show: (msg: PreviewMessage) => void,
        private readonly errorDelayMs = 1000,
    ) {}

    update(job: Job) {
        this.next = job;
        if (!this.running) void this.drain();
    }

    /** Call when the previewed document changes: the last good render no longer applies. */
    reset() {
        this.generation++;
        this.next = null;
        this.hasGood = false;
        clearTimeout(this.errorTimer);
    }

    private async drain() {
        this.running = true;
        while (this.next) {
            const job = this.next;
            this.next = null;
            const generation = this.generation;
            let msg: PreviewMessage;
            try {
                msg = { type: 'svg', data: await job() };
            } catch (err) {
                msg = { type: 'error', data: err instanceof Error ? err.message : String(err) };
            }
            if (generation === this.generation) this.deliver(msg);
        }
        this.running = false;
    }

    private deliver(msg: PreviewMessage) {
        clearTimeout(this.errorTimer);
        if (msg.type === 'svg' && isGood(msg.data)) {
            this.hasGood = true;
            this.show(msg);
        } else if (!this.hasGood) {
            this.show(msg);
        } else {
            this.errorTimer = setTimeout(() => this.show(msg), this.errorDelayMs);
        }
    }
}
