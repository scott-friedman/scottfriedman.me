#!/usr/bin/env node
/**
 * Seed the /surflater band page's RTDB tree from a local JSON file.
 *
 * The band's content (lyrics, emails, images, password) is never committed —
 * this repo is public. Content lives only in RTDB under
 * bandnotes/<slug>/..., where slug = first 32 hex chars of
 * SHA-256(SLUG_SALT + password). The salt string here MUST match
 * js/bandnotes.js exactly; tests/bandnotes.test.js pins that parity
 * (drift shows up as an unexplainable "wrong password" on the page).
 *
 * Usage:
 *   node scripts/seed-bandnotes.mjs scripts/bandnotes-seed.json [flags]
 *
 * Flags:
 *   --dry-run        print the built tree with per-node sizes; write nothing
 *   --path a,b       PUT only these top-level sections (e.g. setlist or
 *                    gallery,galleryData) — the post-launch edit path for
 *                    sections that have no in-page editor
 *   --force          overwrite an already-seeded slug (a PUT REPLACES live
 *                    edits — without this flag an existing tree aborts)
 *   --delete         delete the slug's whole tree (test-slug cleanup)
 *
 * The seed JSON is gitignored (scripts/bandnotes-seed.json). Shape:
 *   {
 *     "password": "...",            // or BANDNOTES_PASSWORD env override
 *     "meta": { "bandName": ..., "tagline": ..., "practiceSpace": ...,
 *               "instagramUrl": ..., "playlistUrl": ... },
 *     "members":  [ {"id","name","role","email"} ],   // order = array position
 *     "availability": { "<memberId>": "free text" },
 *     "agenda": "text",
 *     "goals":    [ {"id","text","done"} ],
 *     "setlist":  [ {"id","name","band","bpm","parts":{...}} ],
 *     "songs":    [ {"id","title","meta","body"} ],
 *     "venues":   [ {"id","name","location","info"} ],
 *     "gallery":  [ {"id","title","file":"assets/bandnotes/out/x.webp"} ]
 *   }
 * Gallery `file` paths are read and base64-encoded into galleryData at build
 * time; the hand-edited JSON never contains base64.
 *
 * Writes go through the PUBLIC rules via unauthenticated REST (no service
 * account), so a successful seed doubles as an end-to-end rules check.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export const SLUG_SALT = 'surflater.scottfriedman.ooo:v1:';
const DB_URL = 'https://scottfriedman-f400d-default-rtdb.firebaseio.com';

export function deriveSlug(password) {
    return createHash('sha256').update(SLUG_SALT + password).digest('hex').slice(0, 32);
}

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const PART_VALUES = new Set(['x', '25', '50', '60', '70', '80', '90', '100']);
const PART_KEYS = new Set(['drums', 'bass', 'gtr1', 'gtr2', 'vox']);

// Mirror the length caps in firebase.rules.json so a bad seed fails fast
// locally instead of as an opaque rules rejection mid-PUT.
const CAPS = {
    'meta.bandName': 60, 'meta.tagline': 300, 'meta.practiceSpace': 300,
    'meta.instagramUrl': 300, 'meta.playlistUrl': 300,
    'member.name': 60, 'member.role': 60, 'member.email': 120,
    'availability.text': 2000, 'agenda.text': 8000, 'goal.text': 300,
    'setlist.name': 100, 'setlist.band': 100,
    'song.title': 120, 'song.meta': 500, 'song.body': 20000,
    'venue.name': 120, 'venue.location': 200, 'venue.info': 1000,
    'gallery.title': 120, 'galleryData': 1500000,
};

const problems = [];
function cap(label, value) {
    if (value === undefined || value === null) return undefined;
    const s = String(value);
    if (s.length > CAPS[label]) problems.push(`${label} is ${s.length} chars (cap ${CAPS[label]})`);
    return s;
}

function keyed(arr, section, build) {
    const out = {};
    (arr || []).forEach((item, i) => {
        if (!item.id) { problems.push(`${section}[${i}] has no id`); return; }
        out[item.id] = build(item, i);
    });
    return out;
}

function prune(obj) {
    // RTDB rejects undefined; strip absent optionals recursively.
    for (const k of Object.keys(obj)) {
        if (obj[k] === undefined) delete obj[k];
        else if (obj[k] && typeof obj[k] === 'object') prune(obj[k]);
    }
    return obj;
}

export function buildTree(seed, readFile = readFileSync) {
    const now = Date.now();
    const tree = {
        meta: {
            bandName: cap('meta.bandName', seed.meta?.bandName),
            tagline: cap('meta.tagline', seed.meta?.tagline),
            practiceSpace: cap('meta.practiceSpace', seed.meta?.practiceSpace),
            instagramUrl: cap('meta.instagramUrl', seed.meta?.instagramUrl),
            playlistUrl: cap('meta.playlistUrl', seed.meta?.playlistUrl),
        },
        members: keyed(seed.members, 'members', (m, i) => ({
            name: cap('member.name', m.name),
            role: cap('member.role', m.role),
            email: cap('member.email', m.email),
            order: i,
        })),
        availability: Object.fromEntries(Object.entries(seed.availability || {}).map(
            ([memberId, text]) => [memberId, { text: cap('availability.text', text), updatedAt: now }])),
        goals: keyed(seed.goals, 'goals', (g, i) => ({
            text: cap('goal.text', g.text), done: !!g.done, order: i,
        })),
        setlist: keyed(seed.setlist, 'setlist', (row, i) => {
            const parts = {};
            for (const [k, v] of Object.entries(row.parts || {})) {
                if (!PART_KEYS.has(k)) problems.push(`setlist ${row.id}: unknown part "${k}"`);
                else if (!PART_VALUES.has(String(v))) problems.push(`setlist ${row.id}: bad ${k} value "${v}"`);
                else parts[k] = String(v);
            }
            if (row.bpm !== undefined && (typeof row.bpm !== 'number' || row.bpm < 20 || row.bpm > 400)) {
                problems.push(`setlist ${row.id}: bpm ${row.bpm} out of range 20-400`);
            }
            return {
                name: cap('setlist.name', row.name), band: cap('setlist.band', row.band),
                bpm: row.bpm, order: i, parts: Object.keys(parts).length ? parts : undefined,
            };
        }),
        songs: keyed(seed.songs, 'songs', (s, i) => ({
            title: cap('song.title', s.title), meta: cap('song.meta', s.meta),
            body: cap('song.body', s.body), order: i, updatedAt: now,
        })),
        venues: keyed(seed.venues, 'venues', (v, i) => ({
            name: cap('venue.name', v.name), location: cap('venue.location', v.location),
            info: cap('venue.info', v.info), order: i,
        })),
        gallery: keyed(seed.gallery, 'gallery', (g, i) => ({
            title: cap('gallery.title', g.title), order: i,
        })),
        galleryData: {},
    };
    if (seed.agenda) tree.agenda = { text: cap('agenda.text', seed.agenda), updatedAt: now };
    for (const g of seed.gallery || []) {
        if (!g.file || !g.id) continue;
        const mime = MIME[extname(g.file).toLowerCase()];
        if (!mime) { problems.push(`gallery ${g.id}: unsupported extension on ${g.file}`); continue; }
        const dataUrl = `data:${mime};base64,${readFile(g.file).toString('base64')}`;
        if (dataUrl.length > CAPS.galleryData) problems.push(`gallery ${g.id}: ${dataUrl.length} bytes as data URL (cap ${CAPS.galleryData})`);
        else if (dataUrl.length > 1400000) console.warn(`  warning: gallery ${g.id} is ${Math.round(dataUrl.length / 1024)}KB — close to the 1.5MB cap`);
        tree.galleryData[g.id] = dataUrl;
    }
    return prune(tree);
}

function sizes(tree) {
    return Object.entries(tree)
        .map(([k, v]) => `  ${k.padEnd(12)} ${JSON.stringify(v).length.toLocaleString()} bytes`)
        .join('\n');
}

async function rest(method, path, body) {
    const res = await fetch(`${DB_URL}/${path}.json`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
}

async function main() {
    const args = process.argv.slice(2);
    const flags = new Set(args.filter((a) => a.startsWith('--')));
    const seedPath = args.find((a) => !a.startsWith('--'));
    const pathArg = args.find((a) => a.startsWith('--path='))?.slice(7)
        ?? (args.includes('--path') ? args[args.indexOf('--path') + 1] : null);
    if (!seedPath) {
        console.error('usage: node scripts/seed-bandnotes.mjs <seed.json> [--dry-run] [--path a,b] [--force] [--delete]');
        process.exit(1);
    }

    const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
    const password = process.env.BANDNOTES_PASSWORD || seed.password;
    if (!password) { console.error('no password: set "password" in the seed JSON or BANDNOTES_PASSWORD'); process.exit(1); }
    const slug = deriveSlug(password);

    if (flags.has('--delete')) {
        await rest('DELETE', `bandnotes/${slug}`);
        console.log(`deleted bandnotes/${slug}`);
        return;
    }

    const tree = buildTree(seed);
    if (problems.length) {
        console.error('seed data problems:\n  - ' + problems.join('\n  - '));
        process.exit(1);
    }

    if (flags.has('--dry-run')) {
        console.log(`slug: ${slug}\n${sizes(tree)}\n  total        ${JSON.stringify(tree).length.toLocaleString()} bytes`);
        return;
    }

    const existing = await rest('GET', `bandnotes/${slug}/meta`);
    if (existing !== null && !flags.has('--force') && !pathArg) {
        console.error('already seeded — a full PUT would replace live edits. Use --path for a section, or --force to replace everything.');
        process.exit(1);
    }

    if (pathArg) {
        for (const section of pathArg.split(',')) {
            if (!(section in tree)) { console.error(`no such section: ${section}`); process.exit(1); }
            await rest('PUT', `bandnotes/${slug}/${section}`, tree[section]);
            console.log(`PUT ${section} (${JSON.stringify(tree[section]).length.toLocaleString()} bytes)`);
        }
    } else {
        await rest('PUT', `bandnotes/${slug}`, tree);
        console.log(`seeded bandnotes/${slug}\n${sizes(tree)}`);
    }
    console.log('page: https://scottfriedman.ooo/surflater/');
}

// Import-safe for tests: only run when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error(err.message); process.exit(1); });
}
