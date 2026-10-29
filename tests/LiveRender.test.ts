import { LiveRender, type PreviewMessage } from '../src/LiveRender';

const GOOD = (n: number) => `<svg data-diagram-type="SEQUENCE">good${n}</svg>`;
const BAD = (n: number) => `<svg>Syntax Error? bad${n}</svg>`;

function deferred() {
    let resolve!: (s: string) => void, reject!: (e: Error) => void;
    const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const flush = () => new Promise<void>(r => jest.requireActual<typeof globalThis>('timers').setImmediate(r));

describe('LiveRender', () => {
    let shown: PreviewMessage[];
    let live: LiveRender;

    beforeEach(() => {
        jest.useFakeTimers();
        shown = [];
        live = new LiveRender(msg => shown.push(msg), 1000);
    });

    afterEach(() => jest.useRealTimers());

    test('shows a good render immediately', async () => {
        live.update(async () => GOOD(1));
        await flush();
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }]);
    });

    test('shows an error immediately when there is no good render to keep', async () => {
        live.update(async () => BAD(1));
        await flush();
        expect(shown).toEqual([{ type: 'svg', data: BAD(1) }]);
    });

    test('keeps the last good render and shows the error only after the delay', async () => {
        live.update(async () => GOOD(1));
        await flush();
        live.update(async () => BAD(2));
        await flush();
        jest.advanceTimersByTime(999);
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }]);
        jest.advanceTimersByTime(1);
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }, { type: 'svg', data: BAD(2) }]);
    });

    test('a good render within the delay cancels the pending error', async () => {
        live.update(async () => GOOD(1));
        await flush();
        live.update(async () => BAD(2));
        await flush();
        jest.advanceTimersByTime(500);
        live.update(async () => GOOD(3));
        await flush();
        jest.advanceTimersByTime(5000);
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }, { type: 'svg', data: GOOD(3) }]);
    });

    test('each new error restarts the delay and the latest error is shown', async () => {
        live.update(async () => GOOD(1));
        await flush();
        live.update(async () => BAD(2));
        await flush();
        jest.advanceTimersByTime(800);
        live.update(async () => BAD(3));
        await flush();
        jest.advanceTimersByTime(800);
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }]);
        jest.advanceTimersByTime(200);
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }, { type: 'svg', data: BAD(3) }]);
    });

    test('holds thrown errors the same way and reports them as error messages', async () => {
        live.update(async () => GOOD(1));
        await flush();
        live.update(async () => { throw new Error('PlantUML process exited unexpectedly (code 1)'); });
        await flush();
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }]);
        jest.advanceTimersByTime(1000);
        expect(shown[1]).toEqual({ type: 'error', data: 'PlantUML process exited unexpectedly (code 1)' });
    });

    test('runs one job at a time and skips superseded jobs', async () => {
        const first = deferred();
        const ran: number[] = [];
        live.update(() => { ran.push(1); return first.promise; });
        live.update(async () => { ran.push(2); return GOOD(2); });
        live.update(async () => { ran.push(3); return GOOD(3); });
        await flush();
        expect(ran).toEqual([1]);
        first.resolve(GOOD(1));
        await flush();
        expect(ran).toEqual([1, 3]);
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }, { type: 'svg', data: GOOD(3) }]);
    });

    test('reset() forgets the last good render so the next error shows immediately', async () => {
        live.update(async () => GOOD(1));
        await flush();
        live.reset();
        live.update(async () => BAD(2));
        await flush();
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }, { type: 'svg', data: BAD(2) }]);
    });

    test('reset() drops the result of a job already in flight', async () => {
        const first = deferred();
        live.update(() => first.promise);
        await flush();
        live.reset();
        live.update(async () => GOOD(2));
        first.resolve(GOOD(1));
        await flush();
        expect(shown).toEqual([{ type: 'svg', data: GOOD(2) }]);
    });

    test('reset() cancels a pending error', async () => {
        live.update(async () => GOOD(1));
        await flush();
        live.update(async () => BAD(2));
        await flush();
        live.reset();
        jest.advanceTimersByTime(5000);
        expect(shown).toEqual([{ type: 'svg', data: GOOD(1) }]);
    });
});
