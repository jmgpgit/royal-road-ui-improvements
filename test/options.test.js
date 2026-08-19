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

const { JSDOM } = require('jsdom');

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

test('the page is five boxes, in the order the site is used', () => {
  // The design box comes first because it decides whether any of the rest apply:
  // on Royal Road's legacy layout every other setting on this page does nothing.
  // The four that follow are in the order somebody moves through the site.
  // Comments left the chapter box because it held 26 of the 40-odd rows, 13 of
  // them under one heading; reading a chapter and reading its comments are two
  // stops, with their own part of the page.
  assert.deepEqual(
    SECTIONS.map((s) => s.title),
    ['Royal Road’s design', 'Fiction lists', 'Fiction pages', 'Chapter pages', 'Comments']
  );
  for (const section of SECTIONS) {
    assert.ok(section.groups.length > 0, `${section.title}: no groups`);
    // A heading on every group except a box that has only one, where the box
    // title has already said it.
    for (const group of section.groups) {
      assert.ok(
        group.title || section.groups.length === 1,
        `${section.title}: a group with no heading in a box that has several`
      );
      assert.ok(group.keys.length > 0, `${section.title} / ${group.title}: empty`);
    }
  }
});

test('no box is long enough to be a wall', () => {
  // The complaint that started the rework: "hard to read with so many options".
  for (const section of SECTIONS) {
    const rows = section.groups.reduce((n, g) => n + g.keys.length, 0);
    assert.ok(rows <= 16, `${section.title}: ${rows} rows in one box`);
    for (const group of section.groups) {
      assert.ok(group.keys.length <= 7, `${section.title} / ${group.title}: ${group.keys.length}`);
    }
  }
});

test('the pattern box explains anchoring, since ^ and $ are not obvious', () => {
  const note = COPY['comments.foldPatterns'].note;
  assert.match(note, /\^/, 'mentions ^');
  assert.match(note, /\$/, 'mentions $');
  assert.match(note, /whole comment/i, 'says what anchoring is for');
});

// --- the page as it actually renders -----------------------------------------

const windows = [];
test.after(() => {
  for (const w of windows) {
    try {
      w.close();
    } catch {
      /* already gone */
    }
  }
});

/** The options page, booted with an empty store. */
async function render(store) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8'), {
    url: 'https://example.invalid/options.html',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  const seed = { settings: {}, hidden: {}, dropped: {}, stats: {}, chapters: {}, ...(store || {}) };
  w.eval(`globalThis.__s = ${JSON.stringify(seed)};`);
  w.eval(
    'globalThis.browser = { storage: { local: {' +
      ' get: async () => JSON.parse(JSON.stringify(globalThis.__s)),' +
      ' set: async (p) => Object.assign(globalThis.__s, p) },' +
      ' onChanged: { addListener() {}, removeListener() {} } },' +
      ' runtime: { getManifest: () => ({ version: "9.8.7" }), getURL: (p) => p,' +
      ' sendMessage: async () => {}, onMessage: { addListener() {} } } };'
  );
  for (const file of [
    'src/common/browser.js',
    'src/common/schema.js',
    'src/common/model.js',
    'src/common/css.js',
    'src/common/store.js',
    'src/options/settings-ui.js',
    'src/options/options.js',
  ]) {
    w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  return w;
}

test('the settings page shows the loaded extension version', async () => {
  const w = await render();
  assert.equal(w.document.getElementById('app-version').textContent, 'Version 9.8.7');
});

test('a note is never part of the control it explains', async () => {
  // A checkbox row wrapped label and note in one <label for=...>, so the whole
  // note became the checkbox's accessible name: a screen reader read 400
  // characters of explanation before saying what the control was. The other
  // three row shapes went the other way and associated their note with nothing.
  const w = await render();
  const d = w.document;

  assert.ok(d.querySelectorAll('.row').length > 40, 'the page rendered');
  assert.equal(
    d.querySelectorAll('label .row__note').length,
    0,
    'no note inside a label'
  );

  for (const control of d.querySelectorAll('#sections [data-setting]')) {
    const key = control.getAttribute('data-setting');
    if (!COPY[key] || !COPY[key].note) continue;
    assert.equal(
      control.getAttribute('aria-describedby'),
      `note-${key}`,
      `${key}: control does not point at its note`
    );
    assert.ok(d.getElementById(`note-${key}`), `${key}: no note with that id`);
  }
});

test('a clamped note keeps its text on the page', async () => {
  // Long notes fold, but into a <summary> rather than a <details> body: text in
  // the body is invisible to find-in-page and reads as absent until opened.
  const w = await render();
  const summaries = [...w.document.querySelectorAll('summary.row__note')];
  assert.ok(summaries.length > 0, 'some notes are long enough to clamp');

  for (const summary of summaries) {
    const key = summary.id.replace(/^note-/, '');
    assert.equal(summary.textContent, COPY[key].note, `${key}: clamped text is the whole note`);
  }
});

test('every box is reachable from the jump strip', async () => {
  const w = await render();
  const targets = [...w.document.querySelectorAll('.jump__link')].map((a) =>
    a.getAttribute('href')
  );
  assert.deepEqual(
    targets,
    SECTIONS.map((s) => `#card-${s.id}`),
    'one link per box, in page order'
  );
  for (const href of targets) {
    assert.ok(w.document.querySelector(href), `${href}: nothing to jump to`);
  }
});

test('picking a tag colour writes it, and picking again replaces it', async () => {
  // A list-typed setting renders no row of its own, so this card is the only
  // way in - which is why it is in NOT_IN_OPTIONS rather than a group.
  const w = await render();
  const d = w.document;

  assert.ok(d.getElementById('tag-colors-section'), 'the card is on the page');
  assert.equal(d.getElementById('tagc-empty').hidden, false, 'and says so while empty');

  d.getElementById('tagc-name').value = 'litrpg';
  d.getElementById('tagc-color').value = '#c084fc';
  d.getElementById('tagc-add').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(
    JSON.parse(JSON.stringify(w.__s.settings['tags.colors'])),
    ['litrpg #c084fc'],
    'stored as slug and colour'
  );
  assert.equal(d.querySelectorAll('.tagc__row').length, 1, 'and shown as a row');
});

test('a tag name that is neither a known tag nor a slug is refused', async () => {
  // The slug reaches a CSS selector, so the page says no rather than storing
  // something the builder will silently drop later.
  const w = await render();
  const d = w.document;

  d.getElementById('tagc-name').value = 'not a slug!';
  d.getElementById('tagc-add').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(d.getElementById('tagc-error').hidden, false, 'it says why');
  assert.equal(d.querySelectorAll('.tagc__row').length, 0, 'and nothing was added');
});

test('a colour chosen before the tag list was known picks up its name later', async () => {
  // The home page can only be matched by name, and the name comes from Royal
  // Road's own list, which nothing has fetched on a first run. Left alone, such
  // an entry stayed nameless for good and never coloured there.
  const w = await render({
    settings: { 'tags.colors': ['magic #c084fc'], 'tags.colorHome': true },
    tagCatalogue: { at: 1, tags: [{ slug: 'magic', label: 'Magic' }] },
  });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.deepEqual(
    JSON.parse(JSON.stringify(w.__s.settings['tags.colors'])),
    ['magic|Magic #c084fc'],
    'the name is filled in from the catalogue'
  );
});

test('a slug the catalogue does not know is left nameless rather than invented', async () => {
  const w = await render({
    settings: { 'tags.colors': ['not_a_real_tag #c084fc'] },
    tagCatalogue: { at: 1, tags: [{ slug: 'magic', label: 'Magic' }] },
  });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.deepEqual(
    JSON.parse(JSON.stringify(w.__s.settings['tags.colors'])),
    ['not_a_real_tag #c084fc'],
    'a name we made up would be stored and then match nothing'
  );
});

test('every setting the page lists actually renders a control', () => {
  // `rowFor` dispatches on the schema type and returned null for anything it did
  // not name, silently. Both colour settings were in a group, had a label and a
  // note, and rendered nothing - settable only by editing an exported backup.
  const shown = new Set(sectionKeys().filter((key) => !isFilterValue(key)));
  for (const key of shown) {
    const spec = SCHEMA[key];
    if (!spec || spec.type === 'list') continue; // lists are edited in context
    assert.ok(
      ['bool', 'enum', 'int', 'number', 'string', 'color'].includes(spec.type),
      `${key}: type "${spec.type}" has no row builder, so it renders nothing`
    );
  }
});

test('the colour settings reach the page', async () => {
  const w = await render();
  for (const key of ['reader.textColor', 'comments.threadColor']) {
    assert.ok(w.document.querySelector(`[data-setting="${key}"]`), `${key}: no control`);
  }
});

test('the switch inside the tag card is a settings row like every other', async () => {
  // Hand-written markup here carried its own copy of the label and note, so
  // editing COPY changed nothing on screen; and it kept the pre-rework geometry,
  // control first with the label right-aligned after it, so the one row on this
  // page that was not built by `rowFor` was also the only one facing backwards.
  const w = await render();
  const copy = COPY['tags.colorHome'];
  const row = w.document.querySelector('#tagc-home-row .row');

  assert.ok(row, 'the switch is not a row at all');
  assert.equal(row.querySelector('.row__title').textContent, copy.label);
  assert.match(row.querySelector('.row__note').textContent, /home page/);

  // Label first in the DOM, control after it: the shape every other row has.
  const title = row.querySelector('.row__title');
  const control = row.querySelector('.row__control');
  assert.ok(
    title.compareDocumentPosition(control) & w.Node.DOCUMENT_POSITION_FOLLOWING,
    'the control comes before its label'
  );
  assert.equal(control.querySelector('input[type="checkbox"]').dataset.setting, 'tags.colorHome');
});

test('a setting write leaves the changed control mounted and focused', async () => {
  // Chrome prioritises the focused element for scroll anchoring. Rebuilding the
  // form removed that anchor after every write and nudged the page upwards.
  const w = await render();
  const d = w.document;

  const checkbox = d.querySelector('[data-setting="list.expandAll"]');
  checkbox.focus();
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(d.querySelector('[data-setting="list.expandAll"]'), checkbox);
  assert.equal(d.activeElement, checkbox);

  const select = d.querySelector('[data-setting="design.mode"]');
  select.focus();
  select.value = [...select.options].find((option) => option.value !== select.value).value;
  select.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(d.querySelector('[data-setting="design.mode"]'), select);
  assert.equal(d.activeElement, select);

  const tagSwitch = d.querySelector('[data-setting="tags.colorHome"]');
  tagSwitch.focus();
  tagSwitch.checked = !tagSwitch.checked;
  tagSwitch.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(d.querySelector('[data-setting="tags.colorHome"]'), tagSwitch);
  assert.equal(d.activeElement, tagSwitch);
});

test('reset updates mounted controls to their defaults', async () => {
  const w = await render({
    settings: { 'design.mode': 'new', 'list.expandAll': true, 'tags.colorHome': true },
  });
  const d = w.document;
  const select = d.querySelector('[data-setting="design.mode"]');
  const checkbox = d.querySelector('[data-setting="list.expandAll"]');
  const tagSwitch = d.querySelector('[data-setting="tags.colorHome"]');
  w.confirm = () => true;

  d.getElementById('reset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(d.querySelector('[data-setting="design.mode"]'), select);
  assert.equal(d.querySelector('[data-setting="list.expandAll"]'), checkbox);
  assert.equal(d.querySelector('[data-setting="tags.colorHome"]'), tagSwitch);
  assert.equal(select.value, 'leave');
  assert.equal(checkbox.checked, false);
  assert.equal(tagSwitch.checked, false);
});
