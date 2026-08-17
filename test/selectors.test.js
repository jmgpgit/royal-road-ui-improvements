'use strict';

/**
 * Guards every selector in src/common/selectors.js against the real Royal Road
 * HTML captured in test/fixtures/.
 *
 * These are substring assertions rather than DOM queries on purpose: they need
 * no parser, and they catch the failure that actually happens - Royal Road
 * renaming a hook out from under us. When one of these fails, re-capture the
 * fixture (see fixtures/README.md) and fix selectors.js.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');

const { SEL, CARD_VARIANTS, CARD_GROUPS, FICTION_STATS } = require('../src/common/selectors.js');
const { read, need } = require('./helpers/fixtures.js');

const FIXTURES = [
  'fictions-rising-stars.new.html',
  'fictions-latest-updates.new.html',
  'fictions-search.new.html',
  'fictions-weekly-popular.new.html',
  'home.new.html',
  'fiction-detail.new.html',
  'fictions-rising-stars.legacy.html',
];
const SKIP = need(...FIXTURES);

/** Every test here needs the captures; skip the lot with one reason if absent. */
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const count = (text, needle) => text.split(needle).length - 1;

// When a fixture is missing every test is skipped, so the empty string is never
// asserted against - this just keeps module load from throwing.
const load = (name) => (SKIP ? '' : read(name));

const listPage = load('fictions-rising-stars.new.html');
const latestUpdates = load('fictions-latest-updates.new.html');
const searchPage = load('fictions-search.new.html');
const weeklyPopular = load('fictions-weekly-popular.new.html');
const home = load('home.new.html');
const fictionPage = load('fiction-detail.new.html');
const legacy = load('fictions-rising-stars.legacy.html');

test('the legacy UI carries none of the hooks we build on', () => {
  // Its `class="ie8 no-js"` is inside an IE conditional comment, so it never
  // reaches a real DOM - hence no document_start detection. See selectors.js.
  assert.match(legacy, /<!--\[if IE 8\]> <html lang="en" class="ie8 no-js">/);
  assert.match(legacy, /<!--\[if !IE\]><!-->\s*<html lang="en">/);

  // Every redesign hook must be absent, which is what makes boot.js inert there.
  for (const hook of [
    'data-rr-expanded-fic-card',
    'data-rr-show-more',
    'data-rr-paginate',
    'data-rr-tooltip',
    'data-rr-carousel',
    'data-vt-trigger',
    'fiction-card-horizontal',
    'fiction-update-card',
    'recommendations-carousel',
  ]) {
    assert.equal(count(legacy, hook), 0, `legacy page unexpectedly has ${hook}`);
  }

  // But it DOES have a .fiction-list of its own, so that can never be the gate.
  assert.ok(legacy.includes('class="fiction-list'));
  assert.ok(SEL.newUiProbe.split(',').every((p) => !p.includes('fiction-list"')));

  // ...and the legacy card class is absent from the redesign, so the two can
  // never be confused in the other direction either.
  assert.ok(legacy.includes('fiction-list-item'));
  assert.equal(count(listPage, 'fiction-list-item'), 0);
});

test('the card link hook is on every server-rendered card', () => {
  // 2 per card on list pages (mobile + desktop title links), 1 on home cards.
  assert.equal(count(listPage, 'data-vt-trigger="fiction-card"'), 100);
  assert.equal(count(latestUpdates, 'data-vt-trigger="fiction-card"'), 40);
  assert.ok(count(home, 'data-vt-trigger="fiction-card"') > 0);

  const serverRendered = CARD_GROUPS.find((g) => g.link.includes('data-vt-trigger'));
  assert.ok(serverRendered, 'a group must match through data-vt-trigger');
  assert.ok(serverRendered.cards.includes('.fiction-card-expanded'));
});

test('.fiction-list is the one anchor every list page shares, exactly once', () => {
  for (const [name, html] of Object.entries({ listPage, latestUpdates, searchPage, weeklyPopular })) {
    assert.equal(count(html, 'class="fiction-list'), 1, `${name}: one .fiction-list`);
  }
});

test('the paginate skeleton is NOT usable as the toolbar anchor', () => {
  // On most list pages it wraps the results...
  assert.ok(listPage.includes('data-rr-paginate-content'));
  assert.ok(listPage.includes('data-rr-paginate-items-container'));
  assert.ok(
    listPage.indexOf('data-rr-paginate-id') < listPage.indexOf('class="fiction-list'),
    'list sits inside the paginate root'
  );

  // ...but on /fictions/search it is a footer widget *after* the results, with
  // neither a content wrapper nor an items container. Anchoring the toolbar to
  // it there would drop the toolbar at the bottom of the page.
  assert.equal(count(searchPage, 'data-rr-paginate-content'), 0);
  assert.equal(count(searchPage, 'data-rr-paginate-items-container'), 0);
  assert.ok(
    searchPage.indexOf('class="fiction-list') < searchPage.indexOf('data-rr-paginate-id'),
    'search: results come before the paginate widget'
  );

  // The id is no better a hook: stable everywhere except search.
  assert.ok(listPage.includes('data-rr-paginate-id="fiction-list-paginate"'));
  assert.doesNotMatch(searchPage, /data-rr-paginate-id="fiction-list-paginate"/);
  assert.match(searchPage, /data-rr-paginate-id="[0-9a-f]{32}"/);
});

test('list cards carry one card wrapper per fiction', () => {
  assert.equal(count(listPage, 'class="fiction-card-expanded"'), 50);
  assert.equal(count(listPage, 'data-rr-expanded-fic-card'), 50);
  assert.equal(count(searchPage, 'class="fiction-card-expanded"'), 20);
  // A single [data-rr-paginate-item] wraps them all - the per-fiction unit is
  // the card, not the paginate item.
  assert.equal(count(listPage, 'data-rr-paginate-item='), 1);
});

test('the show-more widget is the pure-CSS checkbox both features rely on', () => {
  assert.equal(count(listPage, 'data-rr-show-more='), 50);
  // Counted with ="true" because the bare attribute name also appears inside
  // Royal Road's Tailwind arbitrary-variant class names, three times per card.
  assert.equal(count(listPage, `${SEL.showMoreContent.slice(1, -1)}="true"`), 50);
  assert.equal(count(listPage, `${SEL.showMoreWrapper.slice(1, -1)}="true"`), 50);
  assert.ok(listPage.includes(SEL.showMoreGradient.slice(1)), 'gradient-wrapper');

  // A sr-only checkbox drives it, with the fiction id in its own id.
  assert.match(listPage, /<input type="checkbox" id="show-more-blurb-\d+" class="peer sr-only"/);
  assert.equal(count(listPage, `id="${SEL.blurbCheckboxPrefix}`), 50);

  // The collapsed height is a plain inline style - NOT !important - which is
  // exactly why a single !important override in inject.css can beat it.
  assert.match(listPage, /style="max-height: 96px;[^"]*" data-rr-show-more-content/);
  assert.doesNotMatch(listPage, /max-height: 96px !important/);

  // Royal Road's own expanded value, which inject.css matches so the two agree.
  // (`&` arrives HTML-escaped inside the class attribute, hence the trimmed needle.)
  assert.ok(listPage.includes(':has(input:checked)_[data-rr-show-more-content]]:!max-h-[9999px]'));
  // And the class their JS adds when a blurb is short enough not to need this.
  assert.ok(listPage.includes('show-more-not-needed'));
});

test('latest-updates has cards but no descriptions, so expand features no-op there', () => {
  assert.ok(count(latestUpdates, 'data-rr-expanded-fic-card') > 0);
  assert.equal(count(latestUpdates, 'data-rr-show-more='), 0);
});

test('home uses its own card variants, and its splash carousel is not fictions', () => {
  assert.ok(home.includes('fiction-card-horizontal'));
  assert.ok(home.includes('fiction-update-card'));
  assert.ok(home.includes('class="fiction-carousel"'));

  // Scoping the carousel selector to .fiction-carousel matters: the splash
  // carousel's slides are blog posts and would otherwise be hideable.
  assert.ok(home.includes('home-splash-carousel'));
  assert.ok(CARD_VARIANTS.includes('.fiction-carousel [data-rr-carousel-item]'));
  assert.ok(!CARD_VARIANTS.includes('[data-rr-carousel-item]'), 'must stay scoped');
});

test('fiction-page recommendations are React-rendered, so only CSS can reach them', () => {
  // Empty in the server HTML - a DOM-walking approach would find nothing.
  assert.match(fictionPage, /<div id="recommendations"><\/div>/);
  assert.ok(CARD_VARIANTS.includes('.recommendations-carousel .slick-slide'));
});

test('every fiction card links to /fiction/{id}/, which is what hiding matches on', () => {
  for (const [name, html] of Object.entries({ listPage, latestUpdates, home })) {
    assert.match(html, /href="\/fiction\/\d+\//, `${name}: canonical fiction link`);
  }
  // Tag and bookmark URLs live under /fictions/ and so cannot collide.
  assert.ok(listPage.includes('/fictions/search?tagsAdd='));
  assert.ok(listPage.includes('/fictions/setbookmark/'));
});

test('every statistic we read is still labelled the way we look it up', () => {
  // The tiles carry no id and no data-rr- hook, so the label text is the whole
  // contract. A rename here is the one change that breaks the readout, and it
  // has to fail loudly rather than quietly reading fewer numbers.
  for (const label of Object.keys(FICTION_STATS)) {
    // "Ratings" is the exception: the Overall Score panel repeats it as its own
    // heading, which is why the read climbs a bounded distance and why the tile
    // has to come first in document order.
    const expected = label === 'Ratings' ? 2 : 1;
    assert.equal(count(fictionPage, `>${label}<`), expected, `stat label: ${label}`);
  }

  // The panel around them, and the two numbers that are not tiles. Both ids are
  // written twice - Royal Road repeats each as a `data-rr-*-id` on the same
  // element - so two occurrences is one element, not two.
  assert.equal(count(fictionPage, 'id="stats-accordion"'), 2);
  assert.equal(count(fictionPage, 'id="fiction-rating-tooltip"'), 2);
  assert.match(fictionPage, /id="chapters" data-chapters="\d+"/);
  // The score, to two decimals. Royal Road renders the rounded one as star
  // geometry and never writes it as text.
  assert.match(fictionPage, /"aggregateRating":\{[^}]*"ratingValue":\d+\.\d\d/);
  assert.equal(count(fictionPage, 'data-rr-initial-rating="4.83"'), 0, 'the attribute is rounded');
});

test('Royal Road still ships Statistics closed, which decides where the readout goes', () => {
  // If this ever flips to open, the readout could move inside the panel. Until
  // then, anything in there is invisible on a default install.
  const at = fictionPage.indexOf('id="stats-accordion"');
  const panel = fictionPage.slice(at, at + 4000);
  assert.match(panel, /aria-expanded="false"/);
  assert.match(panel, /data-rr-accordion-content-state="closed"/);
});

test('the new-UI probe matches every redesign page we support', () => {
  const probes = SEL.newUiProbe.split(',').map((s) => s.trim());
  const asSubstring = (probe) => probe.replace(/^[[.]/, '').replace(/]$/, '');
  for (const [name, html] of Object.entries({ listPage, home, fictionPage })) {
    const hit = probes.some((p) => html.includes(asSubstring(p)));
    assert.ok(hit, `${name}: no probe matched`);
  }
});
