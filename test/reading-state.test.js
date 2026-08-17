'use strict';

/**
 * The two features that share a chapter record, exercised together.
 *
 * Resume and seen-comments write to the same `chapters` entry, and everything
 * that has gone wrong between them has gone wrong in the seams: one deleting
 * the other's half, or a write that never lands before the page goes away.
 * Neither shows up in a test of either feature alone, so this walks the actual
 * journey - read a chapter, read its comments, move on, come back - against one
 * storage that outlives each page.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const SKIP = need('chapter.new.html') || need('chapter-comments-nested.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const CH1 = 3766643;
const CH2 = 3766644;
const url = (id) => `https://www.royalroad.com/fiction/149588/x/chapter/${id}/y`;

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/css.js',
  'src/common/store.js',
  'src/content/ui.js',
  'src/content/chapter-top.js',
  'src/content/pager.js',
  'src/content/features/comments.js',
  'src/content/features/comments-new.js',
  'src/content/features/resume.js',
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
 * One page load. `storage` is the object that survives between them, standing
 * in for browser.storage.local.
 */
function visit({ storage, chapter, page = 'chapter-comments-nested.new.html', referrer = '' }) {
  const dom = new JSDOM(fixture(page), { url: url(chapter), runScripts: 'outside-only' });
  const w = dom.window;
  windows.push(w);

  w.__store = storage;
  w.eval(`
    globalThis.browser = {
      storage: {
        local: {
          get: async (keys) => {
            const wanted = [].concat(keys);
            const out = {};
            for (const key of wanted) if (key in globalThis.__store) out[key] = globalThis.__store[key];
            return out;
          },
          set: async (patch) => Object.assign(globalThis.__store, patch),
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      runtime: {},
    };
    globalThis.scrollTo = () => {};
  `);
  if (referrer) Object.defineProperty(w.document, 'referrer', { value: referrer, configurable: true });

  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return w;
}

const settings = (w, over) =>
  w.RRX.normalizeSettings({ 'comments.seen': 'fold', 'chapter.resume': 'jump', ...over });

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

test('reading a chapter’s comments, moving on, and coming back leaves them folded', async () => {
  const storage = { chapters: {} };

  // --- visit one: chapter 1, read the comments ---
  const first = visit({ storage, chapter: CH1 });
  const ctx1 = { page: 'chapter', settings: settings(first) };
  await first.RRX.commentsNew.state; // no-op, keeps the shape obvious
  first.RRX.commentsNew.apply(ctx1);
  await settle();

  // Nothing is marked on a first visit, and nothing folds.
  assert.equal(first.document.querySelectorAll('.rrx-comment-seen').length, 0);

  // The reader looks at the comments for long enough to count.
  first.RRX.commentsNew.setDwelt(true);
  first.RRX.commentsNew.commit();
  await settle();

  const afterFirst = storage.chapters[CH1];
  assert.ok(afterFirst && afterFirst.s, 'nothing was recorded about the comments');

  // --- visit two: chapter 2, arrived through the next-chapter link ---
  const second = visit({
    storage,
    chapter: CH2,
    page: 'chapter.new.html',
    referrer: url(CH1),
  });
  second.document
    .querySelector('[data-vt-direction="prev"]')
    .setAttribute('href', `/fiction/149588/x/chapter/${CH1}/y`);
  second.RRX.resume.apply({ page: 'chapter', settings: settings(second) });
  await settle();

  // Chapter 1 is finished, so its reading position goes - but not what it knows
  // about the comments. This is the seam the bug lived in.
  const afterSecond = storage.chapters[CH1];
  assert.ok(afterSecond, 'the whole record was deleted when the chapter was finished');
  assert.equal(afterSecond.s, afterFirst.s, 'the comment watermark did not survive');

  // --- visit three: back to chapter 1, later ---
  // Aged deliberately. These three visits happen in the same millisecond, and a
  // reload inside the grace window is treated as one sitting so the page is not
  // reorganised under somebody who is still reading. "Coming back" means coming
  // back, so the record has to look like it.
  storage.chapters[CH1].a -= 60 * 60;

  const third = visit({ storage, chapter: CH1 });
  const ctx3 = { page: 'chapter', settings: settings(third) };
  await settle();
  third.RRX.commentsNew.apply(ctx3);

  const folded = third.document.querySelectorAll('.rrx-comment-seen').length;
  const total = third.document.querySelectorAll('[data-comment-id]').length;
  assert.equal(third.RRX.commentsNew.state().seenAt, afterFirst.s, 'the watermark was not read back');
  assert.equal(folded, total, `only ${folded} of ${total} comments folded`);
});

test('switching either one off stops it recording in the tab you switched it in', async () => {
  // The listeners are latched on and never removed, so onPage's early return
  // only takes effect on the *next* page load. In the tab where the reader
  // flipped the switch, scrolling went on writing positions and leaving the page
  // went on moving the watermark - against "nothing is recorded while this is
  // off", which is the promise both settings make.
  const storage = { chapters: {} };
  const w = visit({ storage, chapter: CH1 });

  const on = { page: 'chapter', settings: settings(w) };
  w.RRX.commentsNew.apply(on);
  w.RRX.resume.apply(on);
  await settle();

  const off = {
    page: 'chapter',
    settings: settings(w, { 'comments.seen': 'off', 'chapter.resume': 'off' }),
  };
  w.RRX.commentsNew.apply(off);
  w.RRX.resume.apply(off);

  // Everything the surviving handlers would call.
  w.RRX.commentsNew.setDwelt(true);
  w.RRX.commentsNew.commit();
  await settle();

  assert.deepEqual(Object.keys(storage.chapters), [], 'nothing was written');
});

test('and switching resume off does not delete the position it stopped writing', async () => {
  // The sharper half: `measureNow` calls `forget` for a chapter not worth
  // keeping, and that is reachable from the same latched scroll handler. With
  // the guard on the writes only, scrolling in a tab where resume had just been
  // switched off deleted the saved position and nothing put it back.
  const storage = { chapters: { [CH1]: { f: 149588, a: 1, p: 12, o: 0.5 } } };
  const w = visit({ storage, chapter: CH1 });

  w.RRX.resume.apply({ page: 'chapter', settings: settings(w) });
  await settle();
  w.RRX.resume.apply({ page: 'chapter', settings: settings(w, { 'chapter.resume': 'off' }) });

  w.RRX.resume.forget(CH1);
  await settle();
  assert.ok(storage.chapters[CH1], 'the position survived');
  assert.equal(storage.chapters[CH1].p, 12);
});

test('a sweep before the record has loaded does not poison the watermark', async () => {
  const storage = { chapters: {} };

  const first = visit({ storage, chapter: CH1 });
  first.RRX.commentsNew.setDwelt(true);
  await settle();
  first.RRX.commentsNew.apply({ page: 'chapter', settings: settings(first) });
  first.RRX.commentsNew.commit();
  await settle();
  const watermark = storage.chapters[CH1].s;
  assert.ok(watermark);

  // main.js calls syncCards during its own startup and again on every sweep, so
  // this runs long before an async storage read can finish. Resolving from a
  // record that is not in yet gives "never visited", and pinning that made
  // every return look like a first visit for the rest of the page view.
  // Aged, so this reads as a return rather than a reload: inside the grace
  // window nothing folds by design, which would hide what this is testing.
  storage.chapters[CH1].a -= 60 * 60;

  const back = visit({ storage, chapter: CH1 });
  const ctx = { page: 'chapter', settings: settings(back) };
  back.RRX.commentsNew.apply(ctx); // synchronous: the read cannot have finished
  assert.equal(back.document.querySelectorAll('.rrx-comment-seen').length, 0);

  await settle();
  back.RRX.commentsNew.apply(ctx);

  const folded = back.document.querySelectorAll('.rrx-comment-seen').length;
  const total = back.document.querySelectorAll('[data-comment-id]').length;
  assert.equal(back.RRX.commentsNew.state().seenAt, watermark, 'the early pass pinned a zero');
  assert.equal(folded, total, `only ${folded} of ${total} folded`);
});
