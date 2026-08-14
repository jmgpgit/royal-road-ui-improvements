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
async function boot(fixtureName, url, settings = {}, hidden = {}) {
  const dom = new JSDOM(fixture(fixtureName), { url, runScripts: 'outside-only' });
  const w = dom.window;
  windows.push(w);

  const store = { settings, hidden };
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

// -- when the reviews pager is allowed to fire --------------------------------

/** A stand-in for an element's on-screen box. */
const boxOf = (over) => ({ top: 0, left: 0, right: 0, width: 0, height: 0, bottom: 0, ...over });

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
  host.getBoundingClientRect = () => boxOf({ width: 900, height: 900, bottom: 10 });
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

test('paging follows the sort the reader chose, not the one the page loaded with', async () => {
  // Royal Road leaves data-rr-paginate-fetch-url on the ordering the page was
  // rendered with. Ask it for page 2 after a re-sort and it answers with rows
  // from the OLD order: on a fiction with few reviews those are all already on
  // screen, every one deduplicates away, and the pager concludes there is
  // nothing left and stops for good having added nothing.
  const w = await fictionPage({ 'fiction.reviewsAutoLoad': true, 'fiction.reviewSort': 'oldest' });
  const root = w.document.querySelector(w.RRX.SEL.reviewsPaginate);
  assert.match(
    root.getAttribute('data-rr-paginate-fetch-url'),
    /sorting=top/,
    'Royal Road’s own URL still says top, which is the whole problem'
  );

  const url = w.RRX.fictionPage.reviewPager.urlFor(2);
  assert.match(url, /sorting=oldest/, 'we ask for the order actually on screen');
  assert.match(url, /page=2/, 'and the next page of it');
  assert.equal((url.match(/sorting=/g) || []).length, 1, 'the old sort is replaced, not appended');
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
