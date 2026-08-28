/**
 * Training — unlisted stats page.
 *
 * Data flow: scripts/build-training-stats.py in the private `me` repo
 * precomputes every series and label, and pushes the payload to Cloudflare KV.
 * foobos.net/api/fitness/<slug>.json serves it with CORS for this origin. The
 * page is gated by a typed password: the fetch slug is SHA-256(salt+password),
 * so the password never leaves the device and the slug must never be
 * hardcoded here — this repo is public.
 *
 * This file renders. It does not compute training rules: every prescription
 * string, meter number and label arrives render-ready. If a number looks
 * wrong, fix the builder, not the page.
 *
 * Charts are hand-rolled SVG with colours written as presentation attributes
 * rather than CSS, so a chart serialized out to PNG still looks like itself.
 */

const API_BASE = 'https://foobos.net/api/fitness/';
const LS_SLUG = 'training:slug';
const SLUG_SALT = 'training.scottfriedman.ooo:v1:';
const SUPPORTED_SCHEMA = 1;

// Exports must not depend on a web font: a font that fails to load inside the
// rasterizer silently reflows every label.
const FONT_STACK =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

let STATS = null;
let FILTER = 'recent';
let openDetail = null;

// ─── Palette ────────────────────────────────────────────────────────

function isDark() {
    return typeof matchMedia === 'function' &&
        matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Chart colours for the active theme. Mirrors css/training.css. */
function palette() {
    return isDark()
        ? {
            ink: '#ececec', gray: '#a8a8a8', dim: '#7d7d7d',
            accent: '#6fbf87', warm: '#e08560', surface: '#1e1e1e',
            grid: '#333333', gridFaint: '#282828', baseline: '#3f3f3f',
            track: 'rgba(111,191,135,0.18)',
        }
        : {
            ink: '#1a1a1a', gray: '#666666', dim: '#999999',
            accent: '#2d5a3d', warm: '#c45d3a', surface: '#ffffff',
            grid: '#e1e0d9', gridFaint: '#eeede8', baseline: '#c3c2b7',
            track: 'rgba(45,90,61,0.14)',
        };
}

// ─── Small helpers ──────────────────────────────────────────────────

/**
 * Parse 'YYYY-MM-DD' as a LOCAL date.
 * `new Date('2026-04-06')` is parsed as UTC midnight, which in Boston lands on
 * Apr 5 — every heatmap cell would sit one weekday column to the left.
 */
function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function dayCount(a, b) {
    return Math.round((b - a) / 86400000);
}

function monthLabel(iso) {
    return MONTHS[Number(iso.split('-')[1]) - 1];
}

function el(tag, attrs, kids) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) {
        if (attrs[k] !== null && attrs[k] !== undefined) {
            node.setAttribute(k, String(attrs[k]));
        }
    }
    for (const kid of kids || []) node.appendChild(kid);
    return node;
}

function text(x, y, str, attrs) {
    const node = el('text', Object.assign({ x, y }, attrs));
    node.textContent = str;
    return node;
}

/**
 * An SVG root carrying everything a standalone rasterizer needs: xmlns,
 * explicit width/height, viewBox and a real font stack.
 */
function svgRoot(w, h) {
    return el('svg', {
        xmlns: SVG_NS, width: w, height: h,
        viewBox: `0 0 ${w} ${h}`, 'font-family': FONT_STACK,
    });
}

/**
 * Intrinsic size of a chart, read from its viewBox.
 *
 * The viewBox is the contract every exportable chart carries, so reading it
 * back means an export can never depend on a stray property surviving a
 * clone. Throws loudly rather than handing a NaN to canvas.
 */
function svgSize(svg) {
    const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || !Number.isFinite(box[2]) || !Number.isFinite(box[3])) {
        throw new Error('chart has no usable viewBox');
    }
    return { w: box[2], h: box[3] };
}

function tag(name, cls, str) {
    const node = document.createElement(name);
    if (cls) node.className = cls;
    if (str !== undefined && str !== null) node.textContent = str;
    return node;
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/** Linear map from a numeric domain to a pixel range. */
function scale(d0, d1, p0, p1) {
    if (d1 === d0) return () => (p0 + p1) / 2;
    return (v) => p0 + ((v - d0) / (d1 - d0)) * (p1 - p0);
}

const DOWNLOAD_ICON =
    '<path d="M8 2.5V10"></path><path d="M5 7.5l3 3 3-3"></path>' +
    '<path d="M3 12.5h10"></path>';

function exportButton(label, factory) {
    const btn = tag('button', 'export-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', `export ${label} as an image`);
    btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ' +
        'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
        `stroke-linejoin="round" aria-hidden="true">${DOWNLOAD_ICON}</svg>`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        runExport(btn, factory, label);
    });
    return btn;
}

// ─── Charts ─────────────────────────────────────────────────────────

const PANEL_W = 330;
const PANEL_H = 150;

/**
 * One strength small multiple: a 2px line, an end dot with a surface ring,
 * and only the start and end values labelled.
 *
 * `domain` is shared across the panels so the four lifts share an x-axis;
 * y is per-panel, which is what makes a small multiple readable.
 */
function buildStrengthChart(entry, domain, opts) {
    const o = opts || {};
    const p = palette();
    const w = o.width || PANEL_W;
    const h = o.height || PANEL_H;
    const svg = svgRoot(w, h);

    const right = w - 40;
    // The scale runs over DAYS, not milliseconds: every caller below measures
    // a point with dayCount(), so the domain has to be in the same unit.
    const x = scale(0, Math.max(1, dayCount(domain[0], domain[1])), 10, right);
    const values = entry.points.map((pt) => pt[1]);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const y = scale(lo, hi, h - 32, 36);

    svg.appendChild(el('line', {
        x1: 10, y1: h - 22, x2: right, y2: h - 22,
        stroke: p.grid, 'stroke-width': 1,
    }));
    svg.appendChild(el('line', {
        x1: 10, y1: (h - 22 + 36) / 2, x2: right, y2: (h - 22 + 36) / 2,
        stroke: p.gridFaint, 'stroke-width': 1,
    }));

    const pts = entry.points.map((pt) => {
        const px = x(dayCount(domain[0], parseISO(pt[0])));
        return `${px.toFixed(1)},${y(pt[1]).toFixed(1)}`;
    });

    if (pts.length > 1) {
        svg.appendChild(el('polyline', {
            points: pts.join(' '), fill: 'none', stroke: p.accent,
            'stroke-width': o.thick || 2,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }));
    }

    const lastX = x(dayCount(domain[0], parseISO(entry.last_date)));
    const lastY = y(entry.latest);
    // A hollow dot says the line stopped rather than ended.
    svg.appendChild(el('circle', {
        cx: lastX, cy: lastY, r: 4.5,
        fill: entry.dormant ? p.surface : p.accent,
        stroke: entry.dormant ? p.accent : p.surface, 'stroke-width': 2,
    }));

    const firstX = x(dayCount(domain[0], parseISO(entry.first_date)));
    if (entry.points.length > 1) {
        svg.appendChild(text(firstX + 7, y(entry.first) + 3, String(entry.first), {
            'font-size': 10, fill: p.dim,
        }));
    }
    svg.appendChild(text(lastX + 12, lastY + 4, String(entry.latest), {
        'font-size': 12, 'font-weight': 600, fill: p.ink,
    }));
    if (entry.dormant) {
        svg.appendChild(text(lastX + 12, lastY + 18,
            `${monthLabel(entry.last_date)} ${Number(entry.last_date.split('-')[2])}`,
            { 'font-size': 10, fill: p.dim }));
    }

    svg.appendChild(text(firstX, h - 4, monthLabel(entry.first_date), {
        'font-size': 9, fill: p.dim, 'text-anchor': 'middle',
    }));
    svg.appendChild(text(right - 14, h - 4, monthLabel(STATS.meta.as_of), {
        'font-size': 9, fill: p.dim, 'text-anchor': 'middle',
    }));
    return svg;
}

function buildSparkline(series, domain) {
    const p = palette();
    const svg = svgRoot(120, 32);
    const x = scale(0, Math.max(1, dayCount(domain[0], domain[1])), 5, 108);
    const values = series.map((s) => s[1]);
    const y = scale(Math.min(...values), Math.max(...values), 28, 4);

    const pts = series.map((s) =>
        `${x(dayCount(domain[0], parseISO(s[0]))).toFixed(1)},${y(s[1]).toFixed(1)}`);
    if (pts.length > 1) {
        svg.appendChild(el('polyline', {
            points: pts.join(' '), fill: 'none', stroke: p.accent,
            'stroke-width': 1.5, 'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
        }));
    }
    const last = series[series.length - 1];
    svg.appendChild(el('circle', {
        cx: x(dayCount(domain[0], parseISO(last[0]))), cy: y(last[1]), r: 3,
        fill: p.accent, stroke: p.surface, 'stroke-width': 1.5,
    }));
    return svg;
}

/**
 * Rhythm heatmap. Lift, cardio and both are separated by SHAPE (filled,
 * outlined, filled-with-a-dot) on a single hue, so the chart survives any
 * colour-vision difference and any greyscale print.
 */
function buildHeatmap(days, legend) {
    const p = palette();
    const start = parseISO(legend.start);
    const end = parseISO(legend.end);
    const weeks = Math.floor(dayCount(start, end) / 7) + 1;
    const cell = 13;
    const pitch = 16;
    const x0 = 30;
    const y0 = 14;
    const w = x0 + weeks * pitch + 6;
    const h = y0 + 7 * pitch + 4;
    const svg = svgRoot(w, h);

    ['mon', 'wed', 'fri'].forEach((label, i) => {
        svg.appendChild(text(24, y0 + i * 2 * pitch + 10, label, {
            'font-size': 9, fill: p.dim, 'text-anchor': 'end',
        }));
    });

    let lastMonth = null;
    for (let i = 0; i < weeks; i++) {
        const d = new Date(start.getTime());
        d.setDate(d.getDate() + i * 7);
        if (d.getMonth() !== lastMonth) {
            lastMonth = d.getMonth();
            svg.appendChild(text(x0 + i * pitch, 8, MONTHS[lastMonth], {
                'font-size': 9, fill: p.dim,
            }));
        }
    }

    for (const iso in days) {
        const d = parseISO(iso);
        const offset = dayCount(start, d);
        if (offset < 0) continue;
        const col = Math.floor(offset / 7);
        const row = (d.getDay() + 6) % 7;      // Monday-first
        const cx = x0 + col * pitch;
        const cy = y0 + row * pitch;
        const kind = days[iso];

        svg.appendChild(el('rect', {
            x: cx, y: cy, width: cell, height: cell, rx: 3,
            fill: kind === 'cardio' ? 'none' : p.accent,
            stroke: kind === 'cardio' ? p.accent : null,
            'stroke-width': kind === 'cardio' ? 1.5 : null,
        }));
        if (kind === 'both') {
            svg.appendChild(el('circle', {
                cx: cx + cell / 2, cy: cy + cell / 2, r: 2.2, fill: p.surface,
            }));
        }
    }
    return svg;
}

/** Weekly tonnage. Zero weeks stay in place and say why. */
function buildTonnage(weeks) {
    const p = palette();
    const w = 688;
    const h = 170;
    const svg = svgRoot(w, h);
    const base = 140;
    const pitch = (w - 16) / weeks.length;
    const barW = Math.min(24, Math.max(6, pitch - 8));
    const max = Math.max(...weeks.map((k) => k.lbs), 1);
    const hScale = scale(0, max, 0, 118);

    svg.appendChild(el('line', {
        x1: 8, y1: base, x2: w - 8, y2: base, stroke: p.baseline, 'stroke-width': 1,
    }));

    const maxIdx = weeks.reduce((b, k, i) => (k.lbs > weeks[b].lbs ? i : b), 0);
    weeks.forEach((k, i) => {
        const cx = 8 + pitch * i + pitch / 2;
        const x = cx - barW / 2;
        if (k.lbs === 0) {
            if (k.gap) {
                svg.appendChild(text(cx, base - 6, 'travel', {
                    'font-size': 10, fill: p.dim, 'text-anchor': 'middle',
                }));
            }
            return;
        }
        const bh = Math.max(2, hScale(k.lbs));
        const r = Math.min(4, barW / 2, bh);
        // Square at the baseline, rounded at the data end.
        svg.appendChild(el('path', {
            d: `M${x.toFixed(1)},${base} v${-(bh - r).toFixed(1)} ` +
               `a${r},${r} 0 0 1 ${r},${-r} h${(barW - 2 * r).toFixed(1)} ` +
               `a${r},${r} 0 0 1 ${r},${r} v${(bh - r).toFixed(1)} z`,
            fill: p.accent,
        }));
        if (i === maxIdx) {
            svg.appendChild(text(cx, base - bh - 8, fmtK(k.lbs), {
                'font-size': 11, 'font-weight': 600, fill: p.ink,
                'text-anchor': 'middle',
            }));
        } else if (i === weeks.length - 1) {
            svg.appendChild(text(cx, base - bh - 8, fmtK(k.lbs), {
                'font-size': 11, fill: p.gray, 'text-anchor': 'middle',
            }));
        }
    });

    const step = Math.max(1, Math.round(weeks.length / 5));
    weeks.forEach((k, i) => {
        if (i % step) return;
        const cx = 8 + pitch * i + pitch / 2;
        const d = parseISO(k.start);
        svg.appendChild(text(cx, base + 16,
            `${MONTHS[d.getMonth()]} ${d.getDate()}`, {
                'font-size': 9, fill: p.dim, 'text-anchor': 'middle',
            }));
    });
    return svg;
}

function fmtK(n) {
    return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function buildWeightChart(series) {
    const p = palette();
    const w = 688;
    const h = 150;
    const svg = svgRoot(w, h);
    const values = series.map((s) => s[1]);
    // Round the band out to whole 5s so the gridlines read as real numbers.
    const lo = Math.floor(Math.min(...values) / 5) * 5;
    const hi = Math.ceil(Math.max(...values) / 5) * 5;
    const mid = (lo + hi) / 2;
    const y = scale(lo, hi, 120, 20);

    const d0 = parseISO(series[0][0]);
    const d1 = parseISO(STATS.meta.as_of);
    const x = scale(0, Math.max(1, dayCount(d0, d1)), 8, w - 78);

    [[lo, p.grid], [mid, p.gridFaint], [hi, p.gridFaint]].forEach(([v, colour]) => {
        svg.appendChild(el('line', {
            x1: 8, y1: y(v), x2: w - 38, y2: y(v), stroke: colour, 'stroke-width': 1,
        }));
        svg.appendChild(text(w - 32, y(v) + 4, String(v), {
            'font-size': 10, fill: p.dim,
        }));
    });

    const pts = series.map((s) =>
        `${x(dayCount(d0, parseISO(s[0]))).toFixed(1)},${y(s[1]).toFixed(1)}`);
    svg.appendChild(el('polyline', {
        points: pts.join(' '), fill: 'none', stroke: p.warm, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));

    const last = series[series.length - 1];
    const lx = x(dayCount(d0, parseISO(last[0])));
    const ly = y(last[1]);
    svg.appendChild(el('circle', {
        cx: lx, cy: ly, r: 4.5, fill: p.warm, stroke: p.surface, 'stroke-width': 2,
    }));
    svg.appendChild(text(lx + 10, ly + 4, String(last[1]), {
        'font-size': 12, 'font-weight': 600, fill: p.ink,
    }));
    svg.appendChild(text(8, h - 8, monthLabel(series[0][0]), {
        'font-size': 9, fill: p.dim,
    }));
    svg.appendChild(text(w - 38, h - 8,
        `${monthLabel(last[0])} ${Number(last[0].split('-')[2])}`, {
            'font-size': 9, fill: p.dim, 'text-anchor': 'end',
        }));
    return svg;
}

/**
 * The 1080x1080 share card. Built from the same numbers as the page, in a
 * fixed dark palette so it looks the same whatever theme the device is in.
 */
function buildShareCard() {
    const c = {
        bg: '#161616', ink: '#ececec', accent: '#6fbf87',
        gray: '#a8a8a8', dim: '#7d7d7d', grid: '#2b2b2b',
    };
    const entry = STATS.e1rm.bench || Object.values(STATS.e1rm)[0];
    if (!entry) return null;

    const S = 1080;
    const svg = svgRoot(S, S);
    svg.appendChild(el('rect', { x: 0, y: 0, width: S, height: S, fill: c.bg }));

    svg.appendChild(text(92, 210, `${entry.label} · estimated 1RM`, {
        'font-size': 30, fill: c.gray, 'letter-spacing': '0.04em',
    }));
    svg.appendChild(text(92, 340, String(entry.latest), {
        'font-size': 148, 'font-weight': 700, fill: c.ink,
        'letter-spacing': '-0.02em',
    }));

    const numW = String(entry.latest).length * 82 + 24;
    if (entry.delta > 0) {
        svg.appendChild(text(92 + numW, 300, `+${entry.delta} lbs`, {
            'font-size': 40, 'font-weight': 600, fill: c.accent,
        }));
        svg.appendChild(text(92 + numW, 340,
            `since ${monthLabel(entry.first_date)}`, {
                'font-size': 28, fill: c.gray,
            }));
    }

    // The chart, scaled up from the same geometry the page draws.
    const inner = buildStrengthChart(entry, strengthDomain(), {
        width: PANEL_W, height: PANEL_H, thick: 2.5,
    });
    const g = el('g', {
        transform: `translate(92, 430) scale(${896 / PANEL_W})`,
    });
    // Repaint for the fixed dark card, whatever the device theme is.
    for (const node of Array.from(inner.childNodes)) {
        const stroke = node.getAttribute('stroke');
        const fill = node.getAttribute('fill');
        const p = palette();
        if (stroke === p.accent) node.setAttribute('stroke', c.accent);
        if (stroke === p.surface) node.setAttribute('stroke', c.bg);
        if (stroke === p.grid || stroke === p.gridFaint) {
            node.setAttribute('stroke', c.grid);
        }
        if (fill === p.accent) node.setAttribute('fill', c.accent);
        if (fill === p.ink) node.setAttribute('fill', c.ink);
        if (fill === p.dim || fill === p.gray) node.setAttribute('fill', c.dim);
        if (fill === p.surface) node.setAttribute('fill', c.bg);
        g.appendChild(node);
    }
    svg.appendChild(g);

    svg.appendChild(text(92, S - 92,
        `comeback week ${STATS.meta.comeback_week} · ` +
        `${STATS.meta.sessions_total} sessions`, {
            'font-size': 26, fill: c.gray,
        }));
    svg.appendChild(text(S - 92, S - 92, 'scottfriedman.ooo', {
        'font-size': 24, fill: c.dim, 'text-anchor': 'end',
        'letter-spacing': '0.06em',
    }));
    return svg;
}

// ─── Export ─────────────────────────────────────────────────────────

/**
 * Rasterize an SVG node to a PNG blob at 2x.
 *
 * Takes drawn data only: no URL, no slug, no storage read happens in here or
 * anywhere below it. An export can never carry the page's secret.
 */
async function svgToPngBlob(svg, pad) {
    const { w, h } = svgSize(svg);
    const p = pad === undefined ? 16 : pad;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    clone.removeAttribute('style');

    const source = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.decoding = 'sync';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
    await img.decode();

    const scaleFactor = 2;
    const canvas = document.createElement('canvas');
    canvas.width = (w + p * 2) * scaleFactor;
    canvas.height = (h + p * 2) * scaleFactor;
    const ctx = canvas.getContext('2d');
    // Opaque background: a transparent PNG reads as broken in most share targets.
    ctx.fillStyle = p === 0 ? '#161616' : palette().surface;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, p * scaleFactor, p * scaleFactor,
        w * scaleFactor, h * scaleFactor);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))),
            'image/png');
    });
}

async function shareOrDownload(blob, filename) {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return;
        } catch (err) {
            // Cancelling the sheet is a normal outcome, not an error.
            if (err && err.name === 'AbortError') return;
            // NotAllowedError means the gesture expired while rasterizing;
            // fall through to a download.
        }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function runExport(btn, factory, label) {
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    try {
        const svg = factory();
        if (!svg) return;
        const isCard = svgSize(svg).w === 1080;
        const blob = await svgToPngBlob(svg, isCard ? 0 : 16);
        const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        await shareOrDownload(blob, `training-${slug}.png`);
    } catch (err) {
        const note = document.getElementById('share-note');
        if (note) note.textContent = "couldn't build that image on this device.";
    } finally {
        btn.dataset.busy = '0';
    }
}

// ─── Render ─────────────────────────────────────────────────────────

function strengthDomain() {
    const firsts = Object.values(STATS.e1rm).map((e) => parseISO(e.first_date));
    const start = new Date(Math.min(...firsts.map((d) => d.getTime())));
    return [start, parseISO(STATS.meta.as_of)];
}

function libraryDomain() {
    return [parseISO(STATS.meta.first_session), parseISO(STATS.meta.as_of)];
}

function renderTiles() {
    const host = document.getElementById('tiles');
    clear(host);
    for (const t of STATS.headline || []) {
        const card = tag('div', 'tile');
        card.appendChild(tag('div', 'tile-label', t.label));
        const val = tag('div', 'tile-value', t.value);
        if (t.unit) {
            const u = tag('span', 'tile-unit', ` ${t.unit}`);
            val.appendChild(u);
        }
        card.appendChild(val);
        const sub = tag('div', `tile-sub${t.accent ? ' is-accent' : ''}`, t.sub);
        card.appendChild(sub);
        host.appendChild(card);
    }
}

function meterRow(pct, label) {
    const row = tag('div', 'meter-row');
    const track = tag('div', 'meter');
    // A zero-progress meter shows an empty track, never a cosmetic sliver.
    if (pct > 0) {
        const fill = tag('div', 'meter-fill');
        fill.style.width = `${pct}%`;
        track.appendChild(fill);
    }
    row.appendChild(track);
    row.appendChild(tag('div', 'meter-text', label));
    return row;
}

function renderStrength() {
    const host = document.getElementById('strength');
    clear(host);
    const domain = strengthDomain();

    for (const key of ['bench', 'deadlift', 'ohp', 'squat']) {
        const entry = STATS.e1rm[key];
        if (!entry) continue;
        const panel = tag('section', 'panel');

        const head = tag('div', 'panel-head');
        const name = tag('div', 'panel-name');
        name.appendChild(tag('span', null, entry.label));
        if (entry.note) name.appendChild(tag('span', 'panel-note', entry.note));
        head.appendChild(name);
        head.appendChild(exportButton(entry.label,
            () => buildStrengthChart(entry, domain, {})));
        panel.appendChild(head);

        const chart = buildStrengthChart(entry, domain, {});
        chart.setAttribute('style', 'display:block;width:100%;height:auto');
        panel.appendChild(chart);

        const goal = STATS.goals[key];
        if (goal) panel.appendChild(meterRow(goal.pct, goal.text));
        host.appendChild(panel);
    }
}

function renderRhythm() {
    const host = document.getElementById('rhythm');
    clear(host);
    const legend = STATS.rhythm;
    if (!legend || !legend.start) return;
    host.appendChild(buildHeatmap(STATS.training_days, legend));
    document.getElementById('rhythm-since').textContent =
        monthLabel(STATS.meta.first_session);

    const list = document.getElementById('rhythm-legend');
    clear(list);
    [['is-lift', 'lift day', legend.lift],
     ['is-cardio', 'cardio', legend.cardio],
     ['is-both', 'both', legend.both]].forEach(([cls, label, n]) => {
        const li = document.createElement('li');
        li.appendChild(tag('span', `swatch ${cls}`));
        li.appendChild(document.createTextNode(`${label} · ${n}`));
        list.appendChild(li);
    });
}

function mountChart(cardId, hostId, factory, label) {
    const host = document.getElementById(hostId);
    clear(host);
    const svg = factory();
    svg.setAttribute('style', 'display:block;width:100%;height:auto');
    host.appendChild(svg);

    const card = document.getElementById(cardId);
    const old = card.querySelector('.export-btn');
    if (old) old.remove();
    card.appendChild(exportButton(label, factory));
}

function renderMilestones() {
    const host = document.getElementById('milestones');
    clear(host);
    for (const m of (STATS.milestones && STATS.milestones.active) || []) {
        const row = tag('div', 'milestone');
        const head = tag('div', 'milestone-head');
        head.appendChild(tag('div', 'milestone-title', m.title));
        head.appendChild(tag('div', 'milestone-value', m.text));
        row.appendChild(head);
        const meter = meterRow(m.pct, '');
        meter.querySelector('.meter-text').remove();
        row.appendChild(meter);
        if (m.binding) {
            row.appendChild(tag('div', 'milestone-binding', `binding: ${m.binding}`));
        }
        host.appendChild(row);
    }
}

/** Toggle the inline full-history chart under a row. */
function toggleDetail(rowNode, ex) {
    if (openDetail && openDetail.row === rowNode) {
        openDetail.panel.remove();
        rowNode.setAttribute('aria-expanded', 'false');
        openDetail = null;
        return;
    }
    if (openDetail) {
        openDetail.panel.remove();
        openDetail.row.setAttribute('aria-expanded', 'false');
        openDetail = null;
    }

    const panel = tag('div', 'ex-detail');
    if (ex.series && ex.series.length > 1) {
        const entry = {
            label: ex.display,
            points: ex.series,
            first: ex.series[0][1],
            latest: ex.series[ex.series.length - 1][1],
            first_date: ex.series[0][0],
            last_date: ex.series[ex.series.length - 1][0],
            dormant: ex.dormant,
        };
        const domain = [parseISO(ex.series[0][0]), parseISO(STATS.meta.as_of)];
        const factory = () => buildStrengthChart(entry, domain, {});
        const svg = factory();
        svg.setAttribute('style', 'display:block;width:100%;height:auto');
        panel.appendChild(svg);
        panel.appendChild(exportButton(ex.display, factory));
    } else {
        panel.appendChild(tag('div', 'ex-detail-empty',
            ex.time_based ? 'time-based work — no weight to chart'
                          : 'not enough weighted history to chart'));
    }
    rowNode.insertAdjacentElement('afterend', panel);
    rowNode.setAttribute('aria-expanded', 'true');
    openDetail = { row: rowNode, panel };
}

function exerciseRow(ex, domain) {
    const row = tag('button', 'ex-row');
    row.type = 'button';
    row.setAttribute('aria-expanded', 'false');

    const name = tag('div', 'ex-name');
    name.appendChild(tag('span', null, ex.display));
    if (ex.tier) name.appendChild(tag('span', 'tier-chip', ex.tier));
    row.appendChild(name);

    const spark = tag('div', 'ex-spark');
    if (ex.charted) {
        spark.textContent = '↑ charted above';
    } else if (ex.sparkline && ex.series && ex.series.length > 1) {
        spark.appendChild(buildSparkline(ex.series, domain));
    } else if (ex.time_based) {
        spark.textContent = 'time-based';
    }
    row.appendChild(spark);

    row.appendChild(tag('div', 'ex-rx', ex.last_sets || '—'));
    row.appendChild(tag('div', 'ex-when', ex.last_date_label));
    row.appendChild(tag('div', 'ex-count', `${ex.sessions}×`));
    row.addEventListener('click', () => toggleDetail(row, ex));
    return row;
}

function compactRow(ex, dormant) {
    const row = tag('button', 'compact-row');
    row.type = 'button';
    row.setAttribute('aria-expanded', 'false');

    const name = tag('span', 'compact-name');
    name.appendChild(document.createTextNode(ex.display));
    if (ex.note) {
        name.appendChild(tag('span', 'paused-tag', ` · ${ex.note.replace(' — ', ' ')}`));
    }
    row.appendChild(name);

    const stat = dormant
        ? (ex.best_weight_label
            ? `best ${ex.best_weight_label} · ${ex.last_date_label}`
            : ex.last_date_label)
        : `${ex.last_sets || '—'} · ${ex.last_date_label}`;
    row.appendChild(tag('span', 'compact-stat', stat));
    row.addEventListener('click', () => toggleDetail(row, ex));
    return row;
}

const FILTERS = {
    recent: (e) => !e.dormant,
    all: () => true,
    gym: (e) => e.class === 'gym',
    home: (e) => e.class === 'home',
};

function renderLibrary() {
    const all = STATS.exercises || [];
    const domain = libraryDomain();
    const shown = all.filter(FILTERS[FILTER] || FILTERS.recent);

    document.getElementById('library-label').textContent =
        `exercise library — all ${all.length} on record`;
    document.getElementById('showing').textContent =
        `showing ${shown.length} of ${all.length}`;

    // Dormancy wins over frequency: a lift nobody has touched in four weeks
    // belongs in the dormant list however often it used to come up. Squat has
    // 15 sessions and still belongs there.
    const dormant = shown.filter((e) => e.dormant);
    const current = shown.filter((e) => !e.dormant);
    const featured = current.filter((e) => e.sessions >= 6);
    const rotation = current.filter((e) => e.sessions < 6);

    openDetail = null;

    const featuredHost = document.getElementById('featured');
    clear(featuredHost);
    featuredHost.hidden = featured.length === 0;
    for (const ex of featured) featuredHost.appendChild(exerciseRow(ex, domain));

    const rotationHost = document.getElementById('rotation');
    const rotationLabel = document.getElementById('rotation-label');
    clear(rotationHost);
    rotationLabel.hidden = rotation.length === 0;
    rotationHost.hidden = rotation.length === 0;
    rotationLabel.textContent = FILTER === 'recent'
        ? 'also in rotation — last 4 weeks' : 'also in rotation';
    for (const ex of rotation) rotationHost.appendChild(compactRow(ex, false));

    const dormantHost = document.getElementById('dormant');
    const dormantLabel = document.getElementById('dormant-label');
    clear(dormantHost);
    dormantLabel.hidden = dormant.length === 0;
    dormantHost.hidden = dormant.length === 0;
    for (const ex of dormant) dormantHost.appendChild(compactRow(ex, true));
}

function renderAll() {
    document.getElementById('page-meta').textContent =
        `comeback week ${STATS.meta.comeback_week} · as of ${STATS.meta.as_of_label}`;
    renderTiles();
    renderStrength();
    renderRhythm();
    if ((STATS.tonnage_weekly || []).length) {
        mountChart('tonnage-card', 'tonnage',
            () => buildTonnage(STATS.tonnage_weekly), 'weekly tonnage');
    }
    if ((STATS.weight || []).length > 1) {
        mountChart('bodyweight-card', 'bodyweight',
            () => buildWeightChart(STATS.weight), 'body weight');
    }
    renderMilestones();
    renderLibrary();
}

// ─── Gate ───────────────────────────────────────────────────────────

/** Password -> fetch slug: hex(SHA-256(salt + password)), first 32 chars. */
async function deriveSlug(password) {
    const bytes = new TextEncoder().encode(SLUG_SALT + password);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32);
}

function readSlug() {
    try {
        return localStorage.getItem(LS_SLUG);
    } catch (e) {
        return null;                              // private browsing
    }
}

function show(which) {
    document.getElementById('gate').hidden = which !== 'gate';
    document.getElementById('trouble').hidden = which !== 'trouble';
    document.getElementById('stats').hidden = which !== 'stats';
}

function showGate(message) {
    show('gate');
    const err = document.getElementById('gate-error');
    err.textContent = message || '';
    err.hidden = !message;
    if (message) {
        const input = document.getElementById('gate-input');
        input.classList.remove('is-shaking');
        void input.offsetWidth;                    // restart the animation
        input.classList.add('is-shaking');
        input.select();
    }
}

function showTrouble(message) {
    show('trouble');
    document.getElementById('trouble-message').textContent = message;
}

/**
 * A payload can be well-formed JSON and still be unusable — an older or newer
 * builder, or a half-written push. Say "stats need a refresh" for that, and
 * never blame the password.
 */
function validate(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.schema_version !== SUPPORTED_SCHEMA) return false;
    if (!data.meta || !data.meta.as_of) return false;
    if (!Array.isArray(data.exercises)) return false;
    if (!data.e1rm || typeof data.e1rm !== 'object') return false;
    for (const entry of Object.values(data.e1rm)) {
        if (!Array.isArray(entry.points) || !entry.points.length) return false;
        if (!Number.isFinite(entry.latest)) return false;
    }
    return true;
}

async function loadStats(slug, isFreshUnlock) {
    let data;
    try {
        const res = await fetch(API_BASE + encodeURIComponent(slug) + '.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        // Cross-origin, the worker's 404 carries no CORS headers, so a wrong
        // password and an unreachable server look identical here. Only a
        // first unlock gets the combined message.
        if (isFreshUnlock) {
            showGate("couldn't unlock — wrong password, or stats not published yet");
        } else {
            showTrouble('stats server unavailable');
        }
        return;
    }

    if (!validate(data)) {
        showTrouble('stats need a refresh — the published data is an ' +
                    'unsupported shape');
        return;
    }

    STATS = data;
    // Persisted only after the slug is known good, and only as a convenience:
    // storage denial costs the "remembered" behaviour and nothing else.
    try {
        localStorage.setItem(LS_SLUG, slug);
    } catch (e) { /* private browsing */ }

    show('stats');
    renderAll();
}

function lockDevice(e) {
    if (e) e.preventDefault();
    try {
        localStorage.removeItem(LS_SLUG);
    } catch (err) { /* private browsing */ }
    STATS = null;
    showGate();
}

// ─── Init ───────────────────────────────────────────────────────────

function init() {
    // A slug must never sit in history, a bookmark or a shared link.
    if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
    }

    document.getElementById('gate-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('gate-input');
        const value = input.value.trim();
        if (!value) return;
        if (!(typeof crypto !== 'undefined' && crypto.subtle)) {
            showGate('unlocking needs a secure connection (https)');
            return;
        }
        const slug = await deriveSlug(value);
        input.value = '';
        // Fetch with the in-memory slug first; storing it is a side effect of
        // success, not a precondition for trying.
        await loadStats(slug, true);
    });

    document.getElementById('retry').addEventListener('click', () => {
        const slug = readSlug();
        if (slug) loadStats(slug, false);
        else showGate();
    });

    document.getElementById('lock-device').addEventListener('click', lockDevice);
    document.getElementById('trouble-lock').addEventListener('click', lockDevice);

    for (const btn of document.querySelectorAll('#filters button')) {
        btn.addEventListener('click', () => {
            FILTER = btn.dataset.filter;
            for (const other of document.querySelectorAll('#filters button')) {
                other.setAttribute('aria-pressed', String(other === btn));
            }
            renderLibrary();
        });
    }

    document.getElementById('share-card-btn').addEventListener('click', (e) => {
        runExport(e.currentTarget, buildShareCard, 'share card');
    });

    // Charts carry their colours as attributes, so a theme flip needs a redraw.
    if (typeof matchMedia === 'function') {
        const mq = matchMedia('(prefers-color-scheme: dark)');
        const redraw = () => { if (STATS) renderAll(); };
        if (mq.addEventListener) mq.addEventListener('change', redraw);
        else if (mq.addListener) mq.addListener(redraw);
    }

    const stored = readSlug();
    if (stored) loadStats(stored, false);
    else showGate();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { deriveSlug, validate, parseISO, scale, fmtK };
}

if (typeof document !== 'undefined') init();
