'use strict';

/**
 * The options page builds itself from the schema, so the thing worth testing is
 * that the two stay in step: every setting must be reachable somewhere, and
 * every control must point at a setting that exists.
 *
 * Without this, adding a key to schema.js and forgetting settings-ui.js gives a
 * setting nobody can change, which fails silently and forever.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SCHEMA } = require('../src/common/schema.js');
const {
  COPY,
  SECTIONS,
  NOT_IN_OPTIONS,
  isFilterValue,
  sectionKeys,
} = require('../src/options/settings-ui.js');

const ROOT = path.join(__dirname, '..');

test('every schema key is reachable, or explicitly exempt', () => {
  const covered = new Set(sectionKeys());
  const orphans = Object.keys(SCHEMA).filter(
    (key) => !covered.has(key) && !isFilterValue(key) && !(key in NOT_IN_OPTIONS)
  );
  assert.deepEqual(
    orphans,
    [],
    `unreachable setting(s): ${orphans.join(', ')}: add to a section in settings-ui.js, or to NOT_IN_OPTIONS with a reason`
  );
});

test('every option row points at a real setting', () => {
  for (const key of sectionKeys()) {
    assert.ok(SCHEMA[key], `section references unknown setting: ${key}`);
  }
  for (const key of Object.keys(COPY)) {
    assert.ok(SCHEMA[key], `COPY references unknown setting: ${key}`);
  }
  for (const key of Object.keys(NOT_IN_OPTIONS)) {
    assert.ok(SCHEMA[key], `NOT_IN_OPTIONS references unknown setting: ${key}`);
  }
});

test('no setting appears in two sections', () => {
  const keys = sectionKeys();
  assert.equal(new Set(keys).size, keys.length, 'a setting is listed twice');
});

test('every rendered setting has a label, and enums label their options', () => {
  for (const key of sectionKeys()) {
    const copy = COPY[key];
    assert.ok(copy && copy.label, `${key}: no label`);
    const spec = SCHEMA[key];
    if (spec.type !== 'enum') continue;
    for (const value of spec.values) {
      assert.ok(
        copy.optionLabels && copy.optionLabels[value],
        `${key}: enum value "${value}" has no label`
      );
    }
  }
});

test('sections are renderable types only', () => {
  // Lists are edited in context (tag fields in the panel, blocked authors from a
  // chapter chip); a list dropped into a section would render as nothing.
  for (const key of sectionKeys()) {
    assert.notEqual(SCHEMA[key].type, 'list', `${key}: lists cannot be rendered here`);
  }
});

test('the popup only binds settings that exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');
  const keys = [...html.matchAll(/data-setting="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 0, 'the popup binds something');
  for (const key of keys) assert.ok(SCHEMA[key], `popup binds unknown setting: ${key}`);
});

test('both extension pages load the schema before anything that reads it', () => {
  for (const page of ['src/options/options.html', 'src/popup/popup.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const at = (needle) => scripts.findIndex((s) => s.endsWith(needle));
    assert.ok(at('schema.js') >= 0, `${page}: schema.js is not loaded`);
    assert.ok(at('browser.js') < at('schema.js'), `${page}: browser.js must come first`);
    assert.ok(at('schema.js') < at('model.js'), `${page}: model.js depends on schema.js`);
    assert.ok(at('store.js') < scripts.length - 1, `${page}: page script must come last`);
  }
});

test('the page is four boxes, in the order the site is used', () => {
  // The design box comes first because it decides whether any of the rest apply:
  // on Royal Road's legacy layout every other setting on this page does nothing.
  // The three that follow are in the order somebody moves through the site.
  assert.deepEqual(
    SECTIONS.map((s) => s.title),
    ['Royal Road’s design', 'Fiction lists', 'Fiction pages', 'Chapter pages']
  );
  for (const section of SECTIONS) {
    assert.ok(section.groups.length > 0, `${section.title}: no groups`);
    for (const group of section.groups) {
      assert.ok(group.title, `${section.title}: a group with no heading`);
      assert.ok(group.keys.length > 0, `${section.title} / ${group.title}: empty`);
    }
  }
});

test('the pattern box explains anchoring, since ^ and $ are not obvious', () => {
  const note = COPY['comments.foldPatterns'].note;
  assert.match(note, /\^/, 'mentions ^');
  assert.match(note, /\$/, 'mentions $');
  assert.match(note, /whole comment/i, 'says what anchoring is for');
});

