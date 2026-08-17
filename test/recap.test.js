'use strict';

/**
 * The recap: the end of the previous chapter, at the top of this one.
 *
 * NB: arrays created inside jsdom carry its prototypes, so a strict deepEqual
 * against a plain `[]` fails even when both are empty. Lengths are compared.
 *
 * The behaviour worth pinning is what it does with the *shape* of a real
 * chapter, since that is where the guesswork is: chapters end on scene breaks,
 * the first chapter of a fiction has nothing before it, and the whole feature
 * must cost nothing at all while it is switched off.
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
  'src/content/features/recap.js',
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

/** A chapter page with the previous chapter's body served to any fetch. */
function load({ previousHtml = fixture('chapter.new.html'), settings = {} } = {}) {
  const dom = new JSDOM(fixture('chapter.new.html'), {
    url: 'https://www.royalroad.com/fiction/149588/x/chapter/3766643/y',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  w.eval('globalThis.browser = { storage: { local: {}, onChanged: {} }, runtime: {} };');
  w.__prev = previousHtml;
  w.eval(`
    globalThis.__fetched = [];
    globalThis.fetch = async (url) => {
      globalThis.__fetched.push(String(url));
      return { ok: true, status: 200, text: async () => globalThis.__prev };
    };
  `);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  w.__ctx = { page: 'chapter', settings: w.RRX.normalizeSettings(settings) };
  return w;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test('the ending is taken from prose, not from the scene break it closes on', () => {
  const w = load();
  const doc = new w.DOMParser().parseFromString(
    `<div class="chapter-content">
       <p>Real paragraph one.</p>
       <p>Real paragraph two.</p>
       <p>***</p>
       <p>   </p>
     </div>`,
    'text/html'
  );
  // Chapters routinely end on a line of asterisks. Counting those towards the
  // recap spends the reader's paragraphs on punctuation.
  const tail = w.RRX.recap.tailOf(doc, 2);
  assert.equal(tail, 'Real paragraph one.\n\nReal paragraph two.');
});

test('separator-only paragraphs are recognised in the forms chapters use', () => {
  const w = load();
  const { SEPARATOR_ONLY } = w.RRX.recap;
  for (const line of ['***', '* * *', '---', '~~~', '. . .', '===', '   ']) {
    assert.ok(SEPARATOR_ONLY.test(line), `should count as a separator: ${JSON.stringify(line)}`);
  }
  for (const line of ['He left.', 'Chapter 2', '"Stop."', '5 minutes later']) {
    assert.equal(SEPARATOR_ONLY.test(line), false, `is prose: ${JSON.stringify(line)}`);
  }
});

test('nothing is fetched while the feature is off', async () => {
  const w = load({ settings: { 'recap.mode': 'off' } });
  await w.RRX.recap.apply(w.__ctx);
  await settle();
  assert.equal(w.eval('globalThis.__fetched').length, 0, 'off means off, including the request');
  assert.equal(w.document.getElementById('rrx-recap'), null);
});

test('the previous chapter is fetched once and shown above the chapter', async () => {
  const w = load({ settings: { 'recap.mode': 'always', 'recap.paragraphs': 3 } });
  await w.RRX.recap.apply(w.__ctx);
  await settle();

  const fetched = w.eval('globalThis.__fetched');
  assert.equal(fetched.length, 1, 'one request');
  assert.match(fetched[0], /\/chapter\/\d+/, 'and it is a chapter URL');

  const block = w.document.getElementById('rrx-recap');
  assert.ok(block, 'the recap is rendered');
  assert.equal(block.querySelectorAll('.rrx-recap__body > p').length, 3, 'the asked-for length');

  const content = w.document.querySelector('.chapter-content');
  assert.ok(
    block.compareDocumentPosition(content) & w.Node.DOCUMENT_POSITION_FOLLOWING,
    'it sits above the chapter it introduces'
  );
  assert.ok(block.querySelector('a[href*="/chapter/"]'), 'and links to the whole chapter');
});

test('re-running does not refetch or rebuild what is already correct', async () => {
  // onPage runs again on every settings change, and a rebuild would collapse a
  // recap the reader had opened.
  const w = load({ settings: { 'recap.mode': 'click' } });
  await w.RRX.recap.apply(w.__ctx);
  await settle();
  const first = w.document.getElementById('rrx-recap');
  assert.ok(first);

  await w.RRX.recap.apply(w.__ctx);
  await settle();
  assert.equal(w.eval('globalThis.__fetched').length, 1, 'still one request');
  assert.equal(w.document.getElementById('rrx-recap'), first, 'the same element survives');
});

test('click mode is a real disclosure, so it is keyboard reachable', async () => {
  const w = load({ settings: { 'recap.mode': 'click' } });
  await w.RRX.recap.apply(w.__ctx);
  await settle();
  const block = w.document.getElementById('rrx-recap');
  assert.equal(block.tagName, 'DETAILS', 'not a div with a click handler');
  assert.ok(block.querySelector('summary'), 'and it has a summary to operate');
  assert.equal(block.hasAttribute('open'), false, 'closed until asked');
});

test('the first chapter of a fiction says nothing at all', async () => {
  const w = load({ settings: { 'recap.mode': 'always' } });
  // Royal Road simply omits the link at the ends, which is how we know.
  for (const link of w.document.querySelectorAll(w.RRX.SEL.chapterPrev)) link.remove();

  await w.RRX.recap.apply(w.__ctx);
  await settle();
  assert.equal(w.eval('globalThis.__fetched').length, 0, 'nothing to fetch');
  assert.equal(w.document.getElementById('rrx-recap'), null, 'and nothing to show');
});

test('a chapter Royal Road will not serve leaves the page alone', async () => {
  const w = load({ settings: { 'recap.mode': 'always' } });
  w.eval('globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => "" });');

  await w.RRX.recap.apply(w.__ctx);
  await settle();
  assert.equal(w.document.getElementById('rrx-recap'), null, 'no empty box is left behind');
  assert.ok(w.document.querySelector('.chapter-content'), 'and the chapter is untouched');
});

test('hover mode actually opens the recap', async () => {
  // It used to be attempted in CSS, revealing `.rrx-recap__body` inside a closed
  // `<details>`. That can never work: a closed one hides its contents through
  // `::details-content`, which no rule on a descendant can reach, so the setting
  // silently behaved as click mode and quietly lied about what it did.
  const w = load({ settings: { 'recap.mode': 'hover' } });
  await w.RRX.recap.apply(w.__ctx);
  await settle();

  const block = w.document.getElementById('rrx-recap');
  assert.equal(block.hasAttribute('open'), false, 'closed to begin with');

  block.dispatchEvent(new w.MouseEvent('mouseenter'));
  assert.equal(block.hasAttribute('open'), true, 'hovering opens it');

  block.dispatchEvent(new w.MouseEvent('mouseleave'));
  assert.equal(block.hasAttribute('open'), false, 'and leaving closes it again');
});

test('a recap opened on purpose stays open when the pointer leaves', async () => {
  // Having it shut itself mid-sentence is worse than having to close it by hand.
  const w = load({ settings: { 'recap.mode': 'hover' } });
  await w.RRX.recap.apply(w.__ctx);
  await settle();

  const block = w.document.getElementById('rrx-recap');
  const summary = block.querySelector('summary');

  // Hovering has already opened it by the time anyone can click, so the click
  // must pin rather than toggle: otherwise it closes what was reached for.
  block.dispatchEvent(new w.MouseEvent('mouseenter'));
  summary.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(block.hasAttribute('open'), true, 'still open after the click');

  block.dispatchEvent(new w.MouseEvent('mouseleave'));
  assert.equal(block.hasAttribute('open'), true, 'and it stays put once the pointer goes');

  summary.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(block.hasAttribute('open'), false, 'clicking again lets it go');
});

test('the cache is capped, so a long session cannot crowd out the site', () => {
  // Every entry is the chapter's whole text, ~12 KB, in a sessionStorage budget
  // shared with royalroad.com. Uncapped, a binge filled it, every setItem then
  // threw, the catch swallowed it, and the recap refetched every chapter for
  // the rest of the session with no way back.
  const w = load();
  const store = w.RRX.recap;
  for (let i = 1; i <= 60; i += 1) store.cacheSet(String(i), 'x'.repeat(500));

  const keys = [];
  for (let i = 0; i < w.sessionStorage.length; i += 1) {
    const key = w.sessionStorage.key(i);
    if (key && key.startsWith('rrx:recap:')) keys.push(key);
  }
  assert.ok(keys.length <= 40, `kept ${keys.length} entries, expected the cap to hold`);
  assert.ok(w.sessionStorage.getItem('rrx:recap:60'), 'the newest chapter survived');
  assert.equal(w.sessionStorage.getItem('rrx:recap:1'), null, 'the oldest was dropped');
});

// --- naming the chapter ------------------------------------------------------

const ORC = 'CHAPTER 3 _ The Cry of Victory - Reincarnated as an Orc_ From Tribe to Empire [Kingdom Building] - no infinite scroll with comments loaded.htm';

test('the previous chapter is named, on both captures', () => {
  const w = load();
  const parse = (html) => new w.DOMParser().parseFromString(html, 'text/html');

  // A chapter page has no h1, and the heading carrying the title is an h3 known
  // only by Tailwind classes - so the title comes off <title>, with the fiction
  // half removed by exact match rather than by splitting on " - ".
  assert.equal(
    w.RRX.recap.titleOf(parse(fixture('chapter.new.html'))),
    '24 – Alone at Home'
  );
  if (!need(ORC)) {
    assert.equal(w.RRX.recap.titleOf(parse(fixture(ORC))), 'CHAPTER 3 : The Cry of Victory');
  }
});

test('a title is not split on " - ", which appears inside both halves', () => {
  const w = load();
  const doc = new w.DOMParser().parseFromString(
    `<html><head><title>23 - Interlude: The Lass - Part Three - A Tale - Of Two</title></head>
     <body><a href="/fiction/149588/a-tale-of-two">A Tale - Of Two</a></body></html>`,
    'text/html'
  );
  // Splitting on the first " - " keeps "23", on the last it keeps the fiction's
  // own dash. Removing the fiction title itself is the only thing that works.
  assert.equal(w.RRX.recap.titleOf(doc), '23 - Interlude: The Lass - Part Three');
});

test('an unreadable title shows the label alone rather than a guess', () => {
  const w = load();
  const parse = (html) => new w.DOMParser().parseFromString(html, 'text/html');

  // No fiction link to measure against.
  assert.equal(w.RRX.recap.titleOf(parse('<title>Some Chapter - Some Fiction</title>')), '');
  // A <title> that does not end in the fiction title says nothing reliable.
  assert.equal(
    w.RRX.recap.titleOf(
      parse('<title>Some Chapter</title><a href="/fiction/1/x">Some Fiction</a>')
    ),
    ''
  );
  // Deeper links are not the fiction's own page.
  assert.equal(
    w.RRX.recap.fictionTitleIn(
      parse('<a href="/fiction/1/x/chapter/2/y">Chapter Two</a>')
    ),
    ''
  );
});

test('the name is shown beside the label, and is the whole of its own text', async () => {
  const w = load({ settings: { 'recap.mode': 'always', 'recap.paragraphs': 2 } });
  await w.RRX.recap.apply(w.__ctx);
  await settle();

  const name = w.document.querySelector('.rrx-recap__chapter');
  assert.ok(name, 'the recap did not name the chapter');
  // The separator is CSS: find-in-page and a screen reader get the title alone.
  assert.equal(name.textContent, '24 – Alone at Home');
  assert.match(w.document.querySelector('.rrx-recap__label').textContent, /^Previously/);
});

test('a chapter whose name cannot be read still gets its recap', async () => {
  const w = load({
    previousHtml: '<html><head><title>no fiction link here</title></head><body><div class="chapter-content"><p>It ended.</p></div></body></html>',
    settings: { 'recap.mode': 'always', 'recap.paragraphs': 2 },
  });
  await w.RRX.recap.apply(w.__ctx);
  await settle();

  assert.ok(w.document.getElementById('rrx-recap'), 'no name cost the reader the recap itself');
  assert.equal(w.document.querySelector('.rrx-recap__chapter'), null);
});

test('a cache entry written before the name existed still reads as text', async () => {
  // sessionStorage outlives an update inside one tab, and those entries are the
  // bare tail string. Read as text with no name, rather than as a failure.
  const w = load({ settings: { 'recap.mode': 'always', 'recap.paragraphs': 2 } });
  w.sessionStorage.setItem('rrx:recap:3752453', 'An older ending.');
  await w.RRX.recap.apply(w.__ctx);
  await settle();

  assert.equal(w.eval('globalThis.__fetched').length, 0, 'the old entry was ignored and refetched');
  assert.match(w.document.querySelector('.rrx-recap__body').textContent, /An older ending\./);
  assert.equal(w.document.querySelector('.rrx-recap__chapter'), null);
});
