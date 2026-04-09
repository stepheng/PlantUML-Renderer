declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();

const container = document.getElementById('container') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;

let currentSvg = '';
let svgEl: SVGSVGElement | null = null;
let W = 800, H = 600;
let scale = 1, minScale = 0.1;
let tx = 0, ty = 0;

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type: string; data: string };
    if (msg.type === 'svg') showSvg(msg.data);
    else if (msg.type === 'error') showError(msg.data);
});

function showError(msg: string) {
    if (svgEl) { svgEl.remove(); svgEl = null; }
    errorEl.textContent = msg;
    errorEl.style.display = '';
}

function showSvg(svg: string) {
    errorEl.style.display = 'none';
    currentSvg = svg;

    if (svgEl) svgEl.remove();

    const vb = svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
    W = vb ? parseFloat(vb[1]) : parseFloat(svg.match(/\bwidth="([\d.]+)"/)?.[1] ?? '800');
    H = vb ? parseFloat(vb[2]) : parseFloat(svg.match(/\bheight="([\d.]+)"/)?.[1] ?? '600');

    const content = (svg.match(/<svg[\s\S]*<\/svg>/i) ?? [svg])[0];
    const tmp = document.createElement('div');
    tmp.innerHTML = content;
    const found = tmp.querySelector('svg') as SVGSVGElement | null;
    if (!found) { showError('Render error: no <svg> element in PlantUML output'); return; }
    svgEl = found;
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    Object.assign(svgEl.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        display: 'block',
        willChange: 'transform',
    });
    container.appendChild(svgEl);

    requestAnimationFrame(() => {
        const cw = container.clientWidth || W;
        scale = Math.min(1, cw / W);
        minScale = scale;
        tx = 0; ty = 0;
        applyZoom();
    });
}

// ---------------------------------------------------------------------------
// Pan / zoom
// ---------------------------------------------------------------------------

function clamp() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    tx = Math.min(0, Math.max(tx, cw - W * scale));
    ty = Math.min(0, Math.max(ty, ch - H * scale));
}

function applyTranslate() {
    if (!svgEl) return;
    svgEl.style.transform = `translate3d(${tx}px,${ty}px,0)`;
}

let zoomRafPending = false;
function applyZoom() {
    if (!svgEl) return;
    clamp();
    svgEl.style.width = `${W * scale}px`;
    svgEl.style.height = `${H * scale}px`;
    applyTranslate();
}
function scheduleZoom() {
    if (zoomRafPending) return;
    zoomRafPending = true;
    requestAnimationFrame(() => { zoomRafPending = false; applyZoom(); });
}

container.addEventListener('wheel', (e: WheelEvent) => {
    if (!svgEl) return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(minScale, Math.min(20, scale * factor));
    tx = mx - (mx - tx) * (newScale / scale);
    ty = my - (my - ty) * (newScale / scale);
    scale = newScale;
    scheduleZoom();
}, { passive: false });

let dragging = false, dragX = 0, dragY = 0, startTx = 0, startTy = 0;

container.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || !svgEl) return;
    if ((e.target as Element).closest('#toolbar')) return;
    dragging = true;
    dragX = e.clientX; dragY = e.clientY;
    startTx = tx; startTy = ty;
    container.setPointerCapture(e.pointerId);
    container.classList.add('grabbing');
});

container.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    tx = startTx + (e.clientX - dragX);
    ty = startTy + (e.clientY - dragY);
    clamp();
    applyTranslate();
});

container.addEventListener('pointerup', () => {
    dragging = false;
    container.classList.remove('grabbing');
});

container.addEventListener('dblclick', (e: MouseEvent) => {
    if ((e.target as Element).closest('#toolbar')) return;
    scale = minScale;
    tx = 0; ty = 0;
    applyZoom();
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

document.getElementById('btn-reset')!.addEventListener('click', () => {
    scale = minScale;
    tx = 0; ty = 0;
    applyZoom();
});

document.getElementById('btn-svg')!.addEventListener('click', () => {
    if (!currentSvg) return;
    vscode.postMessage({ type: 'export', format: 'svg', data: currentSvg });
});

document.getElementById('btn-png')!.addEventListener('click', () => {
    if (!currentSvg) return;
    const dpr = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d')!;
    // Use base64 data URL to avoid blob: URL CSP issues in the webview sandbox
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(currentSvg);
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        vscode.postMessage({ type: 'export', format: 'png', data: canvas.toDataURL('image/png') });
    };
    img.onerror = () => {
        vscode.postMessage({ type: 'exportError', message: 'PNG conversion failed' });
    };
    img.src = svgDataUrl;
});
