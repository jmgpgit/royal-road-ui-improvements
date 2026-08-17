'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/common/model.js');
const { SCHEMA } = require('../src/common/schema.js');

test('fictionIdFromHref accepts every shape of Royal Road fiction link', () => {
  const cases = {
    '/fiction/181303/gifted?utm_source=rising-stars&utm_medium=fiction-list': 181303,
    '/fiction/181303/gifted': 181303,
    '/fiction/181303/read': 181303,
    '/fiction/181303': 181303,
    '/fiction/181303#reviews': 181303,
    '/fiction/56828/nevermoreenygma-files/chapter/3812268/chapter-13': 56828,
    'https://www.royalroad.com/fiction/21220/mother-of-learning': 21220,
  };
  for (const [href, expected] of Object.entries(cases)) {
    assert.equal(model.fictionIdFromHref(href), expected, href);
  }
});

test('fictionIdFromHref rejects list pages and other non-fiction links', () => {
  const rejected = [
    '/fictions/rising-stars',
    '/fictions/search?tagsAdd=litrpg',
    '/fictions/setbookmark/181303', // the bookmark form action on every card
    '/fiction/',
    '/fiction/abc/slug',
    '/profile/12345',
    '',
    null,
    undefined,
  ];
  for (const href of rejected) {
    assert.equal(model.fictionIdFromHref(href), null, String(href));
  }
});

test('fictionIdFromBlurbId reads the id off the show-more checkbox', () => {
  assert.equal(model.fictionIdFromBlurbId('show-more-blurb-181303'), 181303);
  assert.equal(model.fictionIdFromBlurbId('show-more-blurb-'), null);
  assert.equal(model.fictionIdFromBlurbId('some-other-id'), null);
});

test('normalizeIds de-duplicates, validates and sorts', () => {
  assert.deepEqual(model.normalizeIds([3, '1', 3, 2]), [1, 2, 3]);
  assert.deepEqual(model.normalizeIds([0, -1, 'x', null, 1.5, NaN]), []);
  assert.deepEqual(model.normalizeIds('not an array'), []);
});

test('normalizeHidden repairs partial records without losing the id', () => {
  const hidden = model.normalizeHidden({
    181303: { title: 'Gifted', url: '/fiction/181303/gifted', cover: 'x.jpg', hiddenAt: 42 },
    56828: {}, // a record that lost its metadata
    bogus: { title: 'ignored' },
    '-4': { title: 'ignored' },
  });
  assert.deepEqual(Object.keys(hidden).map(Number).sort((a, b) => a - b), [56828, 181303]);
  assert.equal(hidden[181303].title, 'Gifted');
  assert.equal(hidden[56828].title, 'Fiction 56828');
  assert.equal(hidden[56828].url, '/fiction/56828');
  assert.equal(hidden[56828].hiddenAt, 0);
});

test('the boot mirror round-trips, and a corrupt one degrades to null', () => {
  const settings = model.normalizeSettings({
    'list.expandAll': true,
    'list.hoverDelayMs': 300,
  });
  const hidden = { 5: { title: 'A' }, 3: { title: 'B' } };
  const dropped = { 9: { title: 'C' } };

  const parsed = model.parseMirror(JSON.stringify(model.buildMirror(settings, hidden, dropped)));
  assert.deepEqual(parsed.ids, [3, 5]);
  assert.deepEqual(parsed.dropped, [9]);
  assert.equal(parsed.settings['list.expandAll'], true);
  assert.equal(parsed.settings['list.hoverDelayMs'], 300);

  assert.equal(model.parseMirror('{not json'), null);
  assert.equal(model.parseMirror(null), null);
  assert.equal(model.parseMirror(JSON.stringify({ v: 99, ids: [1] })), null, 'unknown version');

  // A mirror written before dropped fictions existed still boots: it costs the
  // dimming on that one load, not the settings and hidden ids alongside it.
  const old = model.parseMirror(JSON.stringify({ v: 1, settings, ids: [3] }));
  assert.deepEqual(old.ids, [3]);
  assert.deepEqual(old.dropped, []);
});

test('dropped fictions are their own list, kept apart from the hidden one', () => {
  const dropped = model.normalizeDropped({
    181303: { title: 'Gifted', url: '/fiction/181303/gifted', cover: 'c.jpg', droppedAt: 1000 },
    56828: {}, // a record that lost its metadata
    bogus: { title: 'ignored' },
  });
  assert.deepEqual(model.droppedIds(dropped), [56828, 181303]);
  assert.equal(dropped[181303].droppedAt, 1000);
  assert.equal(dropped[56828].title, 'Fiction 56828');
  assert.equal(dropped[56828].droppedAt, 0);
  // The two stamps are what tell the records apart, so neither map may carry the
  // other's: a dropped record that grew a `hiddenAt` would read as hidden.
  assert.equal('hiddenAt' in dropped[181303], false);

  // The same fiction can be on both lists, and hiding does not consume dropping.
  const both = { 7: { title: 'X' } };
  assert.deepEqual(model.hiddenIds(both), [7]);
  assert.deepEqual(model.droppedIds(both), [7]);

  const backup = model.buildBackup({ dropped }, 1700000000000);
  assert.deepEqual(model.parseBackup(JSON.stringify(backup)).dropped, dropped);
  // Absent in a backup written before the feature existed.
  assert.deepEqual(model.parseBackup(JSON.stringify({ ...backup, dropped: undefined })).dropped, {});
});

test('backup round-trips settings and hidden fictions', () => {
  const settings = model.normalizeSettings({
    'list.hoverExpand': true,
    'list.hoverDelayMs': 250,
  });
  const hidden = model.normalizeHidden({
    181303: { title: 'Gifted', url: '/fiction/181303/gifted', cover: 'c.jpg', hiddenAt: 1000 },
  });

  const backup = model.buildBackup({ settings, hidden }, 1700000000000);
  assert.equal(backup.format, model.BACKUP_FORMAT);
  assert.equal(backup.exportedAt, '2023-11-14T22:13:20.000Z');

  const restored = model.parseBackup(JSON.stringify(backup));
  assert.deepEqual(restored.settings, settings);
  assert.deepEqual(restored.hidden, hidden);
});

test('every setting survives a backup, not just the ones a test remembered', () => {
  // The round trip above sets two settings and leaves 65 at their defaults,
  // where a coercion bug is invisible: a colour losing its "#", an enum falling
  // back, a list dropping entries all compare equal to the default they were
  // never moved from. Every key is exercised at a non-default value here, so a
  // new setting is covered the moment it is added to the schema.
  const raw = {};
  for (const [key, spec] of Object.entries(SCHEMA)) {
    if (spec.type === 'bool') raw[key] = !spec.default;
    else if (spec.type === 'enum') raw[key] = spec.values.find((v) => v !== spec.default);
    else if (spec.type === 'int' || spec.type === 'number') {
      const low = spec.min ?? 0;
      const high = spec.max ?? 100;
      const mid = Math.round((low + high) / 2);
      raw[key] = mid === spec.default ? Math.min(high, mid + 1) : mid;
    } else if (spec.type === 'color') raw[key] = '#7FFFD4';
    else if (spec.type === 'string') raw[key] = 'probe value';
    else if (spec.type === 'list') raw[key] = ['litrpg', 'magic'];
  }

  const settings = model.normalizeSettings(raw);
  const backup = model.buildBackup({ settings, hidden: {}, chapters: {} }, 1700000000000);
  const restored = model.parseBackup(JSON.stringify(backup)).settings;

  for (const key of Object.keys(SCHEMA)) {
    assert.deepEqual(restored[key], settings[key], `${key} did not survive the round trip`);
  }
});

test('a chapter nothing has touched for a year goes, whatever it holds', () => {
  // A watermark expired at 60 days and a position was deleted when the chapter
  // was finished - but a chapter put down and never reopened had no expiry at
  // all, so it sat there until the 20,000 cap pushed it out.
  const now = 1_700_000_000;
  const year = 366 * 24 * 3600;
  const chapters = {
    1: { f: 9, a: now - 10, p: 42, o: 0.5 }, // read today
    2: { f: 9, a: now - year, p: 42, o: 0.5 }, // put down, never reopened
    3: { f: 9, a: now - year, s: now - year }, // and its comments, likewise
  };

  const kept = model.pruneChapters(chapters, { now });
  assert.deepEqual(Object.keys(kept), ['1']);

  // The two expiries stay independent: at 90 days the watermark is gone and the
  // position is not.
  const midway = model.pruneChapters(
    { 4: { f: 9, a: now - 90 * 24 * 3600, p: 42, o: 0.5, s: now - 90 * 24 * 3600 } },
    { now }
  );
  assert.equal(midway[4].p, 42, 'the position survives');
  assert.equal('s' in midway[4], false, 'the watermark does not');
});

// --- what changed since you last looked -------------------------------------

const HOUR = 3600;
const DAY = 24 * HOUR;
const reading = (over) => ({
  v: 1000, w: 90, f: 100, m: 50, r: 20, p: 300,
  s: 4.5, sty: 4.4, sto: 4.6, gra: 4.7, cha: 4.3,
  c: 10,
  ...over,
});

/** Every test below names the window it is exercising rather than leaning on the
 *  shipped default, so the default can be turned down for a browser test without
 *  quietly changing what any of these mean. The default itself is asserted once,
 *  at the end. */
const WINDOW = 12 * HOUR;
const at = (now) => ({ now, windowS: WINDOW });

/** A delta carries every comparable field, zeros included, because each is
 *  written under its own figure. Most tests below care only about what moved. */
const moved = (delta) => delta.changes.filter(([, change]) => change !== 0);

test('a reload repeats the same answer instead of erasing it', () => {
  // The failure this exists to prevent: roll the baseline on every visit and
  // refreshing the page becomes the way to lose the delta you just read.
  const monday = 1_700_000_000;
  let entry = model.rollStats(null, reading(), at(monday));
  assert.equal(model.statsDelta(entry), null, 'nothing to compare on a first visit');

  // Next day: what was on screen on Monday becomes the baseline.
  const tuesday = monday + DAY;
  entry = model.rollStats(entry, reading({ f: 412 }), at(tuesday));
  const first = model.statsDelta(entry);
  assert.deepEqual(moved(first), [['f', 312]]);
  assert.equal(first.since, monday);

  // Reload five minutes later. Same baseline, so the same answer.
  entry = model.rollStats(entry, reading({ f: 412 }), at(tuesday + 300));
  assert.deepEqual(model.statsDelta(entry), first);

  // ...and a number that really moved during that look is picked up, still
  // against Monday.
  entry = model.rollStats(entry, reading({ f: 413 }), at(tuesday + 600));
  assert.deepEqual(moved(model.statsDelta(entry)), [['f', 313]]);
  assert.equal(model.statsDelta(entry).since, monday);

  // Wednesday rolls it forward: the comparison is now against Tuesday's 413.
  entry = model.rollStats(entry, reading({ f: 500 }), at(tuesday + DAY));
  assert.deepEqual(moved(model.statsDelta(entry)), [['f', 87]]);
  assert.equal(model.statsDelta(entry).since, tuesday + 600);
});

test('the comparison starts on the second visit, not a window later', () => {
  // What shipped broken: the window gated whether there was a baseline at all,
  // not just when it moved. So on the day somebody switched the feature on,
  // every visit overwrote the last reading and none of them established
  // anything to compare against - there was nothing to do but leave it
  // overnight, which reads as "it does not work at all", because it does not.
  const morning = 1_700_000_000;
  let entry = model.rollStats(null, reading(), at(morning));
  assert.equal(entry.prev, undefined, 'nothing to compare against yet');

  entry = model.rollStats(entry, reading({ v: 1120 }), at(morning + 300));
  assert.ok(entry.prev, 'five minutes later there is');
  assert.deepEqual(moved(model.statsDelta(entry)), [['v', 120]]);
  assert.equal(model.statsDelta(entry).since, morning);

  // ...and the baseline stays put across the rest of that look, so the answer
  // grows rather than resetting itself.
  entry = model.rollStats(entry, reading({ v: 1200 }), at(morning + 600));
  assert.deepEqual(moved(model.statsDelta(entry)), [['v', 200]]);
  assert.equal(model.statsDelta(entry).since, morning);
});

test('"since you last looked" cannot quietly come to mean "since last month"', () => {
  // Visits closer together than the window chain into one look, so a reader who
  // opens a fiction every few hours was measured against a baseline set weeks
  // earlier: "+2,240,000 views" over a fortnight, to somebody who last looked
  // this morning. The look is capped, and re-anchors even mid-chain.
  const start = 1_700_000_000;
  let entry = model.rollStats(null, reading(), at(start));
  let last = start;
  for (let i = 1; i <= 56; i += 1) {
    last = start + i * 6 * HOUR; // every six hours for a fortnight
    entry = model.rollStats(entry, reading({ v: 1000 + i * 100 }), at(last));
  }

  const delta = model.statsDelta(entry);
  const span = (last - delta.since) / (24 * HOUR);
  assert.ok(span <= 7, `the baseline is ${span.toFixed(1)} days back`);
  assert.ok(delta.since > start, 'it did not stay pinned to the first visit');

  // Still not re-anchoring on every visit: inside a chain the baseline holds
  // until the cap, which is what keeps a reload from answering its own question.
  const held = model.rollStats(entry, reading({ v: 9999 }), at(last + HOUR));
  assert.equal(model.statsDelta(held).since, delta.since);
});

test('a burst of visits cannot collapse the span a delta covers', () => {
  // Rolling on how old the baseline is, rather than on the gap between visits,
  // would do exactly that: once the baseline went stale every reload would roll
  // it again, and the delta would shrink to "+2 views since a minute ago".
  const monday = 1_700_000_000;
  let entry = model.rollStats(null, reading(), at(monday));
  entry = model.rollStats(entry, reading({ v: 1100 }), at(monday + 60));

  const tuesday = monday + DAY;
  entry = model.rollStats(entry, reading({ v: 2000 }), at(tuesday));
  assert.equal(model.statsDelta(entry).since, monday + 60, 'measured from Monday’s last reading');

  entry = model.rollStats(entry, reading({ v: 2005 }), at(tuesday + 60));
  assert.equal(model.statsDelta(entry).since, monday + 60, 'and still is a minute later');
  assert.deepEqual(moved(model.statsDelta(entry)), [['v', 905]]);
});

test('a figure that held still is reported as holding still, not left out', () => {
  // Each one is written under its own number, so a field with nothing beneath it
  // reads as one that could not be read rather than one that did not move.
  const now = 1_700_000_000;
  let entry = model.rollStats(null, reading(), at(now));
  entry = model.rollStats(entry, reading({ f: 110 }), at(now + DAY));

  const delta = model.statsDelta(entry);
  assert.deepEqual(delta.changes.map(([field]) => field), model.STAT_FIELDS, 'all of them');
  assert.deepEqual(moved(delta), [['f', 10]], 'but only one of them moved');
  assert.equal(delta.changes.find(([field]) => field === 'v')[1], 0);

  // A field absent from either reading is genuinely not compared, so it is left
  // out rather than reported as zero.
  let partial = model.rollStats(null, { f: 100 }, at(now));
  partial = model.rollStats(partial, { f: 110, v: 50 }, at(now + DAY));
  assert.deepEqual(model.statsDelta(partial).changes, [['f', 10]]);
});

test('nothing moved means nothing to say', () => {
  const now = 1_700_000_000;
  let entry = model.rollStats(null, reading(), { now });
  entry = model.rollStats(entry, reading(), { now: now + DAY });
  assert.equal(model.statsDelta(entry), null, 'a fiction sitting still draws no line');

  // A score that moved by less than a hundredth is not a change either.
  let same = model.rollStats(null, reading({ s: 4.831 }), { now });
  same = model.rollStats(same, reading({ s: 4.834 }), { now: now + DAY });
  assert.equal(model.statsDelta(same), null);
});

test('deltas read every field, in a fixed order, and go both ways', () => {
  const now = 1_700_000_000;
  let entry = model.rollStats(null, reading(), at(now));
  entry = model.rollStats(
    entry,
    reading({
      v: 1500, w: 100, f: 90, m: 61, r: 25, p: 340,
      s: 4.52, sty: 4.45, sto: 4.55, gra: 4.72, cha: 4.33,
      c: 12,
    }),
    at(now + DAY)
  );

  // In the order Royal Road lays the figures out, so the summary and the page
  // read the same way down.
  assert.deepEqual(model.statsDelta(entry).changes, [
    ['v', 500],
    ['w', 10],
    ['f', -10], // followers can fall, and the readout has to be able to say so
    ['m', 11],
    ['r', 5],
    ['p', 40],
    ['s', 0.02], // two decimals is the whole reason the tooltip is read
    ['sty', 0.05],
    ['sto', -0.05],
    ['gra', 0.02],
    ['cha', 0.03],
    ['c', 2],
  ]);
  // Everything moved, so the readout's order is the declared one, whole.
  assert.deepEqual(
    model.statsDelta(entry).changes.map((c) => c[0]),
    model.STAT_FIELDS
  );
});

test('a stat that could not be read is absent, not zero', () => {
  const now = 1_700_000_000;
  // The score is missing from the first reading: Royal Road changed its markup,
  // or the page had no rating yet.
  let entry = model.rollStats(null, { f: 100 }, { now });
  assert.equal('s' in entry.now, false);

  entry = model.rollStats(entry, { f: 110, s: 4.5 }, { now: now + DAY });
  assert.deepEqual(
    model.statsDelta(entry).changes,
    [['f', 10]],
    'an unread baseline must not report the whole score as a gain'
  );
});

test('the stats cap drops the oldest, and says which it kept', () => {
  // The 1.4.1 bug in one sentence: a cap that keeps the right NUMBER of records
  // while dropping the wrong ones looks like it works. So this asserts identity.
  const now = 1_700_000_000;
  const stats = {};
  for (let id = 1; id <= 10; id += 1) {
    stats[id] = { now: { ...reading(), a: now - id * DAY } }; // id 1 newest, 10 oldest
  }

  const kept = model.pruneStats(stats, { now, max: 5, keep: 3 });
  assert.deepEqual(Object.keys(kept).map(Number).sort((a, b) => a - b), [1, 2, 3]);

  // Under the cap, nothing is touched.
  assert.equal(Object.keys(model.pruneStats(stats, { now, max: 50, keep: 40 })).length, 10);
});

test('a baseline nobody could use any more is forgotten', () => {
  const now = 1_700_000_000;
  const stats = {
    1: { now: { ...reading(), a: now - 30 * DAY } },
    2: { now: { ...reading(), a: now - 400 * DAY } },
  };
  assert.deepEqual(Object.keys(model.pruneStats(stats, { now })), ['1']);
  // Ageing is measured against the newest reading, so an old baseline under a
  // fiction opened yesterday is kept.
  const recent = { 3: { now: { ...reading(), a: now }, prev: { ...reading(), a: now - 400 * DAY } } };
  assert.deepEqual(Object.keys(model.pruneStats(recent, { now })), ['3']);
});

test('a record with no current reading says nothing and is dropped', () => {
  assert.deepEqual(model.normalizeStats({ 5: { prev: { ...reading(), a: 1 } } }), {});
  assert.deepEqual(model.normalizeStats({ bogus: { now: reading() } }), {});
  assert.deepEqual(model.normalizeStats(null), {});
  assert.equal(model.statsDelta(null), null);
  assert.equal(model.statsDelta({ now: reading() }), null);
});

test('the shipped window is twelve hours', () => {
  // Every test above states its own window, so this is the only thing standing
  // between a value turned down for a browser test and a release. If it fails,
  // the override is still in src/common/model.js.
  assert.equal(model.LOOK_WINDOW_S, 12 * HOUR, 'a testing override is still in the source');
});

test('statistics survive a backup', () => {
  const now = 1_700_000_000;
  let entry = model.rollStats(null, reading(), { now });
  entry = model.rollStats(entry, reading({ f: 412, s: 4.83 }), { now: now + DAY });
  const stats = { 21220: entry };

  const restored = model.parseBackup(JSON.stringify(model.buildBackup({ stats }, now * 1000)));
  assert.deepEqual(restored.stats, stats);
  assert.deepEqual(model.statsDelta(restored.stats[21220]), model.statsDelta(entry));
  // Absent in a backup written before the feature existed.
  assert.deepEqual(model.parseBackup(JSON.stringify({ format: model.BACKUP_FORMAT })).stats, {});
});

test('parseBackup rejects foreign files with a readable message', () => {
  assert.throws(() => model.parseBackup('{'), /not valid JSON/);
  assert.throws(() => model.parseBackup('[]'), /not a backup|not exported/);
  assert.throws(() => model.parseBackup(JSON.stringify({ format: 'something-else' })), /not exported/);
  assert.throws(
    () => model.parseBackup(JSON.stringify({ format: model.BACKUP_FORMAT, version: 99 })),
    /newer version/
  );
});
