'use strict';

/**
 * The comment pager, against a real capture of the lazy-loaded section.
 *
 * Comments differ from reviews in the one way that matters here: they are
 * `data-rr-paginate-lazy-load="true"`, so until they are fetched there is no
 * container at all - only a "Load Comments" button, with the paginate root
 * reporting `current-page="0"` and `max-page="0"`. Every re-sort bug that
 * outlived the reviews fixes lived in that difference.
 *
 * Royal Road's own script is not in a capture, so the one thing simulated here
 * is what `loadComments(page)` leaves behind. Its shape is taken from the live
 * DOM: `#comments-container` holding `[data-rr-paginate-item]` rows.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE = 'chapter-comments-lazy.new.html';
const SKIP = need(FIXTURE);
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SCRIPTS = manifest.content_scripts.flatMap((entry) => entry.js);

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

async function boot(settings = {}) {
  const dom = new JSDOM(fixture(FIXTURE), {
    url: 'https://www.royalroad.com/fiction/158833/x/chapter/3693361/y',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);

  const store = JSON.stringify({ settings, hidden: {}, dropped: {}, stats: {} });
  w.eval('globalThis.__store = ' + store + ';');
  w.eval(
    'globalThis.browser = { storage: { local: {' +
      ' get: async () => JSON.parse(JSON.stringify(globalThis.__store)),' +
      ' set: async (patch) => Object.assign(globalThis.__store, patch) },' +
      ' onChanged: { addListener() {}, removeListener() {} } },' +
      ' runtime: { getURL: (p) => p, sendMessage: async () => {}, onMessage: { addListener() {} } } };'
  );
  // One row per page, its id derived from the page number.
  w.eval(
    'globalThis.__fetched = [];' +
      'globalThis.fetch = async (url) => {' +
      '  globalThis.__fetched.push(String(url));' +
      '  var page = Number(String(url).split("page=")[1]) || 1;' +
      '  return { ok: true, status: 200, text: async () =>' +
      '    "<div data-rr-paginate-item><div id=\\"comment-container-p" + page + "\\"></div></div>" };' +
      '};' +
      'globalThis.loadComments = () => {};'
  );

  for (const file of SCRIPTS) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  if (w.RRX.boot && w.RRX.boot.ready) await w.RRX.boot.ready;
  await new Promise((resolve) => setTimeout(resolve, 20));
  return w;
}

/** What Royal Road's `loadComments(page)` leaves behind.
 *  @param {number} bottom where the list ends relative to the viewport. Far
 *  below it by default, which is what one page looks like: the ordinary trigger
 *  cannot fire there, so only the restart can. */
function render(w, page, ids, bottom = 5000) {
  const root = w.document.querySelector('#comments-pagination');
  const items = root.querySelector('[data-rr-paginate-items-container]');
  const rowsHtml = ids
    .map(
      (id) =>
        '<div key="' + id + '" class="rr-paginate-item" data-rr-paginate-item="">' +
        '<div id="comment-container-' + id + '" data-comment-id="' + id + '"></div></div>'
    )
    .join('');
  items.innerHTML =
    '<div class="space-y-6" id="comments-container" data-rr-paginate-pagination ' +
    'data-rr-paginate-pagination-page="' + page + '">' + rowsHtml + '</div>';

  root.setAttribute('data-rr-paginate-current-page', String(page));
  root.setAttribute('data-rr-paginate-max-page', '2');

  const host = w.document.querySelector('#comments-container');
  host.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    right: 0,
    width: 900,
    height: 900,
    bottom,
  });
  return host;
}

const rows = (w) =>
  w.document.querySelectorAll('#comments-pagination [data-rr-paginate-item]').length;

test('the section starts with no list at all, only a button', async () => {
  const w = await boot({ 'comments.autoLoad': true });
  const root = w.document.querySelector('#comments-pagination');

  assert.equal(root.getAttribute('data-rr-paginate-lazy-load'), 'true');
  assert.equal(root.getAttribute('data-rr-paginate-current-page'), '0', 'and no page yet');
  assert.equal(w.document.querySelector('#comments-container'), null);
  assert.ok(
    w.document.querySelector('#comment-loader').dataset.rrxClicked,
    'so the loader is pressed rather than waited on'
  );
});

const optionIn = (w, value) =>
  [...w.document.querySelectorAll('#comment-sort-dropdown [data-rr-dropdown-item]')].find(
    (el) => el.getAttribute('data-rr-dropdown-option-value') === value
  );

test('the next page is fetched in the order the reader picked, not the rendered one', async () => {
  // The one that outlived six other fixes, settled from Royal Road's own
  // source: its paginator reads `data-rr-paginate-fetch-url` once, in the
  // constructor, and a re-sort assigns the resulting `fetchUrl` property
  // (`fetchUpdateUrlAndHook`) without writing the attribute back. So the
  // attribute is stale from the first re-sort onwards - logged live, it still
  // said `sorting=newest` after a different order was picked. Page two of the
  // abandoned order arrives as rows already on screen, every one deduplicates
  // away, `added` comes out zero, the run stops and the page numbers come back.
  const w = await boot({ 'comments.autoLoad': true });
  const root = w.document.querySelector('#comments-pagination');
  const pager = w.RRX.comments.pager;

  assert.match(
    root.getAttribute('data-rr-paginate-fetch-url'),
    /sorting=newest/,
    'the URL is rendered on the saved preference'
  );
  assert.equal(pager.sorting(), 'newest', 'which the dropdown agrees with, until a re-sort');

  optionIn(w, 'oldest').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  const url = pager.urlFor(2);
  assert.match(url, /sorting=oldest/, 'we ask for the order they chose');
  assert.doesNotMatch(url, /sorting=newest/, 'not the one the page was built with');
  assert.match(
    root.getAttribute('data-rr-paginate-fetch-url'),
    /sorting=newest/,
    'and Royal Road’s own URL is left exactly as it was'
  );
});

test('an order chosen from the keyboard counts too', async () => {
  // Royal Road's dropdown fires `rr-dropdown-change` and builds its own new
  // fetch URL from this same `detail.value`. A click is not the only way to
  // reach it.
  const w = await boot({ 'comments.autoLoad': true });
  const dropdown = w.document.querySelector('#comment-sort-dropdown');

  dropdown.dispatchEvent(new w.CustomEvent('rr-dropdown-change', { detail: { value: 'top' } }));

  assert.equal(w.RRX.comments.pager.sorting(), 'top');
  assert.match(w.RRX.comments.pager.urlFor(2), /sorting=top/);
});

test('re-picking the order already in use is left alone', async () => {
  // `restart` throws away every appended page and then waits for Royal Road to
  // swap the list. Re-rendering the same order changes nothing it can see, so
  // the wait never ends and the reader is left with page one and no loading.
  const w = await boot({ 'comments.autoLoad': true });
  const pager = w.RRX.comments.pager;

  render(w, 1, [101, 102, 103], 10);
  for (let i = 0; i < 10 && !pager.state.added; i += 1) {
    pager.check();
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(pager.state.added, 1, 'a page is in');

  optionIn(w, 'newest').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(rows(w), 4, 'and it stays');
});

test('a re-sort restarts even when the new page one looks just like the old', async () => {
  // The signature was a row count and the first row's id. Page one of two
  // different orders has the same number of rows and often opens on the same
  // comment - the top comment is frequently also the newest - so the restart
  // could not see the list change, never started, and left Royal Road's page
  // numbers up. Every row is compared now, and the container identity with it.
  const w = await boot({ 'comments.autoLoad': true });
  const root = w.document.querySelector('#comments-pagination');
  const pager = w.RRX.comments.pager;

  render(w, 1, [101, 102, 103], 10); // near the end, so the ordinary run starts
  for (let i = 0; i < 10 && !pager.state.added; i += 1) {
    pager.check();
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(pager.state.added, 1, 'page two was appended');
  assert.ok(root.classList.contains('rrx-endless'), 'so the page numbers went away');

  // The reader re-sorts, and Royal Road answers with a page one that opens on
  // the very same comment and has the very same number of rows.
  const option = [
    ...w.document.querySelectorAll('#comment-sort-dropdown [data-rr-dropdown-item]'),
  ].find((el) => el.getAttribute('data-rr-dropdown-option-value') === 'oldest');
  option.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(rows(w), 3, 'our appended row went at once');

  const before = w.__fetched.length;
  render(w, 1, [101, 999, 998]);
  w.RRX.main.syncCards(w.document);
  // Waited on the row landing, not on the request going out: the assertions
  // below are about what the run ends up holding.
  for (let i = 0; i < 50 && !pager.state.added; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.ok(w.__fetched.length > before, 'the run restarted');
  assert.equal(pager.state.added, 1, 'and appended the next page of the new order');
  assert.ok(root.classList.contains('rrx-endless'), 'and the page numbers stayed away');
});
