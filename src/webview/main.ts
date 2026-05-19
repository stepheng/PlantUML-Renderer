declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();

const container = document.getElementById('container') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;

let currentSvg = '';
let svgEl: SVGSVGElement | null = null;
let W = 800, H = 600;

// Actual transform applied to the DOM (constrained by current diagram + container).
let scale = 1, minScale = 0.1;
let tx = 0, ty = 0;

// User-desired transform — what the user last asked for. Re-applied on each
// render so transient shrinkage of the diagram (e.g. mid-edit errors) does not
// reset the view. Constrained into the actual values via commitFromDesired().
let desiredScale = 1, desiredTx = 0, desiredTy = 0;
let desiredInitialized = false;

// Search state
const searchBar     = document.getElementById('search-bar')      as HTMLDivElement;
const searchInput   = document.getElementById('search-input')     as HTMLInputElement;
const searchCount   = document.getElementById('search-count')     as HTMLSpanElement;

let searchOpen    = false;
let searchQuery   = '';
interface SearchMatch { el: SVGTextElement; occ: number; }
let searchMatches: SearchMatch[] = [];
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
        const fit = Math.min(1, cw / W);
        if (!desiredInitialized) {
            desiredScale = fit;
            desiredTx = 0; desiredTy = 0;
            desiredInitialized = true;
        }
        commitFromDesired();
        paint();
        if (searchOpen && searchQuery) applySearch();
    });
}

// ---------------------------------------------------------------------------
// Pan / zoom
// ---------------------------------------------------------------------------

function commitFromDesired() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    minScale = Math.min(1, cw / W);
    scale = Math.max(minScale, Math.min(20, desiredScale));
    let nx = desiredTx;
    let ny = desiredTy;
    nx = Math.min(0, Math.max(nx, cw - W * scale));
    ny = Math.min(0, Math.max(ny, ch - H * scale));
    tx = nx; ty = ny;
}

function syncDesiredFromActual() {
    desiredScale = scale; desiredTx = tx; desiredTy = ty;
}

function paint() {
    if (!svgEl) return;
    svgEl.style.width = `${W * scale}px`;
    svgEl.style.height = `${H * scale}px`;
    svgEl.style.transform = `translate3d(${tx}px,${ty}px,0)`;
}

let paintRafPending = false;
function schedulePaint() {
    if (paintRafPending) return;
    paintRafPending = true;
    requestAnimationFrame(() => { paintRafPending = false; paint(); });
}

container.addEventListener('wheel', (e: WheelEvent) => {
    if (!svgEl) return;
    e.preventDefault();
    // Anchor zoom to what's currently displayed, not stale desired values.
    syncDesiredFromActual();
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(minScale, Math.min(20, desiredScale * factor));
    desiredTx = mx - (mx - desiredTx) * (newScale / desiredScale);
    desiredTy = my - (my - desiredTy) * (newScale / desiredScale);
    desiredScale = newScale;
    commitFromDesired();
    schedulePaint();
}, { passive: false });

let dragging = false, dragX = 0, dragY = 0, startTx = 0, startTy = 0;

container.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || !svgEl) return;
    if ((e.target as Element).closest('#toolbar')) return;
    dragging = true;
    syncDesiredFromActual();
    dragX = e.clientX; dragY = e.clientY;
    startTx = desiredTx; startTy = desiredTy;
    container.setPointerCapture(e.pointerId);
    container.classList.add('grabbing');
});

container.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    desiredTx = startTx + (e.clientX - dragX);
    desiredTy = startTy + (e.clientY - dragY);
    commitFromDesired();
    paint();
});

container.addEventListener('pointerup', () => {
    dragging = false;
    container.classList.remove('grabbing');
});

container.addEventListener('dblclick', (e: MouseEvent) => {
    if ((e.target as Element).closest('#toolbar')) return;
    resetView();
});

function resetView() {
    const cw = container.clientWidth || W;
    desiredScale = Math.min(1, cw / W);
    desiredTx = 0; desiredTy = 0;
    commitFromDesired();
    paint();
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetView();
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

function highlightEl(el: SVGTextElement, fill: string, activeOcc = -1, activeFill = fill): void {
    const text = el.textContent ?? '';
    const qi   = searchQuery.toLowerCase();
    if (!qi) return;
    const lower = text.toLowerCase();
    let result = '';
    let pos = 0;
    let occ = 0;
    let idx = lower.indexOf(qi, pos);
    if (idx === -1) return;
    while (idx !== -1) {
        result += escapeHtml(text.slice(pos, idx));
        result += `<tspan fill="${occ === activeOcc ? activeFill : fill}">${escapeHtml(text.slice(idx, idx + qi.length))}</tspan>`;
        pos = idx + qi.length;
        occ++;
        idx = lower.indexOf(qi, pos);
    }
    result += escapeHtml(text.slice(pos));
    el.innerHTML = result;
}

function panToMatch(el: SVGTextElement): void {
    if (!svgEl) return;
    const elRect   = el.getBoundingClientRect();
    const cRect    = container.getBoundingClientRect();
    const barH     = searchOpen ? searchBar.offsetHeight : 0;
    const targetCx = cRect.left + cRect.width / 2;
    const targetCy = cRect.top + barH + (cRect.height - barH) / 2;
    syncDesiredFromActual();
    desiredTx += targetCx - (elRect.left + elRect.width / 2);
    desiredTy += targetCy - (elRect.top + elRect.height / 2);
    commitFromDesired();
    paint();
}

function activateMatch(idx: number): void {
    if (searchMatches.length === 0) return;
    // Restore previous active element → all blue
    if (searchIndex >= 0 && searchIndex < searchMatches.length) {
        const prev = searchMatches[searchIndex];
        const orig = originalHTML.get(prev.el);
        if (orig !== undefined) { prev.el.innerHTML = orig; }
        highlightEl(prev.el, '#0369a1');
    }
    searchIndex = idx;
    const cur  = searchMatches[idx];
    const orig = originalHTML.get(cur.el);
    if (orig !== undefined) { cur.el.innerHTML = orig; }
    highlightEl(cur.el, '#0369a1', cur.occ, '#b91c1c');
    panToMatch(cur.el);
    updateCounter();
}

function applySearch(): void {
    clearHighlights();
    searchMatches = [];
    searchIndex   = -1;

    if (!svgEl || !searchQuery) { updateCounter(); return; }

    const qi = searchQuery.toLowerCase();
    const collected: SVGTextElement[] = [];
    for (const el of Array.from(svgEl.querySelectorAll<SVGTextElement>('text'))) {
        if ((el.textContent ?? '').toLowerCase().includes(qi)) {
            collected.push(el);
        }
    }

    collected.sort((a, b) => {
        const ay = parseFloat(a.getAttribute('y') ?? '0');
        const by = parseFloat(b.getAttribute('y') ?? '0');
        if (ay !== by) return ay - by;
        return parseFloat(a.getAttribute('x') ?? '0') - parseFloat(b.getAttribute('x') ?? '0');
    });

    for (const el of collected) {
        originalHTML.set(el, el.innerHTML);
        const lower = (el.textContent ?? '').toLowerCase();
        let pos = 0, occ = 0, idx = lower.indexOf(qi, 0);
        while (idx !== -1) {
            searchMatches.push({ el, occ });
            occ++;
            pos = idx + qi.length;
            idx = lower.indexOf(qi, pos);
        }
        highlightEl(el, '#0369a1'); // all occurrences blue initially
    }

    if (searchMatches.length > 0) {
        searchIndex = 0;
        const cur  = searchMatches[0];
        const orig = originalHTML.get(cur.el)!;
        cur.el.innerHTML = orig;
        highlightEl(cur.el, '#0369a1', cur.occ, '#b91c1c');
        panToMatch(cur.el);
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
