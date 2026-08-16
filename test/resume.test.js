'use strict';

/**
 * Coming back to where you stopped reading.
 *
 * jsdom has no layout: every getBoundingClientRect is zeroes and scrollTo does
 * nothing. So these tests cover the DECISIONS - when to restore, when to refuse,
 * what gets written and what does not - and the geometry is a browser-only
 * check, as noted in the plan.
 *
 * The refusals matter more than the restores. A restore that does not happen is
 * a mild disappointment; one that fires over a reader who followed a comment
 * permalink, or a second one ten minutes into a chapter, throws away their place.
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
  'src/common/store.js',
  'src/content/ui.js',
  'src/content/chapter-top.js',
  'src/content/features/resume.js',
];

const CHAPTER = 3766643;
const URL_BASE = `https://www.royalroad.com/fiction/149588/x/chapter/${CHAPTER}/y`;

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
 * @param {object} opts
 * @param {object} opts.stored what storage.local holds for this chapter
 * @param {string} opts.url the page being opened
 * @param {number} opts.scrollY where the browser has already put the reader
 */
function load({ stored = null, url = URL_BASE, scrollY = 0, settings = {} } = {}) {
  // `pretendToBeVisual` gives the window a requestAnimationFrame. Without it
  // jsdom has none, so anything coalescing work into a frame silently never
  // runs and a test of that coalescing proves nothing either way.
  const dom = new JSDOM(fixture('chapter.new.html'), {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  windows.push(w);

  const chapters = stored ? { [CHAPTER]: stored } : {};
  w.__written = [];
  w.__chapters = chapters;
  w.eval(`
    globalThis.__scrolls = [];
    globalThis.browser = {
      storage: {
        local: {
          get: async (keys) => (String(keys).includes('chapters') ? { chapters: globalThis.__chapters } : {}),
          // Replaces the key, as storage.local does. Merging instead would make
          // a deletion invisible, which is exactly what these tests check.
          set: async (patch) => {
            globalThis.__written.push(patch);
            if (patch.chapters) globalThis.__chapters = patch.chapters;
          },
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      runtime: {},
    };
    globalThis.scrollTo = (x, y) => { globalThis.__scrolls.push(y); };
  `);
  w.__chapters = chapters;
  Object.defineProperty(w, 'scrollY', { value: scrollY, writable: true, configurable: true });

  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return { w, ctx: { page: 'chapter', settings: w.RRX.normalizeSettings(settings) } };
}

const AT_68_PERCENT = { p: 60, o: 0.5, n: 88, len: 11870, a: 1700000000, f: 149588 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

// --- when it must not fire ---------------------------------------------------

test('nothing is remembered while the feature is off', async () => {
  const { w, ctx } = load({ stored: AT_68_PERCENT });
  w.RRX.resume.apply(ctx);
  await settle();

  assert.equal(w.__scrolls.length, 0);
  assert.equal(w.__written.length, 0, 'the feature wrote to storage while switched off');
});

test('a comment permalink is never overridden', async () => {
  for (const url of [`${URL_BASE}#comment-22125114`, `${URL_BASE}?comment=22125114`]) {
    const { w, ctx } = load({ stored: AT_68_PERCENT, url, settings: { 'chapter.resume': 'jump' } });
    w.RRX.resume.apply(ctx);
    await settle();

    // The reader asked to go to a comment. That request wins outright: no
    // restore, and no chip offering one either.
    assert.equal(w.__scrolls.length, 0, `restored anyway for ${url}`);
    assert.equal(w.document.getElementById('rrx-resume'), null);
  }
});

test('a reader who has already scrolled is left where they are', async () => {
  const { w, ctx } = load({
    stored: AT_68_PERCENT,
    scrollY: 900,
    settings: { 'chapter.resume': 'jump' },
  });
  w.RRX.resume.apply(ctx);
  await settle();
  assert.equal(w.__scrolls.length, 0);
});

test('a chapter with nothing stored is left alone', async () => {
  const { w, ctx } = load({ settings: { 'chapter.resume': 'jump' } });
  w.RRX.resume.apply(ctx);
  await settle();
  assert.equal(w.__scrolls.length, 0);
  assert.equal(w.document.getElementById('rrx-resume'), null);
});

test('restoring happens once, however many times onPage re-runs', async () => {
  const { w, ctx } = load({ stored: AT_68_PERCENT, settings: { 'chapter.resume': 'jump' } });

  // onPage fires again on every settings change, and a second restore would
  // drag the reader back to where they were ten minutes ago.
  for (let i = 0; i < 5; i += 1) w.RRX.resume.apply(ctx);
  await settle();
  assert.equal(w.__scrolls.length, 1);
});

// --- the two modes -----------------------------------------------------------

test('“go straight there” scrolls and says so', async () => {
  const { w, ctx } = load({ stored: AT_68_PERCENT, settings: { 'chapter.resume': 'jump' } });
  w.RRX.resume.apply(ctx);
  await settle();

  assert.equal(w.__scrolls.length, 1);
  const toast = w.document.getElementById('rrx-toast');
  assert.ok(toast, 'a jump with no explanation is just a page that opens in the wrong place');
  assert.match(toast.textContent, /Resumed/);
  assert.match(toast.textContent, /Back to top/);
});

test('“offer it” scrolls nothing until it is clicked', async () => {
  const { w, ctx } = load({ stored: AT_68_PERCENT, settings: { 'chapter.resume': 'ask' } });
  w.RRX.resume.apply(ctx);
  await settle();

  assert.equal(w.__scrolls.length, 0);
  const chip = w.document.getElementById('rrx-resume');
  assert.ok(chip);
  assert.match(chip.textContent, /Resume where you stopped \(\d+%\)/);

  chip.click();
  assert.equal(w.__scrolls.length, 1);
  assert.equal(w.document.getElementById('rrx-resume'), null, 'the offer outlived being taken');
});

test('the offer sits above the chapter, marked as ours', async () => {
  const { w, ctx } = load({ stored: AT_68_PERCENT, settings: { 'chapter.resume': 'ask' } });
  w.RRX.resume.apply(ctx);
  await settle();

  const chip = w.document.getElementById('rrx-resume');
  assert.ok(chip.classList.contains(w.RRX.UI_CLASS));
  assert.equal(chip.getAttribute(w.RRX.chapterTop.SLOT_ATTR), '5');
  assert.equal(chip.parentElement, w.document.querySelector('.chapter-content').parentElement);
});

// --- what counts as progress -------------------------------------------------

test('progress is measured against the chapter text, not the page', () => {
  const { w } = load();
  const content = w.document.querySelector('.chapter-content');
  const stub = (top, height) => {
    content.getBoundingClientRect = () => ({ top, height, bottom: top + height });
    for (const child of content.children) {
      child.getBoundingClientRect = () => ({ top: 10, height: 20, bottom: 30 });
    }
  };
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });

  // The comments below the chapter load late and make the PAGE much taller.
  // None of that is progress through the chapter, so none of it may move this.
  stub(0, 10000);
  assert.equal(w.RRX.resume.measure().d, 0.08, 'at the top of a long chapter');

  stub(-9200, 10000);
  assert.equal(w.RRX.resume.measure().d, 1, 'the last line has been on screen');

  stub(-5000, 10000);
  assert.equal(w.RRX.resume.measure().d, 0.58);
});

test('a chapter that has been read to the end is not worth resuming', () => {
  const { w } = load();
  const { worthKeeping } = w.RRX.resume;

  assert.equal(worthKeeping({ started: true, d: 0.5 }), true);
  assert.equal(worthKeeping({ started: true, d: 0.999 }), false, 'finished');
  // Still above the chapter: the topmost visible block is block 0 at offset 0,
  // which is BELOW the reader. Saving that would scroll them forward next time.
  assert.equal(worthKeeping({ started: false, d: 0.02 }), false, 'not started');
});

test('opening the next chapter forgets the one before it', async () => {
  const { w, ctx } = load({ settings: { 'chapter.resume': 'jump' } });
  const previous = 3766600;
  w.__chapters[previous] = { f: 149588, a: 1, p: 10, o: 0, n: 88, len: 11870 };

  // Royal Road's own previous-chapter link, plus a referrer that says we came
  // through it: that is finishing a chapter, not jumping in from the contents.
  const link = w.document.querySelector('[data-vt-direction="prev"]');
  link.setAttribute('href', `/fiction/149588/x/chapter/${previous}/y`);
  Object.defineProperty(w.document, 'referrer', {
    value: `https://www.royalroad.com/fiction/149588/x/chapter/${previous}/y`,
    configurable: true,
  });

  assert.equal(w.RRX.resume.finishedBefore(), previous);
  w.RRX.resume.apply(ctx);
  await settle();
  assert.equal(previous in w.__chapters, false, 'the finished chapter was still remembered');
});

test('arriving from the contents page keeps the previous chapter’s place', async () => {
  const { w, ctx } = load({ settings: { 'chapter.resume': 'jump' } });
  const previous = 3766600;
  w.__chapters[previous] = { f: 149588, a: 1, p: 10, o: 0, n: 88, len: 11870 };

  w.document
    .querySelector('[data-vt-direction="prev"]')
    .setAttribute('href', `/fiction/149588/x/chapter/${previous}/y`);
  Object.defineProperty(w.document, 'referrer', {
    value: 'https://www.royalroad.com/fiction/149588/one-was-worthy',
    configurable: true,
  });

  assert.equal(w.RRX.resume.finishedBefore(), null);
  w.RRX.resume.apply(ctx);
  await settle();
  assert.ok(previous in w.__chapters, 'someone half way through chapter 39 lost their place');
});

// --- an edited chapter -------------------------------------------------------

test('a chapter that has been rewritten is detected, not trusted', () => {
  const { w } = load();
  const { edited } = w.RRX.resume;
  const saved = { p: 60, o: 0.5, n: 88, len: 10000 };

  assert.equal(edited(saved, { n: 88, len: 10000 }), false, 'unchanged');
  assert.equal(edited(saved, { n: 88, len: 10200 }), false, '2% is ordinary editing');
  assert.equal(edited(saved, { n: 91, len: 10000 }), true, 'paragraphs added or split');
  assert.equal(edited(saved, { n: 88, len: 14000 }), true, 'a lot of new text');
});

test('an edited chapter says so rather than claiming the same place', async () => {
  const { w, ctx } = load({
    stored: { ...AT_68_PERCENT, n: 20, len: 3000 },
    settings: { 'chapter.resume': 'jump' },
  });
  w.RRX.resume.apply(ctx);
  await settle();

  assert.match(w.document.getElementById('rrx-toast').textContent, /the chapter has changed/);
});

// --- the record --------------------------------------------------------------

test('the scratchpad and storage agree on what a position is', async () => {
  const { w } = load({ settings: { 'chapter.resume': 'jump' } });
  const position = { p: 12, o: 0.25, n: 88, len: 11870, a: 1700000000, f: 149588 };

  w.RRX.store.writePosition(CHAPTER, position);
  // Field by field: an object parsed inside jsdom carries jsdom's prototypes,
  // so a cross-realm deepEqual fails on two objects that are plainly identical.
  const scratch = w.RRX.store.readPositions()[CHAPTER];
  for (const [key, value] of Object.entries(position)) {
    assert.equal(scratch[key], value, `scratchpad lost ${key}`);
  }

  await w.RRX.store.markChapter(CHAPTER, position);
  const stored = (await w.RRX.store.loadChapters())[CHAPTER];
  assert.equal(stored.p, 12);
  assert.equal(stored.o, 0.25);
  assert.equal(stored.f, 149588);
});

test('a scratchpad newer than storage wins, because the last flush may not have landed', async () => {
  const { w, ctx } = load({
    stored: { p: 5, o: 0, n: 88, len: 11870, a: 1000 },
    settings: { 'chapter.resume': 'ask' },
  });
  w.RRX.store.writePosition(CHAPTER, { p: 70, o: 0, n: 88, len: 11870, a: 2000 });

  // Reload the module so `ready` re-reads with the scratchpad in place.
  w.eval(fs.readFileSync(path.join(ROOT, 'src/content/features/resume.js'), 'utf8'));
  w.RRX.resume.apply(ctx);
  await settle();

  const chip = w.document.getElementById('rrx-resume');
  assert.ok(chip);
  assert.match(chip.textContent, /\(80%\)/, 'the older storage record was used');
});

// --- sharing a record with the comment watermark ------------------------------

test('finishing a chapter forgets your place in it, not which comments you saw', async () => {
  const { w, ctx } = load({ settings: { 'chapter.resume': 'jump' } });
  const previous = 3766600;

  // One record, two features. Resume owns p/o/n/len/d; comments-new owns s.
  w.__chapters[previous] = { f: 149588, a: 1700000000, p: 10, o: 0.5, n: 88, len: 11870, s: 1699999999 };

  const link = w.document.querySelector('[data-vt-direction="prev"]');
  link.setAttribute('href', `/fiction/149588/x/chapter/${previous}/y`);
  Object.defineProperty(w.document, 'referrer', {
    value: `https://www.royalroad.com/fiction/149588/x/chapter/${previous}/y`,
    configurable: true,
  });

  w.RRX.resume.apply(ctx);
  await settle();

  const kept = w.__chapters[previous];
  assert.ok(kept, 'the whole record went, taking the comment watermark with it');
  assert.equal(kept.p, undefined, 'the reading position should be gone');
  assert.equal(kept.s, 1699999999, 'the comment watermark is not resume’s to delete');
});

test('a record with nothing left in it is dropped', async () => {
  const { w } = load();
  const id = 3766601;
  w.__chapters[id] = { f: 149588, a: 1700000000, p: 4, o: 0, n: 88, len: 11870 };

  await w.RRX.store.forgetPosition(id);
  assert.equal(id in w.__chapters, false, 'an empty record was kept');
});

// --- the fixes in 1.4.1 -------------------------------------------------------

test('the scratchpad evicts the oldest entry, not the lowest chapter id', async () => {
  // The comparator read `.at`, which no writer has ever set, so every
  // comparison was 0 - 0. A stable sort then left integer-like keys in
  // ascending order and the cap dropped the LOWEST id. It stayed invisible
  // because the cap itself still worked: 300 entries, just the wrong 300.
  const { w } = load({ settings: { 'chapter.resume': 'jump' } });
  const store = w.RRX.store;

  // 301 chapters. The lowest id is the NEWEST, so id order and age disagree.
  for (let i = 0; i < 301; i += 1) {
    const id = 1000 + i;
    store.writePosition(id, { p: 1, o: 0, n: 10, len: 100, a: 20000 - i, f: 1 });
  }

  const kept = store.readPositions();
  assert.equal(Object.keys(kept).length, 300, 'the cap still holds');
  assert.ok(kept[1000], 'the newest entry survived, even though its id is lowest');
  assert.equal(kept[1300], undefined, 'and the oldest was the one dropped');
});

test('a flush honours the expiry the reader chose, not the built-in default', async () => {
  // markChapter prunes on EVERY call, so a flush that omits seenMaxAgeS prunes
  // the whole map against the 60-day default and silently overrides whatever
  // comments.seenDays says. It has to go through the real flush path: calling
  // markChapter directly with the right argument would prove nothing.
  const { w, ctx } = load({
    settings: { 'chapter.resume': 'jump', 'comments.seenDays': 365 },
  });
  const store = w.RRX.store;
  w.RRX.resume.apply(ctx);
  await settle();

  // jsdom has no layout, so the chapter has to be told where it is: part-read,
  // which is the state that makes a position worth flushing at all.
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });
  const content = w.document.querySelector('.chapter-content');
  content.getBoundingClientRect = () => ({ top: -5000, height: 10000, bottom: 5000 });
  for (const child of content.children) {
    child.getBoundingClientRect = () => ({ top: 10, height: 20, bottom: 30 });
  }

  // A watermark 200 days old: stale at the 60-day default, fresh at 365.
  const now = Math.floor(Date.now() / 1000);
  await store.markChapter(4242, { s: now - 1 }, { seenMaxAgeS: 365 * 86400 });
  const seeded = await store.loadChapters();
  seeded[4242].a = now - 200 * 24 * 60 * 60;
  await w.RRX.ext.storage.local.set({ chapters: seeded });

  // Scroll to make this chapter dirty, then leave the page: that is a flush.
  w.dispatchEvent(new w.Event('scroll'));
  await settle();
  w.dispatchEvent(new w.Event('pagehide'));
  await settle();

  const after = await store.loadChapters();
  assert.ok(after[CHAPTER], 'the flush recorded this chapter, so it really ran');
  assert.ok(after[4242], 'and the 200-day-old chapter survived it');
  assert.ok(after[4242].s, 'keeping its watermark, because the reader asked for a year');
});

test('scrolling measures once per frame, not once per event', async () => {
  // measure() forces layout and used to rebuild the chapter's ~12 KB of text on
  // every scroll event. Counting frames proves nothing - the unthrottled version
  // never asked for one. Count the measurements themselves.
  const { w, ctx } = load({ settings: { 'chapter.resume': 'jump' }, scrollY: 400 });
  w.RRX.resume.apply(ctx);
  await settle();

  let measured = 0;
  const inner = w.RRX.chapterTop.content;
  w.RRX.chapterTop.content = (...args) => {
    measured += 1;
    return inner.apply(w.RRX.chapterTop, args);
  };

  for (let i = 0; i < 20; i += 1) w.dispatchEvent(new w.Event('scroll'));
  const duringBurst = measured;
  await settle();

  assert.equal(duringBurst, 0, `20 scroll events measured ${duringBurst} times before any frame ran`);
  assert.ok(measured <= 2, `and ${measured} times in total, not once per event`);
});
