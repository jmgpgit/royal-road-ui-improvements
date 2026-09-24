'use strict';

/**
 * The reading dashboard: the date arithmetic under it, and the page it draws.
 *
 * London, so the clocks change inside the tested range: a day stepped as
 * 86,400,000 ms lands on the wrong key across a DST change, which is the bug
 * worth guarding against here.
 */
process.env.TZ = 'Europe/London';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const D = require('../src/dashboard/dashboard.js');
const { dayKey } = require('../src/common/model.js');

const ROOT = path.join(__dirname, '..');

const log = (days, extra = {}) => ({ d: days, f: {}, r: [], ...extra });

test('days step by the calendar across both clock changes', () => {
  assert.equal(D.addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(D.addDays('2026-03-29', 1), '2026-03-30', 'spring forward: a 23-hour day');
  assert.equal(D.addDays('2026-10-25', 1), '2026-10-26', 'fall back: a 25-hour day');
  assert.equal(D.addDays('2026-10-26', -1), '2026-10-25');
  assert.equal(D.spanDays('2026-03-01', '2026-03-31'), 31);
});

test('weeks start on Monday, across a month boundary', () => {
  assert.equal(D.weekStart('2026-09-02'), '2026-08-31', 'a Wednesday');
  assert.equal(D.weekStart('2026-08-31'), '2026-08-31', 'a Monday is its own week');
  assert.equal(D.weekStart('2026-09-06'), '2026-08-31', 'Sunday closes the week');

  const days = log({ '2026-08-30': [1, 10], '2026-08-31': [2, 20], '2026-09-06': [3, 30] });
  const weeks = D.weeks(days, '2026-09-06', 2);
  assert.deepEqual(
    weeks.map((w) => [w.start, w.c, w.w]),
    [
      ['2026-08-24', 1, 10],
      ['2026-08-31', 5, 50],
    ]
  );
});

test('a streak survives a today with nothing read yet, and breaks on a gap', () => {
  const days = log({
    '2026-08-29': [1, 1],
    '2026-08-30': [1, 1],
    '2026-08-31': [1, 1],
    '2026-09-01': [2, 1],
    '2026-09-03': [1, 1],
    '2026-09-04': [1, 1],
  });
  assert.deepEqual(D.streaks(days, '2026-09-05'), { current: 2, longest: 4 });
  assert.deepEqual(D.streaks(days, '2026-09-04'), { current: 2, longest: 4 });
  assert.deepEqual(D.streaks(days, '2026-09-06'), { current: 0, longest: 4 }, 'a whole day missed');
});

test('averages run from the first recorded day, not a fixed window', () => {
  const avg = D.averages(log({ '2026-08-31': [6, 1], '2026-09-13': [8, 1] }), '2026-09-13');
  assert.equal(avg.since, '2026-08-31');
  assert.equal(avg.day, 1, '14 chapters over 14 days');
  assert.equal(avg.week, 7, 'over two Monday weeks');
  assert.equal(avg.month, 7, 'over August and September');
  assert.equal(D.averages(log({}), '2026-09-13'), null);
});

test('months run from the first to this one, empty ones included, newest first', () => {
  const days = log({ '2026-06-30': [2, 20], '2026-08-01': [1, 10], '2026-08-02': [1, 5] });
  const rows = D.months(days, '2026-09-01');
  assert.deepEqual(
    rows.map((r) => [r.month, r.c, r.w, r.days]),
    [
      ['2026-09', 0, 0, 0],
      ['2026-08', 2, 15, 2],
      ['2026-07', 0, 0, 0],
      ['2026-06', 2, 20, 1],
    ]
  );
});

test('the year is 53 Monday-first weeks ending with this one', () => {
  const cells = D.year(log({ '2026-09-02': [3, 1] }), '2026-09-02');
  assert.equal(cells.length, 53 * 7);
  assert.equal(D.weekStart(cells[0].day), cells[0].day, 'the first cell is a Monday');
  assert.equal(cells.find((cell) => cell.day === '2026-09-02').c, 3);
  assert.deepEqual(
    cells.filter((cell) => cell.future).map((cell) => cell.day),
    ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']
  );
});

test('measured time reads as minutes, then hours and minutes', () => {
  assert.equal(D.duration(0), '0 min');
  assert.equal(D.duration(2700), '45 min');
  assert.equal(D.duration(3600), '1 h');
  assert.equal(D.duration(3 * 3600 + 5 * 60), '3 h 5 min');
  const days = log({ '2026-09-01': [1, 2000, 600], '2026-09-02': [0, 0, 300] });
  const { t } = D.tally(days, '2026-09-01', '2026-09-02');
  assert.equal(t, 900, 'a day with no finish still counts');
});

test('fictions join the log with chapters part-read, newest first', () => {
  const list = D.fictions(
    log({}, { f: { 1: { t: 'Logged', a: 100, c: 4 } } }),
    {
      10: { f: 1, a: 300, p: 2 },
      11: { f: 2, a: 200, p: 5 },
      12: { f: 3, a: 400, s: 1 }, // only a comment watermark: not in progress
    },
    { 2: 'Known from the hidden list' }
  );
  assert.deepEqual(
    list.map((f) => [f.id, f.title, f.read, f.open, f.last]),
    [
      [1, 'Logged', 4, 1, 300],
      [2, 'Known from the hidden list', 0, 1, 200],
    ]
  );
});

// --- the page ------------------------------------------------------------------

const windows = [];
test.after(() => {
  for (const w of windows) w.close();
});

async function render(store) {
  const html = fs.readFileSync(path.join(ROOT, 'src/dashboard/dashboard.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://example.invalid/dashboard.html',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  w.eval(`globalThis.__s = ${JSON.stringify(store)};`);
  w.eval(
    'globalThis.browser = { storage: { local: {' +
      ' get: async () => JSON.parse(JSON.stringify(globalThis.__s)),' +
      ' set: async (p) => { Object.assign(globalThis.__s, p); const c = {};' +
      ' for (const k in p) c[k] = { newValue: p[k] };' +
      ' (globalThis.__l || []).forEach((l) => l(c, "local")); } },' +
      ' onChanged: { addListener(l) { (globalThis.__l = globalThis.__l || []).push(l); },' +
      ' removeListener() {} } },' +
      ' runtime: { getManifest: () => ({ version: "9.8.7" }), getURL: (p) => p } };'
  );
  for (const src of [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])) {
    w.eval(fs.readFileSync(path.join(ROOT, 'src/dashboard', src), 'utf8'));
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  return w;
}

test('a seeded log draws every part of the page', async () => {
  const today = dayKey(new Date());
  const w = await render({
    settings: { 'history.log': true },
    log: {
      d: { [today]: [2, 4000, 1500], [D.addDays(today, -40)]: [1, 1500, 600] },
      f: { 21220: { t: 'Mother of Learning', a: Math.floor(Date.now() / 1000), c: 3 } },
      r: [1, 2, 3],
    },
  });
  const d = w.document;

  assert.equal(d.getElementById('dash-on').checked, true);
  assert.equal(d.getElementById('dash-data').hidden, false);
  assert.equal(d.getElementById('dash-status').hidden, true, 'nothing to explain');

  const tiles = [...d.querySelectorAll('.tile')].map((t) => t.textContent);
  assert.ok(tiles.some((t) => t.startsWith('Today2')), tiles.join(' | '));
  assert.ok(tiles.some((t) => t.startsWith('Words read5,500')), 'the total counts every day');
  assert.ok(tiles.some((t) => t.startsWith('Time reading35 min')), 'and so does the time');
  assert.ok(tiles.some((t) => t.startsWith('Today2') && t.includes('25 min')));

  assert.equal(d.querySelectorAll('.bars__col').length, 12);
  assert.equal(d.querySelectorAll('#dash-year-grid .heat__cell').length, 53 * 7);
  assert.ok(d.querySelectorAll('#dash-months tr').length >= 2);

  const link = d.querySelector('#dash-fictions a');
  assert.equal(link.textContent, 'Mother of Learning');
  assert.equal(link.getAttribute('href'), 'https://www.royalroad.com/fiction/21220');
  assert.equal(link.getAttribute('rel'), 'noreferrer');
});

test('a clock set back past every recorded day leaves out the averages, not the page', async () => {
  const today = dayKey(new Date());
  const w = await render({
    settings: { 'history.log': true },
    log: log({ [D.addDays(today, 2)]: [2, 4000] }),
  });
  const d = w.document;
  const tiles = [...d.querySelectorAll('.tile')].map((t) => t.textContent);
  assert.ok(tiles.some((t) => t.startsWith('Today')), tiles.join(' | '));
  assert.ok(!tiles.some((t) => t.startsWith('Per day')), tiles.join(' | '));
  assert.equal(d.querySelectorAll('.bars__col').length, 12);
  assert.equal(d.querySelectorAll('#dash-year-grid .heat__cell').length, 53 * 7);
});

test('a write from another tab redraws the page', async () => {
  const today = dayKey(new Date());
  const w = await render({ settings: { 'history.log': true }, log: log({ [today]: [2, 4000] }) });
  const todayTile = () =>
    [...w.document.querySelectorAll('.tile')].find((t) => t.textContent.startsWith('Today'))
      .textContent;
  assert.match(todayTile(), /^Today2/);

  await w.browser.storage.local.set({ log: log({ [today]: [3, 6000] }) });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(todayTile(), /^Today3/);
});

test('an empty log says counting starts now, with no history before it', async () => {
  const w = await render({ settings: {} });
  const d = w.document;
  assert.equal(d.getElementById('dash-on').checked, false);
  assert.equal(d.getElementById('dash-data').hidden, true);
  assert.equal(d.getElementById('dash-fictions-card').hidden, true);
  assert.match(d.getElementById('dash-status').textContent, /no history from before/);
});

test('the switch on the page writes the setting', async () => {
  const w = await render({ settings: {} });
  const d = w.document;
  const box = d.getElementById('dash-on');
  assert.equal(d.getElementById('dash-on-label').textContent, 'Keep a reading log');

  box.checked = true;
  box.dispatchEvent(new w.Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(w.__s.settings['history.log'], true);
  assert.match(d.getElementById('dash-status').textContent, /Counting since you switched this on/);
});
