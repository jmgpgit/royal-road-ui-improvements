'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesFilters,
  hasActiveFilters,
  describeFilters,
  countActiveFilters,
} = require('../src/common/filters.js');

/** A fully-populated card; individual tests blank out what they care about. */
const card = (over = {}) => ({
  id: 1,
  rating: 4.5,
  followers: 5000,
  views: 1000000,
  pages: 500,
  chapters: 100,
  status: 'ONGOING',
  type: 'Original',
  tags: ['litrpg', 'magic'],
  updatedAt: 1_780_000_000,
  mine: { follow: false, favorite: false, ril: false },
  ...over,
});

const NOW = 1_780_000_000 + 10 * 86400; // ten days after the card's last update

test('no filters means everything matches', () => {
  assert.equal(matchesFilters(card(), {}, NOW), true);
  assert.equal(hasActiveFilters({}), false);
  assert.deepEqual(describeFilters({}), []);
});

test('numeric bounds are inclusive on both ends', () => {
  assert.equal(matchesFilters(card({ rating: 4.5 }), { 'filters.minRating': 4.5 }, NOW), true);
  assert.equal(matchesFilters(card({ rating: 4.4 }), { 'filters.minRating': 4.5 }, NOW), false);
  assert.equal(matchesFilters(card({ rating: 4.5 }), { 'filters.maxRating': 4.5 }, NOW), true);
  assert.equal(matchesFilters(card({ rating: 4.6 }), { 'filters.maxRating': 4.5 }, NOW), false);

  const band = { 'filters.minFollowers': 1000, 'filters.maxFollowers': 9000 };
  assert.equal(matchesFilters(card({ followers: 5000 }), band, NOW), true);
  assert.equal(matchesFilters(card({ followers: 999 }), band, NOW), false);
  assert.equal(matchesFilters(card({ followers: 9001 }), band, NOW), false);
});

test('every numeric field is wired up, not just rating', () => {
  for (const [field, key] of [
    ['followers', 'filters.minFollowers'],
    ['views', 'filters.minViews'],
    ['pages', 'filters.minPages'],
    ['chapters', 'filters.minChapters'],
  ]) {
    assert.equal(matchesFilters(card({ [field]: 10 }), { [key]: 100 }, NOW), false, field);
    assert.equal(matchesFilters(card({ [field]: 1000 }), { [key]: 100 }, NOW), true, field);
  }
});

test('an unreadable field never excludes a card', () => {
  // This is the whole safety story: if Royal Road renames the followers tile,
  // the filter stops narrowing rather than emptying the page.
  const blank = card({ rating: null, followers: null, views: null, pages: null, chapters: null });
  const strict = {
    'filters.minRating': 5,
    'filters.minFollowers': 1e6,
    'filters.minViews': 1e9,
    'filters.minPages': 1e5,
    'filters.minChapters': 1e4,
  };
  assert.equal(matchesFilters(blank, strict, NOW), true);
});

test('zero is a real bound, distinct from unset', () => {
  assert.equal(matchesFilters(card({ followers: 0 }), { 'filters.minFollowers': 0 }, NOW), true);
  assert.equal(matchesFilters(card({ followers: 0 }), { 'filters.minFollowers': 1 }, NOW), false);
  // maxFollowers: 0 is meaningful - "no followers at all".
  assert.equal(matchesFilters(card({ followers: 5 }), { 'filters.maxFollowers': 0 }, NOW), false);
});

test('tagsAll requires every tag; tagsNone vetoes any', () => {
  const c = card({ tags: ['litrpg', 'magic'] });
  assert.equal(matchesFilters(c, { 'filters.tagsAll': ['litrpg'] }, NOW), true);
  assert.equal(matchesFilters(c, { 'filters.tagsAll': ['litrpg', 'magic'] }, NOW), true);
  assert.equal(matchesFilters(c, { 'filters.tagsAll': ['litrpg', 'romance'] }, NOW), false);

  assert.equal(matchesFilters(c, { 'filters.tagsNone': ['romance'] }, NOW), true);
  assert.equal(matchesFilters(c, { 'filters.tagsNone': ['magic'] }, NOW), false);
});

test('a card with no readable tags is not treated as tag-free', () => {
  const untagged = card({ tags: [] });
  // tagsAll cannot be satisfied, so it excludes...
  assert.equal(matchesFilters(untagged, { 'filters.tagsAll': ['litrpg'] }, NOW), false);
  // ...but tagsNone must not silently "pass" a card whose chips failed to parse.
  assert.equal(matchesFilters(untagged, { 'filters.tagsNone': ['romance'] }, NOW), true);
});

test('status and type are allow-lists', () => {
  assert.equal(matchesFilters(card(), { 'filters.status': ['ONGOING'] }, NOW), true);
  assert.equal(matchesFilters(card(), { 'filters.status': ['COMPLETED'] }, NOW), false);
  assert.equal(
    matchesFilters(card(), { 'filters.status': ['ONGOING', 'COMPLETED'] }, NOW),
    true
  );
  assert.equal(matchesFilters(card(), { 'filters.type': ['Fan Fiction'] }, NOW), false);
  // Unknown status on the card: no evidence, so no exclusion.
  assert.equal(matchesFilters(card({ status: null }), { 'filters.status': ['COMPLETED'] }, NOW), true);
});

test('date filters read from both ends', () => {
  const c = card({ updatedAt: NOW - 10 * 86400 }); // updated ten days ago

  assert.equal(matchesFilters(c, { 'filters.updatedWithinDays': 30 }, NOW), true);
  assert.equal(matchesFilters(c, { 'filters.updatedWithinDays': 7 }, NOW), false);

  // "quiet for at least N days" is the mirror image.
  assert.equal(matchesFilters(c, { 'filters.staleForDays': 7 }, NOW), true);
  assert.equal(matchesFilters(c, { 'filters.staleForDays': 30 }, NOW), false);

  assert.equal(matchesFilters(card({ updatedAt: null }), { 'filters.updatedWithinDays': 1 }, NOW), true);
});

test('hideMine drops what is already on my shelves', () => {
  const followed = card({ mine: { follow: true, favorite: false, ril: false } });
  assert.equal(matchesFilters(followed, { 'filters.hideMine': ['follow'] }, NOW), false);
  assert.equal(matchesFilters(followed, { 'filters.hideMine': ['favorite'] }, NOW), true);
  assert.equal(matchesFilters(followed, { 'filters.hideMine': ['favorite', 'follow'] }, NOW), false);

  // Logged out, `mine` is absent entirely - nothing to hide, nothing excluded.
  assert.equal(matchesFilters(card({ mine: undefined }), { 'filters.hideMine': ['follow'] }, NOW), true);

  // "Tried and dropped" rides the same list rather than a filter of its own: it
  // answers the same question as the other three, and the panel already has a
  // row for it. The value is ours, filled in from the stored list rather than
  // read off the card - see list-filters.js.
  const dropped = card({ mine: { follow: false, favorite: false, ril: false, dropped: true } });
  assert.equal(matchesFilters(dropped, { 'filters.hideMine': ['dropped'] }, NOW), false);
  assert.equal(matchesFilters(dropped, { 'filters.hideMine': ['follow'] }, NOW), true);
});

test('the master switch turns everything off at once', () => {
  const strict = { 'filters.minRating': 5, 'filters.status': ['COMPLETED'] };
  assert.equal(matchesFilters(card(), strict, NOW), false);
  assert.equal(matchesFilters(card(), { ...strict, 'filters.enabled': false }, NOW), true);
  assert.equal(hasActiveFilters({ ...strict, 'filters.enabled': false }), false);
});

test('hasActiveFilters ignores empty lists and nulls', () => {
  assert.equal(hasActiveFilters({ 'filters.tagsAll': [] }), false);
  assert.equal(hasActiveFilters({ 'filters.minRating': null }), false);
  assert.equal(hasActiveFilters({ 'filters.minRating': 0 }), true);
  assert.equal(hasActiveFilters({ 'filters.tagsAll': ['litrpg'] }), true);
});

test('describeFilters summarises what is narrowing', () => {
  const parts = describeFilters({
    'filters.minRating': 4.5,
    'filters.minFollowers': 100,
    'filters.maxFollowers': 900,
    'filters.tagsAll': ['litrpg'],
    'filters.tagsNone': ['harem'],
    'filters.status': ['ONGOING'],
    'filters.hideMine': ['follow'],
  });
  assert.ok(parts.includes('rating ≥ 4.5'));
  assert.ok(parts.includes('followers 100 to 900'));
  assert.ok(parts.includes('+litrpg'));
  assert.ok(parts.includes('−harem'));
  assert.ok(parts.includes('ONGOING'));
  assert.ok(parts.includes('not follow'));
  assert.equal(countActiveFilters({ 'filters.minRating': 4.5 }), 1);
  assert.equal(countActiveFilters({}), 0);
});

test('the filter values are memoised without going stale', () => {
  // matchesFilters pulls the filter values as its first act and is called once
  // per card on every sweep, so this is the hottest path in the extension. The
  // cache is keyed on object identity, which is only safe because main.js
  // replaces the settings object wholesale rather than mutating it.
  const card = {
    id: 1,
    rating: 4.5,
    followers: 10,
    views: 1,
    pages: 1,
    chapters: 1,
    tags: [],
    status: null,
    type: null,
    updatedAt: null,
    bookmarks: {},
  };

  const loose = { 'filters.enabled': true, 'filters.minRating': 4 };
  assert.equal(matchesFilters(card, loose), true);

  // A different object with a different value must not read the first answer.
  const strict = { 'filters.enabled': true, 'filters.minRating': 5 };
  assert.equal(matchesFilters(card, strict), false, 'a new settings object is re-read');

  // ...and going back gives the original answer, not the cached stricter one.
  assert.equal(matchesFilters(card, loose), true, 'switching back is not stale');

  // Mutating in place is the case identity cannot catch, so the code that owns
  // the settings must never do it. Documented here so the assumption is visible.
  const mutated = { 'filters.enabled': true, 'filters.minRating': 4 };
  assert.equal(matchesFilters(card, mutated), true);
  mutated['filters.minRating'] = 5;
  assert.equal(
    matchesFilters(card, mutated),
    true,
    'in-place mutation is deliberately not observed: main.js replaces, never mutates'
  );
});
