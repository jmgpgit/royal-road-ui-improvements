'use strict';

/**
 * Author-note handling against the real chapter that motivated it.
 *
 * That chapter has both cases side by side, which is why it is the fixture:
 *  - the top note is *only* a shoutout (one block, promoting fiction 179650);
 *  - the bottom note is a genuine note with no outbound fiction links.
 *
 * The second one never being touched is the point. A shoutout remover that
 * occasionally eats a real author's note is worse than no remover at all.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const CHAPTER_URL =
  'https://www.royalroad.com/fiction/149588/one-was-worthy-book-one-complete/chapter/3766643/24-alone-at-home';

const SKIP = need('chapter.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/filters.js',
  'src/common/css.js',
  'src/content/ui.js',
  'src/content/features/author-notes.js',
];

function load() {
  const dom = new JSDOM(fixture('chapter.new.html'), { url: CHAPTER_URL, runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`globalThis.browser = { storage: { local: {}, onChanged: {} }, runtime: {} };`);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return w;
}

const ctxWith = (w, over = {}) => ({ settings: w.RRX.normalizeSettings(over) });

const notes = (w) => [...w.document.querySelectorAll('.author-note-card')];
const chips = (w) => [...w.document.querySelectorAll('.rrx-note-chip')];
const isHidden = (el) => el.classList.contains('rrx-note-hidden');

test('the fixture still has the two cases this feature exists for', () => {
  const w = load();
  const cards = notes(w);
  assert.equal(cards.length, 2);

  const [promo, real] = cards.map((c) => c.querySelector('.author-note'));
  const foreign = (note) =>
    [...note.querySelectorAll('a[href*="/fiction/"]')]
      .map((a) => w.RRX.fictionIdFromHref(a.getAttribute('href')))
      .filter((id) => id && id !== 149588);

  assert.ok(foreign(promo).includes(179650), 'top note promotes another fiction');
  assert.deepEqual(foreign(real), [], 'bottom note links to no other fiction');
});

test('shoutouts mode collapses the promo note and leaves the real one alone', () => {
  const w = load();
  w.RRX.authorNotes.process(ctxWith(w, { 'notes.mode': 'shoutouts' }));

  const [promo, real] = notes(w);

  // The promo note was nothing but a shoutout, so the whole card collapses
  // rather than leaving an "A note from …" header over an empty box.
  assert.ok(isHidden(promo.querySelector('.author-note')), 'promo note collapsed');
  assert.equal(chips(w).length, 1, 'exactly one restore chip');

  // The genuine note is untouched: not hidden, no chip, text intact.
  assert.ok(!isHidden(real.querySelector('.author-note')), 'real note left visible');
  assert.equal(real.querySelectorAll('.rrx-note-chip').length, 0);
  assert.ok(real.textContent.trim().length > 100, 'real note keeps its text');
});

test('the chip restores exactly what was collapsed', () => {
  const w = load();
  w.RRX.authorNotes.process(ctxWith(w, { 'notes.mode': 'shoutouts' }));

  const chip = chips(w)[0];
  const hiddenNote = notes(w)[0].querySelector('.author-note');
  assert.ok(isHidden(hiddenNote));

  chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  assert.ok(!isHidden(hiddenNote), 'restored');
  assert.equal(chips(w).length, 0, 'chip removed');
  // Nothing was destroyed - the promo content is still there to come back to.
  assert.ok(hiddenNote.querySelector('a[href*="/fiction/179650/"]'));
});

test('off mode touches nothing at all', () => {
  const w = load();
  w.RRX.authorNotes.process(ctxWith(w, { 'notes.mode': 'off' }));
  assert.equal(chips(w).length, 0);
  for (const card of notes(w)) {
    assert.ok(!isHidden(card.querySelector('.author-note')));
  }
});

test('all mode collapses both notes, shoutout or not', () => {
  const w = load();
  w.RRX.authorNotes.process(ctxWith(w, { 'notes.mode': 'all' }));
  assert.equal(chips(w).length, 2);
  for (const card of notes(w)) {
    assert.ok(isHidden(card.querySelector('.author-note')));
  }
});

test('a blocked author has their notes collapsed even in off mode', () => {
  const w = load();
  const authorId = w.document.querySelector('[data-author-id]').getAttribute('data-author-id');
  assert.ok(authorId, 'the chapter exposes an author id');

  w.RRX.authorNotes.process(
    ctxWith(w, { 'notes.mode': 'off', 'notes.blockedAuthors': [authorId] })
  );
  assert.equal(chips(w).length, 2, 'both notes from this author collapse');
});

test('isShoutout only fires on links to a different fiction', () => {
  const w = load();
  const { isShoutout } = w.RRX.authorNotes;
  const make = (html) => {
    const d = w.document.createElement('div');
    d.innerHTML = html;
    return d;
  };

  assert.equal(isShoutout(make('<p>Just a note.</p>'), 149588), false);
  // A link back to the fiction you are already reading is not cross-promotion.
  assert.equal(isShoutout(make('<a href="/fiction/149588/x">this one</a>'), 149588), false);
  assert.equal(isShoutout(make('<a href="/fiction/179650/x">that one</a>'), 149588), true);
  assert.equal(
    isShoutout(make('<a href="https://www.royalroad.com/fiction/179650/x">abs</a>'), 149588),
    true
  );
  // Non-fiction Royal Road links must not trip it.
  assert.equal(isShoutout(make('<a href="/fictions/search?tagsAdd=litrpg">tag</a>'), 149588), false);
  assert.equal(isShoutout(make('<a href="https://patreon.com/x">patreon</a>'), 149588), false);
});

test('hiding the author panel takes its "About author" heading with it', () => {
  const w = load();
  const anchor = w.document.querySelector('[data-author-role]');
  assert.ok(anchor, 'the panel root is [data-author-role], not [data-author-id]');

  w.RRX.authorNotes.hideAuthorPanel(true);

  const hidden = anchor.closest('.rrx-note-hidden');
  assert.ok(hidden, 'an ancestor section was hidden, not just the card');

  // The bug this replaces: the author card carries the author's *name* in a
  // heading of its own, so stopping at the first heading found hid only the
  // card and left "About author" sitting above a gap.
  const headings = [...hidden.querySelectorAll('h1, h2, h3, h4')].map((h) => h.textContent);
  assert.ok(
    headings.some((t) => t.includes('About author')),
    `hidden section must contain the section heading; found ${JSON.stringify(headings)}`
  );

  w.RRX.authorNotes.hideAuthorPanel(false);
  assert.equal(anchor.closest('.rrx-note-hidden'), null, 'reversible');
});

test('every author panel on the page is hidden, not just one', () => {
  const w = load();
  const panels = [...w.document.querySelectorAll('[data-author-role]')];
  assert.ok(panels.length >= 1);

  w.RRX.authorNotes.hideAuthorPanel(true);
  for (const panel of panels) {
    assert.ok(panel.closest('.rrx-note-hidden'), 'each panel is covered');
  }
});


test('the settings link is added to Royal Road’s own reading preferences dialog', () => {
  const w = load();
  const dialog = w.document.querySelector('#reading-preferences [data-rr-dialog-content]');
  assert.ok(dialog, 'the chapter has the Reading Preferences dialog');

  w.RRX.authorNotes.addSettingsLink();
  const link = dialog.querySelector('.rrx-prefs-link button');
  assert.ok(link, 'a link into the extension settings');

  // Idempotent: onPage runs again on every settings change.
  w.RRX.authorNotes.addSettingsLink();
  assert.equal(dialog.querySelectorAll('.rrx-prefs-link').length, 1);
});

test('a note that is only a shoutout restores fully when the chip is clicked', () => {
  // collapseShoutouts hid the inner block, then collapseCard hid the
  // whole note on top of it. Clicking "show" un-hid the note but left the block
  // hidden inside, so the note reappeared empty.
  const w = load();
  w.RRX.authorNotes.process(ctxWith(w, { 'notes.mode': 'shoutouts' }));

  const promo = notes(w)[0];
  const note = promo.querySelector('.author-note');
  assert.ok(isHidden(note), 'collapsed to a single chip');
  assert.equal(
    note.querySelectorAll('.rrx-note-hidden').length,
    0,
    'no block may stay individually hidden underneath the card-level chip'
  );

  chips(w)[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  assert.ok(!isHidden(note), 'note revealed');
  assert.ok(note.textContent.trim().length > 100, 'and its content is actually visible again');
  assert.equal(w.document.querySelectorAll('.rrx-note-hidden').length, 0);
});

test('an empty author note is left alone rather than collapsed to a chip', () => {
  const w = load();
  const empty = notes(w).find((c) => !c.querySelector('.author-note').textContent.trim());
  if (!empty) return; // fixture has none; nothing to assert
  w.RRX.authorNotes.process(ctxWith(w, { 'notes.mode': 'all' }));
  assert.ok(!isHidden(empty.querySelector('.author-note')));
});
