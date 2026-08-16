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

nodeTest('a cookie value is read by exact name', () => {
  const jar = 'foo=1; beta-ui-v2=always; bar=2';
  assert.equal(design.cookieValue(jar, 'beta-ui-v2'), 'always');
  assert.equal(design.cookieValue(jar, 'foo'), '1');
  assert.equal(design.cookieValue('', 'beta-ui-v2'), null, 'no cookies at all');
  // Prefix matching would let a future cookie of Royal Road's answer for this one.
  assert.equal(design.cookieValue('beta-ui-v2-other=always', 'beta-ui-v2'), null);
});

nodeTest('only the redesign value counts as the redesign', () => {
  assert.equal(design.usesNewDesign('beta-ui-v2=always'), true);
  // Royal Road's own revert link writes something else; anything that is not
  // exactly the opt-in must read as "not the redesign".
  assert.equal(design.usesNewDesign('beta-ui-v2=never'), false);
  assert.equal(design.usesNewDesign(''), false);
});

nodeTest('the switch directive is scoped to outlast the tab and the subdomain', () => {
  const directive = design.switchDirective();
  assert.match(directive, /^beta-ui-v2=always;/, 'asks for the redesign');
  assert.match(directive, /domain=\.royalroad\.com/, 'holds across subdomains');
  assert.match(directive, /path=\//, 'and across the whole site');
  assert.match(directive, /max-age=\d{7,}/, 'and outlives the session');
});

// --- in a page -------------------------------------------------------------

/**
 * Boot the real content scripts over a fixture.
 *
 * `reloads` counts calls rather than navigating, since jsdom cannot reload and
 * the count is the thing worth asserting anyway.
 */
async function boot({ layout = 'legacy', settings = {}, cookie = '' } = {}) {
  const file =
    layout === 'legacy' ? 'fictions-rising-stars.legacy.html' : 'fictions-rising-stars.new.html';
  // jsdom refuses to let `location` or its `reload` be redefined, so reloads are
  // counted where they surface instead: calling reload() makes jsdom emit a
  // "Not implemented: navigation" error. Catching it both counts the call and
  // keeps the expected noise out of the test output.
  const counter = { reloads: 0 };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (/Not implemented: navigation/i.test(err.message || '')) counter.reloads += 1;
    else console.error(err.message);
  });

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
  if (cookie) w.document.cookie = `${cookie}; path=/`;

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
const stored = (w) => JSON.parse(JSON.stringify(w.eval('globalThis.__s'))).settings || {};

test('nothing at all happens on the redesign', async () => {
  // The extension works here, so there is nothing to offer and nothing to fix.
  const w = await boot({ layout: 'new', cookie: 'beta-ui-v2=always' });
  assert.equal(reloads(w), 0, 'no reload');
  assert.equal(design.usesNewDesign(w.document.cookie), true, 'the cookie is left as it was');
});

test('with the setting on, the switch happens before the page is painted', async () => {
  const w = await boot({ layout: 'legacy', settings: { 'design.mode': 'new' } });
  assert.equal(design.usesNewDesign(w.document.cookie), true, 'the cookie is corrected');
  assert.equal(reloads(w), 1, 'once');
});

test('a switch that does not take costs one reload, not a loop', async () => {
  // If Royal Road ever ignored the cookie, re-deciding on every load would put
  // the tab in a reload loop that the reader cannot escape.
  const w = await boot({ layout: 'legacy', settings: { 'design.mode': 'new' } });
  assert.equal(reloads(w), 1);

  const flag = w.eval(`globalThis.sessionStorage.getItem('rrx:design:switched')`);
  assert.equal(flag, '1', 'the attempt is remembered for this tab');

  // Same tab, cookie still wrong: it must not try again.
  w.RRX.boot.enforceDesign({ 'design.mode': 'new' });
  assert.equal(reloads(w), 1, 'no second reload');
});

test('the guard clears once the switch has taken, so a later revert is honoured', async () => {
  const w = await boot({ layout: 'new', settings: { 'design.mode': 'new' }, cookie: 'beta-ui-v2=always' });
  assert.equal(reloads(w), 0, 'nothing to do');
  assert.equal(
    w.eval(`globalThis.sessionStorage.getItem('rrx:design:switched')`),
    null,
    'and the tab is ready to switch again if Royal Road sends it back'
  );
});

test('ticking the setting in the popup switches the tab you are looking at', async () => {
  // This is what the removed banner used to do with its "Switch to it" button,
  // and it is now the only way in. Without it the popup appears to do nothing on
  // the very page it was opened over, which is the page it was ticked for.
  const w = await boot({ layout: 'legacy' });
  assert.equal(reloads(w), 0, 'nothing has happened yet');

  // The popup writes the setting; the browser tells every tab.
  w.eval(`globalThis.__s.settings['design.mode'] = 'new';
    for (const fn of globalThis.__listeners) fn({ settings: { newValue: globalThis.__s.settings } }, 'local');`);
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(design.usesNewDesign(w.document.cookie), true, 'the cookie is set');
  assert.equal(reloads(w), 1, 'and the tab reloads into the redesign');
});

test('a legacy page leaves the mirror behind so the next one switches sooner', async () => {
  // boot.js reads a synchronous localStorage mirror before first paint, and it
  // is written only by a content script that got as far as running - which never
  // happened on this layout. Somebody who has only ever seen the old design
  // would otherwise never get the pre-paint path at all.
  const w = await boot({ layout: 'legacy', settings: { 'list.showToolbar': true } });
  const mirror = w.eval(`globalThis.localStorage.getItem('rrx:v1:boot')`);
  assert.ok(mirror, 'the mirror was written');
  assert.ok(JSON.parse(mirror).settings, 'and it carries the settings');
});

nodeTest('clearing covers both shapes the cookie can take', () => {
  // A cookie written with a `domain` and one written without are different
  // cookies that can coexist under one name, and a delete removes only the one
  // it matches. Ours has a domain; Royal Road's own may not. Missing either
  // leaves the opt-in in place, and nothing on screen says why.
  const clears = design.clearDirectives();
  assert.equal(clears.length, 2, 'one per shape');
  for (const directive of clears) {
    assert.match(directive, /^beta-ui-v2=;/, 'empty value');
    assert.match(directive, /max-age=0/, 'expiring immediately');
    assert.match(directive, /path=\//, 'over the whole site');
  }
  assert.equal(clears.filter((d) => /domain=/.test(d)).length, 1, 'exactly one carries a domain');

  // The one that does must match how the opt-in was written, or it removes nothing.
  const domainOf = (d) => (d.match(/domain=[^;]*/) || [''])[0];
  assert.equal(
    domainOf(clears.find((d) => /domain=/.test(d))),
    domainOf(design.switchDirective()),
    'and it matches the write'
  );
});

test('choosing the old design puts you back, which is what off never did', async () => {
  // The reported bug: turning the setting off left the cookie in place, so Royal
  // Road kept serving the redesign for ever, and no amount of reloading helped
  // because the cookie is what decides. "Off" cannot fix that by doing nothing.
  const w = await boot({ layout: 'new', settings: { 'design.mode': 'old' }, cookie: 'beta-ui-v2=always' });
  assert.equal(design.usesNewDesign(w.document.cookie), false, 'the opt-in is gone');
  assert.equal(reloads(w), 1, 'and the page reloads to get the old layout');
});

test('leaving it to Royal Road changes nothing in either direction', async () => {
  // The default. It must not undo a choice made before, and must not impose one:
  // it is the state of having no opinion, which is the only safe thing to ship.
  const optedIn = await boot({ layout: 'new', settings: {}, cookie: 'beta-ui-v2=always' });
  assert.equal(design.usesNewDesign(optedIn.document.cookie), true, 'an opt-in is left alone');
  assert.equal(reloads(optedIn), 0, 'with no reload');

  const notOptedIn = await boot({ layout: 'legacy', settings: {} });
  assert.equal(design.usesNewDesign(notOptedIn.document.cookie), false, 'and so is not opting in');
  assert.equal(reloads(notOptedIn), 0, 'with no reload');
});

test('the choice is re-enforced on every load, so a hard refresh obeys it', async () => {
  // Royal Road may set the cookie again itself. Acting only when the setting
  // changes would mean the choice held once and then quietly stopped, which is
  // exactly what "even with ctrl f5" describes.
  const w = await boot({ layout: 'new', settings: { 'design.mode': 'old' }, cookie: 'beta-ui-v2=always' });
  assert.equal(reloads(w), 1);

  // As if Royal Road put it back: a fresh load must clear it again.
  w.document.cookie = 'beta-ui-v2=always; path=/';
  w.eval(`globalThis.sessionStorage.removeItem('rrx:design:switched')`); // a new page, new tab state
  w.RRX.boot.enforceDesign({ 'design.mode': 'old' });
  assert.equal(design.usesNewDesign(w.document.cookie), false, 'cleared again');
  assert.equal(reloads(w), 2, 'and reloaded again');
});

test('switching back from the redesign works from the redesign itself', async () => {
  // The page you are on when you change your mind is the new layout, where
  // main.js takes its own path entirely. If only the legacy branch listened, the
  // one place somebody would actually use this from would be the one that
  // ignored it.
  const w = await boot({ layout: 'new', cookie: 'beta-ui-v2=always' });
  assert.equal(reloads(w), 0, 'nothing yet');

  w.eval(`globalThis.__s.settings['design.mode'] = 'old';
    for (const fn of globalThis.__listeners) fn({ settings: { newValue: globalThis.__s.settings } }, 'local');`);
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(design.usesNewDesign(w.document.cookie), false, 'the opt-in is cleared');
  assert.equal(reloads(w), 1, 'and the tab reloads into the old layout');
});
