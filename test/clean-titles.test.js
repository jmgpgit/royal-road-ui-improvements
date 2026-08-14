'use strict';

/**
 * Trimming genre tags out of titles.
 *
 * The pure function is tested on its own because the interesting cases are all
 * about *not* over-trimming, and the DOM half is tested against a real list
 * page, including that the original comes back when the setting goes off.
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
  'src/common/filters.js',
  'src/common/css.js',
  'src/content/ui.js',
  'src/content/features/clean-titles.js',
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

function load() {
  const dom = new JSDOM(fixture('fictions-rising-stars.new.html'), {
    url: 'https://www.royalroad.com/fictions/rising-stars',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  w.eval(`globalThis.browser = { storage: { local: {}, onChanged: {} }, runtime: {} };`);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return w;
}

const ctxWith = (w, on) => ({
  page: 'list',
  settings: w.RRX.normalizeSettings({ 'list.cleanTitles': on }),
});

test('titles with a bracketed tag suffix are trimmed to the name', () => {
  const w = load();
  const { cleanTitle } = w.RRX.cleanTitles;

  assert.equal(cleanTitle('Some Title - [Post-Apocalyptic Dungeon Core]'), 'Some Title');
  assert.equal(cleanTitle('Another Title (Book One Complete)'), 'Another Title');
  assert.equal(
    cleanTitle('A Third Title (OP MC/ Magic Academy/ LitRPG/ Hidden Genius)'),
    'A Third Title'
  );
});

test('several bracketed runs, in either style, all go', () => {
  const w = load();
  const { cleanTitle } = w.RRX.cleanTitles;
  assert.equal(cleanTitle('Title [LitRPG] (Book 2)'), 'Title');
  assert.equal(cleanTitle('Title [A][B][C]'), 'Title');
  assert.equal(cleanTitle('A Name: The Subtitle [Time Loop]'), 'A Name: The Subtitle');
});

test('curly braces count as brackets too', () => {
  const w = load();
  const { cleanTitle } = w.RRX.cleanTitles;
  // Authors use braces for progress markers, and mix them with the other kinds
  // in one title.
  assert.equal(
    cleanTitle('Sovereign Harvest {Arc 6 Complete}[A Slow Burn Grimdark Progression LitRPG]'),
    'Sovereign Harvest'
  );
  assert.equal(cleanTitle('Title {Complete}'), 'Title');
  assert.equal(cleanTitle('Title {Arc 1} (LitRPG) [Progression]'), 'Title');
  // A run stops at its own closing brace, so the words after it survive.
  assert.equal(cleanTitle('Hard {Mode} Rules'), 'Hard Rules');
  assert.equal(cleanTitle('{Only Braces}'), '{Only Braces}');
});

test('titles with nothing to trim are returned untouched', () => {
  const w = load();
  const { cleanTitle } = w.RRX.cleanTitles;
  for (const title of ['A Plain Title', 'Another One', 'Three Word Title']) {
    assert.equal(cleanTitle(title), title);
  }
});

test('a title that is entirely bracketed is kept rather than emptied', () => {
  const w = load();
  const { cleanTitle } = w.RRX.cleanTitles;
  // Every bracket kind, since each one is a separate chance to blank a card.
  assert.equal(cleanTitle('[Placeholder]'), '[Placeholder]');
  assert.equal(cleanTitle('(untitled)'), '(untitled)');
  assert.equal(cleanTitle('{Arc 6 Complete}'), '{Arc 6 Complete}');
  assert.equal(cleanTitle('{A}[B](C)'), '{A}[B](C)');
  assert.equal(cleanTitle(''), '');
});

test('a trim that would leave nothing readable is abandoned', () => {
  const w = load();
  const { cleanTitle } = w.RRX.cleanTitles;
  // A card with no name on it is worse than a card with an untidy one, so the
  // original comes back whenever the remainder is not worth showing.
  assert.equal(cleanTitle('- [LitRPG]'), '- [LitRPG]');
  assert.equal(cleanTitle('A {Progression}'), 'A {Progression}', 'one letter is not a title');
  assert.equal(cleanTitle('!!! (Complete)'), '!!! (Complete)', 'punctuation is not a title');
  // ...but a real name still trims, including a short one.
  assert.equal(cleanTitle('Re {Complete}'), 'Re');
});

test('punctuation inside the title survives', () => {
  const w = load();
  const { cleanTitle } = w.RRX.cleanTitles;
  // The colon and the hyphen here are part of the name, not a tag separator.
  assert.equal(cleanTitle('Re:Start - The Beginning'), 'Re:Start - The Beginning');
  assert.equal(cleanTitle('One Name/Other Name'), 'One Name/Other Name');
});

test('on a real list page, titles are trimmed and the full text stays in reach', () => {
  const w = load();
  const headings = () => [...w.document.querySelectorAll('.fiction-card-expanded h2')];
  const before = headings().map((h) => h.textContent.trim());

  w.RRX.cleanTitles.apply(w.document, true);
  const after = headings().map((h) => h.textContent.trim());

  const changed = after.filter((t, i) => t !== before[i]);
  assert.ok(changed.length > 0, 'a live list page always has a few tagged titles');
  for (const [i, heading] of headings().entries()) {
    assert.ok(heading.textContent.trim().length > 0, 'never blanked');
    if (after[i] !== before[i]) assert.equal(heading.title, before[i], 'full title in the tooltip');
  }
});

test('turning it off puts every original title back exactly', () => {
  const w = load();
  const headings = () => [...w.document.querySelectorAll('.fiction-card-expanded h2')];
  const before = headings().map((h) => h.textContent);

  w.RRX.cleanTitles.apply(w.document, true);
  w.RRX.cleanTitles.apply(w.document, false);

  assert.deepEqual(headings().map((h) => h.textContent), before);
  for (const h of headings()) assert.equal(h.hasAttribute('title'), false);
});

test('applying twice does not trim the trimmed title again', () => {
  const w = load();
  const ctx = ctxWith(w, true);
  w.RRX.cleanTitles.apply(w.document, true);
  const once = [...w.document.querySelectorAll('.fiction-card-expanded h2')].map((h) => h.textContent);
  w.RRX.cleanTitles.apply(w.document, true);
  w.RRX.cleanTitles.apply(w.document, true);
  const thrice = [...w.document.querySelectorAll('.fiction-card-expanded h2')].map((h) => h.textContent);
  assert.deepEqual(thrice, once);
  assert.ok(ctx.settings['list.cleanTitles']);
});
