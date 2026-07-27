/**
 * Surf Later band page (/surflater) — live shared notes on RTDB.
 *
 * This repo is public, so NOTHING about the band ships in this file or the
 * HTML: lyrics, emails, images, and the password live only in RTDB under
 * bandnotes/<slug>/..., where slug = first 32 hex chars of
 * SHA-256(SLUG_SALT + password) — the same capability scheme as the
 * workouts page. A wrong password derives a slug whose path is empty
 * (rules allow the read; there's just nothing there), which is how "wrong
 * password" is detected. The slug is kept in localStorage and may arrive
 * once via URL fragment (band-chat onboarding), then is scrubbed.
 *
 * The salt string must match scripts/seed-bandnotes.mjs exactly —
 * tests/bandnotes.test.js pins that parity.
 *
 * Trust model: anyone with the slug can edit or delete anything, exactly
 * like the Google Doc this replaces. Conflicts are last-write-wins with an
 * in-editor warning; edits save on explicit action, never per keystroke.
 */

const SLUG_SALT = 'surflater.scottfriedman.ooo:v1:';
const LS_TOKEN = 'bandnotes:token';
const LS_AUTHV = 'bandnotes:authv';
const LS_MEMBER = 'bandnotes:member';
const LS_FONT = 'bandnotes:fontsize';
const LS_SONGS = 'bandnotes:songsCache';

// Setlist columns, in display order. Keys match firebase.rules.json.
const PARTS = [
    { key: 'drums', label: 'D' },
    { key: 'bass', label: 'B' },
    { key: 'gtr1', label: 'G1' },
    { key: 'gtr2', label: 'G2' },
    { key: 'vox', label: 'V' },
];
const PART_VALUES = ['x', '25', '50', '60', '70', '80', '90', '100'];
const LEGEND = [
    ['✅', 'ready to play live with an audience'],
    ['90', 'can play through 100% but needs tightening'],
    ['80', 'can play, but only in practice — not audience-ready'],
    ['70', 'knows the tune, trouble getting through in one take'],
    ['60', 'still learning parts of the song'],
    ['50/25', 'still learning — practice before rehearsal'],
    ['✗', 'not started'],
];

/** Password → slug: hex(SHA-256(salt + password)), first 32 chars. */
async function deriveSlug(password) {
    const bytes = new TextEncoder().encode(SLUG_SALT + password);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32);
}

/** Readiness value → what the grid cell shows. Pure, tested. */
function partDisplay(value) {
    if (value === '100') return { text: '✅', cls: 'val-100' };
    if (value === 'x') return { text: '✗', cls: 'val-x' };
    if (!value) return { text: '·', cls: 'val-none' };
    return { text: value, cls: 'val-' + value };
}

/** Timestamp → short relative time for the board. Pure, tested. */
function fmtWhen(ts, now = Date.now()) {
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Sort [key, value] entries by their .order field. Pure, tested. */
function byOrder(entries) {
    return entries.slice().sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
}

if (typeof document !== 'undefined') {
    (() => {
        // ─── DOM + storage helpers ──────────────────────────────────
        function el(tag, className, text) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }
        const $ = (id) => document.getElementById(id);
        const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
        const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
        const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } };

        let toastTimer = null;
        function toast(message) {
            let t = $('toast');
            if (!t) { t = el('div', 'toast'); t.id = 'toast'; document.body.appendChild(t); }
            t.textContent = message;
            t.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
        }
        const writeFailed = (err) => { console.warn(err); toast("couldn't save — check connection"); };

        // ─── State ──────────────────────────────────────────────────
        let db = null;
        let base = null;           // ref('bandnotes/<slug>')
        const shadow = {};         // latest snapshot value per section
        const editing = new Set(); // node keys currently in an open editor
        let sessionMember = null;  // fallback identity when localStorage is out

        function getMember() {
            if (sessionMember) return sessionMember;
            try { return JSON.parse(lsGet(LS_MEMBER)); } catch (e) { return null; }
        }
        function setMember(m) {
            sessionMember = m;
            lsSet(LS_MEMBER, JSON.stringify(m));
            renderFooter();
        }

        // ─── Gate ───────────────────────────────────────────────────
        function captureToken() {
            const fragment = location.hash.replace(/^#/, '').trim();
            if (fragment) {
                lsSet(LS_TOKEN, fragment);
                history.replaceState(null, '', location.pathname + location.search);
                return fragment;
            }
            return lsGet(LS_TOKEN);
        }

        function showGate(message) {
            $('app').hidden = true;
            $('gate-section').hidden = false;
            const msg = $('gate-message');
            msg.textContent = message || '';
            msg.hidden = !message;
        }

        function connect(slug) {
            if (!firebase.apps.length) firebase.initializeApp(window.getFirebaseConfig('main'));
            db = firebase.database();
            base = db.ref('bandnotes/' + slug);

            // Probe: a successful read of an EMPTY meta means the rules let us
            // in but nothing lives at this slug — i.e. wrong password. A
            // timeout/error means we can't tell — offer cached songs instead.
            const probe = base.child('meta').once('value');
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 7000));
            Promise.race([probe, timeout]).then((snap) => {
                const meta = snap.val();
                if (!meta) {
                    lsDel(LS_TOKEN);
                    showGate('wrong password — try again');
                    return;
                }
                enterApp(meta);
            }).catch(() => {
                const cache = readSongsCache();
                if (cache && lsGet(LS_TOKEN)) {
                    enterOffline(cache);
                } else {
                    showGate("can't reach the server — check your connection and retry");
                }
            });
        }

        // ─── App entry ──────────────────────────────────────────────
        function enterApp(meta) {
            $('gate-section').hidden = true;
            $('app').hidden = false;
            shadow.meta = meta;
            renderMeta();
            renderFooter();

            base.child('members').once('value', (snap) => {
                shadow.members = snap.val() || {};
                renderInfo();
                renderAvailability();
                if (!getMember()) showMemberPicker(null);
            });
            base.child('setlist').on('value', (snap) => {
                shadow.setlist = snap.val() || {};
                renderSetlist();
            });
            base.child('availability').on('value', (snap) => {
                shadow.availability = snap.val() || {};
                renderAvailability();
            });
            base.child('agenda').on('value', (snap) => {
                shadow.agenda = snap.val();
                renderAgenda();
            });
            base.child('goals').on('value', (snap) => {
                shadow.goals = snap.val() || {};
                renderGoals();
            });
            base.child('songs').on('value', (snap) => {
                shadow.songs = snap.val() || {};
                lsSet(LS_SONGS, JSON.stringify({ savedAt: Date.now(), songs: shadow.songs }));
                renderSongs();
            });
            base.child('venues').once('value', (snap) => {
                shadow.venues = snap.val() || {};
                renderInfo();
            });
            base.child('gallery').once('value', (snap) => {
                shadow.gallery = snap.val() || {};
                renderGallery();
            });
            watchMessages();
            renderLegend();
        }

        function readSongsCache() {
            try { return JSON.parse(lsGet(LS_SONGS)); } catch (e) { return null; }
        }

        // Offline: practice spaces have bad reception, and lyrics are the
        // thing you need mid-practice. Songs render read-only from cache;
        // everything else needs the network.
        function enterOffline(cache) {
            $('gate-section').hidden = true;
            $('app').hidden = false;
            const banner = $('banner');
            banner.hidden = false;
            banner.textContent = 'offline — showing saved songs; everything else needs a connection';
            for (const id of ['setlist-section', 'sched-section', 'board-section', 'info-section', 'gallery-section']) {
                $(id).hidden = true;
            }
            shadow.songs = cache.songs || {};
            renderSongs(true);
        }

        // ─── Masthead / info / footer ───────────────────────────────
        function renderMeta() {
            const meta = shadow.meta || {};
            $('tagline').textContent = meta.tagline || '';
        }

        function renderInfo() {
            const area = $('info-area');
            area.textContent = '';
            const meta = shadow.meta || {};

            const members = el('div', 'members');
            for (const [, m] of byOrder(Object.entries(shadow.members || {}))) {
                const row = el('div', 'member-row');
                row.appendChild(el('span', 'member-name', m.name));
                if (m.role) row.appendChild(el('span', 'member-role', m.role));
                if (m.email) {
                    const a = el('a', 'member-email', m.email);
                    a.href = 'mailto:' + m.email;
                    row.appendChild(a);
                }
                members.appendChild(row);
            }
            area.appendChild(members);

            if (meta.practiceSpace) {
                const p = el('p', 'practice-space');
                p.appendChild(el('strong', null, 'practice: '));
                p.appendChild(document.createTextNode(meta.practiceSpace));
                area.appendChild(p);
            }
            const links = el('p', 'band-links');
            if (meta.instagramUrl) {
                const a = el('a', null, 'instagram');
                a.href = meta.instagramUrl;
                a.target = '_blank';
                a.rel = 'noopener';
                links.appendChild(a);
            }
            if (meta.playlistUrl) {
                const a = el('a', null, 'inspiration playlist');
                a.href = meta.playlistUrl;
                a.target = '_blank';
                a.rel = 'noopener';
                links.appendChild(a);
            }
            if (links.childNodes.length) area.appendChild(links);

            const venuesEl = $('venues-list');
            venuesEl.textContent = '';
            for (const [, v] of byOrder(Object.entries(shadow.venues || {}))) {
                const card = el('div', 'venue-card');
                const head = el('div', 'venue-head');
                head.appendChild(el('strong', null, v.name));
                if (v.location) head.appendChild(el('span', 'venue-loc', v.location));
                card.appendChild(head);
                if (v.info) card.appendChild(el('p', 'venue-info', v.info));
                venuesEl.appendChild(card);
            }
        }

        function renderFooter() {
            const member = getMember();
            $('switch-member').textContent = member ? `you're ${member.name} — switch` : 'pick who you are';
        }

        // ─── Member picker ──────────────────────────────────────────
        function showMemberPicker(onDone) {
            let overlay = $('member-overlay');
            if (overlay) overlay.remove();
            overlay = el('div', 'sheet-backdrop');
            overlay.id = 'member-overlay';
            const sheet = el('div', 'sheet');
            sheet.appendChild(el('h3', null, 'who are you?'));
            const wrap = el('div', 'member-buttons');
            for (const [id, m] of byOrder(Object.entries(shadow.members || {}))) {
                const btn = el('button', 'member-btn', m.name);
                btn.type = 'button';
                btn.addEventListener('click', () => {
                    setMember({ id, name: m.name });
                    overlay.remove();
                    renderAvailability();
                    if (onDone) onDone();
                });
                wrap.appendChild(btn);
            }
            sheet.appendChild(wrap);
            overlay.appendChild(sheet);
            document.body.appendChild(overlay);
        }

        // ─── Setlist grid ───────────────────────────────────────────
        function renderSetlist() {
            const grid = $('setlist-grid');
            grid.textContent = '';

            const head = el('div', 'sl-row sl-head');
            head.appendChild(el('div', 'sl-song', 'song'));
            for (const p of PARTS) head.appendChild(el('div', 'sl-cell-head', p.label));
            grid.appendChild(head);

            for (const [rowId, row] of byOrder(Object.entries(shadow.setlist || {}))) {
                const rowEl = el('div', 'sl-row');
                const songCell = el('div', 'sl-song');
                songCell.appendChild(el('div', 'sl-name', row.name));
                const sub = [row.band, row.bpm ? row.bpm + ' bpm' : null].filter(Boolean).join(' · ');
                if (sub) songCell.appendChild(el('div', 'sl-sub', sub));
                songCell.addEventListener('click', () => editSetlistRow(rowId, row));
                rowEl.appendChild(songCell);

                for (const p of PARTS) {
                    const value = row.parts ? row.parts[p.key] : null;
                    const d = partDisplay(value);
                    const cell = el('button', 'sl-cell ' + d.cls, d.text);
                    cell.type = 'button';
                    cell.setAttribute('aria-label', `${row.name} ${p.key}: ${value || 'not set'}`);
                    cell.addEventListener('click', () => showChipSheet(rowId, row.name, p));
                    rowEl.appendChild(cell);
                }
                grid.appendChild(rowEl);
            }

            const area = $('add-song-area');
            area.textContent = '';
            const addBtn = el('button', 'ghost-btn', '+ add song');
            addBtn.type = 'button';
            addBtn.addEventListener('click', () => showRowForm(area, null, null));
            area.appendChild(addBtn);
        }

        // Add/edit a setlist row's name/band/bpm (tap the song name to edit).
        function showRowForm(container, rowId, row) {
            container.textContent = '';
            const form = el('form', 'row-form');
            const name = el('input');
            name.placeholder = 'song name';
            name.maxLength = 100;
            name.required = true;
            if (row) name.value = row.name;
            const band = el('input');
            band.placeholder = 'band (blank = ours)';
            band.maxLength = 100;
            if (row && row.band) band.value = row.band;
            const bpm = el('input');
            bpm.type = 'number';
            bpm.placeholder = 'bpm';
            bpm.min = 20;
            bpm.max = 400;
            if (row && row.bpm) bpm.value = row.bpm;
            const save = el('button', null, 'save');
            const cancel = el('button', 'ghost-btn', 'cancel');
            cancel.type = 'button';
            cancel.addEventListener('click', () => renderSetlist());
            form.append(name, band, bpm, save, cancel);
            if (rowId) {
                const del = el('button', 'danger-btn', 'remove from set');
                del.type = 'button';
                del.addEventListener('click', () => {
                    if (!confirm(`Remove "${row.name}" from the set list?`)) return;
                    base.child('setlist/' + rowId).remove().catch(writeFailed);
                });
                form.appendChild(del);
            }
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const orders = Object.values(shadow.setlist || {}).map((r) => r.order ?? 0);
                const data = {
                    name: name.value.trim(),
                    order: row ? (row.order ?? 0) : (orders.length ? Math.max(...orders) + 1 : 0),
                };
                if (band.value.trim()) data.band = band.value.trim();
                if (bpm.value) data.bpm = Number(bpm.value);
                if (row && row.parts) data.parts = row.parts;
                if (!data.name) return;
                const target = rowId ? base.child('setlist/' + rowId) : base.child('setlist').push();
                target.set(data).catch(writeFailed);
            });
            container.appendChild(form);
            name.focus();
        }

        function editSetlistRow(rowId, row) {
            const area = $('add-song-area');
            showRowForm(area, rowId, row);
            area.scrollIntoView({ block: 'nearest' });
        }

        function showChipSheet(rowId, songName, part) {
            let overlay = $('chip-overlay');
            if (overlay) overlay.remove();
            overlay = el('div', 'sheet-backdrop');
            overlay.id = 'chip-overlay';
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
            const sheet = el('div', 'sheet');
            sheet.appendChild(el('h3', null, `${songName} — ${part.key}`));
            const chips = el('div', 'chip-row');
            const cellRef = base.child(`setlist/${rowId}/parts/${part.key}`);
            for (const v of PART_VALUES) {
                const d = partDisplay(v);
                const chip = el('button', 'chip ' + d.cls, d.text);
                chip.type = 'button';
                chip.addEventListener('click', () => {
                    // No optimistic paint — the on('value') round trip repaints,
                    // same code path as a bandmate's edit landing.
                    cellRef.set(v).catch(writeFailed);
                    overlay.remove();
                });
                chips.appendChild(chip);
            }
            const clear = el('button', 'chip val-none', 'clear');
            clear.type = 'button';
            clear.addEventListener('click', () => {
                cellRef.remove().catch(writeFailed);
                overlay.remove();
            });
            chips.appendChild(clear);
            sheet.appendChild(chips);
            overlay.appendChild(sheet);
            document.body.appendChild(overlay);
        }

        function renderLegend() {
            const body = $('legend-body');
            body.textContent = '';
            for (const [mark, meaning] of LEGEND) {
                const row = el('div', 'legend-row');
                row.appendChild(el('span', 'legend-mark', mark));
                row.appendChild(el('span', null, meaning));
                body.appendChild(row);
            }
            body.appendChild(el('p', 'legend-note',
                "don't suggest a song you don't already know. don't put a song on the setlist unless you want to finish it 100%."));
        }

        // ─── Editable text nodes (availability / agenda) ────────────
        // Explicit edit mode, save on action, last-write-wins. While an
        // editor is open its node key sits in `editing` and the live
        // listener leaves that DOM alone; if the server copy moves under
        // us, an inline warning appears but typing is never interrupted.
        function textEditor({ key, getRemote, save, maxLength, emptyLabel }) {
            const wrap = el('div', 'text-node');
            function renderView() {
                editing.delete(key);
                wrap.textContent = '';
                const remote = getRemote();
                const body = el('div', 'text-body', remote && remote.text ? remote.text : emptyLabel);
                if (!remote || !remote.text) body.classList.add('text-empty');
                const edit = el('button', 'ghost-btn', 'edit');
                edit.type = 'button';
                edit.addEventListener('click', renderEdit);
                wrap.append(body, edit);
            }
            function renderEdit() {
                editing.add(key);
                wrap.textContent = '';
                const remote = getRemote();
                const baseline = remote ? remote.updatedAt : null;
                const ta = el('textarea');
                ta.maxLength = maxLength;
                ta.value = remote && remote.text ? remote.text : '';
                const warn = el('p', 'edit-warn');
                warn.hidden = true;
                wrap.dataset.baseline = baseline || '';
                wrap.conflictCheck = () => {
                    const now = getRemote();
                    if (now && now.updatedAt !== baseline) {
                        warn.textContent = 'changed by someone else while you were typing — saving overwrites their edit';
                        warn.hidden = false;
                    }
                };
                const saveBtn = el('button', null, 'save');
                saveBtn.type = 'button';
                saveBtn.addEventListener('click', () => {
                    save(ta.value.trim()).then(renderView).catch((err) => {
                        writeFailed(err); // keep the textarea — nothing is lost
                    });
                });
                const cancel = el('button', 'ghost-btn', 'cancel');
                cancel.type = 'button';
                cancel.addEventListener('click', renderView);
                const btns = el('div', 'editor-btns');
                btns.append(saveBtn, cancel);
                wrap.append(ta, warn, btns);
                ta.focus();
            }
            wrap.renderView = renderView;
            renderView();
            return wrap;
        }

        const editors = {}; // key → editor element, so live renders can skip/notify

        function renderAvailability() {
            const cards = $('availability-cards');
            const me = getMember();
            const entries = byOrder(Object.entries(shadow.members || {}));
            for (const [memberId, m] of entries) {
                const key = 'availability/' + memberId;
                if (editing.has(key)) {
                    if (editors[key]) editors[key].conflictCheck();
                    continue;
                }
                let card = cards.querySelector(`[data-member="${memberId}"]`);
                if (!card) {
                    card = el('div', 'avail-card');
                    card.dataset.member = memberId;
                    cards.appendChild(card);
                }
                card.classList.toggle('is-me', !!(me && me.id === memberId));
                card.textContent = '';
                card.appendChild(el('div', 'avail-name', m.name));
                const editor = textEditor({
                    key,
                    getRemote: () => (shadow.availability || {})[memberId],
                    save: (text) => base.child(key).set({
                        text, updatedAt: firebase.database.ServerValue.TIMESTAMP,
                    }),
                    maxLength: 2000,
                    emptyLabel: 'no availability notes',
                });
                editors[key] = editor;
                card.appendChild(editor);
            }
        }

        function renderAgenda() {
            const key = 'agenda';
            if (editing.has(key)) {
                if (editors[key]) editors[key].conflictCheck();
                return;
            }
            const area = $('agenda-area');
            area.textContent = '';
            const editor = textEditor({
                key,
                getRemote: () => shadow.agenda,
                save: (text) => base.child('agenda').set({
                    text, updatedAt: firebase.database.ServerValue.TIMESTAMP,
                }),
                maxLength: 8000,
                emptyLabel: 'no agenda yet — set one for next practice',
            });
            editors[key] = editor;
            area.appendChild(editor);
        }

        // ─── Goals ──────────────────────────────────────────────────
        function renderGoals() {
            const area = $('goals-area');
            area.textContent = '';
            const list = el('div', 'goals-list');
            for (const [goalId, g] of byOrder(Object.entries(shadow.goals || {}))) {
                const row = el('label', 'goal-row');
                const box = el('input');
                box.type = 'checkbox';
                box.checked = !!g.done;
                box.addEventListener('change', () => {
                    base.child(`goals/${goalId}/done`).set(box.checked).catch(writeFailed);
                });
                row.appendChild(box);
                const text = el('span', 'goal-text', g.text);
                if (g.done) text.classList.add('goal-done');
                row.appendChild(text);
                const del = el('button', 'goal-del', '✕');
                del.type = 'button';
                del.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (!confirm(`Delete goal "${g.text}"?`)) return;
                    base.child('goals/' + goalId).remove().catch(writeFailed);
                });
                row.appendChild(del);
                list.appendChild(row);
            }
            area.appendChild(list);

            const form = el('form', 'goal-add');
            const input = el('input');
            input.placeholder = 'add a goal';
            input.maxLength = 300;
            const btn = el('button', null, 'add');
            form.append(input, btn);
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const text = input.value.trim();
                if (!text) return;
                const orders = Object.values(shadow.goals || {}).map((g) => g.order ?? 0);
                base.child('goals').push({
                    text, done: false, order: orders.length ? Math.max(...orders) + 1 : 0,
                }).catch(writeFailed);
                input.value = '';
            });
            area.appendChild(form);
        }

        // ─── Songs ──────────────────────────────────────────────────
        function renderSongs(offline) {
            const list = $('songs-list');
            list.textContent = '';
            const entries = byOrder(Object.entries(shadow.songs || {}));
            for (const [songId, song] of entries) {
                if (editing.has('song/' + songId)) continue;
                const row = el('div', 'song-row');
                const main = el('button', 'song-open');
                main.type = 'button';
                main.appendChild(el('span', 'song-title', song.title));
                if (song.meta) main.appendChild(el('span', 'song-meta', song.meta));
                main.addEventListener('click', () => openStage(entries.map(([, s]) => s), entries.findIndex(([id]) => id === songId)));
                row.appendChild(main);
                if (!offline) {
                    const edit = el('button', 'ghost-btn', 'edit');
                    edit.type = 'button';
                    edit.addEventListener('click', () => showSongEditor(songId, song));
                    row.appendChild(edit);
                }
                list.appendChild(row);
            }
            const area = $('new-song-area');
            area.textContent = '';
            if (!offline) {
                const btn = el('button', 'ghost-btn', '+ new song');
                btn.type = 'button';
                btn.addEventListener('click', () => showSongEditor(null, null));
                area.appendChild(btn);
            }
        }

        function showSongEditor(songId, song) {
            const key = 'song/' + (songId || 'new');
            editing.add(key);
            const overlay = el('div', 'stage-overlay editor-overlay');
            const bar = el('div', 'stage-bar');
            const title = el('input', 'editor-title');
            title.placeholder = 'title';
            title.maxLength = 120;
            if (song) title.value = song.title;
            const meta = el('input', 'editor-meta');
            meta.placeholder = 'notes (bpm, tuning…)';
            meta.maxLength = 500;
            if (song && song.meta) meta.value = song.meta;
            const body = el('textarea', 'editor-body');
            body.placeholder = 'lyrics / chords';
            body.maxLength = 20000;
            if (song) body.value = song.body;
            const baseline = song ? song.updatedAt : null;

            function close() { editing.delete(key); overlay.remove(); renderSongs(); }
            const cancel = el('button', 'ghost-btn', 'cancel');
            cancel.type = 'button';
            cancel.addEventListener('click', close);
            const save = el('button', null, 'save');
            save.type = 'button';
            save.addEventListener('click', () => {
                const t = title.value.trim();
                if (!t) { toast('song needs a title'); return; }
                const current = songId ? (shadow.songs || {})[songId] : null;
                if (current && current.updatedAt !== baseline &&
                    !confirm('This song changed while you were editing — overwrite?')) return;
                const orders = Object.values(shadow.songs || {}).map((s) => s.order ?? 0);
                const data = {
                    title: t,
                    body: body.value,
                    order: song ? (song.order ?? 0) : (orders.length ? Math.max(...orders) + 1 : 0),
                    updatedAt: firebase.database.ServerValue.TIMESTAMP,
                };
                if (meta.value.trim()) data.meta = meta.value.trim();
                const target = songId ? base.child('songs/' + songId) : base.child('songs').push();
                target.set(data).then(close).catch(writeFailed);
            });
            bar.append(cancel, save);
            if (songId) {
                const del = el('button', 'danger-btn', 'delete');
                del.type = 'button';
                del.addEventListener('click', () => {
                    if (!confirm(`Delete "${song.title}" completely?`)) return;
                    base.child('songs/' + songId).remove().then(close).catch(writeFailed);
                });
                bar.appendChild(del);
            }
            overlay.append(bar, title, meta, body);
            document.body.appendChild(overlay);
            title.focus();
        }

        // ─── Stage mode ─────────────────────────────────────────────
        // Fullscreen big-text lyrics with wake lock + auto-scroll, for
        // phones on mic stands. Wake lock: iOS drops it when the tab
        // hides; visibilitychange re-acquires. Feature-detected.
        let wakeLock = null;
        async function acquireWakeLock() {
            if (!('wakeLock' in navigator) || wakeLock) return;
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => { wakeLock = null; });
            } catch (e) { wakeLock = null; } // rejects when not visible — harmless
        }
        function releaseWakeLock() {
            if (!wakeLock) return;
            try { wakeLock.release(); } catch (e) { /* */ }
            wakeLock = null;
        }

        let stage = null; // {overlay, view, songs, idx, scroll:{running,pos,prev,speed}}
        const SPEEDS = [10, 18, 30]; // px/s — slow enough to sing to

        function openStage(songs, idx) {
            closeStage();
            const overlay = el('div', 'stage-overlay');
            const barTop = el('div', 'stage-bar');
            const close = el('button', 'ghost-btn', '✕');
            close.type = 'button';
            close.addEventListener('click', closeStage);
            const title = el('span', 'stage-title');
            const smaller = el('button', 'ghost-btn', 'A−');
            smaller.type = 'button';
            const bigger = el('button', 'ghost-btn', 'A+');
            bigger.type = 'button';
            barTop.append(close, title, smaller, bigger);

            const view = el('div', 'stage-view');
            const text = el('pre', 'stage-text');
            view.appendChild(text);

            const barBottom = el('div', 'stage-bar stage-bar-bottom');
            const prev = el('button', 'ghost-btn', '‹ prev');
            prev.type = 'button';
            const play = el('button', 'scroll-btn', '▶ scroll');
            play.type = 'button';
            const speed = el('button', 'ghost-btn', '·');
            speed.type = 'button';
            const next = el('button', 'ghost-btn', 'next ›');
            next.type = 'button';
            barBottom.append(prev, play, speed, next);

            overlay.append(barTop, view, barBottom);
            document.body.appendChild(overlay);
            document.body.classList.add('stage-open');

            stage = {
                overlay, view, text, title, play, speedBtn: speed, songs, idx,
                scroll: { running: false, pos: 0, prev: null, speedIdx: 0 },
            };

            let fontSize = parseFloat(lsGet(LS_FONT)) || 1.35;
            const applyFont = () => { text.style.fontSize = fontSize + 'rem'; };
            smaller.addEventListener('click', () => { fontSize = Math.max(1.1, fontSize - 0.125); applyFont(); lsSet(LS_FONT, String(fontSize)); });
            bigger.addEventListener('click', () => { fontSize = Math.min(2.2, fontSize + 0.125); applyFont(); lsSet(LS_FONT, String(fontSize)); });
            applyFont();

            prev.addEventListener('click', () => stageGo(-1));
            next.addEventListener('click', () => stageGo(1));
            play.addEventListener('click', toggleScroll);
            speed.addEventListener('click', () => {
                stage.scroll.speedIdx = (stage.scroll.speedIdx + 1) % SPEEDS.length;
                speed.textContent = '·'.repeat(stage.scroll.speedIdx + 1);
            });
            // A hand on the lyrics wins over the robot scroll.
            view.addEventListener('touchstart', pauseScroll, { passive: true });
            view.addEventListener('wheel', pauseScroll, { passive: true });

            stageShow();
            acquireWakeLock();
        }

        function stageShow() {
            const song = stage.songs[stage.idx];
            stage.title.textContent = song.title + (song.meta ? ' · ' + song.meta : '');
            stage.text.textContent = song.body || '';
            stage.view.scrollTop = 0;
            pauseScroll();
        }

        function stageGo(delta) {
            const n = stage.songs.length;
            stage.idx = (stage.idx + delta + n) % n;
            stageShow();
        }

        function toggleScroll() {
            if (!stage) return;
            if (stage.scroll.running) { pauseScroll(); return; }
            stage.scroll.running = true;
            // Re-sync from wherever a hand left the view; keep pos fractional
            // in the accumulator (scrollTop assignment rounds).
            stage.scroll.pos = stage.view.scrollTop;
            stage.scroll.prev = null;
            stage.play.textContent = '❚❚ scroll';
            requestAnimationFrame(scrollTick);
        }

        function pauseScroll() {
            if (!stage) return;
            stage.scroll.running = false;
            if (stage.play) stage.play.textContent = '▶ scroll';
        }

        function scrollTick(t) {
            if (!stage || !stage.scroll.running) return;
            const s = stage.scroll;
            if (s.prev !== null) {
                const max = stage.view.scrollHeight - stage.view.clientHeight;
                s.pos = Math.min(s.pos + SPEEDS[s.speedIdx] * (t - s.prev) / 1000, max);
                stage.view.scrollTop = s.pos;
                if (s.pos >= max) { pauseScroll(); return; }
            }
            s.prev = t;
            requestAnimationFrame(scrollTick);
        }

        function closeStage() {
            if (!stage) return;
            pauseScroll();
            stage.overlay.remove();
            document.body.classList.remove('stage-open');
            stage = null;
            releaseWakeLock();
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && stage) {
                acquireWakeLock();
                stage.scroll.prev = null; // no time-jump lurch on resume
            }
        });

        // ─── Board ──────────────────────────────────────────────────
        function watchMessages() {
            const list = $('messages-list');
            list.textContent = '';
            base.child('messages').orderByKey().limitToLast(200).on('child_added', (snap) => {
                const m = snap.val();
                if (!m) return;
                const row = el('div', 'msg-row');
                const head = el('div', 'msg-head');
                head.appendChild(el('span', 'msg-name', m.name));
                head.appendChild(el('span', 'msg-when', fmtWhen(m.ts)));
                row.appendChild(head);
                row.appendChild(el('div', 'msg-text', m.text));
                list.appendChild(row);
                list.scrollTop = list.scrollHeight;
            });

            $('message-form').addEventListener('submit', (e) => {
                e.preventDefault();
                const input = $('message-input');
                const text = input.value.trim();
                if (!text) return;
                const member = getMember();
                if (!member) { showMemberPicker(() => $('message-form').requestSubmit()); return; }
                base.child('messages').push({
                    name: member.name, text, ts: firebase.database.ServerValue.TIMESTAMP,
                }).then(() => { input.value = ''; }).catch(writeFailed);
            });
        }

        // ─── Gallery (lazy) ─────────────────────────────────────────
        // Metadata renders immediately; each base64 blob is fetched only
        // as its placeholder nears the viewport, one node at a time.
        function renderGallery() {
            const grid = $('gallery-grid');
            grid.textContent = '';
            const io = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const fig = entry.target;
                    io.unobserve(fig);
                    base.child('galleryData/' + fig.dataset.imageId).once('value', (snap) => {
                        const dataUrl = snap.val();
                        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
                        const img = el('img');
                        img.alt = fig.dataset.title || '';
                        img.src = dataUrl;
                        fig.replaceChild(img, fig.firstChild);
                    });
                }
            }, { rootMargin: '400px' });

            for (const [imageId, g] of byOrder(Object.entries(shadow.gallery || {}))) {
                const fig = el('figure', 'art-figure');
                fig.dataset.imageId = imageId;
                fig.dataset.title = g.title || '';
                fig.appendChild(el('div', 'art-placeholder'));
                if (g.title) fig.appendChild(el('figcaption', null, g.title));
                grid.appendChild(fig);
                io.observe(fig);
            }
        }

        // ─── Init ───────────────────────────────────────────────────
        function init() {
            // Versioned auth key: bump to force every device back to the
            // password form (e.g. after a password rotation).
            if (lsGet(LS_AUTHV) !== '1') {
                lsDel(LS_TOKEN);
                lsSet(LS_AUTHV, '1');
            }

            $('gate-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const value = $('gate-input').value.trim();
                if (!value) return;
                if (!(typeof crypto !== 'undefined' && crypto.subtle)) {
                    showGate('logging in needs a secure connection (https)');
                    return;
                }
                const slug = await deriveSlug(value);
                lsSet(LS_TOKEN, slug);
                connect(slug);
            });

            $('reset-token').addEventListener('click', (e) => {
                e.preventDefault();
                lsDel(LS_TOKEN);
                lsDel(LS_MEMBER);
                location.reload();
            });

            $('switch-member').addEventListener('click', (e) => {
                e.preventDefault();
                showMemberPicker(null);
            });

            const token = captureToken();
            if (token) connect(token);
            else showGate();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    })();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SLUG_SALT, deriveSlug, partDisplay, fmtWhen, byOrder };
}
