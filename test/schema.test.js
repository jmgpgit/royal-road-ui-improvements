'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../src/common/schema.js');
const { SCHEMA, normalizeSettings, coerce } = schema;

test('defaults are complete and stable', () => {
  const d = normalizeSettings(undefined);
  assert.deepEqual(Object.keys(d).sort(), Object.keys(SCHEMA).sort());
  assert.deepEqual(d, { ...schema.DEFAULT_SETTINGS });
  // Re-normalizing a normalized object must be a no-op.
  assert.deepEqual(normalizeSettings(d), d);
});

test('unknown keys are dropped rather than carried around', () => {
  const out = normalizeSettings({ 'not.a.setting': 1, 'list.expandAll': true });
  assert.equal('not.a.setting' in out, false);
  assert.equal(out['list.expandAll'], true);
});

test('numbers are coerced and clamped to their bounds', () => {
  assert.equal(normalizeSettings({ 'list.hoverDelayMs': -50 })['list.hoverDelayMs'], 0);
  assert.equal(normalizeSettings({ 'list.hoverDelayMs': 99999 })['list.hoverDelayMs'], 2000);
  assert.equal(normalizeSettings({ 'list.hoverDelayMs': '175' })['list.hoverDelayMs'], 175);
  assert.equal(normalizeSettings({ 'list.hoverDelayMs': 'abc' })['list.hoverDelayMs'], 150);
  // ints round; plain numbers do not.
  assert.equal(normalizeSettings({ 'list.hoverDelayMs': 12.6 })['list.hoverDelayMs'], 13);
  assert.equal(normalizeSettings({ 'reader.lineHeight': 1.75 })['reader.lineHeight'], 1.75);
});

test('nullable numerics keep null distinct from zero', () => {
  // This is what makes "no constraint" different from "must be exactly 0".
  const d = normalizeSettings({});
  assert.equal(d['filters.minRating'], null);
  assert.equal(normalizeSettings({ 'filters.minRating': '' })['filters.minRating'], null);
  assert.equal(normalizeSettings({ 'filters.minRating': null })['filters.minRating'], null);
  assert.equal(normalizeSettings({ 'filters.minRating': 0 })['filters.minRating'], 0);
});

test('enums fall back to their default when given something unknown', () => {
  assert.equal(normalizeSettings({ 'list.view': 'grid' })['list.view'], 'grid');
  assert.equal(normalizeSettings({ 'list.view': 'spiral' })['list.view'], 'default');
  assert.equal(normalizeSettings({ 'notes.mode': 'all' })['notes.mode'], 'all');
  assert.equal(normalizeSettings({ 'notes.mode': 42 })['notes.mode'], 'off');
});

test('features that alter an author’s words are off by default', () => {
  const d = normalizeSettings({});
  assert.equal(d['notes.mode'], 'off', 'collapsing part of a note is opt-in');
  // Every fiction-page section defaults to leaving Royal Road's own choice
  // alone, whatever shape its control takes.
  for (const key of [
    'about',
    'stats',
    'chapters',
    'recommendations',
    'writeReview',
    'reviews',
    'reviewSort',
  ]) {
    assert.equal(d[`fiction.${key}`], 'leave', key);
  }
});

test('lists de-duplicate and reject values outside their vocabulary', () => {
  const out = normalizeSettings({
    'filters.status': ['ONGOING', 'ONGOING', 'NONSENSE', 'COMPLETED', 7, ''],
    'filters.tagsAll': ['litrpg', 'litrpg', 'magic'],
  });
  assert.deepEqual(out['filters.status'], ['ONGOING', 'COMPLETED']);
  // tagsAll has no fixed vocabulary - Royal Road adds tags - so anything goes.
  assert.deepEqual(out['filters.tagsAll'], ['litrpg', 'magic']);
  assert.deepEqual(normalizeSettings({ 'filters.status': 'ONGOING' })['filters.status'], []);
});

test('strings are truncated, never rejected outright', () => {
  const long = 'x'.repeat(500);
  assert.equal(normalizeSettings({ 'reader.fontFamily': long })['reader.fontFamily'].length, 200);
  assert.equal(normalizeSettings({ 'reader.textColor': 123 })['reader.textColor'], '');
});

test("v1's flat setting names still load", () => {
  // An install upgrading from v1 has these six keys and nothing else.
  const v1 = {
    expandAll: true,
    hoverExpand: true,
    hoverDelayMs: 300,
    showToolbar: false,
    hideEnabled: false,
    showHidden: true,
  };
  const out = normalizeSettings(v1);
  assert.equal(out['list.expandAll'], true);
  assert.equal(out['list.hoverExpand'], true);
  assert.equal(out['list.hoverDelayMs'], 300);
  assert.equal(out['list.showToolbar'], false);
  assert.equal(out['hide.enabled'], false);
  assert.equal(out['hide.showHidden'], true);
  // The old names are not retained.
  assert.equal('expandAll' in out, false);
});

test('an explicit v2 key wins over its v1 alias', () => {
  const out = normalizeSettings({ expandAll: true, 'list.expandAll': false });
  assert.equal(out['list.expandAll'], false);
});

test('every schema entry is well formed', () => {
  for (const [key, spec] of Object.entries(SCHEMA)) {
    assert.ok(spec.type, `${key}: missing type`);
    assert.ok('default' in spec, `${key}: missing default`);
    if (spec.type === 'enum') {
      assert.ok(Array.isArray(spec.values) && spec.values.length, `${key}: enum needs values`);
      assert.ok(spec.values.includes(spec.default), `${key}: default not in values`);
    }
    if (spec.type === 'list') assert.ok(Array.isArray(spec.default), `${key}: list default`);
    // The default must survive its own coercion, or defaults and stored state diverge.
    assert.deepEqual(coerce(spec, spec.default), coerce(spec, undefined), `${key}: unstable default`);
  }
});

test('group() slices the schema by prefix', () => {
  const filters = schema.group('filters');
  assert.ok(filters.includes('filters.minRating'));
  assert.ok(!filters.includes('list.expandAll'));
  assert.equal(schema.group('nope').length, 0);
});

test('a colour written without its hash still works', () => {
  // What people paste out of a colour picker. Without the hash it is not valid
  // CSS, so the field would silently do nothing.
  const colour = (v) => normalizeSettings({ 'reader.textColor': v })['reader.textColor'];

  assert.equal(colour('7FFFD4'), '#7FFFD4');
  assert.equal(colour('fff'), '#fff', '3-digit');
  assert.equal(colour('1a2b3c4d'), '#1a2b3c4d', '8-digit with alpha');
  assert.equal(colour('  abcdef  '), '#abcdef', 'and it is trimmed first');

  // Already valid, or not hex at all: left exactly as written.
  assert.equal(colour('#7FFFD4'), '#7FFFD4');
  assert.equal(colour('red'), 'red');
  assert.equal(colour('rgb(1 2 3)'), 'rgb(1 2 3)');
  assert.equal(colour('oklch(56% .12 247)'), 'oklch(56% .12 247)');
  assert.equal(colour(''), '');

  // Hex-looking but not a valid length: not a colour, so not touched.
  assert.equal(colour('12345'), '12345');
  assert.equal(colour('nonsense!'), 'nonsense!');

  // The thread colour is the same type.
  assert.equal(
    normalizeSettings({ 'comments.threadColor': '4f8ef7' })['comments.threadColor'],
    '#4f8ef7'
  );
});

test('no CSS colour keyword can be mistaken for a bare hex value', () => {
  // The whole normalisation rests on this: a keyword would have to be spelled
  // with only the letters a to f, at one of the hex lengths, to collide.
  const NAMED = [
    'red', 'blue', 'aqua', 'beige', 'coral', 'cyan', 'gold', 'ivory', 'lime', 'navy',
    'peru', 'pink', 'plum', 'snow', 'tan', 'teal', 'wheat', 'white', 'black', 'grey',
    'gray', 'green', 'olive', 'orange', 'purple', 'silver', 'violet', 'yellow', 'maroon',
    'fuchsia', 'magenta', 'indigo', 'khaki', 'linen', 'azure', 'bisque', 'brown',
    'chocolate', 'crimson', 'orchid', 'salmon', 'sienna', 'thistle', 'tomato',
    'turquoise', 'transparent', 'currentcolor',
  ];
  for (const name of NAMED) {
    const looksHex = /^[0-9a-f]+$/i.test(name) && [3, 4, 6, 8].includes(name.length);
    assert.equal(looksHex, false, `"${name}" would be rewritten as a hex value`);
  }
});
