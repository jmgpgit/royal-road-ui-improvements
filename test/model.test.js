'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/common/model.js');

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

  const parsed = model.parseMirror(JSON.stringify(model.buildMirror(settings, hidden)));
  assert.deepEqual(parsed.ids, [3, 5]);
  assert.equal(parsed.settings['list.expandAll'], true);
  assert.equal(parsed.settings['list.hoverDelayMs'], 300);

  assert.equal(model.parseMirror('{not json'), null);
  assert.equal(model.parseMirror(null), null);
  assert.equal(model.parseMirror(JSON.stringify({ v: 99, ids: [1] })), null, 'unknown version');
});

test('backup round-trips settings and hidden fictions', () => {
  const settings = model.normalizeSettings({
    'list.hoverExpand': true,
    'list.hoverDelayMs': 250,
  });
  const hidden = model.normalizeHidden({
    181303: { title: 'Gifted', url: '/fiction/181303/gifted', cover: 'c.jpg', hiddenAt: 1000 },
  });

  const backup = model.buildBackup(settings, hidden, 1700000000000);
  assert.equal(backup.format, model.BACKUP_FORMAT);
  assert.equal(backup.exportedAt, '2023-11-14T22:13:20.000Z');

  const restored = model.parseBackup(JSON.stringify(backup));
  assert.deepEqual(restored.settings, settings);
  assert.deepEqual(restored.hidden, hidden);
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
