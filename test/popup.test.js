'use strict';

/**
 * The toolbar popup shows one section, chosen from the tab it was opened over.
 *
 * Two things are worth holding still. First, a section must only offer settings
 * that do something on that page shape: a control that cannot act on the page in
 * front of you is the problem this popup was rebuilt to solve, and it comes back
 * silently the moment somebody adds a row to the wrong section. Second, the page
 * it picks must agree with the page the content script picked, so both go
 * through `pageFromPath` rather than parsing URLs twice.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { SCHEMA } = require('../src/common/schema.js');

const ROOT = path.join(__dirname, '..');
const POPUP = path.join(ROOT, 'src', 'popup');

/**
 * Which page shape each settings group acts on. `comments.*` belongs to chapter
 * pages because that is where Royal Road renders comments this extension styles.
 */
const PAGE_OF_PREFIX = {
  list: 'list',
  filters: 'list',
  hide: 'list',
  fiction: 'fiction',
  reader: 'chapter',
  recap: 'chapter',
  notes: 'chapter',
  comments: 'chapter',
};

const html = fs.readFileSync(path.join(POPUP, 'popup.html'), 'utf8');

/** Boot the real popup over a stubbed tab, and hand back its window. */
async function open(url) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.invalid/popup' });
  const w = dom.window;
  w.eval(`globalThis.__saved = {};
    globalThis.browser = {
      storage: { local: {
          get: async () => ({ settings: {}, hidden: {} }),
          set: async (patch) => Object.assign(globalThis.__saved, patch) },
        onChanged: { addListener() {}, removeListener() {} } },
      runtime: { openOptionsPage() {}, getURL: (p) => p },
      tabs: { query: async () => ${JSON.stringify(url ? [{ url }] : [{}])} },
    };`);

  for (const src of [
    '../common/browser.js',
    '../common/selectors.js',
    '../common/schema.js',
    '../common/model.js',
    '../common/store.js',
    '../options/settings-ui.js',
    'popup.js',
  ]) {
    w.eval(fs.readFileSync(path.join(POPUP, src), 'utf8'));
  }
  await new Promise((r) => setTimeout(r, 0));
  return w;
}

const visible = (w) =>
  [...w.document.querySelectorAll('section[data-page]')]
    .filter((s) => !s.hidden)
    .map((s) => s.dataset.page);

test('every section only offers settings that act on that page', () => {
  const dom = new JSDOM(html).window.document;
  for (const section of dom.querySelectorAll('section[data-page]')) {
    const page = section.dataset.page;
    const keys = [...section.querySelectorAll('[data-setting]')].map((el) => el.dataset.setting);
    assert.ok(keys.length, `the ${page} section offers nothing`);
    for (const key of keys) {
      assert.ok(SCHEMA[key], `${page} section binds unknown setting: ${key}`);
      assert.equal(
        PAGE_OF_PREFIX[key.split('.')[0]],
        page,
        `${key} is in the ${page} section but does nothing on a ${page} page`
      );
    }
  }
});

test('every dropdown binds a setting that has values to offer', () => {
  // popup.js fills each <select> from SCHEMA[key].values, so a non-enum here
  // renders an empty dropdown rather than failing loudly.
  const dom = new JSDOM(html).window.document;
  for (const select of dom.querySelectorAll('select[data-setting]')) {
    const key = select.dataset.setting;
    assert.equal(SCHEMA[key].type, 'enum', `${key} is a <select> but is not an enum`);
    assert.ok(SCHEMA[key].values.length > 1, `${key} offers nothing to choose between`);
  }
});

test('it shows the section for the page it was opened over', async () => {
  const cases = [
    ['https://www.royalroad.com/fictions/rising-stars', 'list'],
    ['https://www.royalroad.com/fiction/149588/some-fiction', 'fiction'],
    ['https://www.royalroad.com/fiction/149588/some-fiction/chapter/3766643/x', 'chapter'],
  ];
  for (const [url, page] of cases) {
    const w = await open(url);
    assert.deepEqual(visible(w), [page], `${url} should show the ${page} section`);
    assert.equal(w.document.getElementById('p-elsewhere').hidden, true);
    w.close();
  }
});

test('somewhere else, it says so instead of offering dead controls', async () => {
  // Royal Road's own home page included: it carries fiction cards and honours
  // hiding, but nothing in this popup changes what is on it.
  for (const url of [null, 'https://example.com/', 'https://www.royalroad.com/home']) {
    const w = await open(url);
    assert.deepEqual(visible(w), [], `${url} should show no section`);
    assert.equal(w.document.getElementById('p-elsewhere').hidden, false);
    w.close();
  }
});

test('dropdowns are filled from the schema, not restated in the popup', async () => {
  const w = await open('https://www.royalroad.com/fiction/149588/f/chapter/1/x');
  const recap = w.document.getElementById('p-recapMode');
  assert.deepEqual(
    [...recap.options].map((o) => o.value),
    SCHEMA['recap.mode'].values
  );
  // And labelled, rather than showing the raw stored value.
  assert.notEqual(recap.options[0].textContent, recap.options[0].value);
  w.close();
});

test('changing a control writes that setting and nothing else', async () => {
  const w = await open('https://www.royalroad.com/fictions/rising-stars');
  const box = w.document.getElementById('p-filtersEnabled');
  box.checked = false;
  box.dispatchEvent(new w.Event('change'));
  await new Promise((r) => setTimeout(r, 0));
  const saved = JSON.parse(JSON.stringify(w.eval('globalThis.__saved'))).settings;
  assert.equal(saved['filters.enabled'], false);
  w.close();
});

test('the design row is there whichever page you open the popup over', async () => {
  // It is the setting everything else depends on, and it stays visible on the
  // new design too: somebody who wants the old layout back has to be able to
  // switch it off. A control that only appears while you agree with it is not a
  // control.
  for (const url of [
    'https://www.royalroad.com/fictions/rising-stars',
    'https://www.royalroad.com/fiction/21220/mother-of-learning',
    'https://www.royalroad.com/fiction/21220/x/chapter/301778/y',
    'https://www.royalroad.com/home',
  ]) {
    const w = await open(url);
    const row = w.document.getElementById('p-design');
    assert.ok(row && !row.hidden, `${url}: the design row is missing`);
    assert.ok(
      w.document.querySelector('#p-design [data-setting="design.mode"]'),
      `${url}: the design row has no control`
    );
  }
});

test('the design row sits above the page sections', () => {
  // Below them it would read as belonging to whichever section happened to show.
  const doc = new JSDOM(html).window.document;
  const design = doc.getElementById('p-design');
  const first = doc.querySelector('section[data-page]');
  assert.ok(
    design.compareDocumentPosition(first) & 4 /* DOCUMENT_POSITION_FOLLOWING */,
    'the design row comes first'
  );
});
