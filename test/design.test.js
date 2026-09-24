'use strict';

/**
 * Switching between Royal Road's two layouts.
 *
 * This matters more than most settings: the extension only works on the
 * redesign, so on the legacy layout every other feature is inert. These tests
 * pin down the way out of that — a setting that switches for you — and, just as
 * importantly, that it does nothing on a page that is already the redesign.
 *
 * There was briefly an in-page notice offering the switch. It was removed: on
 * the legacy layout Royal Road's ad script puts a sticky unit over the bottom of
 * the viewport, which swallowed the clicks, and winning that fight permanently
 * was not worth it. The offer lives in the popup instead.
 *
 * jsdom proves the cookie mechanics only. What Royal Road serves for a cookie was
 * measured against the live site; `beta-ui-v2` had stopped counting by 4.1.20260923
 * and every test here still passed, because they checked the cookie, not the page.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');
const design = require('../src/common/design.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SCRIPTS = manifest.content_scripts.flatMap((entry) => entry.js);

const SKIP = need('fictions-rising-stars.legacy.html', 'fictions-rising-stars.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

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

// --- the pure part ---------------------------------------------------------

nodeTest('a cookie value is read by exact name, the last copy winning', () => {
  const jar = 'foo=1; rr_ui_mode=redesign; bar=2';
  assert.equal(design.cookieValue(jar, 'rr_ui_mode'), 'redesign');
  assert.equal(design.cookieValue(jar, 'foo'), '1');
  assert.equal(design.cookieValue('', 'rr_ui_mode'), null, 'no cookies at all');
  assert.equal(design.cookieValue('rr_ui_mode_x=redesign', 'rr_ui_mode'), null, 'no prefix match');
  // Measured: with two copies Royal Road serves the last one.
  assert.equal(design.cookieValue('rr_ui_mode=legacy; rr_ui_mode=redesign', 'rr_ui_mode'), 'redesign');
  assert.equal(design.cookieValue('rr_ui_mode=redesign; rr_ui_mode=legacy', 'rr_ui_mode'), 'legacy');
});

nodeTest('beta-ui-v2 no longer asks for anything', () => {
  // By 4.1.20260923 the server ignores it: `always` alone gets legacy.
  assert.equal(design.layoutAsked('beta-ui-v2=always'), null);
  assert.equal(design.layoutAsked('beta-ui-v2=never; rr_ui_mode=redesign'), 'redesign');
});

nodeTest('the switch is written host-only, after removing both domain-scoped leftovers', () => {
  const directives = design.switchDirectives('redesign');
  const write = directives.at(-1);
  assert.match(write, /^rr_ui_mode=redesign;/);
  assert.doesNotMatch(write, /domain=/, "host-only, so it is the same cookie as Royal Road's");
  assert.match(write, /path=\//);
  assert.match(write, /samesite=lax/);
  assert.match(write, /; secure;/);
  assert.match(write, /max-age=\d{7,}/, 'outlives the session');

  const deletes = directives.slice(0, -1);
  assert.deepEqual(
    deletes.map((d) => d.split('=')[0]),
    ['rr_ui_mode', 'beta-ui-v2'],
    'before the write, so a newer domain copy cannot outrank it'
  );
  for (const d of deletes) {
    assert.match(d, /^[\w-]+=;/, 'empty value');
    assert.match(d, /domain=\.royalroad\.com/, 'the shape 1.5.4 wrote');
    assert.match(d, /path=\/.*max-age=0/);
  }
  assert.equal(directives.filter((d) => /^beta-ui-v2=[^;]/.test(d)).length, 0, 'never written');
  assert.match(design.switchDirectives('legacy').at(-1), /^rr_ui_mode=legacy;/);
});

// --- in a page -------------------------------------------------------------

/**
 * Boot the real content scripts over a fixture.
 *
 * `reloads` counts calls rather than navigating, since jsdom cannot reload and
 * the count is the thing worth asserting anyway. `cookie` may be a list, to seed
 * two shapes under one name.
 */
async function boot({ layout = 'legacy', settings = {}, cookie = [] } = {}) {
  const file =
    layout === 'legacy' ? 'fictions-rising-stars.legacy.html' : 'fictions-rising-stars.new.html';
  // jsdom refuses to let `location` or its `reload` be redefined, so reloads are
  // counted where they surface instead: calling reload() makes jsdom emit a
  // "Not implemented: navigation" error. Catching it both counts the call and
  // keeps the expected noise out of the test output.
  const counter = { reloads: 0, warnings: [] };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (/Not implemented: navigation/i.test(err.message || '')) counter.reloads += 1;
    else console.error(err.message);
  });
  virtualConsole.on('warn', (...args) => counter.warnings.push(args.join(' ')));

  const dom = new JSDOM(fixture(file), {
    url: 'https://www.royalroad.com/fictions/rising-stars',
    runScripts: 'outside-only',
    virtualConsole,
  });
  const w = dom.window;
  w.__counter = counter;
  windows.push(w);

  // `path=/` because that is how the cookie really arrives: without it the
  // browser scopes a cookie to the directory of the current URL, so one set from
  // /fictions/... lives at /fictions and no site-wide delete can reach it.
  for (const c of [].concat(cookie)) w.document.cookie = `${c}; path=/`;

  w.eval(`globalThis.__s = ${JSON.stringify({ settings, hidden: {} })};
    globalThis.__sent = [];
    globalThis.__listeners = [];
    globalThis.browser = {
      storage: {
        local: {
          get: async () => JSON.parse(JSON.stringify(globalThis.__s)),
          set: async (patch) => Object.assign(globalThis.__s, patch),
        },
        onChanged: {
          addListener: (fn) => globalThis.__listeners.push(fn),
          removeListener: (fn) => {
            globalThis.__listeners = globalThis.__listeners.filter((f) => f !== fn);
          },
        },
      },
      runtime: {
        getURL: (p) => p,
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          globalThis.__sent.push(message);
        },
      },
    };`);

  for (const file2 of SCRIPTS) w.eval(fs.readFileSync(path.join(ROOT, file2), 'utf8'));
  await new Promise((r) => setTimeout(r, 250));
  return w;
}

const reloads = (w) => w.__counter.reloads;
const asked = (w) => design.layoutAsked(w.document.cookie);
const copies = (w) => (w.document.cookie.match(/(?:^|; )rr_ui_mode=/g) || []).length;
const overridden = (w) => w.__counter.warnings.some((m) => /Display Mode/.test(m));
/** What the popup does: write the setting, and the browser tells every tab. */
const choose = (w, mode) =>
  w.eval(`globalThis.__s.settings['design.mode'] = '${mode}';
    for (const fn of globalThis.__listeners) fn({ settings: { newValue: globalThis.__s.settings } }, 'local');`);

test('with the setting on, a legacy page asks for the redesign and reloads once', async () => {
  const w = await boot({ layout: 'legacy', settings: { 'design.mode': 'new' } });
  assert.equal(asked(w), 'redesign');
  assert.equal(copies(w), 1);
  assert.equal(reloads(w), 1);
  assert.equal(overridden(w), false, 'a switch under way is not a switch that failed');
});

test('a reader left on beta-ui-v2 by 1.5.4 is switched properly', async () => {
  // The regression: 1.5.4's opt-in read as done while Royal Road served legacy
  // to it, so the extension sat inert with the setting on.
  const w = await boot({
    layout: 'legacy',
    settings: { 'design.mode': 'new' },
    cookie: 'beta-ui-v2=always; domain=.royalroad.com',
  });
  assert.equal(asked(w), 'redesign');
  assert.equal(copies(w), 1, 'exactly one rr_ui_mode');
  assert.equal(reloads(w), 1);
  assert.doesNotMatch(w.document.cookie, /beta-ui-v2/, 'and our leftover is gone');
});

test("Royal Road's revert is overwritten, not shadowed", async () => {
  // Their revert writes a host-only rr_ui_mode=legacy. Ours must replace it,
  // and any domain-scoped copy must go, or two go up and the newer one wins.
  const w = await boot({
    layout: 'legacy',
    settings: { 'design.mode': 'new' },
    cookie: ['rr_ui_mode=legacy; domain=.royalroad.com', 'rr_ui_mode=legacy'],
  });
  assert.equal(asked(w), 'redesign');
  assert.equal(copies(w), 1, 'one cookie');
  assert.equal(reloads(w), 1);
});

test('a switch that does not take costs one reload, not a loop', async () => {
  const w = await boot({ layout: 'legacy', settings: { 'design.mode': 'new' } });
  assert.equal(reloads(w), 1);
  assert.equal(w.eval(`globalThis.sessionStorage.getItem('rrx:design:switched')`), '1');

  // Same tab, and the cookie did not survive the reload: no second attempt.
  w.document.cookie = 'rr_ui_mode=; path=/; max-age=0';
  w.RRX.boot.enforceDesign({ 'design.mode': 'new' });
  assert.equal(reloads(w), 1, 'no second reload');
});

test('the guard clears once the cookie matches, so a later revert is honoured', async () => {
  const w = await boot({
    layout: 'new',
    settings: { 'design.mode': 'new' },
    cookie: 'rr_ui_mode=redesign',
  });
  assert.equal(reloads(w), 0);
  assert.equal(w.eval(`globalThis.sessionStorage.getItem('rrx:design:switched')`), null);
});

test('when the cookie is right and the layout is not, the console says why', async () => {
  // Nothing is left to try, and a loop would be worse. A signed-in account's
  // own Display Mode is the likely cause, and that is not ours to change.
  const w = await boot({
    layout: 'legacy',
    settings: { 'design.mode': 'new' },
    cookie: 'rr_ui_mode=redesign',
  });
  assert.equal(reloads(w), 0);
  assert.equal(overridden(w), true);
});

test('ticking the setting in the popup switches the tab you are looking at', async () => {
  // The only way in. Without it the popup appears to do nothing on the very
  // page it was opened over.
  const w = await boot({ layout: 'legacy' });
  assert.equal(reloads(w), 0, 'nothing has happened yet');
  choose(w, 'new');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(asked(w), 'redesign');
  assert.equal(reloads(w), 1);
});

test('a popup change follows the page served, not only the cookie', async () => {
  // Another tab asked for the redesign after this legacy page loaded, so the
  // cookie already reads right. Choosing the new design must still reload.
  const w = await boot({ layout: 'legacy', cookie: 'rr_ui_mode=redesign' });
  assert.equal(reloads(w), 0);

  // Any other edit leaves the page alone: only this setting says what it should be.
  w.eval(`globalThis.__s.settings['list.expandAll'] = true;
    for (const fn of globalThis.__listeners) fn({ settings: { newValue: globalThis.__s.settings } }, 'local');`);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(reloads(w), 0);

  choose(w, 'new');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(reloads(w), 1);
  assert.equal(copies(w), 1);
});

test('a legacy page leaves the mirror behind so the next one switches sooner', async () => {
  // boot.js reads a synchronous localStorage mirror before first paint, and only
  // a content script that ran writes it. Somebody who has only ever seen the old
  // design would otherwise never get the pre-paint path at all.
  const w = await boot({ layout: 'legacy', settings: { 'list.showToolbar': true } });
  const mirror = w.eval(`globalThis.localStorage.getItem('rrx:v1:boot')`);
  assert.ok(mirror, 'the mirror was written');
  assert.ok(JSON.parse(mirror).settings, 'and it carries the settings');
});

test("choosing the old design writes legacy, as Royal Road's revert does", async () => {
  // Written, not deleted: no cookie is legacy signed out, but a signed-in
  // account may have its own preference to fall back on.
  const w = await boot({
    layout: 'new',
    settings: { 'design.mode': 'old' },
    cookie: 'rr_ui_mode=redesign',
  });
  assert.equal(asked(w), 'legacy');
  assert.equal(copies(w), 1);
  assert.equal(reloads(w), 1);
});

test('leaving it to Royal Road touches nothing, not even our own leftover', async () => {
  // The default. It must not undo a choice made before, and must not impose one.
  const optedIn = await boot({ layout: 'new', cookie: 'rr_ui_mode=redesign' });
  assert.equal(asked(optedIn), 'redesign');
  assert.equal(reloads(optedIn), 0);

  const old = await boot({ layout: 'legacy', cookie: 'beta-ui-v2=always; domain=.royalroad.com' });
  assert.equal(asked(old), null);
  assert.match(old.document.cookie, /beta-ui-v2=always/);
  assert.equal(reloads(old), 0);

  // Leave reads no cookie, so it cannot blame an account's Display Mode.
  const stuck = await boot({ layout: 'legacy', cookie: 'rr_ui_mode=redesign' });
  assert.equal(overridden(stuck), false);

  const own = Object.getOwnPropertyDescriptor(stuck.Document.prototype, 'cookie');
  let read = 0;
  Object.defineProperty(stuck.document, 'cookie', {
    configurable: true,
    get() {
      read += 1;
      return own.get.call(this);
    },
    set(v) {
      own.set.call(this, v);
    },
  });
  assert.equal(stuck.RRX.boot.enforceDesign({ 'design.mode': 'leave' }), false);
  assert.equal(read, 0, 'PRIVACY.md promises leave reads no cookie');
});

test('the choice is re-enforced on every load, so a hard refresh obeys it', async () => {
  const w = await boot({
    layout: 'new',
    settings: { 'design.mode': 'old' },
    cookie: 'rr_ui_mode=redesign',
  });
  assert.equal(reloads(w), 1);

  // Royal Road's own switch puts it back; a fresh load must correct it again.
  w.document.cookie = 'rr_ui_mode=redesign; path=/; samesite=lax';
  w.eval(`globalThis.sessionStorage.removeItem('rrx:design:switched')`); // a new page
  w.RRX.boot.enforceDesign({ 'design.mode': 'old' });
  assert.equal(asked(w), 'legacy');
  assert.equal(copies(w), 1);
  assert.equal(reloads(w), 2);
});

test('switching back from the redesign works from the redesign itself', async () => {
  // main.js takes its own path on the redesign. If only the legacy branch
  // listened, the page you change your mind on would ignore you.
  const w = await boot({ layout: 'new', cookie: 'rr_ui_mode=redesign' });
  assert.equal(reloads(w), 0);
  choose(w, 'old');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(asked(w), 'legacy');
  assert.equal(reloads(w), 1);
});
