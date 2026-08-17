'use strict';

/**
 * Card extraction against the real captures.
 *
 * The point of these is coverage of every field on every page shape, and: via
 * the two logged-in fixtures: that a *present* status icon and an *absent* one
 * are told apart correctly. That distinction is what this plan got wrong once.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');
const { matchesFilters } = require('../src/common/filters.js');

const ROOT = path.join(__dirname, '..');

const SKIP = need(
  'fictions-rising-stars.new.html',
  'fictions-latest-updates.new.html',
  'card-loggedin.html',
  'card-loggedin-marked.html'
);
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/cards.js',
];

function loadPage(fixtureName, url) {
  const dom = new JSDOM(fixture(fixtureName), { url, runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`globalThis.browser = { storage: { local: {}, onChanged: {} }, runtime: {} };`);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return w;
}

const cardsOf = (w) => [...w.document.querySelectorAll('.fiction-card-expanded')];

/**
 * Records are built inside the jsdom realm, so their objects and arrays carry
 * jsdom's prototypes and `assert.deepEqual` (which is strict) rejects them as
 * "not reference-equal". Re-wrap into this realm before comparing structurally.
 */
const own = (value) => JSON.parse(JSON.stringify(value));

// -- coverage across a whole page -------------------------------------------

test('every card on rising-stars yields a complete record', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const cards = cardsOf(w);
  assert.equal(cards.length, 50);

  for (const el of cards) {
    const d = w.RRX.readCardData(el);
    assert.ok(Number.isInteger(d.id) && d.id > 0, 'id');
    assert.ok(d.rating >= 0 && d.rating <= 5, `rating ${d.rating}`);
    for (const field of ['followers', 'pages', 'chapters', 'views']) {
      assert.ok(Number.isInteger(d[field]) && d[field] >= 0, `${field} = ${d[field]}`);
    }
    assert.ok(['ONGOING', 'HIATUS', 'COMPLETED', 'STUB', 'DROPPED'].includes(d.status), d.status);
    assert.ok(['Original', 'Fan Fiction'].includes(d.type), d.type);
    assert.ok(d.tags.length > 0, 'at least one tag');
    assert.ok(d.updatedAt > 1_000_000_000, `updatedAt ${d.updatedAt}`);
  }
});

test('numbers are parsed out of the thousands separators, not truncated at them', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const totals = cardsOf(w).map((el) => w.RRX.readCardData(el).views);
  // "630,441" must be 630441, not 630. Any comma bug shows up as a tiny max.
  assert.ok(Math.max(...totals) > 10000, `max views was only ${Math.max(...totals)}`);
  assert.equal(w.RRX.parseCount('714,646'), 714646);
  assert.equal(w.RRX.parseCount('2,116'), 2116);
  assert.equal(w.RRX.parseCount(''), null);
  assert.equal(w.RRX.parseCount('n/a'), null);
});

test('tags are de-duplicated across the mobile and desktop chip rows', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  for (const el of cardsOf(w)) {
    const { tags } = w.RRX.readCardData(el);
    assert.equal(new Set(tags).size, tags.length, 'tags must not repeat');
    for (const tag of tags) assert.ok(!tag.includes('&'), `unparsed query in tag: ${tag}`);
  }
});

test('latest-updates cards parse despite having no blurb', () => {
  const w = loadPage('fictions-latest-updates.new.html', 'https://www.royalroad.com/fictions/latest-updates');
  const cards = cardsOf(w);
  assert.ok(cards.length > 0);
  const d = w.RRX.readCardData(cards[0]);
  assert.ok(Number.isInteger(d.id));
  assert.ok(Number.isInteger(d.followers));
  assert.ok(d.updatedAt > 1_000_000_000);
});

// -- personal state, present and absent -------------------------------------

test('a followed + favourited card reports both, and its real numbers', () => {
  const w = loadPage('card-loggedin-marked.html', 'https://www.royalroad.com/fictions/best-rated');
  const d = w.RRX.readCardData(cardsOf(w)[0]);

  assert.equal(d.id, 54508);
  assert.equal(d.rating, 4.8);
  assert.equal(d.followers, 2116);
  assert.equal(d.pages, 362);
  assert.equal(d.chapters, 50);
  assert.equal(d.views, 714646);
  assert.equal(d.status, 'COMPLETED');
  assert.equal(d.type, 'Original');
  assert.deepEqual(own(d.tags).sort(), ['adventure', 'historical', 'mystery', 'romance']);
  assert.equal(d.updatedAt, 1780672771);

  assert.equal(d.mine.follow, true, 'the Following icon must be seen');
  assert.equal(d.mine.favorite, true, 'the Favorited icon must be seen');
  assert.equal(d.mine.ril, false, 'mark="True" means Read Later is NOT set');
});

test('an unmarked card reports nothing on my shelves', () => {
  // The regression test for the mistake this project already made once: absence
  // of a passive status icon is the normal unset state, not a parse failure.
  const w = loadPage('card-loggedin.html', 'https://www.royalroad.com/fictions/best-rated');
  const cards = cardsOf(w);
  assert.ok(cards.length >= 1);
  for (const el of cards) {
    const d = w.RRX.readCardData(el);
    // `dropped` is ours rather than Royal Road's; nothing on a card can set it.
    assert.deepEqual(own(d.mine), { follow: false, favorite: false, ril: false, dropped: false });
  }
});

test('hideMine drops the marked card and keeps the unmarked ones', () => {
  const marked = loadPage('card-loggedin-marked.html', 'https://www.royalroad.com/fictions/best-rated');
  const plain = loadPage('card-loggedin.html', 'https://www.royalroad.com/fictions/best-rated');
  const filters = { 'filters.hideMine': ['follow', 'favorite', 'ril'] };

  assert.equal(matchesFilters(marked.RRX.readCardData(cardsOf(marked)[0]), filters), false);
  for (const el of cardsOf(plain)) {
    assert.equal(matchesFilters(plain.RRX.readCardData(el), filters), true);
  }
});

// -- end-to-end through the filters -----------------------------------------

test('a rating filter narrows the real page by the right amount', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const records = cardsOf(w).map((el) => w.RRX.readCardData(el));

  const kept = records.filter((d) => matchesFilters(d, { 'filters.minRating': 4.5 }));
  const expected = records.filter((d) => d.rating >= 4.5).length;
  assert.equal(kept.length, expected);
  assert.ok(kept.length > 0 && kept.length < records.length, 'filter must actually narrow');
});

test('a tag filter narrows the real page by the right amount', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const records = cardsOf(w).map((el) => w.RRX.readCardData(el));

  const kept = records.filter((d) => matchesFilters(d, { 'filters.tagsAll': ['litrpg'] }));
  const expected = records.filter((d) => d.tags.includes('litrpg')).length;
  assert.equal(kept.length, expected);
  assert.ok(kept.length > 0, 'rising-stars always has some litrpg');
});
