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

test('parseBackup rejects foreign files with a readable message', () => {
  assert.throws(() => model.parseBackup('{'), /not valid JSON/);
  assert.throws(() => model.parseBackup('[]'), /not a backup|not exported/);
  assert.throws(() => model.parseBackup(JSON.stringify({ format: 'something-else' })), /not exported/);
  assert.throws(
    () => model.parseBackup(JSON.stringify({ format: model.BACKUP_FORMAT, version: 99 })),
    /newer version/
  );
});
