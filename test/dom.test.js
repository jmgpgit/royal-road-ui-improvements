'use strict';

/**
 * Integration tests: the real content-script modules, running against the real
 * Royal Road HTML in test/fixtures/, inside jsdom.
 *
 * The string assertions in selectors.test.js prove the hooks still exist. These
 * prove the code built on them actually selects the right elements - in
 * particular that the generated `:has()` rule hides exactly one fiction and
 * nothing adjacent.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');

const SKIP = need(
  'chapter-comments-nested.new.html',
  'fictions-rising-stars.new.html',
  'fictions-latest-updates.new.html',
  'fictions-search.new.html',
  'home.new.html',
  'fictions-rising-stars.legacy.html'
);

/** Every test here loads a capture into jsdom; skip the lot if any is absent. */
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/css.js',
  'src/content/ui.js',
  'src/content/features/hide-fictions.js',
];

/** A jsdom window with the extension's content-script modules loaded into it. */
function loadPage(fixtureName, url) {
  const dom = new JSDOM(fixture(fixtureName), { url, runScripts: 'outside-only' });
  const w = dom.window;
  // Just enough of the extension API for browser.js and store-free modules.
  w.eval(`globalThis.browser = {
    storage: { local: { get: async () => ({}), set: async () => {} },
               onChanged: { addListener() {}, removeListener() {} } },
    runtime: { getURL: (p) => p, sendMessage() {}, onMessage: { addListener() {} } },
  };`);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return w;
}

/**
 * Every `display: none` selector out of the generated stylesheet, exactly as the
 * browser sees them (one per card group), joined back into a single query.
 */
function hideSelector(w, ids) {
  return w.RRX
    .buildHideCss(ids)
    .split('\n')
    .filter((rule) => rule.includes('display:none'))
    .map((rule) => rule.split('{')[0].trim())
    .join(',');
}

/** A stand-in for main.js's shared context. */
function makeCtx(w, hiddenIds = []) {
  return {
    settings: w.RRX.normalizeSettings({ 'hide.enabled': true }),
    hiddenSet: new Set(hiddenIds),
    hide() {},
    unhide() {},
  };
}

// -- list pages -------------------------------------------------------------

test('list page: the toolbar anchor exists and sits above the cards', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const anchors = w.document.querySelectorAll(w.RRX.SEL.listRoot);
  assert.equal(anchors.length, 1);

  const marker = w.document.createElement('div');
  anchors[0].prepend(marker);
  const firstCard = w.document.querySelector(w.RRX.SEL.listCard);
  assert.equal(
    marker.compareDocumentPosition(firstCard) & w.Node.DOCUMENT_POSITION_FOLLOWING,
    w.Node.DOCUMENT_POSITION_FOLLOWING,
    'toolbar must precede the first card'
  );
});

test('list page: every card resolves to exactly one fiction id', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];
  assert.equal(cards.length, 50);

  const ids = cards.map((c) => w.RRX.hideFictions.readFictionId(c));
  assert.ok(ids.every((id) => Number.isInteger(id) && id > 0), 'every card yields an id');
  assert.equal(new Set(ids).size, 50, 'ids are unique across the page');

  // Cross-check against the id Royal Road puts in the show-more checkbox.
  for (const card of cards) {
    const box = card.querySelector(`input[id^="${w.RRX.SEL.blurbCheckboxPrefix}"]`);
    if (!box) continue;
    assert.equal(
      w.RRX.fictionIdFromBlurbId(box.id),
      w.RRX.hideFictions.readFictionId(card),
      `card ${box.id}: link-derived id must match the checkbox id`
    );
  }
});

test('list page: the generated rule hides exactly the one fiction', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];
  const target = cards[7];
  const id = w.RRX.hideFictions.readFictionId(target);

  const matched = [...w.document.querySelectorAll(hideSelector(w, [id]))];
  assert.equal(matched.length, 1);
  assert.equal(matched[0], target);
});

test('list page: hiding several fictions hits precisely those cards', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];
  const chosen = [cards[0], cards[13], cards[49]];
  const ids = chosen.map((c) => w.RRX.hideFictions.readFictionId(c));

  const matched = new Set(w.document.querySelectorAll(hideSelector(w, ids)));
  assert.equal(matched.size, 3);
  for (const card of chosen) assert.ok(matched.has(card));
});

test('a near-miss id does not drag a longer id down with it', () => {
  // The trailing slash in a[href*="/fiction/{id}/"] is what stops /fiction/1813
  // from matching /fiction/181303.
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];
  const realId = w.RRX.hideFictions.readFictionId(cards[0]);
  const prefix = Number(String(realId).slice(0, -1)); // e.g. 181303 -> 18130

  assert.equal(w.document.querySelectorAll(hideSelector(w, [prefix])).length, 0);
  assert.equal(w.document.querySelectorAll(hideSelector(w, [realId])).length, 1);
});

test('latest-updates: cards are hideable even though they carry no blurb', () => {
  const w = loadPage('fictions-latest-updates.new.html', 'https://www.royalroad.com/fictions/latest-updates');
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];
  assert.ok(cards.length > 0);
  assert.equal(w.document.querySelectorAll(w.RRX.SEL.showMoreRoot).length, 0);

  // These cards link to chapters as well as the fiction; all share one id.
  const id = w.RRX.hideFictions.readFictionId(cards[0]);
  assert.ok(Number.isInteger(id));
  assert.equal(w.document.querySelectorAll(hideSelector(w, [id])).length, 1);
});

test('search page: the anchor and cards resolve there too', () => {
  const w = loadPage('fictions-search.new.html', 'https://www.royalroad.com/fictions/search?tagsAdd=litrpg');
  assert.equal(w.document.querySelectorAll(w.RRX.SEL.listRoot).length, 1);
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];
  assert.equal(cards.length, 20);
  const id = w.RRX.hideFictions.readFictionId(cards[0]);
  assert.equal(w.document.querySelectorAll(hideSelector(w, [id])).length, 1);
});

// -- home -------------------------------------------------------------------

test('home: hiding a fiction removes it from every strip it appears in', () => {
  const w = loadPage('home.new.html', 'https://www.royalroad.com/home');
  const horizontal = [...w.document.querySelectorAll('.fiction-card-horizontal')];
  assert.ok(horizontal.length > 0, 'home has horizontal cards');

  const id = w.RRX.hideFictions.readFictionId(horizontal[0]);
  const matched = [...w.document.querySelectorAll(hideSelector(w, [id]))];
  assert.ok(matched.length >= 1);
  // Whatever it matched must be a supported card variant for that same fiction.
  for (const node of matched) {
    assert.ok(
      w.RRX.CARD_VARIANTS.some((v) => node.matches(v)),
      'matched node must be a card variant'
    );
    assert.equal(w.RRX.hideFictions.readFictionId(node), id);
  }
});

test('home: the blog splash carousel is never hideable', () => {
  const w = loadPage('home.new.html', 'https://www.royalroad.com/home');
  const splashSlides = w.document.querySelectorAll('.home-splash-carousel [data-rr-carousel-item]');
  assert.ok(splashSlides.length > 0, 'fixture still has splash slides');

  // Hiding every fiction on the page must not touch a single splash slide.
  const allIds = [...w.document.querySelectorAll('a[href*="/fiction/"]')]
    .map((a) => w.RRX.fictionIdFromHref(a.getAttribute('href')))
    .filter(Boolean);
  const matched = [...w.document.querySelectorAll(hideSelector(w, allIds))];
  for (const slide of splashSlides) {
    assert.ok(!matched.includes(slide), 'a blog slide must never be hidden');
  }
});

// -- legacy UI --------------------------------------------------------------

test('legacy UI: the probe says no, and nothing we emit matches anyway', () => {
  const w = loadPage('fictions-rising-stars.legacy.html', 'https://www.royalroad.com/fictions/rising-stars');

  // The <html> element is NOT a usable signal - the old UI's "ie8 no-js" classes
  // sit inside an IE conditional comment, so a real parser sees a bare <html>.
  // This is exactly why detection waits for the DOM probe.
  assert.equal(w.document.documentElement.className, '');
  assert.equal(w.document.querySelectorAll(w.RRX.SEL.newUiProbe).length, 0);

  assert.equal(w.document.querySelectorAll(w.RRX.SEL.listCard).length, 0);
  assert.equal(w.document.querySelectorAll(w.RRX.SEL.showMoreRoot).length, 0);
  // The old UI has a `.fiction-list` of its own, which is why that alone can
  // never stand in for the probe.
  assert.equal(w.document.querySelectorAll(w.RRX.SEL.listRoot).length, 1);

  // Even with ids that genuinely exist on the page, the rule matches nothing.
  const ids = [...w.document.querySelectorAll('a[href*="/fiction/"]')]
    .map((a) => w.RRX.fictionIdFromHref(a.getAttribute('href')))
    .filter(Boolean)
    .slice(0, 20);
  assert.ok(ids.length > 0, 'legacy page does link to fictions');
  assert.equal(w.document.querySelectorAll(hideSelector(w, ids)).length, 0);
});

test("a blurb linking to another fiction does not make this card hideable as it", () => {
  // Author blurbs routinely say "if you liked this, try...". Matching any
  // /fiction/ link would (a) refuse to give this card a button and (b) delete
  // this card from every list the moment the reader hides the recommended one.
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const cards = [...w.document.querySelectorAll(w.RRX.SEL.listCard)];

  const withForeignLinks = cards.filter((card) => {
    const own = w.RRX.hideFictions.readFictionId(card);
    return [...card.querySelectorAll('a[href*="/fiction/"]')].some(
      (a) => w.RRX.fictionIdFromHref(a.getAttribute('href')) !== own
    );
  });
  assert.ok(withForeignLinks.length > 0, 'fixture still contains a cross-linking blurb');

  for (const card of withForeignLinks) {
    const own = w.RRX.hideFictions.readFictionId(card);
    assert.ok(Number.isInteger(own), 'the card is still attributable to its own fiction');

    const foreign = [...card.querySelectorAll('a[href*="/fiction/"]')]
      .map((a) => w.RRX.fictionIdFromHref(a.getAttribute('href')))
      .filter((id) => id && id !== own);

    // Hiding a fiction merely *mentioned* in the blurb must not hide this card.
    const matched = [...w.document.querySelectorAll(hideSelector(w, foreign))];
    assert.ok(!matched.includes(card), 'card hidden by a blurb link');
    // Hiding its own fiction must.
    assert.ok([...w.document.querySelectorAll(hideSelector(w, [own]))].includes(card));
  }
});

// -- card decoration --------------------------------------------------------

test('syncCards tags each card once and is safe to re-run', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const ctx = makeCtx(w);

  w.RRX.hideFictions.syncCards(w.document, ctx);
  const tagged = w.document.querySelectorAll('[data-rrx-fid]');
  assert.equal(tagged.length, 50);
  assert.equal(w.document.querySelectorAll('.rrx-card-btn').length, 50);

  // Re-running must not duplicate controls - the observer calls this repeatedly.
  w.RRX.hideFictions.syncCards(w.document, ctx);
  w.RRX.hideFictions.syncCards(w.document, ctx);
  assert.equal(w.document.querySelectorAll('.rrx-card-btn').length, 50);

  for (const card of tagged) {
    assert.equal(card.querySelectorAll(':scope > .rrx-card-btn').length, 1);
  }
});

test('syncCards shows a restore control and badge on already-hidden cards', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const first = w.document.querySelector(w.RRX.SEL.listCard);
  const id = w.RRX.hideFictions.readFictionId(first);

  const ctx = makeCtx(w, [id]);
  w.RRX.hideFictions.syncCards(w.document, ctx);

  assert.equal(first.getAttribute('data-rrx-hidden'), '');
  assert.equal(first.querySelector(':scope > .rrx-card-btn').dataset.rrxMode, 'restore');
  assert.equal(first.querySelectorAll(':scope > .rrx-hidden-badge').length, 1);

  // Un-hiding swaps the control back and drops the badge.
  ctx.hiddenSet.delete(id);
  w.RRX.hideFictions.syncCards(w.document, ctx);
  assert.equal(first.hasAttribute('data-rrx-hidden'), false);
  assert.equal(first.querySelector(':scope > .rrx-card-btn').dataset.rrxMode, 'hide');
  assert.equal(first.querySelectorAll(':scope > .rrx-hidden-badge').length, 0);
});

test('syncCards removes controls entirely when hiding is switched off', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const ctx = makeCtx(w);
  w.RRX.hideFictions.syncCards(w.document, ctx);
  assert.equal(w.document.querySelectorAll('.rrx-card-btn').length, 50);

  ctx.settings = w.RRX.normalizeSettings({ 'hide.enabled': false });
  w.RRX.hideFictions.syncCards(w.document, ctx);
  assert.equal(w.document.querySelectorAll('.rrx-card-btn').length, 0);
  assert.equal(w.document.querySelectorAll('[data-rrx-hidden]').length, 0);
});

test('readMeta captures a usable title, cover and query-free url', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const card = w.document.querySelector(w.RRX.SEL.listCard);
  const id = w.RRX.hideFictions.readFictionId(card);
  const meta = w.RRX.hideFictions.readMeta(card, id);

  assert.ok(meta.title.length > 0);
  assert.notEqual(meta.title, `Fiction ${id}`, 'should find the real title, not the fallback');
  assert.match(meta.url, new RegExp(`^/fiction/${id}/`));
  assert.ok(!meta.url.includes('?'), 'utm parameters must be stripped');
  assert.match(meta.cover, /^https?:\/\//);
});

test('non-fiction containers are marked skipped rather than rescanned forever', () => {
  const w = loadPage('home.new.html', 'https://www.royalroad.com/home');
  const ctx = makeCtx(w);
  w.RRX.hideFictions.syncCards(w.document, ctx);

  // The colour-scheme and partner carousels contain no fiction links.
  const skipped = w.document.querySelectorAll('[data-rrx-skip]');
  for (const node of skipped) {
    assert.equal(node.hasAttribute('data-rrx-fid'), false);
    assert.equal(node.querySelectorAll(':scope > .rrx-card-btn').length, 0);
  }
});

// -- the covers layout --------------------------------------------------------
//
// The covers tile is built entirely in CSS, by giving parts of Royal Road's card
// an `order` inside one flex column. That only works if each part it orders is a
// separate flex item, which is not something the markup guarantees.

test('the covers view can place the title without dragging the buttons with it', () => {
  const w = loadPage('fictions-rising-stars.new.html', 'https://www.royalroad.com/fictions/rising-stars');
  const card = w.document.querySelector('.fiction-card-expanded');

  // Royal Road ships the title and the Read / Read Later pair in ONE row. Order
  // that row and both move together, and at tile width they end up side by side
  // fighting over the same few characters.
  const row = [...card.querySelectorAll('div')].find(
    (d) => d.matches('div:has(> a[data-vt-trigger] > h2)') && d.querySelector('form[data-bookmark-form]')
  );
  assert.ok(row, 'the shared title-and-buttons row still exists, which is why it gets dissolved');

  // So what the stylesheet orders is the title LINK, not that row. It must hold
  // the heading and nothing else.
  const titleItem = card.querySelector('a[data-vt-trigger]:has(> h2)');
  assert.ok(titleItem, 'the title link is reachable on its own');
  assert.ok(titleItem.querySelector('h2'), 'and it carries the heading');
  assert.equal(
    titleItem.querySelector('form[data-bookmark-form]'),
    null,
    'the ordered title item must not contain the Read / Read Later buttons'
  );

  // And the buttons are reachable as their own item, so they can be sent last.
  const buttons = card.querySelector('div.hidden:has(> form[data-bookmark-form])');
  assert.ok(buttons, 'the buttons are addressable separately');
  assert.equal(buttons.querySelector('h2'), null, 'and carry no heading of their own');
});

test('the covers stylesheet orders buttons, cover, rating, title', () => {
  const whole = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'content', 'inject-views.css'),
    'utf8'
  );
  // Only the cover-grid section. Two columns orders the same parts differently,
  // and searching the whole file finds its rules first.
  const start = whole.indexOf('Cover grid:');
  assert.ok(start > 0, 'the cover grid section is findable');
  const css = whole.slice(start);

  const orderOf = (selectorFragment) => {
    const i = css.indexOf(selectorFragment);
    assert.ok(i > 0, `rule not found: ${selectorFragment}`);
    const m = css.slice(i, i + 400).match(/order:\s*(\d+)/);
    assert.ok(m, `no order on: ${selectorFragment}`);
    return Number(m[1]);
  };
  const cover = orderOf("div:has(> a img[data-type='cover'])");
  const title = orderOf("a[data-vt-trigger]:has(> h2)");
  const stats = orderOf("[class*='grid-cols-5']");
  const buttons = orderOf("div.hidden:has(> form[data-bookmark-form])");

  // The title is the only part whose height varies, so it goes last: anywhere
  // else it pushes what follows out of line with the neighbouring tiles.
  assert.ok(buttons < cover, `buttons (${buttons}) come before the cover (${cover})`);
  assert.ok(cover < stats, `cover (${cover}) comes before the rating (${stats})`);
  assert.ok(stats < title, `rating (${stats}) comes before the title (${title})`);
  assert.equal(title, Math.max(buttons, cover, stats, title), 'the title is last');
});

test('the thread divider is drawn on every comment but the last', () => {
  // Royal Road wraps each top-level comment in its own [data-rr-paginate-item],
  // one comment per wrapper. So every comment is the last child of something,
  // and a `[data-depth='0']:last-child` rule meant to spare the final comment
  // silently spares all of them: the setting draws nothing, anywhere, while its
  // spacing still applies. The wrapper is what has siblings.
  const w = loadPage('chapter-comments-nested.new.html', 'https://www.royalroad.com/fiction/1/x/chapter/2/y');
  const d = w.document;
  d.documentElement.className = 'rrx-comments rrx-comment-rules';

  const tops = [...d.querySelectorAll('[data-comment-id][data-depth="0"]')];
  assert.ok(tops.length > 5, 'the page has several conversations');
  assert.equal(
    tops.filter((c) => c === c.parentElement.lastElementChild).length,
    tops.length,
    'every comment really is a last-child, which is why that selector is wrong'
  );

  const suppressed = [
    ...d.querySelectorAll(
      'html.rrx-comments.rrx-comment-rules [data-rr-paginate-item]:last-child [data-comment-id][data-depth="0"]'
    ),
  ];
  assert.equal(suppressed.length, 1, 'exactly one comment is the final one');
  assert.equal(suppressed[0], tops[tops.length - 1], 'and it is the last on the page');
});
