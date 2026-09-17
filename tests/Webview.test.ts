/** @jest-environment jsdom */
/// <reference lib="dom" />
import * as path from 'path';
import { execFileSync } from 'child_process';

const normalSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="gradient"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="100" height="100" fill="url(#gradient)"/><text x="10" y="20">Alice &amp; Bob</text></svg>';
let postMessage: jest.Mock;

beforeAll(() => {
    document.body.innerHTML = '<div id="container"></div><div id="error"></div><div id="search-bar"><input id="search-input"/><span id="search-count"></span></div>' +
        ['reset', 'svg', 'png', 'search-open', 'prev', 'next', 'search-close'].map(id => `<button id="btn-${id}"></button>`).join('');
    postMessage = jest.fn();
    (window as any).acquireVsCodeApi = () => ({ postMessage });
    window.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 0; };
    const bundle = execFileSync(process.execPath, ['-e', "process.stdout.write(require('esbuild').buildSync({entryPoints:['src/webview/main.ts'],bundle:true,write:false,format:'iife'}).outputFiles[0].text)"], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    window.eval(bundle);
});

function render(data: string) {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'svg', data } }));
}

function preview() { return document.querySelector('#container svg')!; }

test('removes active SVG content before insertion and export', () => {
    render('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>injected</div></foreignObject><a href="javascript:alert(1)"><text onclick="alert(1)">Alice</text></a><animate attributeName="href" values="javascript:alert(1)"/></svg>');
    expect(preview().querySelector('script, foreignObject, animate')).toBeNull();
    expect(preview().querySelector('[onload], [onclick], [href^="javascript:"]')).toBeNull();
    document.getElementById('btn-svg')!.click();
    expect(postMessage.mock.calls[postMessage.mock.calls.length - 1][0].data).not.toMatch(/onload|onclick|javascript:|foreignObject|<script/i);
});

test('blocks diagram styles from changing the surrounding toolbar', () => {
    render('<svg xmlns="http://www.w3.org/2000/svg"><style>button {display:none}</style><text>Safe</text></svg>');
    expect(preview().querySelector('style')).toBeNull();
});

test('preserves diagram shapes, gradients, search, and zoom', () => {
    render(normalSvg);
    expect(preview().querySelector('rect')!.getAttribute('fill')).toBe('url(#gradient)');
    expect(preview().querySelector('linearGradient')).not.toBeNull();
    expect(preview().textContent).toBe('Alice & Bob');
    document.getElementById('btn-search-open')!.click();
    jest.useFakeTimers();
    const input = document.getElementById('search-input') as HTMLInputElement;
    input.value = 'Alice';
    input.dispatchEvent(new Event('input'));
    jest.runAllTimers();
    jest.useRealTimers();
    expect(document.getElementById('search-count')!.textContent).toBe('1 / 1');
    expect(preview().querySelector('tspan')!.textContent).toBe('Alice');
    document.getElementById('btn-search-close')!.click();
    expect(preview().textContent).toBe('Alice & Bob');
    const width = (preview() as SVGSVGElement).style.width;
    document.getElementById('container')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    expect((preview() as SVGSVGElement).style.width).not.toBe(width);
});

test('rejects output without SVG', () => {
    render('<img src="x" onerror="alert(1)">');
    expect(document.querySelector('#container svg')).toBeNull();
    expect(document.getElementById('error')!.textContent).toContain('no <svg>');
});
