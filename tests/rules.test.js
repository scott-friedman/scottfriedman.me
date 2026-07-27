/**
 * Security-rules tests for firebase.rules.json.
 *
 * Run with `npm test` (wraps `firebase emulators:exec`, which starts the
 * RTDB emulator and sets FIREBASE_DATABASE_EMULATOR_HOST).
 *
 * These exist because two rules deploys (2026-01-19, 2026-04-02) silently
 * killed three features for months. Machine writers (HA, workers) use the
 * database secret, which bypasses rules entirely — that path can't be
 * tested here, so these tests pin down what the PUBLIC can and can't do.
 */
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require('@firebase/rules-unit-testing');
const { ref, get, set, push, remove, update } = require('firebase/database');

const ADMIN_UID = 'test-admin-uid';
let testEnv;

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'demo-test',
        database: {
            rules: fs.readFileSync(
                path.join(__dirname, '..', 'firebase.rules.json'), 'utf8'),
        },
    });
    // Seed the admin allowlist the rules check against
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await set(ref(ctx.database(), `admins/${ADMIN_UID}`), true);
    });
});

after(async () => {
    await testEnv.cleanup();
});

const anonDb = () => testEnv.unauthenticatedContext().database();
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).database();

// ---------- content ----------

test('anyone can read content', async () => {
    await assertSucceeds(get(ref(anonDb(), 'content')));
});

test('anon cannot write content, admin can', async () => {
    await assertFails(set(ref(anonDb(), 'content/about'), 'defaced'));
    await assertSucceeds(set(ref(adminDb(), 'content/about'), 'hello'));
});

// ---------- litterrobot (HA writes via database secret, not testable here) ----------

test('anyone can read litterrobot, nobody can write publicly', async () => {
    await assertSucceeds(get(ref(anonDb(), 'litterrobot/current')));
    await assertFails(set(ref(anonDb(), 'litterrobot/current'), { status: 'fake' }));
});

// ---------- figurines ----------

const validFigurine = () => ({
    modelUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/model.glb',
    name: 'Testy',
    x: 50,
    z: 50,
    rotationY: 0,
    state: 'idle',
    hunger: 80,
    happiness: 80,
    energy: 80,
    lastInteraction: Date.now(),
});

test('anyone can read figurines', async () => {
    await assertSucceeds(get(ref(anonDb(), 'figurines')));
});

test('anon can create a valid figurine', async () => {
    await assertSucceeds(set(ref(anonDb(), 'figurines/fig1'), validFigurine()));
});

test('figurine model must live on Firebase Storage', async () => {
    const bad = { ...validFigurine(), modelUrl: 'https://evil.example/model.glb' };
    await assertFails(set(ref(anonDb(), 'figurines/fig-bad'), bad));
});

test('anon can move a figurine but not rename it', async () => {
    await set(ref(anonDb(), 'figurines/fig2'), validFigurine());
    await assertSucceeds(update(ref(anonDb(), 'figurines/fig2'), { x: 10, z: 90 }));
    await assertFails(update(ref(anonDb(), 'figurines/fig2'), { name: 'Hijacked' }));
});

test('only admin can delete a figurine', async () => {
    await set(ref(anonDb(), 'figurines/fig3'), validFigurine());
    await assertFails(remove(ref(anonDb(), 'figurines/fig3')));
    await assertSucceeds(remove(ref(adminDb(), 'figurines/fig3')));
});

test('anon can write a valid walk and statsUpdatedAt', async () => {
    await set(ref(anonDb(), 'figurines/fig-walk'), validFigurine());
    await assertSucceeds(update(ref(anonDb(), 'figurines/fig-walk'), {
        walk: { fromX: 50, fromZ: 50, toX: 60, toZ: 40, startedAt: Date.now(), duration: 8000 },
        statsUpdatedAt: Date.now(),
    }));
    // Clearing the walk (stroll finished) is allowed
    await assertSucceeds(update(ref(anonDb(), 'figurines/fig-walk'), { walk: null }));
});

test('walk coords are clamped 0-100 and duration capped at 60s', async () => {
    await set(ref(anonDb(), 'figurines/fig-walk2'), validFigurine());
    await assertFails(update(ref(anonDb(), 'figurines/fig-walk2'), {
        walk: { fromX: 50, fromZ: 50, toX: 150, toZ: 40, startedAt: Date.now(), duration: 8000 },
    }));
    await assertFails(update(ref(anonDb(), 'figurines/fig-walk2'), {
        walk: { fromX: 50, fromZ: 50, toX: 60, toZ: 40, startedAt: Date.now(), duration: 120000 },
    }));
    // Partial walk objects are rejected
    await assertFails(update(ref(anonDb(), 'figurines/fig-walk2'), {
        walk: { toX: 60, toZ: 40 },
    }));
});

test('figurines reject unknown fields and non-number statsUpdatedAt', async () => {
    await set(ref(anonDb(), 'figurines/fig-strict'), validFigurine());
    await assertFails(update(ref(anonDb(), 'figurines/fig-strict'), { payload: 'arbitrary' }));
    await assertFails(update(ref(anonDb(), 'figurines/fig-strict'), { statsUpdatedAt: 'yesterday' }));
});

// ---------- caretakers / caretakerCounts / notifyState ----------

test('caretaker emails are unreadable and unwritable by anon', async () => {
    await assertFails(get(ref(anonDb(), 'caretakers')));
    await assertFails(get(ref(anonDb(), 'caretakers/fig1')));
    await assertFails(set(ref(anonDb(), 'caretakers/fig1/x'), {
        email: 'spammer@example.com', createdAt: Date.now(),
    }));
});

test('caretaker emails are unreadable even by admin (worker-secret only)', async () => {
    await assertFails(get(ref(adminDb(), 'caretakers')));
    await assertFails(set(ref(adminDb(), 'caretakers/fig1/x'), { email: 'a@b.c' }));
});

test('caretakerCounts are public read, nobody writes via client', async () => {
    await assertSucceeds(get(ref(anonDb(), 'caretakerCounts')));
    await assertFails(set(ref(anonDb(), 'caretakerCounts/fig1'), 999));
    await assertFails(set(ref(adminDb(), 'caretakerCounts/fig1'), 999));
});

test('notifyState is fully private', async () => {
    await assertFails(get(ref(anonDb(), 'notifyState')));
    await assertFails(set(ref(anonDb(), 'notifyState/fig1/hungry'), { lastNotifiedAt: 0 }));
});

// ---------- commandcenter/log ----------

test('anyone can read the activity log', async () => {
    await assertSucceeds(get(ref(anonDb(), 'commandcenter/log')));
});

test('anon cannot write log entries (worker uses the database secret)', async () => {
    await assertFails(push(ref(anonDb(), 'commandcenter/log'), {
        entity_id: 'light.fake',
        action: 'turn_on',
        deviceName: '<img src=x onerror=alert(1)>',
        timestamp: Date.now(),
    }));
});

test('admin can write and clear the log', async () => {
    await assertSucceeds(push(ref(adminDb(), 'commandcenter/log'), {
        entity_id: 'light.lamp',
        action: 'turn_on',
        deviceName: 'Lamp',
        timestamp: Date.now(),
    }));
    await assertFails(push(ref(adminDb(), 'commandcenter/log'), {
        entity_id: 'light.lamp',
        action: 'turn_on',
        deviceName: 'x'.repeat(61), // over the 60-char bound
        timestamp: Date.now(),
    }));
    await assertSucceeds(remove(ref(adminDb(), 'commandcenter/log')));
});

// ---------- benefits cache ----------

test('anyone can read benefits cache, anon cannot write it', async () => {
    await assertSucceeds(get(ref(anonDb(), 'benefits/cache')));
    await assertFails(set(ref(anonDb(), 'benefits/cache/poisoned'), {
        benefits: ['lies'],
        usageTips: ['more lies'],
        cachedAt: Date.now(),
    }));
});

// ---------- stickynotes ----------

const validNote = () => ({
    text: 'hello',
    x: 50,
    y: 100,
    color: 'yellow',
    createdAt: Date.now(),
});

test('anon can create a valid stickynote', async () => {
    await assertSucceeds(set(ref(anonDb(), 'stickynotes/note1'), validNote()));
});

test('anon cannot delete a stickynote, admin can', async () => {
    await set(ref(anonDb(), 'stickynotes/note2'), validNote());
    await assertFails(remove(ref(anonDb(), 'stickynotes/note2')));
    await assertSucceeds(remove(ref(adminDb(), 'stickynotes/note2')));
});

test('anon can move a stickynote but not rewrite its text', async () => {
    await set(ref(anonDb(), 'stickynotes/note3'), validNote());
    const moved = { ...validNote(), x: 20, y: 300 };
    // createdAt must be unchanged for a move — reuse the original
    const original = (await get(ref(adminDb(), 'stickynotes/note3'))).val();
    await assertSucceeds(set(ref(anonDb(), 'stickynotes/note3'),
        { ...original, x: 20, y: 300 }));
    await assertFails(set(ref(anonDb(), 'stickynotes/note3'),
        { ...original, text: 'rewritten' }));
});

// ---------- strokes ----------

test('anon can draw a valid stroke but not clear the canvas', async () => {
    await assertSucceeds(set(ref(anonDb(), 'strokes/index/s1'), {
        points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
        width: 5,
        timestamp: Date.now(),
    }));
    await assertFails(remove(ref(anonDb(), 'strokes/index')));
    await assertSucceeds(remove(ref(adminDb(), 'strokes/index')));
});

test('strokes over the 2000-point cap are rejected', async () => {
    const points = Array.from({ length: 2001 }, (_, i) => ({ x: i, y: i }));
    await assertFails(set(ref(anonDb(), 'strokes/index/s2'), {
        points,
        width: 5,
        timestamp: Date.now(),
    }));
});

// ---------- music ----------

const validBar = () => ({
    name: 'test bar',
    creator: 'tester',
    bpm: 120,
    drums: [[true, false]],
    melody: [[false, true]],
    createdAt: Date.now(),
});

test('anon can create a valid bar but not arbitrary JSON or huge names', async () => {
    await assertSucceeds(set(ref(anonDb(), 'music/bars/bar1'), validBar()));
    await assertFails(set(ref(anonDb(), 'music/bars/bar2'), { junk: 'x'.repeat(100000) }));
    await assertFails(set(ref(anonDb(), 'music/bars/bar3'),
        { ...validBar(), name: 'x'.repeat(61) }));
});

test('bars are create-only for anon; admin can delete', async () => {
    await set(ref(anonDb(), 'music/bars/bar4'), validBar());
    await assertFails(set(ref(anonDb(), 'music/bars/bar4'),
        { ...validBar(), name: 'defaced' }));
    await assertFails(remove(ref(anonDb(), 'music/bars/bar4')));
    await assertSucceeds(remove(ref(adminDb(), 'music/bars/bar4')));
});

const validSong = () => ({
    name: 'test song',
    creator: 'tester',
    barIds: ['bar1', 'bar2'],
    createdAt: Date.now(),
});

test('anon can create a valid song; junk fields and missing fields rejected', async () => {
    await assertSucceeds(set(ref(anonDb(), 'music/songs/song1'), validSong()));
    await assertFails(set(ref(anonDb(), 'music/songs/song2'),
        { ...validSong(), payload: 'arbitrary' }));
    await assertFails(set(ref(anonDb(), 'music/songs/song3'), { name: 'no barIds' }));
});

test('songs are create-only for anon; barIds capped at 100', async () => {
    await set(ref(anonDb(), 'music/songs/song4'), validSong());
    await assertFails(set(ref(anonDb(), 'music/songs/song4'),
        { ...validSong(), name: 'defaced' }));
    await assertFails(set(ref(anonDb(), 'music/songs/song5'),
        { ...validSong(), barIds: Array.from({ length: 101 }, (_, i) => `bar${i}`) }));
});

// ---------- benefits history ----------

test('history entries take only query + timestamp, bounded', async () => {
    await assertSucceeds(set(ref(anonDb(), 'benefits/history/h1'),
        { query: 'kiwi', timestamp: Date.now() }));
    await assertFails(set(ref(anonDb(), 'benefits/history/h2'),
        { query: 'kiwi', timestamp: Date.now(), extra: 'payload' }));
    await assertFails(set(ref(anonDb(), 'benefits/history/h3'),
        { query: 'x'.repeat(201), timestamp: Date.now() }));
});

// ---------- admin config ----------

test('anon cannot read admins or admin_config', async () => {
    await assertFails(get(ref(anonDb(), 'admins')));
    await assertFails(get(ref(anonDb(), 'admin_config')));
});

// ---------- bandnotes ----------

// The slug IS the credential (first 32 hex of SHA-256(salt + password)),
// so these tests pin two properties above all: the parent path must never
// be enumerable, and a well-formed slug grants full read/write (the
// intentional Google-Doc-equivalent trust model).
const BAND_SLUG = 'a'.repeat(32);

const validBandSeed = () => ({
    meta: {
        bandName: 'test band',
        practiceSpace: '123 Test St',
        instagramUrl: 'https://www.instagram.com/testband',
    },
    members: {
        scott: { name: 'Scott', role: 'bass', email: 'scott@example.com', order: 0 },
    },
    availability: {
        scott: { text: 'free most nights', updatedAt: Date.now() },
    },
    agenda: { text: 'practice the set', updatedAt: Date.now() },
    goals: { g1: { text: 'book a show', done: false, order: 0 } },
    setlist: {
        boxcar: {
            name: 'Boxcar', band: 'Jawbreaker', bpm: 155, order: 0,
            parts: { drums: '100', bass: '100', gtr1: '100', vox: '100' },
        },
    },
    songs: {
        thegray: { title: 'The Gray', meta: '135 BPM', body: 'lyrics here', order: 0, updatedAt: Date.now() },
    },
    venues: { ralphs: { name: 'Ralphs', location: 'Worcester MA', info: 'diner car', order: 0 } },
    gallery: { logo: { title: 'logo', order: 0 } },
    galleryData: { logo: 'data:image/webp;base64,AAAA' },
    messages: { m1: { name: 'Scott', text: 'first', ts: Date.now() } },
});

test('bandnotes parent is not enumerable (the security-critical property)', async () => {
    await assertFails(get(ref(anonDb(), 'bandnotes')));
    await assertFails(get(ref(adminDb(), 'bandnotes')));
});

test('malformed slugs are denied read and write', async () => {
    await assertFails(get(ref(anonDb(), 'bandnotes/not-a-hex-slug')));
    await assertFails(set(ref(anonDb(), 'bandnotes/not-a-hex-slug/meta'),
        { bandName: 'x' }));
    // Uppercase hex is not a valid slug (deriveSlug emits lowercase)
    await assertFails(get(ref(anonDb(), `bandnotes/${'A'.repeat(32)}`)));
    // Too short
    await assertFails(get(ref(anonDb(), `bandnotes/${'a'.repeat(31)}`)));
});

test('probe read of an empty valid slug succeeds (the wrong-password UX path)', async () => {
    await assertSucceeds(get(ref(anonDb(), `bandnotes/${'b'.repeat(32)}/meta`)));
});

test('a full seed-shaped PUT at a valid slug succeeds (the seeder path)', async () => {
    await assertSucceeds(set(ref(anonDb(), `bandnotes/${BAND_SLUG}`), validBandSeed()));
});

test('setlist cells take only legend values; clearing works', async () => {
    await set(ref(anonDb(), `bandnotes/${BAND_SLUG}`), validBandSeed());
    const cell = (part) => ref(anonDb(), `bandnotes/${BAND_SLUG}/setlist/boxcar/parts/${part}`);
    await assertSucceeds(set(cell('bass'), '80'));
    await assertFails(set(cell('bass'), '95'));
    await assertFails(set(cell('bass'), '✅')); // the emoji itself is not a value
    await assertFails(set(cell('keys'), '80'));     // no such instrument column
    await assertSucceeds(set(cell('bass'), null));  // empty cell = absent node
});

test('junk children under a slug are rejected', async () => {
    await assertFails(set(ref(anonDb(), `bandnotes/${BAND_SLUG}/evil`), true));
});

test('messages are shape-checked and clock-skew-bounded', async () => {
    const msgs = ref(anonDb(), `bandnotes/${BAND_SLUG}/messages`);
    await assertSucceeds(push(msgs, { name: 'Gabe', text: 'thursday works', ts: Date.now() }));
    await assertFails(push(msgs, { name: 'Gabe', text: 'x', ts: Date.now(), admin: true }));
    await assertFails(push(msgs, { name: 'Gabe', text: 'x', ts: Date.now() + 600000 }));
    await assertFails(push(msgs, { name: '', text: 'anonymous', ts: Date.now() }));
});

test('song bodies are capped and require updatedAt', async () => {
    const song = ref(anonDb(), `bandnotes/${BAND_SLUG}/songs/newsong`);
    await assertFails(set(song, {
        title: 'War and Peace', body: 'x'.repeat(20001), order: 1, updatedAt: Date.now(),
    }));
    await assertFails(set(song, { title: 'No timestamp', body: 'x', order: 1 }));
});

test('galleryData must be a data:image URL', async () => {
    const img = ref(anonDb(), `bandnotes/${BAND_SLUG}/galleryData/sneaky`);
    await assertFails(set(img, 'https://evil.example/img.png'));
    await assertSucceeds(set(img, 'data:image/webp;base64,AAAA'));
});

test('a slug-holder can delete the whole tree (intentional: Google-Doc trust model)', async () => {
    await set(ref(anonDb(), `bandnotes/${BAND_SLUG}`), validBandSeed());
    await assertSucceeds(remove(ref(anonDb(), `bandnotes/${BAND_SLUG}`)));
});

// ---------- default deny ----------

test('unknown paths are denied', async () => {
    await assertFails(get(ref(anonDb(), 'somethingelse')));
    await assertFails(set(ref(anonDb(), 'somethingelse/x'), 1));
});
