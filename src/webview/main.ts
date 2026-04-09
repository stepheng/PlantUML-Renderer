declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();

const container = document.getElementById('container') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;

let currentSvg = '';
let svgEl: SVGSVGElement | null = null;
let W = 800, H = 600;
let scale = 1, minScale = 0.1;
let tx = 0, ty = 0;

// Search state
const searchBar     = document.getElementById('search-bar')      as HTMLDivElement;
const searchInput   = document.getElementById('search-input')     as HTMLInputElement;
const searchCount   = document.getElementById('search-count')     as HTMLSpanElement;

let searchOpen    = false;
let searchQuery   = '';
let searchMatches: SVGTextElement[] = [];
let searchIndex   = -1;
const originalHTML = new Map<SVGTextElement, string>();
let searchDebounce: ReturnType<typeof setTimeout> | undefined;

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
        if (searchOpen && searchQuery) applySearch();
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

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function openSearch(): void {
    searchOpen = true;
    searchBar.classList.add('open');
    searchInput.focus();
    searchInput.select();
    if (svgEl && searchQuery) applySearch();
}

function closeSearch(): void {
    clearTimeout(searchDebounce);
    searchOpen = false;
    searchBar.classList.remove('open');
    clearHighlights();
    searchMatches = [];
    searchIndex   = -1;
    updateCounter();
}

function updateCounter(): void {
    searchCount.textContent = searchMatches.length === 0
        ? '0 / 0'
        : `${searchIndex + 1} / ${searchMatches.length}`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearHighlights(): void {
    originalHTML.forEach((html, el) => { el.innerHTML = html; });
    originalHTML.clear();
}

function highlightEl(el: SVGTextElement, fill: string): void {
    const text  = el.textContent ?? '';
    const lower = text.toLowerCase();
    const qi    = searchQuery.toLowerCase();
    const idx   = lower.indexOf(qi);
    if (idx === -1) return;
    el.innerHTML =
        escapeHtml(text.slice(0, idx)) +
        `<tspan fill="${fill}">${escapeHtml(text.slice(idx, idx + searchQuery.length))}</tspan>` +
        escapeHtml(text.slice(idx + searchQuery.length));
}

function panToMatch(el: SVGTextElement): void {
    if (!svgEl) return;
    const elRect   = el.getBoundingClientRect();
    const cRect    = container.getBoundingClientRect();
    const barH     = searchOpen ? searchBar.offsetHeight : 0;
    const targetCx = cRect.left + cRect.width / 2;
    const targetCy = cRect.top + barH + (cRect.height - barH) / 2;
    tx += targetCx - (elRect.left + elRect.width / 2);
    ty += targetCy - (elRect.top + elRect.height / 2);
    applyZoom();
}

function activateMatch(idx: number): void {
    if (searchMatches.length === 0) return;
    // Restore previous active → normal yellow
    if (searchIndex >= 0 && searchIndex < searchMatches.length) {
        const prev = searchMatches[searchIndex];
        const orig = originalHTML.get(prev);
        if (orig !== undefined) { prev.innerHTML = orig; }
        highlightEl(prev, '#ffee58');
    }
    searchIndex = idx;
    const el   = searchMatches[idx];
    const orig = originalHTML.get(el);
    if (orig !== undefined) { el.innerHTML = orig; }
    highlightEl(el, '#ff9800');
    panToMatch(el);
    updateCounter();
}

function applySearch(): void {
    clearHighlights();
    searchMatches = [];
    searchIndex   = -1;

    if (!svgEl || !searchQuery) { updateCounter(); return; }

    const qi = searchQuery.toLowerCase();
    for (const el of Array.from(svgEl.querySelectorAll<SVGTextElement>('text'))) {
        if ((el.textContent ?? '').toLowerCase().includes(qi)) {
            originalHTML.set(el, el.innerHTML);
            highlightEl(el, '#ffee58');
            searchMatches.push(el);
        }
    }

    if (searchMatches.length > 0) {
        searchIndex = 0;
        // Activate first match (orange + pan) without touching previous index
        const el   = searchMatches[0];
        const orig = originalHTML.get(el)!;
        el.innerHTML = orig;
        highlightEl(el, '#ff9800');
        panToMatch(el);
    }
    updateCounter();
}

function navigateNext(): void {
    if (searchMatches.length === 0) return;
    activateMatch((searchIndex + 1) % searchMatches.length);
}

function navigatePrev(): void {
    if (searchMatches.length === 0) return;
    activateMatch((searchIndex - 1 + searchMatches.length) % searchMatches.length);
}

// Keyboard shortcuts
window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
        return;
    }
    if (e.key === 'Escape' && searchOpen) {
        closeSearch();
        return;
    }
    if (e.key === 'Enter' && searchOpen) {
        e.preventDefault();
        if (e.shiftKey) navigatePrev(); else navigateNext();
    }
});

// Debounced input handler
searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        searchQuery = searchInput.value;
        applySearch();
    }, 150);
});

// Button handlers
document.getElementById('btn-search-open')!.addEventListener('click', openSearch);
document.getElementById('btn-prev')!.addEventListener('click', navigatePrev);
document.getElementById('btn-next')!.addEventListener('click', navigateNext);
document.getElementById('btn-search-close')!.addEventListener('click', closeSearch);
