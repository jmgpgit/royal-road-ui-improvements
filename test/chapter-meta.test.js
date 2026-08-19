'use strict';

/**
 * The facts bar above a chapter, and the rail it sits in.
 *
 * What is worth pinning here is everything that depends on Royal Road's markup
 * rather than on our own: a chapter page carries three `time[unixtime]`
 * elements and only one of them belongs to the chapter, the word count comes
 * from a container that also holds ad placeholders, and the bar has to be
 * cheap to re-run because `onPage` fires on every settings change.
 *
 * jsdom has no layout, so nothing here proves how it looks. Order, content and
 * the rebuild guard are what these tests are for.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const SKIP = need('chapter.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/css.js',
  'src/content/ui.js',
  'src/content/chapter-top.js',
  'src/content/features/chapter-meta.js',
];

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
 * The real chapter list for this fiction, trimmed: the page under test is
 * chapter 3766643, which Royal Road's own list puts 89th of 95.
 */
const CHAPTER_LIST = Array.from({ length: 95 }, (_, i) => ({
  order: i,
  id: i === 88 ? 3766643 : 2968269 + i,
  title: `Chapter ${i + 1}`,
  slug: `chapter-${i + 1}`,
}));

function load(settings = {}, { list = CHAPTER_LIST, ok = true } = {}) {
  const dom = new JSDOM(fixture('chapter.new.html'), {
    url: 'https://www.royalroad.com/fiction/149588/x/chapter/3766643/y',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  w.eval('globalThis.browser = { storage: { local: {}, onChanged: {} }, runtime: {} };');
  w.__list = list;
  w.__ok = ok;
  w.eval(`
    globalThis.__fetched = [];
    globalThis.fetch = async (url) => {
      globalThis.__fetched.push(String(url));
      return { ok: globalThis.__ok, status: globalThis.__ok ? 200 : 500, json: async () => globalThis.__list };
    };
  `);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return { w, ctx: { page: 'chapter', settings: w.RRX.normalizeSettings(settings) } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const bar = (w) => w.document.getElementById(w.RRX.chapterMeta.BLOCK_ID);
const texts = (w) =>
  [...bar(w).querySelectorAll('.rrx-chapter-meta__item')].map((el) => el.textContent);

// --- what belongs to the chapter -------------------------------------------

test('only the chapter’s own timestamp is read, not the author’s join date', () => {
  const { w } = load();
  const all = w.document.querySelectorAll('time[unixtime]');
  const found = w.RRX.chapterMeta.stamps();

  // Three on the page: the chapter stamp and two copies of the author's
  // membership age inside the About-author panel. Scoping to `.chapter` is the
  // only thing that tells them apart.
  assert.equal(all.length, 3, 'fixture shape changed: re-check selectors.js chapterCard');
  assert.equal(found.length, 1);
  assert.equal(found[0].unix, 1785817599);
});

test('a stamp is labelled by Royal Road’s own tooltip', () => {
  const { w } = load();
  assert.equal(w.RRX.chapterMeta.stamps()[0].label, 'Created At');
});

test('an unlabelled stamp is named by position, never invented', () => {
  const { w } = load();
  const { nameFor } = w.RRX.chapterMeta;
  assert.equal(nameFor({ label: 'Created At' }, 0), 'Created At');
  assert.equal(nameFor({ label: '' }, 0), 'Posted');
  assert.equal(nameFor({ label: '' }, 1), 'Updated');
});

// --- length ----------------------------------------------------------------

test('the word count is the chapter text, and matches the real chapter', () => {
  const { w } = load();
  assert.equal(w.RRX.chapterMeta.wordCount(), 2120);
});

test('reading time rounds to minutes, and to hours once minutes stop helping', () => {
  const { w } = load();
  const { readingTime } = w.RRX.chapterMeta;
  assert.equal(readingTime(2120, 250), '~8 min');
  assert.equal(readingTime(100, 250), '~1 min', 'never zero minutes');
  assert.equal(readingTime(30000, 250), '~2 h');
  assert.equal(readingTime(33000, 250), '~2 h 12 min');
});

// --- what the bar says -----------------------------------------------------

test('nothing is shown until something is switched on', () => {
  const { w, ctx } = load();
  w.RRX.chapterMeta.apply(ctx);
  assert.equal(bar(w), null);
  assert.equal(
    w.document.querySelectorAll(`[${w.RRX.chapterTop.SLOT_ATTR}]`).length,
    0,
    'nothing left above the chapter either'
  );
});

test('each switch adds only its own fact', () => {
  const one = load({ 'chapter.topTimestamp': true });
  one.w.RRX.chapterMeta.apply(one.ctx);
  assert.equal(texts(one.w).length, 1);
  assert.match(texts(one.w)[0], /^Created At /);

  const two = load({ 'chapter.wordCount': 'both', 'chapter.wpm': 250 });
  two.w.RRX.chapterMeta.apply(two.ctx);
  const wordLabel = `${(2120).toLocaleString()} words`;
  assert.deepEqual([...texts(two.w)], [wordLabel, '~8 min']);

  const three = load({ 'chapter.topTimestamp': true, 'chapter.wordCount': 'words' });
  three.w.RRX.chapterMeta.apply(three.ctx);
  assert.equal(texts(three.w).length, 2);
});

test('a faster reader gets a shorter estimate', () => {
  const { w, ctx } = load({ 'chapter.wordCount': 'time', 'chapter.wpm': 400 });
  w.RRX.chapterMeta.apply(ctx);
  assert.deepEqual([...texts(w)], ['~5 min']);
});

// --- how far through the fiction you are ------------------------------------

test('nothing is fetched while the count is off', async () => {
  const { w, ctx } = load({ 'chapter.topTimestamp': true });
  await w.RRX.chapterMeta.loadProgress(ctx);
  await settle();
  assert.equal(w.__fetched.length, 0);
});

test('the count comes from Royal Road’s own chapter list', async () => {
  const { w, ctx } = load({ 'chapter.catchUp': true });
  await w.RRX.chapterMeta.loadProgress(ctx);
  w.RRX.chapterMeta.apply(ctx);

  assert.deepEqual([...w.__fetched], ['/fictions/chapterlist?id=149588']);
  assert.deepEqual([...texts(w)], ['Chapter 89 of 95 (6 to catch up)']);
});

test('the list is fetched once per fiction, not once per render', async () => {
  const { w, ctx } = load({ 'chapter.catchUp': true });
  await w.RRX.chapterMeta.loadProgress(ctx);
  for (let i = 0; i < 4; i += 1) await w.RRX.chapterMeta.loadProgress(ctx);
  await settle();
  assert.equal(w.__fetched.length, 1);
});

test('the last chapter drops the parenthetical rather than saying “0 to catch up”', async () => {
  const { w, ctx } = load({ 'chapter.catchUp': true }, { list: CHAPTER_LIST.slice(0, 89) });
  await w.RRX.chapterMeta.loadProgress(ctx);
  w.RRX.chapterMeta.apply(ctx);
  assert.deepEqual([...texts(w)], ['Chapter 89 of 89']);
});

test('the count is one fact, not two', async () => {
  const { w, ctx } = load({ 'chapter.catchUp': true }, { list: CHAPTER_LIST.slice(0, 90) });
  await w.RRX.chapterMeta.loadProgress(ctx);
  w.RRX.chapterMeta.apply(ctx);
  assert.deepEqual([...texts(w)], ['Chapter 89 of 90 (1 to catch up)']);
});

test('a chapter missing from the list refetches once, past the cache', async () => {
  const { w, ctx } = load({ 'chapter.catchUp': true }, { list: CHAPTER_LIST.slice(0, 40) });
  await w.RRX.chapterMeta.loadProgress(ctx);
  await settle();

  // Published since we cached, or the fiction was restructured. Worth one
  // retry, and exactly one - it must not turn into a loop.
  assert.equal(w.__fetched.length, 2);
  assert.equal(w.document.getElementById(w.RRX.chapterMeta.BLOCK_ID), null, 'no guessed position');
});

test('a list Royal Road will not serve leaves the page alone', async () => {
  const { w, ctx } = load({ 'chapter.catchUp': true }, { ok: false });
  await w.RRX.chapterMeta.loadProgress(ctx);
  w.RRX.chapterMeta.apply(ctx);
  assert.equal(w.document.getElementById(w.RRX.chapterMeta.BLOCK_ID), null);
});

test('the count joins the facts line rather than getting a line of its own', async () => {
  const { w, ctx } = load({ 'chapter.catchUp': true, 'chapter.topTimestamp': true });
  await w.RRX.chapterMeta.loadProgress(ctx);
  w.RRX.chapterMeta.apply(ctx);

  assert.equal(w.document.querySelectorAll('.rrx-chapter-meta').length, 1);
  const shown = texts(w);
  assert.match(shown[0], /^Created At /);
  assert.deepEqual(shown.slice(1), ['Chapter 89 of 95 (6 to catch up)']);
});

// --- living with the sweep -------------------------------------------------

test('re-applying identical settings does not touch the DOM', () => {
  const { w, ctx } = load({ 'chapter.topTimestamp': true, 'chapter.wordCount': 'both' });
  w.RRX.chapterMeta.apply(ctx);
  const first = bar(w);

  // `onPage` re-runs on every settings change, and the sweep is driven by a
  // MutationObserver: replacing an identical bar would schedule the next sweep,
  // which would replace it again.
  for (let i = 0; i < 5; i += 1) w.RRX.chapterMeta.apply(ctx);
  assert.equal(bar(w), first, 'the bar was rebuilt when nothing about it changed');
});

test('changing a setting rebuilds it exactly once', () => {
  const { w, ctx } = load({ 'chapter.wordCount': 'words' });
  w.RRX.chapterMeta.apply(ctx);
  const before = bar(w);

  ctx.settings = w.RRX.normalizeSettings({ 'chapter.wordCount': 'both' });
  w.RRX.chapterMeta.apply(ctx);
  assert.notEqual(bar(w), before);
  assert.equal(texts(w).length, 2);

  const after = bar(w);
  w.RRX.chapterMeta.apply(ctx);
  assert.equal(bar(w), after);
});

test('switching everything off takes the bar away again', () => {
  const { w, ctx } = load({ 'chapter.topTimestamp': true });
  w.RRX.chapterMeta.apply(ctx);
  assert.ok(bar(w));

  ctx.settings = w.RRX.normalizeSettings({});
  w.RRX.chapterMeta.apply(ctx);
  assert.equal(bar(w), null);
});

// --- placing blocks above the chapter ---------------------------------------

const slotted = (w) =>
  [...w.document.querySelectorAll(`[${w.RRX.chapterTop.SLOT_ATTR}]`)].map((el) => el.id);

test('the bar sits directly above the chapter text', () => {
  const { w, ctx } = load({ 'chapter.topTimestamp': true });
  w.RRX.chapterMeta.apply(ctx);
  assert.equal(bar(w).nextElementSibling, w.document.querySelector('.chapter-content'));
});

test('our blocks are siblings of the chapter, never wrapped in a box of ours', () => {
  const { w, ctx } = load({ 'chapter.topTimestamp': true });
  w.RRX.chapterMeta.apply(ctx);
  const content = w.document.querySelector('.chapter-content');

  // The parent is `div.chapter.flex.flex-col.items-center`: it centres and
  // shrink-wraps each child. A wrapper of ours around the bar and the recap
  // resized itself whenever the recap opened, sliding the bar sideways with it.
  assert.equal(bar(w).parentElement, content.parentElement);
});

test('slots order the blocks, whatever order they arrive in', () => {
  const { w } = load();
  const { place, SLOTS } = w.RRX.chapterTop;

  // The recap is fetched, so it can land either side of the bar.
  place(w.RRX.ui.el('div', { id: 'fake-recap', class: 'rrx-ui' }), SLOTS.recap);
  place(w.RRX.ui.el('div', { id: 'fake-meta', class: 'rrx-ui' }), SLOTS.meta);
  assert.deepEqual(slotted(w), ['fake-meta', 'fake-recap']);

  const content = w.document.querySelector('.chapter-content');
  assert.equal(w.document.getElementById('fake-recap').nextElementSibling, content);
});

test('a block replaces its own slot rather than stacking up', () => {
  const { w } = load();
  const { place, SLOTS } = w.RRX.chapterTop;
  place(w.RRX.ui.el('div', { id: 'first', class: 'rrx-ui' }), SLOTS.meta);
  place(w.RRX.ui.el('div', { id: 'second', class: 'rrx-ui' }), SLOTS.meta);
  assert.deepEqual(slotted(w), ['second']);
});

test('a block can be taken away again by slot', () => {
  const { w } = load();
  const { place, clear, SLOTS } = w.RRX.chapterTop;
  place(w.RRX.ui.el('div', { id: 'meta', class: 'rrx-ui' }), SLOTS.meta);
  place(w.RRX.ui.el('div', { id: 'recap', class: 'rrx-ui' }), SLOTS.recap);
  clear(SLOTS.meta);
  assert.deepEqual(slotted(w), ['recap']);
});

test('everything we place is marked as ours', () => {
  const { w, ctx } = load({ 'chapter.topTimestamp': true, 'chapter.wordCount': 'both' });
  w.RRX.chapterMeta.apply(ctx);

  // main.js tests the node that was ADDED, so anything landing beside the
  // chapter has to carry the class or it schedules another sweep.
  for (const el of w.document.querySelectorAll(`[${w.RRX.chapterTop.SLOT_ATTR}]`)) {
    assert.ok(el.classList.contains(w.RRX.UI_CLASS), `unmarked block above the chapter: ${el.id}`);
  }
});
