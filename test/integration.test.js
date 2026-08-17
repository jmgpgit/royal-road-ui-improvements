'use strict';

/**
 * End-to-end-ish: boots the whole content script, in the order manifest.json
 * declares, against a real captured page inside jsdom.
 *
 * The unit suites prove each module in isolation; this one proves they load in a
 * working order, find each other on `RRX`, and survive a real page without
 * throwing, which is the class of bug no amount of pure testing catches.
 *
 * Script order is read from the manifest rather than duplicated here, so a file
 * added to one and not the other fails the suite.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const SKIP = need(
  'fictions-rising-stars.new.html',
  'fictions-rising-stars.legacy.html',
  'chapter.new.html',
  'fiction-detail.new.html',
  'fictions-search.new.html',
  // The only capture with real pagination, so the only one infinite scroll has
  // a next page to fetch on.
  'fictions-weekly-popular.new.html'
);
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

/** Every content script, both batches, in manifest order. */
const SCRIPTS = manifest.content_scripts.flatMap((entry) => entry.js);

/**
 * Booting the real content script leaves live timers and a MutationObserver in
 * each jsdom window (the filter watchdog, the undo toast, the sweep debounce).
 * Those keep Node's event loop open, so the suite has to close its windows or
 * the process never exits even though every test has passed.
 */
const windows = [];
nodeTest.after(() => {
  for (const w of windows) {
    try {
      w.close();
    } catch {
      /* already gone */
    }
  }
});

/**
 * Boot the extension over a fixture.
 * @param {object} [settings] seeded into the fake storage
 */
async function boot(fixtureName, url, settings = {}, hidden = {}, dropped = {}, stats = {}) {
  // These documents run to 1.8 MB each and the suite booted one per test, all
  // held until the file finished - which eventually exhausted the heap rather
  // than failing any single test. Tests in a file run one at a time, so anything
  // from a finished one is dead weight; `after` still sweeps what is left.
  while (windows.length > 1) {
    try {
      windows.shift().close();
    } catch {
      /* already gone */
    }
  }

  const dom = new JSDOM(fixture(fixtureName), { url, runScripts: 'outside-only' });
  const w = dom.window;
  windows.push(w);

  const store = { settings, hidden, dropped, stats };
  w.eval(`globalThis.__store = ${JSON.stringify(store)};`);
  w.eval(`globalThis.browser = {
    storage: {
      local: {
        get: async (keys) => JSON.parse(JSON.stringify(globalThis.__store)),
        set: async (patch) => Object.assign(globalThis.__store, patch),
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: { getURL: (p) => p, sendMessage: async () => {}, onMessage: { addListener() {} } },
  };`);

  // No test may touch the network. Two code paths would otherwise: the tag
  // catalogue (fetched when the filter panel opens on a page without Royal
  // Road's #tagsAdd select) and the load-more crawler.
  //
  // The stub is installed *inside* the jsdom realm rather than assigned from
  // here: assigning `w.fetch` from Node does not replace what code eval'd in
  // that realm resolves, so the real network call still went out and left the
  // test process hanging on an open socket.
  w.__searchHtml = fixture('fictions-search.new.html');
  w.__listHtml = fixture('fictions-rising-stars.new.html');
  w.eval(`
    globalThis.__fetched = [];
    globalThis.fetch = async (url) => {
      globalThis.__fetched.push(String(url));
      const body = String(url).includes('/fictions/search')
        ? globalThis.__searchHtml
        : globalThis.__listHtml;
      return { ok: true, status: 200, text: async () => body };
    };
  `);

  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  const warn = [];
  w.console.warn = (...args) => warn.push(args.join(' '));

  for (const file of SCRIPTS) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));

  // main.js kicks off an async init; let it settle.
  if (w.RRX.boot && w.RRX.boot.ready) await w.RRX.boot.ready;
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { w, errors, warn };
}

const toolbar = (w) => w.document.getElementById('rrx-toolbar');
const visibleCards = (w) =>
  [...w.document.querySelectorAll('.fiction-card-expanded')].filter(
    (c) => !c.classList.contains('rrx-filtered')
  );

test('the full content script boots a list page without errors', async () => {
  const { w, errors } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );

  assert.deepEqual(errors, []);
  assert.equal(w.RRX.main.ctx.page, 'list');
  assert.equal(w.RRX.main.ctx.isListPage, true);
  assert.ok(w.document.documentElement.classList.contains('rrx-ready'), 'marked ready');
});

test('the toolbar renders with the expected controls', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  const bar = toolbar(w);
  assert.ok(bar, 'toolbar exists');

  const toggles = [...bar.querySelectorAll('[data-rrx-toggle]')].map((b) => b.dataset.rrxToggle);
  assert.ok(toggles.includes('expandAll'));
  assert.ok(toggles.includes('hoverExpand'));
  assert.ok(toggles.includes('showHidden'));
  assert.ok(toggles.includes('filters'));
  assert.ok(bar.querySelector('[data-rrx-action="manage"]'), 'manage button');

  // It must sit above the cards it applies to.
  const firstCard = w.document.querySelector('.fiction-card-expanded');
  assert.ok(
    bar.compareDocumentPosition(firstCard) & w.Node.DOCUMENT_POSITION_FOLLOWING,
    'toolbar precedes the first card'
  );
});

test('every card gets a hide button and a parsed record', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  assert.equal(w.document.querySelectorAll('[data-rrx-fid]').length, 50);
  assert.equal(w.document.querySelectorAll('.rrx-card-btn').length, 50);
});

test('a stored filter narrows the page, and the toolbar says by how much', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    { 'filters.minRating': 4.5 }
  );

  const all = w.document.querySelectorAll('.fiction-card-expanded').length;
  const shown = visibleCards(w).length;
  assert.ok(shown > 0 && shown < all, `expected some filtering, got ${shown}/${all}`);
  // Re-wrapped: objects built inside jsdom carry its prototypes, which strict
  // deepEqual rejects.
  assert.deepEqual(JSON.parse(JSON.stringify(w.RRX.main.ctx.filterCounts)), {
    total: all,
    shown,
  });

  const count = toolbar(w).querySelector('.rrx-toolbar__count');
  assert.ok(count, 'count is reported');
  assert.equal(count.textContent, `${shown} of ${all}`);
});

test('the pre-paint list guard is set only when filtering, and always cleared', async () => {
  const plain = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  assert.equal(
    plain.w.document.documentElement.classList.contains('rrx-filters-pending'),
    false,
    'no filters, so the list is never held back'
  );

  const filtered = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    { 'filters.minRating': 4.5 }
  );
  assert.equal(
    filtered.w.document.documentElement.classList.contains('rrx-filters-pending'),
    false,
    'the guard must be cleared once the first pass lands'
  );
});

test('the filter panel opens, applies, and clears', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  const button = toolbar(w).querySelector('[data-rrx-toggle="filters"]');

  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(w.RRX.panel.isOpen(), 'panel opened');
  assert.ok(w.document.querySelector('#rrx-filter-panel input[data-rrx-key]'), 'has fields');

  const min = w.document.querySelector('[data-rrx-key="filters.minRating"]');
  min.value = '4.5';
  min.dispatchEvent(new w.Event('input', { bubbles: true }));

  const apply = [...w.document.querySelectorAll('#rrx-filter-panel button')].find(
    (b) => b.textContent === 'Apply'
  );
  apply.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(w.RRX.panel.isOpen(), false, 'panel closes on apply');
  assert.equal(w.RRX.main.ctx.settings['filters.minRating'], 4.5);
  assert.ok(visibleCards(w).length < 50, 'the page actually narrowed');
});

test('number fields cannot offer a value the filter would reject', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  toolbar(w)
    .querySelector('[data-rrx-toggle="filters"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  // Rating spun off in both directions before this: the schema knows the bound,
  // so the control should too.
  const min = w.document.querySelector('[data-rrx-key="filters.minRating"]');
  assert.equal(min.getAttribute('min'), '0');
  assert.equal(min.getAttribute('max'), '5');

  for (const input of w.document.querySelectorAll('#rrx-filter-panel input[type="number"]')) {
    assert.ok(input.hasAttribute('min'), `${input.dataset.rrxKey}: no min`);
    assert.ok(input.hasAttribute('max'), `${input.dataset.rrxKey}: no max`);
  }
});

test('the filter panel is grouped rather than one flat run of fields', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  toolbar(w)
    .querySelector('[data-rrx-toggle="filters"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  const titles = [...w.document.querySelectorAll('#rrx-filter-panel .rrx-group__title')].map((h) =>
    h.textContent
  );
  assert.deepEqual(titles, ['Score and size', 'Tags', 'Kind', 'Activity']);
});

test('tags are picked from Royal Road’s vocabulary, by label, stored as slug', async () => {
  const { w } = await boot(
    'fictions-search.new.html',
    'https://www.royalroad.com/fictions/search?tagsAdd=litrpg'
  );
  // The search page carries the #tagsAdd select, so the catalogue is free here.
  assert.ok(w.RRX.tags.harvest().length > 20, 'tag vocabulary harvested from the page');

  // "Romance Subplot" is stored as `romance`: exactly the sort of mismatch that
  // made typing slugs by hand a trap.
  assert.equal(w.RRX.tags.slugFor('Romance Subplot'), 'romance');
  assert.equal(w.RRX.tags.labelFor('romance'), 'Romance Subplot');
  assert.equal(w.RRX.tags.slugFor('not a real tag'), null);

  toolbar(w)
    .querySelector('[data-rrx-toggle="filters"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  const input = w.document.querySelector('#rrx-filter-panel input[role="combobox"]');
  assert.ok(input, 'a combobox, not a native datalist');

  const menu = () => [...input.parentElement.querySelectorAll('.rrx-combo__item')];
  const chips = () =>
    [...w.document.querySelectorAll('#rrx-filter-panel .rrx-chip--on')].map((c) => c.textContent);

  // Several tags in a row, without retyping between them - the whole reason a
  // native <datalist> was the wrong control here.
  for (const label of ['Romance Subplot', 'Adventure', 'Magic']) {
    input.value = label;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const hit = menu().find((b) => b.textContent === label);
    assert.ok(hit, `"${label}" offered in the dropdown`);
    hit.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.equal(input.value, '', 'input clears, ready for the next');
  }
  assert.equal(chips().length, 3, 'three chips accumulated');

  const apply = [...w.document.querySelectorAll('#rrx-filter-panel button')].find(
    (b) => b.textContent === 'Apply'
  );
  apply.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Stored as slugs, including "Adventure" - a genre, which lives only on the
  // cards and not in Royal Road's tag select.
  assert.deepEqual(JSON.parse(JSON.stringify(w.RRX.main.ctx.settings['filters.tagsAll'])), [
    'romance',
    'adventure',
    'magic',
  ]);
});

test('changing the view while the panel is open updates the toolbar label', async () => {
  // The bug: the toolbar refused to rebuild while the panel was open, so the
  // view changed but its button still read "Cards".
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  const label = () => toolbar(w).querySelector('[data-rrx-toggle="view"] .rrx-badge').textContent;
  assert.equal(label(), 'Cards');

  toolbar(w)
    .querySelector('[data-rrx-toggle="filters"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(w.RRX.panel.isOpen());

  toolbar(w)
    .querySelector('[data-rrx-toggle="view"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(label(), 'Compact', 'the label follows the setting');
  assert.ok(w.RRX.panel.isOpen(), 'and the panel survives the rebuild');
});

test('hiding a fiction through the button removes it and records it', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  const card = w.document.querySelector('[data-rrx-fid]');
  const id = Number(card.dataset.rrxFid);

  card.querySelector('.rrx-card-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(w.RRX.main.ctx.hiddenSet.has(id), 'recorded as hidden');
  const css = w.document.getElementById('rrx-hide-style').textContent;
  assert.ok(css.includes(`/fiction/${id}/`), 'the generated rule targets it');
  assert.ok(w.document.getElementById('rrx-toast'), 'an undo toast is offered');
});

test('dropping a fiction dims its card and leaves it in the list', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    { 'drop.enabled': true }
  );
  const card = w.document.querySelector('[data-rrx-fid]');
  const id = Number(card.dataset.rrxFid);
  const before = w.document.querySelectorAll('.fiction-card-expanded').length;

  card
    .querySelector('[data-rrx-btn="drop"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(w.RRX.main.ctx.droppedSet.has(id), 'recorded as dropped');
  const css = w.document.getElementById('rrx-hide-style').textContent;
  assert.ok(css.includes(`/fiction/${id}/`), 'the generated rule targets it');
  assert.equal(css.includes('display:none'), false, 'and does not remove it');
  assert.equal(
    w.document.querySelectorAll('.fiction-card-expanded').length,
    before,
    'the card is still on the page'
  );
  assert.ok(card.querySelector('.rrx-dropped-badge'), 'and says why it is dimmed');
  assert.ok(w.document.getElementById('rrx-toast'), 'an undo toast is offered');
});

test('switching the feature off stops the marking, but not a filter asked for', async () => {
  // `drop.enabled` decides whether the button and the dimming appear. It used to
  // gate the filter too, so that one switch turned everything off - but the
  // panel offers the Dropped chip whatever the switch says and the toolbar
  // counts it as narrowing the list, so an explicitly chosen filter silently did
  // nothing.
  const stored = { title: 'X', url: '/fiction/1', cover: '', droppedAt: 1 };
  const url = 'https://www.royalroad.com/fictions/rising-stars';
  const settings = { 'drop.enabled': true, 'filters.hideMine': ['dropped'] };

  const on = await boot('fictions-rising-stars.new.html', url, settings, {}, {});
  const id = Number(on.w.document.querySelector('[data-rrx-fid]').dataset.rrxFid);
  const total = on.w.document.querySelectorAll('.fiction-card-expanded').length;

  const filtered = await boot('fictions-rising-stars.new.html', url, settings, {}, { [id]: stored });
  assert.equal(visibleCards(filtered.w).length, total - 1, 'the dropped card is filtered out');

  const off = await boot(
    'fictions-rising-stars.new.html',
    url,
    { ...settings, 'drop.enabled': false },
    {},
    { [id]: stored }
  );
  assert.equal(
    visibleCards(off.w).length,
    total - 1,
    'still filtered: that is what the reader asked the panel for'
  );
  assert.equal(off.w.document.getElementById('rrx-hide-style').textContent, '', 'but not dimmed');
  assert.equal(off.w.document.querySelector('[data-rrx-btn="drop"]'), null, 'and no control');
});

test('the load-more bar appears only when filters could be hiding further pages', async () => {
  // rising-stars is a single page of 50, so there is nothing further to scan.
  const single = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    { 'filters.minRating': 4.5 }
  );
  assert.equal(single.w.document.getElementById('rrx-loadmore'), null);

  // ...and with no filters at all there is nothing to load *more* of, either.
  const unfiltered = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  assert.equal(unfiltered.w.document.getElementById('rrx-loadmore'), null);
});

test('v1 settings still drive v2 behaviour end to end', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    { expandAll: true, hoverDelayMs: 300 }
  );
  const html = w.document.documentElement;
  assert.ok(html.classList.contains('rrx-expand-all'), 'legacy expandAll still applies');
  assert.equal(html.style.getPropertyValue('--rrx-hover-delay'), '300ms');
});

test('a chapter page boots, and reader overrides reach the DOM', async () => {
  const { w, errors } = await boot(
    'chapter.new.html',
    'https://www.royalroad.com/fiction/149588/one-was-worthy-book-one-complete/chapter/3766643/24-alone-at-home',
    {
      'reader.enabled': true,
      'reader.lineHeight': 1.9,
      'reader.justify': true,
      'reader.maxWidthPx': 1600,
      'notes.mode': 'shoutouts',
    }
  );

  assert.deepEqual(errors, []);
  assert.equal(w.RRX.main.ctx.page, 'chapter');

  const html = w.document.documentElement;
  assert.ok(html.classList.contains('rrx-line-height'));
  assert.ok(html.classList.contains('rrx-justify'));
  assert.ok(html.classList.contains('rrx-hyphens'));
  assert.ok(html.classList.contains('rrx-wide'));
  assert.equal(html.style.getPropertyValue('--rrx-line-height'), '1.9');
  assert.equal(html.style.getPropertyValue('--rrx-reader-max'), '1600px');

  // The shoutout-only note collapsed; the genuine note did not.
  assert.equal(w.document.querySelectorAll('.rrx-note-chip').length, 1);

  // No list furniture leaks onto a chapter.
  assert.equal(toolbar(w), null);
});

test('turning the reader off clears its classes and its custom properties', async () => {
  const { w } = await boot(
    'chapter.new.html',
    'https://www.royalroad.com/fiction/149588/one-was-worthy-book-one-complete/chapter/3766643/24-alone-at-home',
    { 'reader.lineHeight': 1.9, 'reader.maxWidthPx': 1600 } // values set, master switch off
  );
  const html = w.document.documentElement;
  assert.ok(!html.classList.contains('rrx-line-height'), 'gated behind reader.enabled');
  assert.ok(!html.classList.contains('rrx-wide'));
  assert.equal(html.style.getPropertyValue('--rrx-line-height'), '');
  assert.equal(html.style.getPropertyValue('--rrx-reader-max'), '');
});

const expanded = (w, id) =>
  w.document.querySelector(`#${id} [data-rr-accordion-trigger]`).getAttribute('aria-expanded');

test('a fiction page boots, and leaving accordions alone really does nothing', async () => {
  const { w, errors } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning'
  );
  assert.deepEqual(errors, []);
  assert.equal(w.RRX.main.ctx.page, 'fiction');

  // Royal Road's own defaults, untouched: four open, Statistics closed. This is
  // exactly why the old boolean "open by default" was a no-op on most of them.
  assert.equal(expanded(w, 'about-accordion'), 'true');
  assert.equal(expanded(w, 'chapters-accordion'), 'true');
  assert.equal(expanded(w, 'reviews-accordion'), 'true');
  assert.equal(expanded(w, 'recommendations-accordion'), 'true');
  assert.equal(expanded(w, 'stats-accordion'), 'false');
});

test('an accordion can be forced open, and one that is open can be forced shut', async () => {
  const { w } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning'
  );

  // jsdom has no Royal Road accordion script, so drive the trigger's own
  // contract directly: the feature must click a trigger whose state is wrong,
  // and leave alone one that is already right.
  const clicks = [];
  for (const id of ['stats-accordion', 'about-accordion', 'chapters-accordion']) {
    w.document
      .querySelector(`#${id} [data-rr-accordion-trigger]`)
      .addEventListener('click', () => clicks.push(id));
  }

  w.RRX.fictionPage.setAccordion('stats-accordion', 'open'); // closed -> needs a click
  w.RRX.fictionPage.setAccordion('about-accordion', 'closed'); // open   -> needs a click
  w.RRX.fictionPage.setAccordion('chapters-accordion', 'open'); // already open -> no click

  assert.deepEqual(clicks.sort(), ['about-accordion', 'stats-accordion']);
});

test('an accordion already in the wanted state is marked done, not clicked forever', async () => {
  const { w } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning'
  );
  let clicks = 0;
  w.document
    .querySelector('#chapters-accordion [data-rr-accordion-trigger]')
    .addEventListener('click', () => {
      clicks += 1;
    });

  w.RRX.fictionPage.setAccordion('chapters-accordion', 'open');
  w.RRX.fictionPage.setAccordion('chapters-accordion', 'open');
  assert.equal(clicks, 0, 'already open, so never clicked');

  // The state has to hold across two polls before we stop watching - one poll
  // could just be catching Royal Road mid-flip.
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(
    w.document.getElementById('chapters-accordion').getAttribute('data-rrx-accordion'),
    'open'
  );
  assert.equal(clicks, 0, 'and still never clicked');
});

test('a first visit records the numbers and says nothing', async () => {
  const { w, errors } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning',
    { 'fiction.statDeltas': true }
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(errors, []);
  assert.equal(w.document.getElementById('rrx-stat-delta'), null, 'nothing to compare against yet');

  const stored = w.__store.stats[21220];
  assert.ok(stored && stored.now, 'but the visit was recorded');
  assert.equal(stored.now.f, 32866, 'with the followers off the page');
  assert.equal(stored.now.s, 4.83, 'and the two-decimal score');
  assert.equal(stored.prev, undefined, 'and no baseline, since this was the first look');
});

test('opening the same fiction twice in one sitting is enough to get an answer', async () => {
  // The journey that was broken: switch the feature on, open a fiction, open it
  // again. Every visit overwrote the last reading and none of them established a
  // baseline, so the readout could not appear until the next day.
  const url = 'https://www.royalroad.com/fiction/21220/mother-of-learning';
  const settings = { 'fiction.statDeltas': true };

  const first = await boot('fiction-detail.new.html', url, settings);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const carried = JSON.parse(JSON.stringify(first.w.__store.stats));
  assert.ok(carried[21220].now, 'the first visit was recorded');

  // Second visit, minutes later. The capture cannot change between the two, so
  // the first reading is doctored instead: the same page now reads as a fiction
  // that has gained a chapter and a follower since.
  carried[21220].now.c -= 1;
  carried[21220].now.f -= 1;

  const second = await boot('fiction-detail.new.html', url, settings, {}, {}, carried);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(second.w.__store.stats[21220].prev, 'the earlier reading became the baseline');
  const line = second.w.document.getElementById('rrx-stat-delta');
  assert.ok(line, 'and the readout appears on the second visit');
  assert.match(line.textContent, /\+1 chapter\b/);
  assert.match(line.textContent, /\+1 follower\b/);
  // Minutes old, so it says a time rather than today's date, which would read
  // as a bug on the day it was written.
  assert.match(line.textContent, /^Since \d/);
});

test('coming back says what moved, and nothing while the feature is off', async () => {
  const url = 'https://www.royalroad.com/fiction/21220/mother-of-learning';
  // A look from two days ago, when it had 500 fewer followers and a lower score.
  const then = Math.floor(Date.now() / 1000) - 2 * 24 * 3600;
  const seed = () => ({
    21220: { now: { a: then, f: 32366, m: 31777, s: 4.81, c: 106, p: 2932, r: 17316, v: 27778323 } },
  });

  const { w } = await boot('fiction-detail.new.html', url, { 'fiction.statDeltas': true }, {}, {}, seed());
  await new Promise((resolve) => setTimeout(resolve, 20));

  const line = w.document.getElementById('rrx-stat-delta');
  assert.ok(line, 'the readout is on the page');
  assert.match(line.textContent, /\+500 followers/);
  assert.match(line.textContent, /\+3 chapters/);
  assert.match(line.textContent, /\+0\.02 score/, 'the rounded 4.8 could never show this');
  assert.equal(/favourites/.test(line.textContent), false, 'and stays quiet about what did not move');

  // It sits where it can be read: outside the trigger, above the panel Royal
  // Road ships closed.
  const content = w.document.querySelector('#stats-accordion [data-rr-accordion-content]');
  assert.equal(line.nextElementSibling, content);
  assert.equal(line.closest('[data-rr-accordion-trigger]'), null);

  // The baseline rolled forward, so the record now compares against today.
  assert.equal(w.__store.stats[21220].prev.f, 32366);
  assert.equal(w.__store.stats[21220].now.f, 32866);

  const off = await boot('fiction-detail.new.html', url, { 'fiction.statDeltas': false }, {}, {}, seed());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(off.w.document.getElementById('rrx-stat-delta'), null, 'nothing shown');
  assert.deepEqual(
    off.w.__store.stats[21220].now.a,
    then,
    'and nothing recorded: the stored look is untouched'
  );
});

test('the tag cache ages from when it was fetched, not from when it was last used', async () => {
  // `save` rewrites the key on every read of the cache and on any page carrying
  // tag chips. Stamping those with "now" made the week count from the last time
  // the filter panel was opened, so a reader who opened it weekly never
  // refreshed - the cache aged only while it went unused.
  const eightDays = Date.now() - 8 * 24 * 3600 * 1000;
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  w.__store.tagCatalogue = { at: eightDays, tags: [{ slug: 'litrpg', label: 'LitRPG' }] };

  await w.RRX.tags.load();
  assert.equal(
    w.__store.tagCatalogue.at,
    eightDays,
    'using the cache does not make it look freshly fetched'
  );
  // Whether it refetches is not asserted here: this capture carries 73 distinct
  // tag slugs on its cards, one over the threshold at which `load` returns
  // without consulting the cache at all.
});

test('the stored maps age out even with every feature that fills them off', async () => {
  // The prunes live inside the write paths, and every write path is behind a
  // setting. With those off nothing wrote and so nothing expired either: what
  // was there stayed for good. Housekeeping is what makes the expiry real.
  const year = 400 * 24 * 3600;
  const old = Math.floor(Date.now() / 1000) - year;
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    {}, // every reading feature at its default, which is off
    {},
    {},
    { 21220: { now: { a: old, f: 100 } } }
  );
  // Booting a page is enough to have run it once, which is the point.
  assert.ok(w.__store.tidiedAt, 'every page load offers to tidy');

  w.__store.chapters = { 3766643: { f: 9, a: old, p: 42, o: 0.5 } };
  delete w.__store.tidiedAt; // as if a day had passed
  assert.equal(await w.RRX.store.tidy(), true, 'it ran');
  assert.equal(Object.keys(w.__store.chapters).length, 0, 'the stale chapter went');
  assert.equal(Object.keys(w.__store.stats).length, 0, 'and the stale fiction');

  // Once a day, not once a page: this reads two maps that reach megabytes.
  assert.equal(await w.RRX.store.tidy(), false, 'not again today');
});

test('housekeeping does not clobber a record written while it was deciding', async () => {
  // It runs at document_end alongside the features that write these maps, and
  // the write is the whole map: a reading recorded between the read and the
  // write was read back stale and dropped by the prune that had already run.
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  const stale = Math.floor(Date.now() / 1000) - 400 * 24 * 3600;
  w.__store.stats = { 1: { now: { a: stale, f: 1 } } };
  delete w.__store.tidiedAt;

  // A page records while housekeeping is mid-flight.
  const housekeeping = w.RRX.store.tidy();
  await w.RRX.store.markFictionStats(21220, { f: 32866 });
  await housekeeping;

  assert.ok(w.__store.stats[21220], 'the fresh reading survived');
  assert.equal(w.__store.stats[1], undefined, 'and the stale one still went');
});

test('housekeeping prunes against the reader’s own expiry, not the built-in one', async () => {
  // The 1.4.1 bug from the other direction: a writer that omits the setting
  // prunes the whole map against the default, silently overriding the choice.
  const days = (n) => Math.floor(Date.now() / 1000) - n * 24 * 3600;
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    { 'comments.seenDays': 300 }
  );
  // 200 days old: past the built-in 60, well inside the 300 the reader chose.
  w.__store.chapters = { 3766643: { f: 9, a: days(200), s: days(200) } };
  delete w.__store.tidiedAt;

  await w.RRX.store.tidy();
  assert.ok(w.__store.chapters[3766643], 'kept, because the reader asked for 300 days');
  assert.equal(w.__store.chapters[3766643].s, days(200), 'watermark and all');
});

test('resetting and importing delete the readings too, not just the toggle', async () => {
  // saveSettings noticed the on->off transition; resetSettings writes the
  // settings key directly and import replaces it wholesale, so both reached
  // "off" without ever cleaning up after it.
  const url = 'https://www.royalroad.com/fiction/21220/mother-of-learning';
  const seeded = { 21220: { now: { a: Math.floor(Date.now() / 1000), f: 32366 } } };

  const reset = await boot('fiction-detail.new.html', url, { 'fiction.statDeltas': true }, {}, {}, seeded);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await reset.w.RRX.store.resetSettings();
  assert.equal(Object.keys(reset.w.__store.stats).length, 0, 'reset turns it off, so it clears');

  // ...and a backup carrying readings alongside a setting that says they are
  // not kept: the setting wins, or import would be a way back in.
  const imported = await boot('fiction-detail.new.html', url, { 'fiction.statDeltas': true }, {}, {}, seeded);
  const state = await imported.w.RRX.store.replaceAll({
    settings: { 'fiction.statDeltas': false },
    stats: seeded,
  });
  assert.equal(Object.keys(imported.w.__store.stats).length, 0, 'not restored behind the setting');
  assert.equal(Object.keys(state.stats).length, 0, 'and the caller is told so');
});

test('switching the readings off deletes them', async () => {
  // The map is pruned only when a reading is written, so with the feature off
  // nothing would ever touch it again: what was there would sit in storage for
  // good, whatever "forgotten after a year" claimed.
  const url = 'https://www.royalroad.com/fiction/21220/mother-of-learning';
  const seeded = { 21220: { now: { a: 1_700_000_000, f: 32366 } } };
  const { w } = await boot('fiction-detail.new.html', url, { 'fiction.statDeltas': true }, {}, {}, seeded);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(w.__store.stats[21220], 'seeded');

  await w.RRX.store.saveSettings({ 'fiction.statDeltas': false });
  // Counted rather than deepEqual'd: a jsdom `{}` is not strictly equal to one
  // built out here.
  assert.equal(Object.keys(w.__store.stats).length, 0, 'off means gone, not merely paused');

  // Turning something else off leaves it alone.
  await w.RRX.store.saveSettings({ 'fiction.statDeltas': true });
  await w.RRX.store.markFictionStats(21220, { f: 1 });
  await w.RRX.store.saveSettings({ 'list.expandAll': false });
  assert.ok(w.__store.stats[21220], 'an unrelated setting change keeps them');
});

test('a section forced open survives Royal Road re-closing it after init', async () => {
  // The "About Fiction never opens" bug. Royal Road server-renders it open, so
  // the watcher used to see "already correct", mark it done and stop: then its
  // deferred script initialised and shut it, with nothing left to object.
  const { w } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning'
  );

  const acc = w.document.getElementById('about-accordion');
  const trigger = acc.querySelector('[data-rr-accordion-trigger]');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'starts open in the server HTML');

  // Stand in for Royal Road's accordion script: a click toggles the state.
  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  w.RRX.fictionPage.setAccordion('about-accordion', 'open');

  // ...and now it closes it, exactly as the real script does on init.
  trigger.setAttribute('aria-expanded', 'false');

  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(
    trigger.getAttribute('aria-expanded'),
    'true',
    'the watcher must notice and re-open it'
  );
});

test('a real click from the reader stops the extension fighting back', async () => {
  const { w } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning'
  );
  const acc = w.document.getElementById('chapters-accordion');
  const trigger = acc.querySelector('[data-rr-accordion-trigger]');
  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  w.RRX.fictionPage.setAccordion('chapters-accordion', 'open');
  // isTrusted is false for dispatched events, so mark it the way a real one would.
  w.RRX.fictionPage.userTouched.add('chapters-accordion');
  trigger.setAttribute('aria-expanded', 'false');

  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'left closed, as the reader asked');
});

test('the review accordion is offered, and its absence is harmless', async () => {
  const { w, errors } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning',
    { 'fiction.writeReview': 'open' }
  );
  assert.deepEqual(errors, []);
  assert.ok(
    Object.values(w.RRX.FICTION_ACCORDIONS).includes('fiction.writeReview'),
    'Leave A Review is controllable'
  );
  // Logged out it is simply not rendered; that must not throw.
  w.RRX.fictionPage.setAccordion('write-a-review-accordion', 'open');
});

test('the legacy UI boots to a complete no-op', async () => {
  const { w, errors } = await boot(
    'fictions-rising-stars.legacy.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  assert.deepEqual(errors, []);
  assert.equal(toolbar(w), null, 'no toolbar');
  assert.equal(w.document.querySelectorAll('.rrx-card-btn').length, 0, 'no buttons');
  assert.equal(w.document.querySelectorAll('[data-rrx-fid]').length, 0, 'nothing tagged');
  assert.equal(w.document.documentElement.classList.contains('rrx-ready'), false);
});

test('a settled page stops mutating, so the sweep cannot feed itself', async () => {
  // The observer schedules a sweep whenever an element is added. Anything the
  // sweep itself inserts unconditionally therefore schedules the next one, and
  // the page never goes quiet: a permanent full-document sweep, worst exactly
  // when infinite scroll has grown the list to its largest.
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars',
    { 'filters.enabled': true, 'filters.minRating': 4, 'list.infiniteScroll': true }
  );

  // A finished run: the status line reports the tally and stays put, which is
  // the state it lives in for the rest of the session and so the one that has
  // to be quiet.
  Object.assign(w.RRX.loadMore.state, { pages: 2, added: 7, done: 'no more results' });
  w.RRX.main.syncCards(w.document);
  const bar = w.document.getElementById('rrx-loadmore');
  assert.ok(bar, 'the status line is showing');

  // Sweeping again with nothing changed must not touch the DOM.
  let mutations = 0;
  const observer = new w.MutationObserver((records) => {
    mutations += records.length;
  });
  observer.observe(w.document.body, { childList: true, subtree: true });

  for (let i = 0; i < 5; i += 1) w.RRX.main.syncCards(w.document);
  await new Promise((r) => setTimeout(r, 0));
  observer.disconnect();

  assert.equal(mutations, 0, 'a re-sweep over an unchanged page must write nothing');
  assert.equal(w.document.getElementById('rrx-loadmore'), bar, 'and the same node survives');
});

test('the observer ignores the extension’s own controls', async () => {
  const { w } = await boot(
    'fictions-rising-stars.new.html',
    'https://www.royalroad.com/fictions/rising-stars'
  );
  // Everything injected carries the marker the observer filters on, so a
  // feature that does write on every sweep still cannot spin the page up.
  const ours = [...w.document.querySelectorAll(`.${w.RRX.UI_CLASS}`)];
  assert.ok(ours.length > 0, 'the extension injected something');
  for (const el of ours) {
    assert.ok(
      el.classList.contains(w.RRX.UI_CLASS),
      'every injected control is marked, or the observer would react to it'
    );
  }
});

// -- infinite scroll ----------------------------------------------------------

/** Boot a paginated list and pretend its bottom edge is on screen. */
async function atListBottom(settings) {
  const { w } = await boot(
    'fictions-weekly-popular.new.html',
    'https://www.royalroad.com/fictions/weekly-popular',
    settings
  );
  const list = w.document.querySelector(w.RRX.SEL.listRoot);
  list.getBoundingClientRect = () => ({ bottom: 10, top: 0, left: 0, right: 0, width: 100, height: 10 });
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });
  return w;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 900));

test('reaching the bottom loads the next page, with no filter set', async () => {
  // This was once gated on having a filter active, which made a setting called
  // "keep loading as you scroll" do nothing on an ordinary list, with no
  // toolbar button to hint that it existed.
  const w = await atListBottom({ 'list.infiniteScroll': true });
  assert.equal(w.RRX.hasActiveFilters(w.RRX.main.ctx.settings), false, 'nothing is filtered');

  const before = w.document.querySelectorAll(w.RRX.SEL.listCard).length;
  w.dispatchEvent(new w.Event('scroll'));
  await settled();

  assert.equal(w.__fetched.length, 1, 'exactly one page was requested');
  assert.match(w.__fetched[0], /[?&]page=2\b/, 'and it was the next one');
  assert.ok(
    w.document.querySelectorAll(w.RRX.SEL.listCard).length > before,
    'the cards it returned were appended'
  );
});

test('a filter still narrows what infinite scroll appends', async () => {
  const w = await atListBottom({
    'list.infiniteScroll': true,
    'filters.enabled': true,
    'filters.minRating': 4.6,
  });
  const total = () => w.document.querySelectorAll(w.RRX.SEL.listCard).length;
  const before = total();

  w.dispatchEvent(new w.Event('scroll'));
  await settled();

  assert.ok(w.__fetched.length >= 1, 'it still fetched');
  assert.ok(total() > before, 'and appended something');

  // Every card left showing has to satisfy the filter, appended or not. A card
  // whose rating cannot be read is the documented exception: a filter never
  // excludes on a field it could not parse, so a Royal Road markup change
  // degrades to "the filter does nothing" rather than "everything vanishes".
  for (const card of w.document.querySelectorAll(`${w.RRX.SEL.listCard}:not(.rrx-filtered)`)) {
    const { rating } = w.RRX.readCardData(card);
    assert.ok(
      rating === null || rating >= 4.6,
      `a visible card rated ${rating} is below the filter`
    );
  }
});

test('it stops when the setting is off', async () => {
  const w = await atListBottom({ 'list.infiniteScroll': false });
  w.dispatchEvent(new w.Event('scroll'));
  await settled();
  assert.equal(w.__fetched.length, 0, 'no request is made at all');
});

test('Royal Road’s page numbers go once we have appended beneath them', async () => {
  const w = await atListBottom({ 'list.infiniteScroll': true });
  const paginate = w.document.querySelector(w.RRX.SEL.paginateRoot);
  const footer = w.document.querySelector('[data-rr-paginate-footer]');
  assert.ok(paginate && footer, 'the list has Royal Road’s paginator');

  // Untouched to begin with: it is still accurate, and still the quickest way
  // to jump deep into a long list.
  assert.equal(paginate.classList.contains('rrx-endless'), false, 'left alone before any append');

  w.dispatchEvent(new w.Event('scroll'));
  await settled();

  assert.ok(w.RRX.loadMore.state.pages > 0, 'a page was appended');
  assert.ok(
    paginate.classList.contains('rrx-endless'),
    'once it is lying about which page you are on, it is hidden'
  );
  // It is hidden by the stylesheet rather than removed, so nothing is lost.
  assert.ok(footer.isConnected, 'and hidden rather than removed');

  // A filter change starts the run over, and the numbers become true again.
  w.RRX.loadMore.reset();
  w.RRX.loadMore.syncPaginator();
  assert.equal(paginate.classList.contains('rrx-endless'), false, 'restored on reset');
});

test('the page numbers stay gone if Royal Road re-renders its paginator', async () => {
  // `hideFooter` used to be called from exactly one place: the end of a load.
  // Anything that re-rendered the pagination took the class with it, the page
  // numbers came back under a list still being appended to, and nothing put
  // them away again - permanently so once every page was in, because no further
  // load would ever run. Reported as "sometimes the page numbering comes back".
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);
  const pager = w.RRX.fictionPage.reviewPager;
  assert.ok(root && host, 'the fiction page has the reviews paginator');

  // Nowhere near the end, so `check` will not try to load.
  host.getBoundingClientRect = () => boxOf({ width: 900, height: 900, bottom: 5000 });
  pager.state.added = 2;
  pager.hideFooter(true);
  assert.ok(root.classList.contains('rrx-endless'), 'hidden after appending');

  // Royal Road re-renders, and the class goes with it.
  root.classList.remove('rrx-endless');
  pager.check();
  assert.ok(root.classList.contains('rrx-endless'), 'a check puts it back');

  // And it must come back once there is nothing left to load, which is when
  // `check` returns earliest and the old code could never recover.
  root.classList.remove('rrx-endless');
  pager.state.done = true;
  pager.check();
  assert.ok(root.classList.contains('rrx-endless'), 'even with nothing left to load');
});

// -- when the reviews pager is allowed to fire --------------------------------

/** A stand-in for an element's on-screen box. */
const boxOf = (over) => ({ top: 0, left: 0, right: 0, width: 0, height: 0, bottom: 0, ...over });

/** A list that moves out of trigger range as it grows, the way a real one does.
 *  A box pinned near the bottom forever makes the pager's own poll walk every
 *  page a fixture declares - 135 of them on the reviews root - which is a
 *  harness artefact rather than a bug, but it exhausts the heap all the same. */
const growingBox = (host, extra = 0) => {
  const start = host.children.length;
  return () =>
    boxOf({ width: 900, height: 900, bottom: host.children.length > start + extra ? 5000 : 10 });
};

async function fictionPage(settings) {
  const { w } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning',
    settings
  );
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });
  return w;
}

test('a collapsed reviews panel is never paged into', async () => {
  // Anything display:none reports a zero-size box, and a bottom of 0 satisfies
  // any "are we near the end of the list?" test. Unguarded, the pager downloads
  // the whole review list into a panel the reader has closed, from page load,
  // without anyone scrolling.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true, 'fiction.reviews': 'closed' });
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);
  assert.ok(host, 'the fiction page has a reviews container');

  host.getBoundingClientRect = () => boxOf({});
  const before = w.__fetched.length;
  w.RRX.fictionPage.reviewPager.check();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(w.__fetched.length, before, 'a closed panel asks Royal Road for nothing');

  // Opened, and scrolled to its end, it pages as normal.
  host.getBoundingClientRect = growingBox(host);
  w.RRX.fictionPage.reviewPager.check();
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(w.__fetched.length > before, 'an open panel at its end does page');
});

test('Royal Road’s review numbers survive until we have appended something', async () => {
  // Hiding them the moment the feature is switched on removes a working control
  // and puts nothing in its place: if the trigger never fires, because the panel
  // is closed or you never scroll that far, the section has neither pagination
  // nor auto-loading, which simply reads as broken.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);
  assert.ok(root && host, 'the fiction page has the reviews paginator');

  host.getBoundingClientRect = () => boxOf({ width: 900, height: 900, bottom: 5000 });
  w.RRX.fictionPage.reviewPager.check();
  assert.equal(
    root.classList.contains('rrx-endless'),
    false,
    'looking, and deciding not to load, leaves the numbers alone'
  );

  // Only a real append takes them away.
  const pager = w.RRX.fictionPage.reviewPager;
  pager.state.added = 3;
  pager.hideFooter(pager.state.added > 0);
  assert.ok(root.classList.contains('rrx-endless'), 'once something is appended, they go');
});

test('the order is the one on screen, not the one the fetch URL was rendered with', async () => {
  // Read from Royal Road's own source: its paginator takes
  // `data-rr-paginate-fetch-url` once, in its constructor, into a `fetchUrl`
  // property, and a re-sort assigns that property - `fetchUpdateUrlAndHook` -
  // without ever writing the attribute back. From the first re-sort onwards the
  // attribute describes an order nobody is looking at, and page two of it comes
  // back as rows already on screen: they all deduplicate away, nothing is
  // added, and the run stops with the page numbers up.
  //
  // `fiction.reviewSort` reaches Royal Road by clicking its own dropdown item,
  // so the list really is in that order. This asserted the opposite for a
  // while, on the strength of a capture whose scripts never run and so never
  // rewrite anything.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true, 'fiction.reviewSort': 'oldest' });
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);
  const url = w.RRX.fictionPage.reviewPager.urlFor(2);

  assert.match(
    root.getAttribute('data-rr-paginate-fetch-url'),
    /sorting=top/,
    'the attribute keeps saying what the page was built with'
  );
  assert.match(url, /sorting=oldest/, 'and we ask in the order actually on screen');
  assert.doesNotMatch(url, /sorting=top/);
  assert.match(url, /page=2/);
});

test('a reader picking an order beats the one we asked for', async () => {
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true, 'fiction.reviewSort': 'oldest' });
  const pager = w.RRX.fictionPage.reviewPager;
  assert.equal(pager.sorting(), 'oldest');

  const item = [...w.document.querySelectorAll(w.RRX.SEL.reviewSortDropdown + ' [data-rr-dropdown-item]')].find(
    (el) => el.getAttribute('data-rr-dropdown-option-value') === 'upvotes'
  );
  item.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  assert.equal(pager.sorting(), 'upvotes');
  assert.match(pager.urlFor(2), /sorting=upvotes/);
});

test('with no sort of our own, Royal Road’s own fetch URL is left untouched', async () => {
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const url = w.RRX.fictionPage.reviewPager.urlFor(3);
  assert.match(url, /sorting=top/, 'whatever the page came with');
  assert.match(url, /page=3/);
});

// -- the pre-paint blanking guard ---------------------------------------------

test('a saved filter never blanks a page the filters do not run on', async () => {
  // `.fiction-list` is not unique to the fiction lists: /home has four, and the
  // legacy layout has one. The guard hides that element until the first filter
  // pass reveals it, and on those pages no pass is ever coming.
  for (const [fixture, url] of [
    ['home.new.html', 'https://www.royalroad.com/home'],
    ['fictions-rising-stars.legacy.html', 'https://www.royalroad.com/fictions/rising-stars'],
  ]) {
    const { w } = await boot(fixture, url, { 'filters.minRating': 4.5 });
    assert.ok(
      w.document.querySelectorAll('.fiction-list').length > 0,
      `${fixture}: has a .fiction-list to blank`
    );
    assert.equal(
      w.document.documentElement.classList.contains('rrx-filters-pending'),
      false,
      `${fixture}: must never be blanked`
    );
  }
});

test('the reveal watchdog is armed unconditionally', () => {
  // boot.js sets the guard twice: synchronously from the localStorage mirror,
  // then again from the authoritative storage read, which resolves AFTER every
  // content script body has run. On a first load there is no mirror, so the
  // guard arrives last. Arming the watchdog only when the class is already
  // present therefore skips the one case that needs it, and the list stays
  // hidden for the rest of the page's life.
  const src = fs.readFileSync(
    path.join(ROOT, 'src', 'content', 'features', 'list-filters.js'),
    'utf8'
  );
  const arm = src.slice(src.indexOf('watchdog = setTimeout('));
  assert.ok(arm, 'the watchdog is armed somewhere');

  // The arming statement must not sit inside a test for the class.
  const before = src.slice(0, src.indexOf('watchdog = setTimeout(reveal, REVEAL_WATCHDOG_MS)'));
  const lastLines = before.split('\n').slice(-6).join('\n');
  assert.equal(
    /if\s*\([^)]*filtersPending[^)]*\)\s*\{?\s*$/.test(lastLines.trim()),
    false,
    `the watchdog is guarded by the class it exists to clear:\n${lastLines}`
  );
});

test('changing a filter starts infinite scroll over', async () => {
  // The run state latches by design: `done` stops a finished run asking again,
  // and `pages` remembers how far it read. Both are wrong once the filter
  // changes, and neither clears itself, so a relaxed filter would skip every
  // page already scanned and a run that ended on "no more results" would stay
  // ended for the rest of the session.
  const { w } = await boot(
    'fictions-weekly-popular.new.html',
    'https://www.royalroad.com/fictions/weekly-popular',
    { 'list.infiniteScroll': true, 'filters.enabled': true, 'filters.minRating': 4 }
  );
  const loadMore = w.RRX.loadMore;

  Object.assign(loadMore.state, { pages: 3, added: 7, done: 'no more results' });
  assert.equal(loadMore.state.done, 'no more results');

  await w.RRX.main.ctx.setSetting('filters.minRating', 3);

  assert.equal(loadMore.state.done, '', 'a changed filter clears the finished flag');
  assert.equal(loadMore.state.pages, 0, 'and the pages already scanned');
  assert.equal(loadMore.state.added, 0, 'and the tally');
});

test('an unchanged filter leaves the run alone', async () => {
  const { w } = await boot(
    'fictions-weekly-popular.new.html',
    'https://www.royalroad.com/fictions/weekly-popular',
    { 'list.infiniteScroll': true, 'filters.enabled': true, 'filters.minRating': 4 }
  );
  const loadMore = w.RRX.loadMore;
  Object.assign(loadMore.state, { pages: 3, added: 7 });

  // A setting that is not a filter must not throw the tally away.
  await w.RRX.main.ctx.setSetting('list.showToolbar', false);
  assert.equal(loadMore.state.pages, 3, 'an unrelated setting is not a filter change');
  assert.equal(loadMore.state.added, 7);
});

test('"About Fiction: always open" survives Royal Road re-applying its own state', async () => {
  // Royal Road initialises this show-more in a deferred script and applies its
  // remembered state, so setting the checkbox once at document_end only wins
  // when that script happens to run first. Every accordion is insisted on for a
  // window for exactly this reason; About was not, so it worked or not by luck.
  const { w } = await boot(
    'fiction-detail.new.html',
    'https://www.royalroad.com/fiction/21220/mother-of-learning',
    { 'fiction.about': 'open' }
  );
  const box = () =>
    w.document.querySelector('#about-accordion [data-rr-show-more] input[type="checkbox"]');
  assert.ok(box(), 'the fiction page has the About show-more');
  assert.equal(box().checked, true, 'expanded on the first pass');

  // Royal Road changes its mind a moment later.
  box().checked = false;
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(box().checked, true, 'and is put back');
});

test('re-sorting after loading pages does not strand the rest of the comments', async () => {
  // Reported: load several pages of comments, change the sort, and only the
  // first page comes back - the rest vanish and infinite scroll never resumes.
  // Royal Road refetches page one and swaps the container's contents, taking
  // every page we appended with it, while our counters still believe the run is
  // deep in progress or finished.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);
  assert.ok(host, 'the fiction page has a reviews container');

  // Stand in for a run that reached the end: pages appended, nothing left.
  const appended = w.document.createElement('div');
  appended.setAttribute('data-rr-paginate-item', '');
  appended.setAttribute('data-rrx-appended', '1');
  host.appendChild(appended);
  pager.state.added = 3;
  pager.state.next = 4;
  pager.state.done = true;

  assert.equal(pager.noticeReplacement(), false, 'our pages are still there, so nothing to do');

  // Royal Road re-sorts: it replaces the container with page one of the new
  // order, and everything we appended goes with it.
  host.innerHTML = '<div data-rr-paginate-item></div>';

  assert.equal(pager.noticeReplacement(), true, 'the replacement is noticed');
  assert.equal(pager.state.done, false, 'so the run can resume');
  assert.equal(pager.state.next, 2, 'from page two of the NEW order');
  assert.equal(pager.state.added, 0);
});

test('a re-sort while a page is in flight drops that page rather than mixing it in', async () => {
  // `noticeReplacement` restarts the run through `reset`, which clears `busy`.
  // A fetch already in the air then landed anyway: it appended into the
  // container that had just been swapped out, and bumped the counters, so the
  // restarted run believed it was holding a page nobody could see.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);

  const appended = w.document.createElement('div');
  appended.setAttribute('data-rr-paginate-item', '');
  appended.setAttribute('data-rrx-appended', '1');
  host.appendChild(appended);
  Object.assign(pager.state, { added: 3, next: 4, done: false });

  // A fetch that will not resolve until we say so.
  let release;
  const inFlight = new Promise((resolve) => {
    release = resolve;
  });
  w.eval(`globalThis.__held = null; globalThis.fetch = (url) => {
    globalThis.__fetched.push(String(url));
    return new Promise((resolve) => { globalThis.__held = resolve; });
  };`);

  pager.loadNext();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pager.state.busy, true, 'a page is in the air');

  // Royal Road re-sorts underneath it.
  host.innerHTML = '<div data-rr-paginate-item></div>';
  assert.equal(pager.noticeReplacement(), true);
  const restarted = { next: pager.state.next, added: pager.state.added };

  // ...and only now does the old response arrive.
  w.eval(`globalThis.__held({ ok: true, status: 200, text: async () =>
    '<div data-rr-paginate-item><div id="stale-1"></div></div>' });`);
  release();
  await inFlight;
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(w.document.getElementById('stale-1'), null, 'the stale page was not appended');
  assert.equal(pager.state.next, restarted.next, 'and the restarted run is untouched');
  assert.equal(pager.state.added, restarted.added);
});

test('a re-sorted list keeps loading instead of dropping back to pagination', async () => {
  // Reported twice. A re-sort leaves one page on screen, so the end of the list
  // is nowhere near the viewport and `check` refuses to load - while
  // `noticeReplacement` has already put Royal Road's page numbers back, because
  // they are true again. Nothing then loaded until the reader scrolled all the
  // way down, which reads as infinite scroll having simply stopped.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);
  root.setAttribute('data-rr-paginate-max-page', '5');

  const appended = w.document.createElement('div');
  appended.setAttribute('data-rr-paginate-item', '');
  appended.setAttribute('data-rrx-appended', '1');
  host.appendChild(appended);
  Object.assign(pager.state, { added: 6, next: 3, done: true });
  pager.hideFooter(true);

  // Royal Road re-sorts: one page, and its bottom is far below the fold.
  host.innerHTML = '<div data-rr-paginate-item><div id="sorted-1"></div></div>';
  // Far below the fold, which is what a one-page list looks like: the trigger
  // geometry alone would never fire, which is the whole point of the test.
  host.getBoundingClientRect = growingBox(host);

  w.RRX.main.syncCards(w.document);
  for (let i = 0; i < 50 && host.children.length < 2; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.ok(host.children.length > 1, 'the next page loaded without waiting for a scroll');
  assert.ok(
    root.classList.contains('rrx-endless'),
    'so Royal Road’s page numbers stay put away'
  );
});

test('picking a different order throws our pages away and waits for the new first one', async () => {
  // Driven by the click rather than inferred from what is missing afterwards.
  // Two things that inference could not do: our appended rows go at once, so
  // they cannot be stranded under Royal Road's new page one if Royal Road only
  // clears the rows it rendered itself; and nothing is fetched until the list
  // has visibly changed, because until then the fetch URL still describes the
  // order the reader has just left.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);

  const ours = w.document.createElement('div');
  ours.setAttribute('data-rr-paginate-item', '');
  ours.setAttribute('data-rrx-appended', '1');
  ours.innerHTML = '<div id="review-ours"></div>';
  host.appendChild(ours);
  Object.assign(pager.state, { added: 3, next: 4, done: true });
  pager.hideFooter(true);

  // The reader picks a different order from Royal Road's own dropdown.
  const option = [...w.document.querySelectorAll(w.RRX.SEL.dropdownItem)].find(
    (el) => el.getAttribute('data-rr-dropdown-option-value') === 'newest'
  );
  option.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  assert.equal(w.document.getElementById('review-ours'), null, 'our pages went at once');
  assert.equal(pager.state.next, 2, 'and the run is back to the beginning');
  assert.equal(root.classList.contains('rrx-endless'), false, 'its page numbers are true again');

  // The debt, not a fetch: driving a real one appends a 1.8 MB fixture, and this
  // suite already holds a jsdom document per test. That the restart then loads
  // is covered by "a re-sorted list keeps loading instead of dropping back to
  // pagination"; what is unique here is that it waits first.
  assert.equal(pager.owed(), false, 'nothing is owed while the old list is still up');

  // Royal Road finishes and puts page one of the new order in.
  host.innerHTML = '<div data-rr-paginate-item><div id="review-new-1"></div></div>';
  assert.equal(pager.owed(), true, 'now the restart is owed its first page');
  assert.match(pager.urlFor(pager.state.next), /page=2/, 'from page two');
});

test('a reader on page two carries on from page three, not back to page two', async () => {
  // Reported as "I was on the second page, reordered, and got three reviews".
  // The run started at page two whatever was on screen, so a reader who had
  // used Royal Road's own pagination refetched the page they were already
  // looking at: every row deduplicated away, `added` came out zero, and the run
  // ended before it began - leaving Royal Road's page numbers up, which is the
  // "it still paginates" half.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);

  root.setAttribute('data-rr-paginate-current-page', '2');
  root.setAttribute('data-rr-paginate-max-page', '12');
  host.getBoundingClientRect = growingBox(host);

  const before = w.__fetched.length;
  pager.loadNext();
  for (let i = 0; i < 50 && w.__fetched.length === before; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.match(w.__fetched[w.__fetched.length - 1], /page=3/, 'the page after the one on screen');

  // Waited for the response, not just the request: the assertion below is about
  // what the run does once rows have actually landed.
  for (let i = 0; i < 50 && !pager.state.added; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(pager.state.added > 0, 'the page landed');

  // ...and once we are appending, Royal Road's number is stale: it describes
  // what it rendered, not what we have added since.
  root.setAttribute('data-rr-paginate-current-page', '2');
  assert.ok(pager.state.next > 3, 'so it is not consulted again mid-run');
});

test('an id used elsewhere in the list does not swallow an arriving row', async () => {
  // Reported as "12 reviews before the reorder, 11 after". The duplicate check
  // compared an arriving item's first id against *every* id in the container,
  // so anything else carrying that id - a tooltip, a widget, a reply - dropped
  // the row silently. It has to compare item markers with item markers.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);
  root.setAttribute('data-rr-paginate-max-page', '9');

  // Something in the container that is not an item, wearing the id the next row
  // will arrive with.
  host.innerHTML =
    '<div data-rr-paginate-item><div id="review-onscreen"></div></div>' +
    '<div class="tooltip"><span id="review-arriving"></span></div>';
  host.getBoundingClientRect = growingBox(host);
  w.eval(`globalThis.fetch = async (url) => {
    globalThis.__fetched.push(String(url));
    return { ok: true, status: 200, text: async () =>
      '<div data-rr-paginate-item><div id="review-arriving"></div></div>' };
  };`);

  const before = host.querySelectorAll('[data-rr-paginate-item]').length;
  pager.loadNext();
  for (let i = 0; i < 50 && !pager.state.added; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(pager.state.added, 1, 'the row was appended, not swallowed');
  assert.equal(host.querySelectorAll('[data-rr-paginate-item]').length, before + 1);

  // ...and a genuine repeat is still dropped.
  pager.state.busy = false;
  pager.loadNext();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(pager.state.added, 1, 'the same row a second time is still refused');
});

test('a list we never appended to is left alone', async () => {
  // Royal Road replaces its own list for its own reasons. Before we have added
  // anything there is nothing to restart, and resetting would be noise.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);

  pager.state.added = 0;
  host.innerHTML = '<div data-rr-paginate-item></div>';
  assert.equal(pager.noticeReplacement(), false);
});

test('after a re-sort the run really does start again, not just reset its counters', async () => {
  // Resetting the state is only half of it. What was reported is "infinite
  // scroll stops working", so the test that matters is whether a further page
  // is actually fetched afterwards - in the new order, from page two, because
  // Royal Road has already put page one on screen itself.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true });
  const pager = w.RRX.fictionPage.reviewPager;
  const host = w.document.querySelector(w.RRX.SEL.reviewsContainer);

  const appended = w.document.createElement('div');
  appended.setAttribute('data-rr-paginate-item', '');
  appended.setAttribute('data-rrx-appended', '1');
  host.appendChild(appended);
  Object.assign(pager.state, { added: 3, next: 4, done: true });

  // Royal Road re-sorts and replaces the list.
  host.innerHTML = '<div data-rr-paginate-item></div>';
  pager.noticeReplacement();

  // At the end of the list, so a check should want the next page.
  host.getBoundingClientRect = growingBox(host);
  const before = w.__fetched.length;
  pager.check();
  // Waited for rather than slept through: a fixed delay is a race, and this one
  // failed once under load before passing three runs in a row.
  for (let i = 0; i < 50 && w.__fetched.length === before; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.ok(w.__fetched.length > before, 'nothing was fetched: the run is still stuck');
  assert.match(w.__fetched[w.__fetched.length - 1], /page=2/, 'and it resumed from page two');
});
