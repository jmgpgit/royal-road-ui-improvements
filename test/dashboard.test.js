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
const { read: fixture, need } = require('./helpers/fixtures.js');

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

test('years run from the first total to this one, empty ones included, newest first', () => {
  const totals = log({}, { y: { 2023: [5, 50, 9, 2], 2025: [1, 10, 3, 1] } });
  assert.deepEqual(
    D.years(totals, '2026-01-01').map((r) => [r.year, r.c, r.w, r.t, r.days]),
    [
      ['2026', 0, 0, 0, 0],
      ['2025', 1, 10, 3, 1],
      ['2024', 0, 0, 0, 0],
      ['2023', 5, 50, 9, 2],
    ]
  );
  assert.deepEqual(D.years(log({}, { y: {} }), '2026-01-01'), []);
  assert.deepEqual(
    D.years(totals, '2022-06-01').map((r) => r.year),
    ['2023'],
    'a clock behind the first year still lists it'
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

test('measured time reads as minutes, then hours and minutes, then hours', () => {
  assert.equal(D.duration(0), '0 min');
  assert.equal(D.duration(2700), '45 min');
  assert.equal(D.duration(3600), '1 h');
  assert.equal(D.duration(3 * 3600 + 5 * 60), '3 h 5 min');
  assert.equal(D.duration(99 * 3600 + 59 * 60), '99 h 59 min');
  assert.equal(D.duration(939 * 3600 + 8 * 60), '939 h', 'past 100 h, no minutes');
  assert.equal(D.duration(1204 * 3600), `${(1204).toLocaleString()} h`);
  const days = log({ '2026-09-01': [1, 2000, 600], '2026-09-02': [0, 0, 300] });
  const { t } = D.tally(days, '2026-09-01', '2026-09-02');
  assert.equal(t, 900, 'a day with no finish still counts');
});

test(
  'a page is as many words as Royal Road counts one',
  { skip: need('fictions-search.new.html') },
  () => {
    const text = fixture('fictions-search.new.html').replace(/\s+/g, ' ');
    assert.match(text, new RegExp(`counted as ${D.WORDS_PER_PAGE} words`));
  }
);

test('a page is 275 words, rounded to the nearest', () => {
  assert.equal(D.pages(0), 0);
  assert.equal(D.pages(137), 0);
  assert.equal(D.pages(138), 1);
  assert.equal(D.pages(275), 1);
  assert.equal(D.pages(412), 1);
  assert.equal(D.pages(413), 2);
  assert.equal(D.pages(11242), 41);
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

test('a fiction the log holds only a title for is listed once part-read, never alone', () => {
  const list = D.fictions(
    log({}, {
      f: { 1: { t: 'Opened', a: 100, c: 0 }, 2: { t: 'Opened, nothing read', a: 500, c: 0 } },
    }),
    { 10: { f: 1, a: 300, p: 2 } }
  );
  assert.deepEqual(
    list.map((f) => [f.id, f.title, f.read, f.open, f.last]),
    [[1, 'Opened', 0, 1, 300]]
  );
});

// --- the page ------------------------------------------------------------------

const windows = [];
test.after(() => {
  for (const w of windows) w.close();
});

/** A tile's lines under its number, found by its label. */
function subs(d, label) {
  const tile = [...d.querySelectorAll('.tile')].find(
    (t) => t.querySelector('.tile__label').textContent === label
  );
  return [...tile.querySelectorAll('.tile__sub')].map((sub) => sub.textContent);
}

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
  assert.deepEqual(subs(d, 'Today'), ['4,000 words', '15 pages', '25 min']);
  assert.deepEqual(subs(d, 'Words read'), ['20 pages', 'in 3 chapters']);

  const head = [...d.querySelectorAll('#h-months + .dash-table-wrap thead th')].map(
    (th) => th.textContent
  );
  assert.deepEqual(head, ['Month', 'Chapters', 'Words', 'Pages', 'Days read', 'Time']);
  const thisMonth = [...d.querySelectorAll('#dash-months tr')][0];
  assert.deepEqual(
    [...thisMonth.querySelectorAll('td')].map((td) => td.textContent),
    ['2', '4,000', '15', '1', '25 min']
  );

  assert.equal(d.querySelectorAll('.bars__col').length, 12);
  assert.equal(d.querySelectorAll('#dash-year-grid .heat__cell').length, 53 * 7);
  assert.ok(d.querySelectorAll('#dash-months tr').length >= 2);

  const link = d.querySelector('#dash-fictions a');
  assert.equal(link.textContent, 'Mother of Learning');
  assert.equal(link.getAttribute('href'), 'https://www.royalroad.com/fiction/21220');
  assert.equal(link.getAttribute('rel'), 'noreferrer');
});

/** A table's rows as text, header cell first. */
const rows = (d, id) =>
  [...d.querySelectorAll(`#${id} tr`)].map((tr) =>
    [...tr.children].map((cell) => cell.textContent)
  );

test('the all-time tiles and the year table come from the year totals, not the days', async () => {
  const today = dayKey(new Date());
  const year = Number(today.slice(0, 4));
  const w = await render({
    settings: { 'history.log': true },
    log: {
      d: { [today]: [2, 4000, 1500] }, // the older days have aged out
      f: {},
      r: [1, 2],
      y: { [year - 2]: [100, 196000, 36000, 50], [year]: [2, 4000, 1500, 1] },
    },
  });
  const d = w.document;
  assert.deepEqual(subs(d, 'Words read'), ['727 pages', 'in 102 chapters']);
  const tiles = [...d.querySelectorAll('.tile')].map((t) => t.textContent);
  assert.ok(tiles.some((t) => t.startsWith('Words read200,000')), tiles.join(' | '));
  assert.ok(tiles.some((t) => t.startsWith('Time reading10 h 25 min')), tiles.join(' | '));

  const head = [...d.querySelectorAll('#h-years + .dash-table-wrap thead th')].map(
    (th) => th.textContent
  );
  assert.deepEqual(head, ['Year', 'Chapters', 'Words', 'Pages', 'Days read', 'Time']);
  assert.deepEqual(rows(d, 'dash-years'), [
    [String(year), '2', '4,000', '15', '1', '25 min'],
    [String(year - 1), '0', '0', '0', '0', '0 min'],
    [String(year - 2), '100', '196,000', '713', '50', '10 h'],
  ]);
  assert.equal(rows(d, 'dash-months').length, 1, 'the months still come from the days');
});

test('a log left with only its year totals still shows them', async () => {
  const year = new Date().getFullYear();
  const w = await render({
    settings: { 'history.log': true },
    log: { d: {}, f: {}, r: [], y: { [year - 2]: [3, 6000, 600, 2] } },
  });
  const d = w.document;
  assert.equal(d.getElementById('dash-data').hidden, false);
  assert.equal(d.getElementById('dash-status').hidden, true, 'not "counting since…"');
  assert.equal(rows(d, 'dash-years').length, 3);
  const months = d.getElementById('dash-months').closest('section');
  assert.equal(months.hidden, true, 'no empty month table');
  assert.equal(d.getElementById('dash-weeks').closest('section').hidden, true, 'nor weeks');
  assert.equal(d.getElementById('dash-year-grid').closest('section').hidden, true, 'nor last year');
  assert.deepEqual(subs(d, 'Words read'), ['22 pages', 'in 3 chapters']);
  assert.deepEqual(subs(d, 'Streak'), [], 'no "longest 0 days"');

  const paused = await render({ settings: {}, log: { y: { [year - 2]: [3, 6000, 600, 2] } } });
  assert.match(
    paused.document.getElementById('dash-status').textContent,
    /Paused: .*is kept until you forget it/,
    'the year totals never age out'
  );
});

test('a fiction only part-read shows the title kept on opening, and no “0 chapters read”', async () => {
  const now = Math.floor(Date.now() / 1000);
  const w = await render({
    settings: { 'history.log': true },
    log: log({}, {
      f: { 191136: { t: 'Kept on opening', a: now, c: 0 }, 5: { t: 'Nothing read', a: now, c: 0 } },
    }),
    chapters: { 3766643: { f: 191136, a: now, p: 1200 } },
  });
  const items = [...w.document.querySelectorAll('#dash-fictions li')].map((li) => li.textContent);
  assert.equal(items.length, 1, items.join(' | '));
  assert.match(items[0], /^Kept on opening1 part-read · last /);
  assert.ok(!items[0].includes('0 chapters'), items[0]);
});

test('one page is singular, on the tiles', async () => {
  const today = dayKey(new Date());
  const w = await render({ settings: { 'history.log': true }, log: log({ [today]: [1, 275, 0] }) });
  const d = w.document;
  assert.deepEqual(subs(d, 'Today'), ['275 words', '1 page']);
  assert.deepEqual(subs(d, 'Words read'), ['1 page', 'in 1 chapter']);
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
  assert.match(d.getElementById('dash-status').textContent, /Counting since you switched the log on/);
});

test('the keep switch writes its own setting, and the pause says what happens', async () => {
  const today = dayKey(new Date());
  const w = await render({ settings: {}, log: log({ [today]: [1, 2000] }) });
  const d = w.document;
  const box = d.getElementById('dash-keep');
  const status = () => d.getElementById('dash-status').textContent;
  assert.equal(d.getElementById('dash-keep-label').textContent, 'Keep the reading log for good');
  assert.equal(box.checked, false);
  assert.match(status(), /still ages out/);

  box.checked = true;
  box.dispatchEvent(new w.Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(w.__s.settings['history.keep'], true);
  assert.equal(w.__s.settings['history.log'], false, 'the log switch is its own');
  assert.equal(d.getElementById('dash-on').checked, false);
  assert.match(status(), /kept until you forget it/);

  const kept = await render({ settings: { 'history.keep': true } });
  assert.equal(kept.document.getElementById('dash-keep').checked, true, 'read back on load');
});
