/**
 * Band-notes tests. The one that earns its keep is salt parity: the page
 * (js/bandnotes.js) and the seeder (scripts/seed-bandnotes.mjs) each embed
 * the SLUG_SALT string literal and derive the slug independently. If they
 * ever drift, the band sees "wrong password" with no other symptom — this
 * test turns that into a red build instead.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const page = require('../js/bandnotes.js');

test('salt parity: page and seeder derive identical slugs', async () => {
    const seeder = await import('../scripts/seed-bandnotes.mjs');
    assert.strictEqual(seeder.SLUG_SALT, page.SLUG_SALT);
    for (const pw of ['test', 'surf later 4ever', 'päss wörd']) {
        assert.strictEqual(seeder.deriveSlug(pw), await page.deriveSlug(pw));
    }
});

test('deriveSlug: deterministic 32-char lowercase hex, case-sensitive', async () => {
    const slug = await page.deriveSlug('test');
    assert.match(slug, /^[0-9a-f]{32}$/);
    assert.strictEqual(await page.deriveSlug('test'), slug);
    assert.notStrictEqual(await page.deriveSlug('Test'), slug);
});

test('buildTree: arrays become keyed nodes with positional order, files become data URLs', async () => {
    const { buildTree } = await import('../scripts/seed-bandnotes.mjs');
    const tree = buildTree({
        meta: { bandName: 'test band' },
        members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', role: 'drums' }],
        availability: { a: 'weeknights' },
        agenda: 'practice',
        setlist: [{ id: 's1', name: 'Song', bpm: 155, parts: { bass: '80' } }],
        gallery: [{ id: 'img1', title: 'logo', file: 'stub.webp' }],
    }, () => Buffer.from('fake-image-bytes'));
    assert.strictEqual(tree.members.a.order, 0);
    assert.strictEqual(tree.members.b.order, 1);
    assert.strictEqual(tree.members.a.role, undefined); // absent optionals pruned
    assert.strictEqual(tree.availability.a.text, 'weeknights');
    assert.ok(tree.availability.a.updatedAt <= Date.now());
    assert.strictEqual(tree.setlist.s1.parts.bass, '80');
    assert.match(tree.galleryData.img1, /^data:image\/webp;base64,/);
});
