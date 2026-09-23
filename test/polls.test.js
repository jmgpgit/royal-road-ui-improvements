'use strict';

/**
 * The poll sort button, over a real 18-option poll captured signed out (which
 * shows results, as a signed-in reader sees after voting).
 *
 * jsdom has no layout, so these pin order and the guards, not how it looks.
 * Rows are compared as elements: whitespace text nodes drift when rows move,
 * which renders as nothing but would fail a childNodes or innerHTML check.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const SKIP = need('chapter-poll.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = ['src/common/selectors.js', 'src/content/ui.js', 'src/content/features/polls.js'];

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
  const dom = new JSDOM(fixture('chapter-poll.new.html'), {
    url: 'https://www.royalroad.com/fiction/166359/x/chapter/4002493/y',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const poll = w.document.getElementById('poll').parentElement.parentElement;
  const { list, rows } = w.RRX.polls.optionsOf(poll);
  return { w, poll, list, rows };
}

const shareOf = (row) => parseFloat(row.querySelector('[style*="width"]').style.width);
const optionRows = (list) => [...list.children].filter((c) => c.querySelector('h6'));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const sameOrder = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);

test('one button under the title, not pressed, author order untouched', () => {
  const { w, poll, list, rows } = load();
  w.RRX.polls.decorate(w.document);

  const bars = poll.querySelectorAll('.rrx-poll-sort');
  assert.equal(bars.length, 1);
  assert.equal(bars[0].previousElementSibling.tagName, 'H5');
  assert.equal(bars[0].querySelector('button').getAttribute('aria-pressed'), 'false');
  assert.equal(rows.length, 18);
  assert.ok(sameOrder(optionRows(list), rows));
});

test('a press sorts by share and keeps Total last; a second puts it back', () => {
  const { w, poll, list, rows } = load();
  const total = list.lastElementChild;
  assert.match(total.textContent, /Total:/);
  w.RRX.polls.decorate(w.document);
  const button = poll.querySelector('.rrx-poll-sort button');

  click(w, button);
  const sorted = optionRows(list);
  assert.equal(sorted.length, rows.length);
  for (let i = 1; i < sorted.length; i += 1) {
    const [prev, cur] = [shareOf(sorted[i - 1]), shareOf(sorted[i])];
    assert.ok(prev >= cur, `row ${i}: ${prev} before ${cur}`);
    // Ties keep the author's order.
    if (prev === cur) assert.ok(rows.indexOf(sorted[i - 1]) < rows.indexOf(sorted[i]));
  }
  assert.equal(list.lastElementChild, total);
  assert.equal(button.getAttribute('aria-pressed'), 'true');

  click(w, button);
  assert.ok(sameOrder(optionRows(list), rows));
  assert.equal(list.lastElementChild, total);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
});

test('onPage re-running after a press writes nothing', () => {
  const { w, poll, list } = load();
  const feature = w.RRX.features.list.find((f) => f.id === 'pollSort');
  feature.onPage({});
  const button = poll.querySelector('.rrx-poll-sort button');
  click(w, button);
  const sorted = optionRows(list);

  const observer = new w.MutationObserver(() => {});
  observer.observe(w.document.body, { childList: true, attributes: true, subtree: true });
  for (let i = 0; i < 5; i += 1) feature.onPage({});
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();

  assert.equal(poll.querySelector('.rrx-poll-sort button'), button);
  assert.ok(sameOrder(optionRows(list), sorted));
});

test('no shares, no button: the pre-vote form carries none', () => {
  const { w, poll } = load();
  for (const bar of poll.querySelectorAll('[style*="width"]')) bar.remove();
  w.RRX.polls.decorate(w.document);
  assert.equal(poll.querySelector('.rrx-poll-sort'), null);
});

test('no button when the options are already in vote order', () => {
  const { w, poll, list, rows } = load();
  const after = rows[rows.length - 1].nextSibling;
  for (const row of [...rows].sort((a, b) => shareOf(b) - shareOf(a))) {
    list.insertBefore(row, after);
  }
  w.RRX.polls.decorate(w.document);
  assert.equal(poll.querySelector('.rrx-poll-sort'), null);
});
