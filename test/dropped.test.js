'use strict';

/**
 * "Tried and dropped", against real list markup.
 *
 * The thing most worth pinning down is that two features now hang controls on
 * the same card: for a while `.rrx-card-btn` was how hide-fictions found its own
 * button, so whichever swept last deleted the other's. Everything here is one
 * sweep away from that, so most of these assertions are about coexistence.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const SKIP = need('fictions-rising-stars.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/css.js',
  'src/content/ui.js',
  'src/content/features/hide-fictions.js',
  'src/content/features/dropped-fictions.js',
];

const LIST_URL = 'https://www.royalroad.com/fictions/rising-stars';

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

function loadPage() {
  const dom = new JSDOM(fixture('fictions-rising-stars.new.html'), {
    url: LIST_URL,
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  w.eval(`globalThis.browser = {
    storage: { local: { get: async () => ({}), set: async () => {} },
               onChanged: { addListener() {}, removeListener() {} } },
    runtime: { getURL: (p) => p, sendMessage() {}, onMessage: { addListener() {} } },
  };`);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return w;
}

/** A stand-in for main.js's shared context, recording what the buttons call. */
function makeCtx(w, over = {}) {
  const calls = [];
  return {
    calls,
    settings: w.RRX.normalizeSettings({ 'hide.enabled': true, 'drop.enabled': true, ...over.settings }),
    hiddenSet: new Set(over.hidden || []),
    droppedSet: new Set(over.dropped || []),
    hide: (id, meta) => calls.push(['hide', id, meta]),
    unhide: (id) => calls.push(['unhide', id]),
    drop: (id, meta) => calls.push(['drop', id, meta]),
    undrop: (id) => calls.push(['undrop', id]),
  };
}

const sync = (w, ctx) => {
  w.RRX.hideFictions.syncCards(w.document, ctx);
  w.RRX.droppedFictions.syncCards(w.document, ctx);
};

const firstCard = (w) => w.document.querySelector(w.RRX.SEL.listCard);

test('both controls land on the same card without displacing each other', () => {
  const w = loadPage();
  const ctx = makeCtx(w);
  sync(w, ctx);

  const card = firstCard(w);
  assert.ok(card.querySelector(':scope > [data-rrx-btn="hide"]'), 'the hide button is there');
  assert.ok(card.querySelector(':scope > [data-rrx-btn="drop"]'), 'and so is the drop button');

  // Swept repeatedly, in both orders: this is what used to delete one of them.
  sync(w, ctx);
  w.RRX.droppedFictions.syncCards(w.document, ctx);
  w.RRX.hideFictions.syncCards(w.document, ctx);
  assert.equal(card.querySelectorAll(':scope > [data-rrx-btn="hide"]').length, 1);
  assert.equal(card.querySelectorAll(':scope > [data-rrx-btn="drop"]').length, 1);
});

test('the control is absent until the feature is switched on', () => {
  const w = loadPage();
  const ctx = makeCtx(w, { settings: { 'drop.enabled': false } });
  sync(w, ctx);

  const card = firstCard(w);
  assert.equal(card.querySelector(':scope > [data-rrx-btn="drop"]'), null);
  assert.ok(card.querySelector(':scope > [data-rrx-btn="hide"]'), 'hiding is unaffected');

  // And turning it on mid-page adds it, since a settings change re-sweeps.
  ctx.settings = w.RRX.normalizeSettings({ 'hide.enabled': true, 'drop.enabled': true });
  sync(w, ctx);
  assert.ok(card.querySelector(':scope > [data-rrx-btn="drop"]'));
});

test('clicking it reports the fiction with enough to render it later', () => {
  const w = loadPage();
  const ctx = makeCtx(w);
  sync(w, ctx);

  const card = firstCard(w);
  const id = w.RRX.hideFictions.readFictionId(card);
  card.querySelector(':scope > [data-rrx-btn="drop"]').click();

  assert.deepEqual(ctx.calls.map((c) => c[0]), ['drop']);
  const [, reported, meta] = ctx.calls[0];
  assert.equal(reported, id);
  assert.ok(meta.title && meta.title !== `Fiction ${id}`, 'the title came off the card');
  assert.match(meta.url, new RegExp(`/fiction/${id}`));
});

test('a dropped card says so, and its button offers the way back', () => {
  const w = loadPage();
  const card = firstCard(loadPage()); // id from a clean copy of the same page
  const id = card.dataset.rrxFid ? Number(card.dataset.rrxFid) : null;
  assert.equal(id, null, 'sanity: nothing has swept that copy yet');

  const ctx = makeCtx(w, { dropped: [] });
  sync(w, ctx);
  const target = firstCard(w);
  const targetId = Number(target.dataset.rrxFid);

  ctx.droppedSet = new Set([targetId]);
  sync(w, ctx);

  assert.ok(target.hasAttribute('data-rrx-dropped'), 'the filter reads this attribute');
  const badge = target.querySelector(':scope > .rrx-dropped-badge');
  assert.ok(badge, 'the card is labelled rather than silently dimmed');
  assert.equal(badge.textContent, 'Dropped');

  target.querySelector(':scope > [data-rrx-btn="drop"]').click();
  assert.deepEqual(ctx.calls, [['undrop', targetId]]);

  // And clearing the mark takes the label and the attribute with it.
  ctx.droppedSet = new Set();
  sync(w, ctx);
  assert.equal(target.hasAttribute('data-rrx-dropped'), false);
  assert.equal(target.querySelector(':scope > .rrx-dropped-badge'), null);
});

test('switching the feature off leaves no trace on the cards', () => {
  const w = loadPage();
  const ctx = makeCtx(w);
  sync(w, ctx);
  const card = firstCard(w);
  const id = Number(card.dataset.rrxFid);

  ctx.droppedSet = new Set([id]);
  sync(w, ctx);
  assert.ok(card.querySelector(':scope > .rrx-dropped-badge'));

  ctx.settings = w.RRX.normalizeSettings({ 'hide.enabled': true, 'drop.enabled': false });
  sync(w, ctx);
  assert.equal(card.querySelector(':scope > [data-rrx-btn="drop"]'), null);
  assert.equal(card.querySelector(':scope > .rrx-dropped-badge'), null);
  assert.equal(card.hasAttribute('data-rrx-dropped'), false, 'or the filter would still see it');
  assert.ok(card.querySelector(':scope > [data-rrx-btn="hide"]'), 'and hiding still works');
});

test('the generated rule dims exactly the one card', () => {
  const w = loadPage();
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];
  const id = w.RRX.hideFictions.readFictionId(cards[7]);

  const selector = w.RRX.buildDropCss([id])
    .split('\n')
    .map((rule) => rule.split('{')[0].trim())
    .join(',');

  // The rule targets the card's children, so it is the parents that are counted.
  const matched = new Set([...w.document.querySelectorAll(selector)].map((el) => el.parentElement));
  assert.equal(matched.size, 1);
  assert.ok(matched.has(cards[7]));
});

test('hiding and dropping the same fiction is not a conflict', () => {
  const w = loadPage();
  const ctx = makeCtx(w);
  sync(w, ctx);
  const card = firstCard(w);
  const id = Number(card.dataset.rrxFid);

  ctx.hiddenSet = new Set([id]);
  ctx.droppedSet = new Set([id]);
  sync(w, ctx);

  assert.ok(card.hasAttribute('data-rrx-hidden'));
  assert.ok(card.hasAttribute('data-rrx-dropped'));
  assert.ok(card.querySelector(':scope > .rrx-hidden-badge'), 'both badges are present');
  assert.ok(card.querySelector(':scope > .rrx-dropped-badge'));

  // Each button still answers for its own feature.
  card.querySelector(':scope > [data-rrx-btn="hide"]').click();
  card.querySelector(':scope > [data-rrx-btn="drop"]').click();
  assert.deepEqual(ctx.calls, [['unhide', id], ['undrop', id]]);
});
