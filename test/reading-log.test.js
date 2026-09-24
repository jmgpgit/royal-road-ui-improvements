'use strict';

/**
 * What counts as reading a chapter, for the reading log.
 *
 * jsdom has no layout, so the chapter is told where it is: its rect and the
 * viewport height are stubbed, as in resume.test.js, and so is the clock the
 * time guard reads. Whether the rule matches real reading is a browser check.
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
  'src/content/features/chapter-meta.js',
  'src/content/features/resume.js',
  'src/content/features/recap.js',
  'src/content/features/reading-log.js',
];

const CHAPTER = 3766643;
const FICTION = 149588;
const URL_BASE = `https://www.royalroad.com/fiction/${FICTION}/x/chapter/${CHAPTER}/y`;
const MINUTES = 60 * 1000;

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

/** One page view. `storage` stands in for storage.local and outlives the page. */
function visit({ storage = {}, url = URL_BASE, settings = { 'history.log': true }, start = true } = {}) {
  const dom = new JSDOM(fixture('chapter.new.html'), {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  windows.push(w);

  w.__store = storage;
  w.eval(`
    globalThis.browser = {
      storage: {
        local: {
          get: async (keys) => {
            const out = {};
            for (const key of [].concat(keys)) if (key in globalThis.__store) out[key] = globalThis.__store[key];
            return JSON.parse(JSON.stringify(out));
          },
          set: async (patch) => Object.assign(globalThis.__store, patch),
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      runtime: {},
    };
  `);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));

  // Long enough since load unless a test says otherwise.
  w.performance.now = () => 30 * MINUTES;
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });

  const ctx = { page: 'chapter', settings: w.RRX.normalizeSettings(settings) };
  if (start) w.RRX.readingLog.apply(ctx);
  return { w, ctx };
}

/** Timers the page sets, held rather than run, so a test decides when. */
function holdTimers(w) {
  const timers = [];
  w.setTimeout = (fn, ms) => timers.push({ fn, ms, live: true });
  w.clearTimeout = (id) => {
    if (timers[id - 1]) timers[id - 1].live = false;
  };
  return timers;
}

/** Put the chapter's top `top` px from the viewport top; 10,000 px tall. */
function scrollTo(w, top) {
  const content = w.document.querySelector('.chapter-content');
  content.getBoundingClientRect = () => ({ top, height: 10000, bottom: top + 10000 });
  w.dispatchEvent(new w.Event('scroll'));
}

const AT_END = -9300;
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const today = (w) => w.RRX.dayKey(new Date());

test('a chapter read to the end is counted once per page view', async () => {
  const { w } = visit();
  scrollTo(w, AT_END);
  await settle();
  let calls = 0;
  const local = w.browser.storage.local;
  const { get, set } = local;
  local.get = (keys) => ((calls += 1), get(keys));
  local.set = (patch) => ((calls += 1), set(patch));
  scrollTo(w, AT_END + 100);
  await settle();
  assert.equal(calls, 0, 'the view is latched, not re-checked against the ring');

  const log = w.__store.log;
  assert.ok(log, 'nothing was logged');
  const [chapters, words] = log.d[today(w)];
  assert.equal(chapters, 1);
  assert.equal(words, w.RRX.chapterMeta.wordCount());
  assert.ok(words > 1000, 'the words are the chapter’s own count');
  assert.equal(log.f[FICTION].c, 1);
  assert.equal(log.f[FICTION].t, w.RRX.recap.fictionTitleIn(w.document), 'the title is kept');
  assert.ok(log.f[FICTION].t, 'and the fixture has one');
  assert.deepEqual([...log.r], [CHAPTER]);
});

test('nothing is counted while the log is off', async () => {
  const { w } = visit({ settings: {} });
  scrollTo(w, AT_END);
  await settle();
  assert.equal(w.__store.log, undefined);
});

test('switching it off in an open tab stops the counting there', async () => {
  const { w, ctx } = visit();
  ctx.settings = w.RRX.normalizeSettings({ 'history.log': false });
  scrollTo(w, AT_END);
  await settle();
  assert.equal(w.__store.log, undefined);
});

test('a chapter not yet at its last line is not counted', async () => {
  const { w } = visit();
  scrollTo(w, -5000);
  await settle();
  assert.equal(w.__store.log, undefined);
});

test('a page opened from a comment link is not counted', async () => {
  for (const url of [`${URL_BASE}#comment-22125114`, `${URL_BASE}?comment=22125114`]) {
    const { w } = visit({ url });
    // Royal Road strips the fragment once the comments load.
    w.history.replaceState(null, '', URL_BASE);
    scrollTo(w, AT_END);
    await settle();
    assert.equal(w.__store.log, undefined, url);
  }
});

test('reaching the end too soon after opening is a skim, until enough time has passed', async () => {
  const { w } = visit();
  w.performance.now = () => 5000;
  scrollTo(w, AT_END);
  await settle();
  assert.equal(w.__store.log, undefined, 'five seconds into a chapter of a few thousand words');

  w.performance.now = () => 30 * MINUTES;
  scrollTo(w, AT_END);
  await settle();
  assert.equal(w.__store.log.d[today(w)][0], 1);
});

test('a reload at the bottom does not count the chapter twice', async () => {
  const storage = {};
  const first = visit({ storage });
  scrollTo(first.w, AT_END);
  await settle();

  const second = visit({ storage });
  scrollTo(second.w, AT_END);
  await settle();
  assert.equal(storage.log.d[today(second.w)][0], 1);
  assert.equal(storage.log.f[FICTION].c, 1);
});

test('it counts with “come back to where you stopped” off', async () => {
  const { w, ctx } = visit();
  assert.equal(ctx.settings['chapter.resume'], 'off');
  scrollTo(w, AT_END);
  await settle();
  assert.ok(w.__store.log);
  assert.equal(w.__store.chapters, undefined, 'and writes no chapter record');
});

test('a chapter that ends on screen counts once it has been visible long enough', async () => {
  const { w, ctx } = visit({ start: false });
  const timers = holdTimers(w);
  // Short enough to end inside the viewport, and nothing is ever scrolled.
  w.document.querySelector('.chapter-content').getBoundingClientRect = () => ({ top: 0, height: 500, bottom: 500 });
  w.RRX.readingLog.apply(ctx);

  const words = w.RRX.chapterMeta.wordCount();
  const share = (w.RRX.readingLog.MIN_SHARE * words * MINUTES) / ctx.settings['chapter.wpm'];
  assert.equal(timers.length, 1);
  assert.equal(Math.round(timers[0].ms), Math.round(share), 'the same share the scroll rule waits for');
  timers[0].fn();
  await settle();
  assert.equal(w.__store.log.d[today(w)][0], 1);
});

// --- time spent reading ----------------------------------------------------------

/** `visit` puts the clock at 30 minutes when the page starts listening. */
const START = 30 * MINUTES;
const SECONDS = 1000;
const at = (w, ms) => {
  w.performance.now = () => START + ms;
};
const press = (w) => w.dispatchEvent(new w.KeyboardEvent('keydown'));
function setVisible(w, visible) {
  Object.defineProperty(w.document, 'visibilityState', {
    value: visible ? 'visible' : 'hidden',
    configurable: true,
  });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
}
const seconds = (w) => (w.__store.log ? w.__store.log.d[today(w)][2] : 0);

test('only visible time counts towards reading a chapter that ends on screen', () => {
  const { w, ctx } = visit({ start: false });
  const timers = holdTimers(w);
  w.document.querySelector('.chapter-content').getBoundingClientRect = () => ({ top: 0, height: 500, bottom: 500 });
  setVisible(w, false);
  w.RRX.readingLog.apply(ctx);
  assert.equal(timers.length, 0, 'a background tab waits for nothing');

  at(w, 0);
  setVisible(w, true);
  const share = timers[0].ms;
  at(w, share / 2);
  setVisible(w, false);
  assert.equal(timers[0].live, false, 'hidden again, so the wait stops');

  at(w, share * 5); // a long stretch in the background counts for nothing
  setVisible(w, true);
  assert.equal(Math.round(timers[1].ms), Math.round(share / 2));
});

test('time between inputs counts, and a long pause only up to the idle cap', async () => {
  const { w } = visit();
  at(w, 20 * SECONDS);
  press(w);
  await settle();
  assert.equal(seconds(w), 0, 'held until a minute has built up');

  at(w, 20 * SECONDS + 10 * MINUTES);
  press(w);
  await settle();
  assert.equal(seconds(w), 20 + w.RRX.readingLog.IDLE_MS / 1000);
});

test('time is written when the tab is hidden, and not counted while it is', async () => {
  const { w } = visit();
  at(w, 30 * SECONDS);
  press(w);
  at(w, 40 * SECONDS);
  setVisible(w, false);
  await settle();
  assert.equal(seconds(w), 40);

  at(w, 5 * MINUTES);
  press(w); // hidden: another tab has the reader
  at(w, 6 * MINUTES);
  press(w);
  await settle();
  assert.equal(seconds(w), 40, 'inputs while hidden credit nothing');
  setVisible(w, true);
  at(w, 6 * MINUTES + 15 * SECONDS);
  w.dispatchEvent(new w.Event('pagehide'));
  await settle();
  assert.equal(seconds(w), 55, 'the hidden stretch counted nothing');
});

test('no time is counted while the log is off, or after it is switched off', async () => {
  const off = visit({ settings: {} });
  at(off.w, 30 * SECONDS);
  press(off.w);
  setVisible(off.w, false);
  await settle();
  assert.equal(off.w.__store.log, undefined);

  const { w, ctx } = visit();
  at(w, 30 * SECONDS);
  press(w);
  ctx.settings = w.RRX.normalizeSettings({ 'history.log': false });
  setVisible(w, false);
  await settle();
  assert.equal(w.__store.log, undefined, 'the unwritten half minute was dropped');
});

test('a finish and a time flush in the same moment both land', async () => {
  // Both rewrite the whole log; unqueued, the second wrote back a log without
  // the first.
  const { w } = visit();
  // A read that answers slower than a frame, so the finish reads before the
  // flush has written.
  const local = w.RRX.ext.storage.local;
  const get = local.get;
  local.get = (keys) => {
    const answer = get(keys);
    return new Promise((resolve) => setTimeout(() => resolve(answer), 30));
  };

  at(w, 50 * SECONDS);
  press(w);
  at(w, 70 * SECONDS);
  scrollTo(w, AT_END); // input past the flush threshold, and the chapter's end
  await new Promise((resolve) => setTimeout(resolve, 200));
  const [chapters, , time] = w.__store.log.d[today(w)];
  assert.equal(chapters, 1);
  assert.equal(time, 70);
});
