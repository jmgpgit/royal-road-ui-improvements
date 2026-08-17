'use strict';

/**
 * Reading a fiction's numbers off its own page.
 *
 * Half of this is not "does it work today" but "does it still work when Royal
 * Road moves something". Reordering is the dangerous one: it does not fail, it
 * mispairs - the right label over its neighbour's number.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const SKIP = need('fiction-detail.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/cards.js',
  'src/content/ui.js',
  'src/content/features/fiction-stats.js',
];

const URL = 'https://www.royalroad.com/fiction/21220/mother-of-learning';

/** Every number this capture shows, checked against the raw HTML. In the order
 *  Royal Road lays them out: the six tiles, then the overall score and its four
 *  sub-scores, then the chapter count, which is on the table of contents. */
const EXPECTED = {
  v: 27778323,
  w: 254847,
  f: 32866,
  m: 31777,
  r: 17316,
  p: 2932,
  s: 4.83,
  sty: 4.68,
  sto: 4.8,
  gra: 4.78,
  cha: 4.72,
  c: 109,
};

/** Records are built inside the jsdom realm, so they carry its prototypes and
 *  strict deepEqual rejects them as not reference-equal. */
const own = (value) => JSON.parse(JSON.stringify(value));

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
  const dom = new JSDOM(fixture('fiction-detail.new.html'), { url: URL, runScripts: 'outside-only' });
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

const grid = (w) => {
  // Not a class selector: the grid is identified by being the one node inside
  // the Statistics panel with six tile children.
  const label = [...w.document.querySelectorAll('#stats-accordion *')].find(
    (el) => !el.firstElementChild && el.textContent.trim() === 'Followers'
  );
  return label.parentElement.parentElement;
};

test('every number on a real fiction page is read', () => {
  const w = loadPage();
  const stats = w.RRX.fictionStats.readStats();
  for (const [field, value] of Object.entries(EXPECTED)) {
    assert.equal(stats[field], value, `field ${field}`);
  }
  assert.deepEqual(Object.keys(stats).sort(), Object.keys(EXPECTED).sort(), 'and nothing else');
});

test('the score is read to two decimals, not Royal Road’s rounded one', () => {
  // The page displays 4.8 as star geometry; 4.83 is text only. A +0.02 move is
  // invisible at one decimal, which is the entire point of the readout.
  const w = loadPage();
  assert.equal(w.RRX.fictionStats.readScore(), 4.83);

  // Each source in turn, most machine-readable first. JSON-LD gone: the panel's
  // own star tooltip says the same.
  for (const script of w.document.querySelectorAll('script[type="application/ld+json"]')) {
    script.remove();
  }
  assert.equal(w.RRX.fictionStats.readScore(), 4.83, 'the panel tooltip is the fallback');

  // Panel gone too: the tooltip beside the title, which is outside it.
  w.document.querySelector('#stats-accordion').remove();
  assert.equal(w.RRX.fictionStats.readScore(), 4.83, 'and the hero tooltip after that');

  // And with all three gone it declines rather than reporting the rounded 4.8
  // that data-rr-initial-rating carries - mixing one- and two-decimal readings
  // would invent ±0.05 movements out of nothing.
  w.document.querySelector('#fiction-rating-tooltip').remove();
  assert.equal(w.RRX.fictionStats.readScore(), null);
});

test('every star rating is read, and told apart by its own heading', () => {
  // Five identical `[data-rr-rating-selector]` widgets in one panel. By
  // position, a reorder would report Style's movement as Grammar's.
  const w = loadPage();
  const widgets = w.RRX.fictionStats.scoreWidgets();
  assert.deepEqual([...widgets.keys()], ['s', 'sty', 'sto', 'gra', 'cha']);

  const scored = [...widgets].map(([field, el]) => [field, w.RRX.fictionStats.scoreOf(el)]);
  assert.deepEqual(scored, [
    ['s', 4.83],
    ['sty', 4.68],
    ['sto', 4.8],
    ['gra', 4.78],
    ['cha', 4.72],
  ]);

  // Reversed, each still reports its own figure rather than its neighbour's.
  const panel = widgets.get('sty').parentElement.parentElement;
  for (const child of [...panel.children].reverse()) panel.appendChild(child);
  const after = w.RRX.fictionStats.scoreWidgets();
  assert.equal(w.RRX.fictionStats.scoreOf(after.get('gra')), 4.78);
  assert.equal(w.RRX.fictionStats.scoreOf(after.get('sty')), 4.68);
});

test('“Ratings” resolves to the tile, not the Overall Score heading of the same name', () => {
  // There are two leaves reading "Ratings" inside #stats-accordion. The second
  // is a heading whose nearest number, three levels up, is Total Views.
  const w = loadPage();
  const labels = [...w.document.querySelectorAll('#stats-accordion *')].filter(
    (el) => !el.firstElementChild && el.textContent.trim() === 'Ratings'
  );
  assert.equal(labels.length, 2, 'both still exist, or this test proves nothing');
  assert.equal(w.RRX.fictionStats.valueNear(labels[0]), 17316, 'the tile');
  assert.equal(w.RRX.fictionStats.valueNear(labels[1]), null, 'the heading declines');
  assert.equal(w.RRX.fictionStats.readStats().r, 17316);
});

test('the read survives Royal Road moving the tiles around', () => {
  // Reordering is the one that used to be silent: with `nth-child` selectors,
  // "Followers" started reporting the Favorites number and nothing looked wrong.
  const w = loadPage();
  const box = grid(w);
  const tiles = [...box.children];
  for (const tile of tiles.reverse()) box.appendChild(tile);

  const stats = w.RRX.fictionStats.readStats();
  assert.equal(stats.f, EXPECTED.f, 'followers still report their own number');
  assert.equal(stats.m, EXPECTED.m);
  assert.equal(stats.v, EXPECTED.v);
});

test('the read survives a restyle, an extra tile, and losing every icon', () => {
  const w = loadPage();
  const box = grid(w);

  // Every class stripped from the whole panel: no Tailwind left to key on.
  for (const el of [box, ...box.querySelectorAll('*')]) el.removeAttribute('class');

  // Icons deleted outright - the fallback the design brief suggested is not just
  // unnecessary, it would have been the fragile half.
  for (const icon of box.querySelectorAll('i')) icon.remove();

  // And Royal Road adds a stat, at the front, where every offset would shift.
  const extra = w.document.createElement('div');
  extra.innerHTML = '<span>1,234</span><span>Bookmarks</span>';
  box.insertBefore(extra, box.firstElementChild);

  const stats = w.RRX.fictionStats.readStats();
  for (const [field, value] of Object.entries(EXPECTED)) {
    assert.equal(stats[field], value, `field ${field}`);
  }
});

test('an ambiguous tile declines instead of guessing', () => {
  // A label with two numbers under it, once the climb reaches them, cannot be
  // resolved. Reporting either would be a made-up statistic.
  const w = loadPage();
  const label = [...w.document.querySelectorAll('#stats-accordion *')].find(
    (el) => !el.firstElementChild && el.textContent.trim() === 'Followers'
  );
  const extra = w.document.createElement('span');
  extra.textContent = '9,999';
  label.parentElement.appendChild(extra);

  assert.equal(w.RRX.fictionStats.valueNear(label), null);
  assert.equal('f' in w.RRX.fictionStats.readStats(), false, 'left out, not zeroed');
});

test('a page with no statistics panel reads what it still can', () => {
  const w = loadPage();
  w.document.querySelector('#stats-accordion').remove();
  // The chapter count and the score live outside that panel.
  assert.deepEqual(own(w.RRX.fictionStats.readStats()), { c: EXPECTED.c, s: EXPECTED.s });
});

test('the readout goes where it can be seen, outside the collapsing panel', () => {
  // Royal Road ships Statistics closed (`max-h-0 invisible`), so anything put
  // inside the content div is invisible on a default install; and anything put
  // inside the trigger toggles the panel when clicked.
  const w = loadPage();
  const content = w.document.querySelector('#stats-accordion [data-rr-accordion-content]');
  assert.equal(
    content.getAttribute('data-rr-accordion-content-state'),
    'closed',
    'Royal Road still ships it closed, which is why the anchor is what it is'
  );

  w.RRX.fictionStats.render({ since: 1_700_000_000, changes: [['f', 312], ['s', 0.02]] });

  const node = w.document.getElementById('rrx-stat-delta');
  assert.ok(node, 'the line was inserted');
  assert.equal(node.nextElementSibling, content, 'directly above the collapsing panel');
  assert.equal(node.closest('[data-rr-accordion-trigger]'), null, 'and outside the trigger');
  assert.ok(node.classList.contains('rrx-ui'), 'or every insertion would wake the sweep');
  assert.match(node.textContent, /\+312 followers/);
  assert.match(node.textContent, /\+0\.02 score/);
});

test('each figure carries its own delta, written directly under it', () => {
  const w = loadPage();
  w.RRX.fictionStats.render({
    since: 1_700_000_000,
    changes: [['f', 312], ['m', -2], ['s', 0.02], ['c', 3]],
  });

  const cells = [...w.document.querySelectorAll('[data-rrx-delta]')];
  assert.deepEqual(
    cells.map((c) => c.getAttribute('data-rrx-delta')),
    ['f', 'm', 's'],
    'chapters has no figure on this panel, so it gets no cell'
  );

  const [followers, favourites, score] = cells;
  assert.equal(followers.previousElementSibling.textContent.trim(), '32,866', 'under its own number');
  assert.equal(followers.textContent, '(+312)');
  assert.ok(followers.classList.contains('rrx-stat-cell--up'));

  assert.equal(favourites.previousElementSibling.textContent.trim(), '31,777');
  assert.equal(favourites.textContent, '(−2)', 'a fall is signed, and reads as one');
  assert.ok(favourites.classList.contains('rrx-stat-cell--down'));

  // No figure at all for the score - Royal Road draws it as star widths - so it
  // goes under the stars. The overall ones: four sub-scores sit below.
  assert.equal(score.textContent, '(+0.02)');
  assert.ok(score.previousElementSibling.hasAttribute('data-rr-rating-selector'));
  assert.match(score.parentElement.textContent, /Overall Score/);

  // Every cell is ours, or the sweep would treat each one as page content.
  for (const el of cells) assert.ok(el.classList.contains('rrx-ui'));

  // Same things, same two colours, so the two read as one report seen twice.
  const items = [...w.document.querySelectorAll('.rrx-stat-delta__item')];
  assert.deepEqual(
    items.map((el) => `${el.getAttribute('data-rrx-field')}:${el.className.split('--').pop()}`),
    ['f:up', 'm:down', 's:up', 'c:up']
  );
});

test('a figure that held still says so, quietly', () => {
  // Without it, the tile beside three annotated ones looks like one the
  // extension could not read.
  const w = loadPage();
  w.RRX.fictionStats.render({
    since: 1_700_000_000,
    changes: [['f', 312], ['m', 0], ['r', 0], ['s', 0]],
  });

  const cells = [...w.document.querySelectorAll('[data-rrx-delta]')];
  assert.deepEqual(
    cells.map((el) => [el.getAttribute('data-rrx-delta'), el.textContent, el.className.split('--').pop()]),
    [
      ['f', '(+312)', 'up'],
      ['m', '(+0)', 'flat'],
      ['r', '(+0)', 'flat'],
      ['s', '(+0.00)', 'flat'],
    ]
  );

  // The summary is a line to glance at, so "+0" has no place on it.
  const summary = [...w.document.querySelectorAll('.rrx-stat-delta__item')];
  assert.deepEqual(summary.map((el) => el.getAttribute('data-rrx-field')), ['f']);
});

test('the sub-scores stay in the panel and never reach the header', () => {
  // Four more items would turn a line meant to be glanced at into a paragraph.
  const w = loadPage();
  w.RRX.fictionStats.render({
    since: 1_700_000_000,
    changes: [['f', 312], ['s', 0.02], ['sty', 0.05], ['sto', -0.03], ['gra', 0.01], ['cha', 0.02]],
  });

  const summary = [...w.document.querySelectorAll('.rrx-stat-delta__item')];
  assert.deepEqual(
    summary.map((el) => el.getAttribute('data-rrx-field')),
    ['f', 's'],
    'the overall score belongs on the header; its four parts do not'
  );

  // ...but every one of them is written under its own stars.
  const cells = [...w.document.querySelectorAll('[data-rrx-delta]')];
  assert.deepEqual(
    cells.map((el) => el.getAttribute('data-rrx-delta')),
    ['f', 's', 'sty', 'sto', 'gra', 'cha']
  );
  const style = cells.find((el) => el.getAttribute('data-rrx-delta') === 'sty');
  assert.equal(style.textContent, '(+0.05)');
  assert.match(style.parentElement.textContent, /Style/);
});

test('the summary keeps only what has no figure to sit under, once the panel is open', () => {
  const w = loadPage();
  w.RRX.fictionStats.render({ since: 1_700_000_000, changes: [['f', 312], ['c', 3]] });

  // Which half shows is CSS: opening an accordion changes an attribute, which
  // the sweep never sees. So the rule is checked as the browser applies it.
  const rule =
    "#stats-accordion:has([data-rr-accordion-trigger][aria-expanded='true']) " +
    ".rrx-stat-delta__item:not([data-rrx-field='c'])";
  const sheet = fs.readFileSync(path.join(ROOT, 'src/content/inject.css'), 'utf8');
  assert.ok(sheet.replace(/\s+/g, ' ').includes(rule.replace(/\s+/g, ' ')), 'the rule still exists');

  const trigger = w.document.querySelector('#stats-accordion [data-rr-accordion-trigger]');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(w.document.querySelectorAll(rule).length, 0, 'closed: the whole summary shows');

  trigger.setAttribute('aria-expanded', 'true');
  const hidden = [...w.document.querySelectorAll(rule)];
  assert.deepEqual(
    hidden.map((el) => el.getAttribute('data-rrx-field')),
    ['f'],
    'open: the tiles say it themselves, so only chapters survives'
  );
  // And the "since" label stays either way - it is what says what the tile
  // annotations are measured against.
  assert.ok(w.document.querySelector('.rrx-stat-delta__since'));
});

test('switching it off takes the cells with it, not just the line', () => {
  const w = loadPage();
  w.RRX.fictionStats.render({ since: 1_700_000_000, changes: [['f', 312], ['s', 0.02]] });
  assert.equal(w.document.querySelectorAll('[data-rrx-delta]').length, 2);

  w.RRX.fictionStats.clear();
  assert.equal(w.document.getElementById('rrx-stat-delta'), null);
  assert.equal(
    w.document.querySelectorAll('[data-rrx-delta]').length,
    0,
    'left behind, these would be numbers with no explanation anywhere on the page'
  );
});

test('the line is rewritten only when what it says changes', () => {
  const w = loadPage();
  const delta = { since: 1_700_000_000, changes: [['f', 312]] };
  w.RRX.fictionStats.render(delta);
  const first = w.document.getElementById('rrx-stat-delta');

  w.RRX.fictionStats.render({ since: 1_700_000_000, changes: [['f', 312]] });
  assert.equal(w.document.getElementById('rrx-stat-delta'), first, 'same node, not rebuilt');

  w.RRX.fictionStats.render({ since: 1_700_000_000, changes: [['f', 313]] });
  assert.notEqual(w.document.getElementById('rrx-stat-delta'), first, 'a real change rebuilds it');
});

test('a fall is worded as a fall, and singulars are singular', () => {
  const w = loadPage();
  const say = w.RRX.fictionStats.phrase;
  assert.equal(say(['c', 1]), '+1 chapter');
  assert.equal(say(['c', 3]), '+3 chapters');
  assert.equal(say(['f', -1]), '−1 follower');
  assert.equal(say(['v', 1234567]), '+1,234,567 views');
  assert.equal(say(['s', -0.02]), '−0.02 score');
});
