'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

const css = require('../src/common/css.js');
const { CARD_VARIANTS, CARD_GROUPS } = require('../src/common/selectors.js');

const ruleCount = (text) => (text.match(/\{/g) || []).length;

test('nothing hidden means no stylesheet at all', () => {
  assert.equal(css.buildHideCss([]), '');
  assert.equal(css.buildHideCss(undefined), '');
  assert.equal(css.buildHideCss(['nonsense', 0, -1]), '');
});

test('hidden fictions produce a display:none rule naming each id', () => {
  const text = css.buildHideCss([181303, 56828]);
  assert.match(text, /display:none!important/);
  assert.match(text, /a\[href\*="\/fiction\/181303\/"\]/);
  assert.match(text, /a\[href\*="\/fiction\/56828\/"\]/);
  // The slug-less form, for links that stop at the id.
  assert.match(text, /a\[href\$="\/fiction\/181303"\]/);
});

test('every supported card variant is covered', () => {
  const text = css.buildHideCss([1]);
  for (const variant of CARD_VARIANTS) {
    assert.ok(text.includes(variant), `missing card variant: ${variant}`);
  }
});

test('the rule count stays constant as the hidden list grows', () => {
  // One `:has()` holding an `:is()` list of ids per card group, not one rule per
  // fiction - `:has()` is re-evaluated on every style recalculation, so the rule
  // count is what has to stay bounded.
  const one = ruleCount(css.buildHideCss([1]));
  const many = ruleCount(css.buildHideCss(Array.from({ length: 500 }, (_, i) => i + 1)));
  assert.equal(one, many);
  assert.equal(one, CARD_GROUPS.length * 3, 'hide, dim and outline rule per card group');
});

test('each card group matches through its own link selector', () => {
  const text = css.buildHideCss([181303]);
  for (const group of CARD_GROUPS) {
    assert.ok(
      text.includes(`${group.link}[href*="/fiction/181303/"]`),
      `group "${group.cards[0]}" must match via ${group.link}`
    );
  }
  // The server-rendered groups must go through data-vt-trigger, so a fiction
  // merely linked from an author's blurb can never hide the card it appears in.
  assert.ok(text.includes('a[data-vt-trigger="fiction-card"][href*="/fiction/181303/"]'));
});

test('ids are de-duplicated and order-independent', () => {
  assert.equal(css.buildHideCss([2, 1, 2]), css.buildHideCss([1, 2]));
  assert.equal(css.buildHideCss(['3', 3]), css.buildHideCss([3]));
});

test('show-hidden mode reveals rather than removes', () => {
  const text = css.buildHideCss([1]);
  assert.match(text, /html:not\(\.rrx-show-hidden\)[^\n]*display:none/);
  assert.match(text, /html\.rrx-show-hidden[^\n]*opacity:\.4/);
  // The dimming must skip the controls we inject, since opacity on a parent
  // cannot be undone by a child.
  assert.match(text, />\*:not\(\.rrx-ui\)/);
});

test('a dropped fiction is dimmed, and nothing else', () => {
  // The whole point of the mark is that the card stays: `display:none` is what
  // hiding is for, and `pointer-events:none` would stop somebody changing their
  // mind, which is the case this feature exists to serve.
  const text = css.buildDropCss([181303]);
  assert.match(text, /opacity:0?\.\d+/);
  assert.equal(text.includes('display:none'), false, 'a dropped fiction is not hidden');
  assert.equal(text.includes('pointer-events'), false, 'and stays clickable');
  assert.match(text, /a\[href\*="\/fiction\/181303\/"\]/);
  // Same reason as the hide stylesheet: opacity on the card cannot be undone by
  // a child, so our own controls have to be left out of it.
  assert.match(text, />\*:not\(\.rrx-ui\)/);
});

test('the dropped stylesheet scales the same way the hidden one does', () => {
  assert.equal(css.buildDropCss([]), '');
  assert.equal(css.buildDropCss(['nonsense', 0, -1]), '');
  assert.equal(css.buildDropCss([2, 1, 2]), css.buildDropCss([1, 2]));

  const one = ruleCount(css.buildDropCss([1]));
  const many = ruleCount(css.buildDropCss(Array.from({ length: 500 }, (_, i) => i + 1)));
  assert.equal(one, many);
  assert.equal(one, CARD_GROUPS.length, 'one dimming rule per card group');

  for (const variant of CARD_VARIANTS) {
    assert.ok(css.buildDropCss([1]).includes(variant), `missing card variant: ${variant}`);
  }
});

test('inject.css can only ever match the redesign or our own elements', () => {
  // This is the invariant that lets boot.js run without an old-UI check: every
  // selector must be anchored to an `rrx-` name we control or a `data-rr-` hook
  // that exists only in the redesign. Nothing may match bare Royal Road markup.
  const text = fs
    .readFileSync(path.join(__dirname, '..', 'src', 'content', 'inject.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const selectors = text
    .split('}')
    .map((block) => block.split('{')[0].trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('@'))
    .filter((s) => !/^(from|to|\d+%)$/.test(s)) // @keyframes stops
    .flatMap((s) => s.split(',').map((one) => one.trim()))
    .filter(Boolean);

  assert.ok(selectors.length > 10, 'sanity: the stylesheet was actually parsed');
  for (const selector of selectors) {
    assert.ok(
      selector.includes('rrx') || selector.includes('data-rr'),
      `unanchored selector would leak onto the old UI: "${selector}"`
    );
  }
});

test('rootClassesFor maps settings to <html> classes', () => {
  // comments.threading, its separators and the collapse control all default
  // on, so they are the baseline in every expectation below.
  const of = (s) => css.rootClassesFor(s).sort();
  const BASE = ['rrx-comment-collapsible', 'rrx-comment-rules', 'rrx-comments'];

  assert.deepEqual(of({}), BASE);
  assert.deepEqual(of({ 'list.expandAll': true }), [...BASE, 'rrx-expand-all']);
  assert.deepEqual(of({ 'list.hoverExpand': true }), [...BASE, 'rrx-hover-expand']);

  // Expand-all already holds everything open, so hover is suppressed rather
  // than layered on top.
  assert.deepEqual(of({ 'list.expandAll': true, 'list.hoverExpand': true }), [
    ...BASE,
    'rrx-expand-all',
  ]);

  assert.deepEqual(of({ 'hide.showHidden': true }), [...BASE, 'rrx-show-hidden']);
  // ...but not while hiding is switched off entirely.
  assert.deepEqual(of({ 'hide.showHidden': true, 'hide.enabled': false }), BASE);

  assert.deepEqual(of({ 'comments.threading': false }), [], 'separators need threading');
  assert.deepEqual(of({ 'comments.separators': false }), [
    'rrx-comment-collapsible',
    'rrx-comments',
  ]);
  // The collapse button needs a gutter reserved on every comment, so it gets a
  // class of its own rather than riding along with threading.
  assert.deepEqual(of({ 'comments.collapsible': false }), ['rrx-comment-rules', 'rrx-comments']);
  assert.deepEqual(of({ 'list.view': 'grid' }), [...BASE, 'rrx-view-grid']);
  assert.deepEqual(of({ 'list.view': 'default' }), BASE);
});

test('reader classes only appear while the reader is enabled', () => {
  const of = (s) => css.rootClassesFor(s).sort();
  const reader = { 'reader.lineHeight': 1.8, 'reader.justify': true, 'reader.textColor': '#eee' };

  // Every reader override is gated behind the master switch, so turning the
  // reader off is one toggle rather than clearing five fields.
  assert.deepEqual(of(reader), ['rrx-comment-collapsible', 'rrx-comment-rules', 'rrx-comments']);

  const on = of({ ...reader, 'reader.enabled': true });
  assert.ok(on.includes('rrx-line-height'));
  assert.ok(on.includes('rrx-justify'));
  assert.ok(on.includes('rrx-hyphens'), 'hyphens ride along with justify by default');
  assert.ok(on.includes('rrx-text-color'));
  assert.ok(!on.includes('rrx-wide'), 'no width override was asked for');

  const noHyphens = of({ ...reader, 'reader.enabled': true, 'reader.hyphens': false });
  assert.ok(noHyphens.includes('rrx-justify'));
  assert.ok(!noHyphens.includes('rrx-hyphens'));
});

test('rootVarsFor carries values, and drops them when unset', () => {
  const base = css.rootVarsFor({});
  assert.equal(base['--rrx-hover-delay'], '150ms');
  assert.equal('--rrx-line-height' in base, false);

  const full = css.rootVarsFor({
    'reader.enabled': true,
    'reader.lineHeight': 1.8,
    'reader.textColor': '#eee',
    'reader.fontFamily': 'Georgia, serif',
    'reader.maxWidthPx': 1600,
  });
  assert.equal(full['--rrx-line-height'], '1.8');
  assert.equal(full['--rrx-text-color'], '#eee');
  assert.equal(full['--rrx-font'], 'Georgia, serif');
  assert.equal(full['--rrx-reader-max'], '1600px');
});

test('MANAGED_CLASSES covers what rootClassesFor emits, but not lifecycle flags', () => {
  // boot.js clears MANAGED_CLASSES before applying; anything emitted but not
  // managed would stick around forever once set.
  const emitted = new Set();
  for (const view of ['default', 'compact', 'grid', 'two-col', 'titles']) {
    for (const cls of css.rootClassesFor({
      'list.view': view,
      'list.expandAll': true,
      'hide.showHidden': true,
      'reader.enabled': true,
      'reader.lineHeight': 2,
      'reader.justify': true,
      'reader.textColor': '#000',
      'reader.fontFamily': 'serif',
      'reader.maxWidthPx': 1600,
      'notes.hideAuthorPanel': true,
    })) {
      emitted.add(cls);
    }
  }
  for (const cls of emitted) {
    assert.ok(css.MANAGED_CLASSES.includes(cls), `${cls} is emitted but not managed`);
  }
  // rrx-ready and rrx-filters-pending are lifecycle, not settings: clearing them
  // on a settings change would be wrong.
  assert.ok(!css.MANAGED_CLASSES.includes('rrx-ready'));
  assert.ok(!css.MANAGED_CLASSES.includes('rrx-filters-pending'));
});

test('the recap is set in the same type as the chapter under it', () => {
  // The recap builds its own paragraphs from the previous chapter's text, so it
  // is the one piece of chapter prose on the page that is NOT inside
  // `.chapter-content` and matches none of Royal Road's containers. Every
  // reader override therefore has to name it explicitly, or the reader's font,
  // colour and leading stop at the top of the page: the same author's words,
  // set in a different typeface, directly above the chapter they came from.
  const text = fs
    .readFileSync(path.join(__dirname, '..', 'src', 'content', 'inject-reader.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /** The selector list of the rule gated on this `<html>` class. */
  const selectorsFor = (cls) => {
    const blocks = text.split('}');
    const block = blocks.find((b) => b.includes(`html.${cls} `));
    assert.ok(block, `no rule is gated on html.${cls}`);
    return block.slice(0, block.indexOf('{'));
  };

  for (const cls of ['rrx-font', 'rrx-text-color', 'rrx-line-height', 'rrx-justify']) {
    assert.match(
      selectorsFor(cls),
      /\.rrx-recap__body/,
      `html.${cls} styles the chapter but not the recap above it`
    );
  }

  // The link inside the recap keeps its own colour, exactly as a link inside
  // the chapter does: a recoloured chapter must not swallow its own link.
  assert.match(selectorsFor('rrx-text-color'), /\.rrx-recap__body \*:not\(a\):not\(a \*\)/);
});

test('every selector in every stylesheet actually parses', () => {
  // A selector the browser cannot parse is dropped silently, taking its whole
  // rule with it, and the feature just stops working with nothing in the
  // console. Nested :has() is the easy one to write by accident: it is illegal,
  // and `div:has(> div:has(a))` looks perfectly reasonable.
  const { JSDOM } = require('jsdom');
  const w = new JSDOM('<div></div>').window;
  const dir = path.join(__dirname, '..', 'src', 'content');
  const sheets = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));
  assert.ok(sheets.length >= 5, 'found the stylesheets');

  let checked = 0;
  for (const sheet of sheets) {
    const text = fs
      .readFileSync(path.join(dir, sheet), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media[^{]*\{/g, '');
    for (const block of text.split('}')) {
      const selector = block.split('{')[0].trim();
      if (!selector || !block.includes('{') || selector.startsWith('@')) continue;
      if (/^(from|to|\d+%)$/.test(selector)) continue; // @keyframes stops
      try {
        w.document.querySelector(selector);
        checked += 1;
      } catch (err) {
        assert.fail(`${sheet}: unparseable selector\n  ${selector}\n  ${err.message}`);
      }
    }
  }
  assert.ok(checked > 100, `sanity: ${checked} selectors parsed`);

  // And prove the check has teeth, rather than passing because nothing throws.
  assert.throws(
    () => w.document.querySelector('div:has(> div:has(a))'),
    'nested :has() must be rejected, or this test guards nothing'
  );
  w.close();
});

test('a rule meant to override another is actually more specific than it', () => {
  // The covers tile works by dissolving Royal Road's shared "title + Read /
  // Read Later" row so the two can be placed separately. That rule has to beat
  // the blanket rule which forces every desktop block to `display: flex`, and
  // both are `!important`, so `!important` decides nothing and specificity does.
  // A shorter selector loses however late it appears in the file, and the
  // symptom is silent: the row simply stays a flex box and the title sits
  // beside the buttons.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'content', 'inject-views.css'),
    'utf8'
  );

  /** (ids, classes+attrs+pseudo-classes, elements); :has() counts its argument. */
  const specificity = (selector) => {
    let s = selector;
    let a = 0;
    let b = 0;
    let c = 0;
    s = s.replace(/:(?:has|is|not)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (_, inner) => {
      const [ia, ib, ic] = specificity(inner.replace(/^\s*[>+~]\s*/, ''));
      a += ia;
      b += ib;
      c += ic;
      return ' ';
    });
    a += (s.match(/#[\w-]+/g) || []).length;
    // `\\.` covers an escaped character inside a class name, as in `md\:flex`.
    b += (s.match(/\.(?:\\.|[\w-])+/g) || []).length;
    b += (s.match(/\[[^\]]*\]/g) || []).length;
    b += (s.match(/:(?!:)[\w-]+/g) || []).length;
    c += (s.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length;
    return [a, b, c];
  };
  const beats = (x, y) => {
    const [p, q] = [specificity(x), specificity(y)];
    return p[0] - q[0] || p[1] - q[1] || p[2] - q[2];
  };

  /** The selector of the first rule after `from` whose body sets prop: value. */
  const selectorSetting = (property, value, from = 0) => {
    const at = css.indexOf(`${property}: ${value}`, from);
    assert.ok(at > 0, `no rule sets ${property}: ${value}`);
    // Walk back to the brace that opens this block, then to whatever ended the
    // thing before it: everything between is the selector list.
    const open = css.lastIndexOf('{', at);
    const prevEnd = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('*/', open));
    return css
      .slice(prevEnd + 1, open)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s.includes('rrx-view-grid'))[0];
  };

  // The class is literally named "md:flex", so the colon is escaped in CSS.
  const blanket = 'html.rrx-view-grid .fiction-card-expanded .hidden.md\\:flex';
  assert.ok(css.includes(blanket), 'the blanket desktop-block rule still exists');

  const dissolve = selectorSetting('display', 'contents', css.indexOf('Cover grid:'));
  assert.ok(dissolve, 'the covers view dissolves the shared title row');
  assert.ok(
    beats(dissolve, blanket) > 0,
    `this loses to the blanket rule and will not apply:\n  ${dissolve}  ${specificity(dissolve)}\n  ${blanket}  ${specificity(blanket)}`
  );

  // The helper must actually rank these, or the assertion above proves nothing.
  assert.ok(beats('.a.b.c.d', '.a.b.c') > 0, 'more classes wins');
  assert.ok(beats('div:has(> a[x] > h2)', '.a.b.c.d') < 0, 'classes outrank elements');
});

test('the endless-mode rule lives where every page can see it', () => {
  // Comments, reviews and the fiction lists all set `rrx-endless`, so the rule
  // that acts on it cannot sit in one feature's stylesheet.
  const dir = path.join(__dirname, '..', 'src', 'content');
  const sheets = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));
  const owners = sheets.filter((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8').includes('.rrx-endless')
  );
  assert.deepEqual(owners, ['inject.css'], 'exactly one shared stylesheet defines it');
});

test('the divider strength reaches the page as a custom property', () => {
  // Emitted from rootVarsFor rather than set later by comments.js, so it lands
  // at document_start and the line never redraws itself after first paint.
  assert.equal(css.rootVarsFor({})['--rrx-divider'], '0.16', 'faint by default');
  assert.equal(css.rootVarsFor({ 'comments.dividerOpacity': 70 })['--rrx-divider'], '0.7');

  // Nothing to draw, nothing to say.
  assert.equal('--rrx-divider' in css.rootVarsFor({ 'comments.separators': false }), false);
  assert.equal('--rrx-divider' in css.rootVarsFor({ 'comments.threading': false }), false);

  // The schema clamps, so a hand-edited backup cannot produce invalid CSS.
  assert.equal(css.rootVarsFor({ 'comments.dividerOpacity': 999 })['--rrx-divider'], '1');
  assert.equal(css.rootVarsFor({ 'comments.dividerOpacity': -5 })['--rrx-divider'], '0.01');
});

test('nothing visible depends on color-mix resolving', () => {
  // color-mix() is all-or-nothing: if any input fails to resolve, the browser
  // drops the whole declaration and the line does not exist. That is how the
  // divider and the thread line both came to be invisible while their spacing
  // still applied. Every rule that draws something must therefore either avoid
  // color-mix, or state a plain value first for it to refine.
  // Comments are stripped first: this file explains color-mix at length, and
  // prose is not a declaration.
  const sheet = fs
    .readFileSync(path.join(__dirname, '..', 'src', 'content', 'inject-comments.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const at = sheet.indexOf("[data-depth='0']::after");
  const divider = sheet.slice(at, sheet.indexOf('}', at));
  assert.match(divider, /background:\s*currentColor/, 'the divider needs no theme token');
  assert.match(divider, /opacity:\s*var\(--rrx-divider, 0?\.\d+\)/, 'and is faded with opacity');
  assert.equal(divider.includes('color-mix'), false, 'and never with color-mix');

  // Wherever color-mix is still used, a plain declaration must precede it in the
  // same block so an unresolvable mix downgrades instead of vanishing.
  for (const block of sheet.split('}')) {
    if (!block.includes('color-mix')) continue;
    for (const prop of ['background', 'border-left-color', 'border-left']) {
      if (!block.includes(prop + ':')) continue;
      const decls = block.split(';').map((d) => d.trim()).filter((d) => d.startsWith(prop.split('-')[0]));
      assert.ok(
        decls.some((d) => !d.includes('color-mix')),
        `a color-mix value with no plain fallback before it:\n${block.trim().slice(0, 160)}`
      );
    }
  }
});

// --- the tag rules, against the markup they are written for -------------------

const ROOT = path.join(__dirname, '..');
const listCss = fs.readFileSync(path.join(ROOT, 'src/content/inject-list.css'), 'utf8');

/** jsdom has no cascade, so what is checkable is whether a rule's selector
 *  reaches the elements it was written for. A rule that matches nothing is the
 *  failure mode worth catching: Royal Road renames a class and the setting
 *  quietly stops doing anything. */
const docFor = (fixture, rootClass) => {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'test/fixtures', fixture), 'utf8'));
  dom.window.document.documentElement.classList.add(rootClass);
  return dom;
};

test('the always-open tag rule reaches the tags Royal Road hides', () => {
  const dom = docFor('fictions-weekly-popular.new.html', 'rrx-tags-all');
  const d = dom.window.document;

  const hidden = d.querySelectorAll('.fiction-card-expanded a[href*="tagsAdd="].hidden');
  assert.ok(hidden.length > 0, 'the capture has cards with tags folded away');

  const reached = d.querySelectorAll(
    '.rrx-tags-all .fiction-card-expanded a[href*="tagsAdd="].hidden'
  );
  assert.equal(reached.length, hidden.length, 'every one of them is reached');

  // And the +/- goes, since it would have nothing left to reveal.
  assert.ok(
    d.querySelectorAll('.rrx-tags-all .fiction-card-expanded label[for^="tags-toggle"]').length > 0,
    'the toggle is reached too'
  );
  dom.window.close();
});

test('the fiction-page tag rule stays inside the fiction’s own header', () => {
  const dom = docFor('fiction-detail.new.html', 'rrx-fiction-tags-all');
  const d = dom.window.document;

  assert.ok(d.querySelector('#fiction-hero'), 'the hero is the anchor');
  assert.ok(
    d.querySelectorAll('#fiction-hero a[href*="tagsAdd="]').length > 0,
    'the fiction’s tags are inside it'
  );
  // Every tag chip on the page belongs to the fiction itself in this capture,
  // so scoping cannot be shown to exclude anything here - what it guards
  // against is the recommendation and review blocks further down a live page.
  assert.equal(
    d.querySelectorAll('.fiction-card-expanded a[href*="tagsAdd="]').length,
    0,
    'and a fiction page carries no list cards'
  );
  dom.window.close();
});

test('both shapes of Royal Road’s tag toggle are found by shape, not by id', () => {
  // The lists call it `tags-toggle-<fiction id>`; a fiction page calls it
  // `show-more-tags`. Extrapolating the second from the first is how the + was
  // left sitting on an already-open row. What both share is a label wrapping an
  // `sr-only` checkbox with a tag link beside it - the same thing that makes
  // Tailwind's `peer-has-checked:` work, so it cannot drift from the markup.
  const SHAPE = 'label:has(> input.sr-only[type="checkbox"])';
  const isTagToggle = (label) =>
    !!label.parentElement && !!label.parentElement.querySelector('a[href*="tagsAdd="]');

  const dom = new JSDOM(
    fs.readFileSync(path.join(ROOT, 'test/fixtures/fictions-weekly-popular.new.html'), 'utf8')
  );
  const list = [...dom.window.document.querySelectorAll(SHAPE)].filter(isTagToggle);
  assert.ok(list.length > 0, 'the list capture has toggles');
  assert.equal(
    list.length,
    dom.window.document.querySelectorAll('label[for^="tags-toggle"]').length,
    'and the shape finds exactly the ones the id would have'
  );
  dom.window.close();

  // A fiction page's, which no capture holds: its checkbox is `show-more-tags`.
  const hero = new JSDOM(
    '<div class="flex flex-row gap-1 flex-wrap">' +
      '<a href="/fictions/search?tagsAdd=male_lead">Male Lead</a>' +
      '<label for="show-more-tags" class="peer">' +
      '<input type="checkbox" id="show-more-tags" class="sr-only"></label>' +
      '<a href="/fictions/search?tagsAdd=magic" class="hidden peer-has-checked:flex">Magic</a>' +
      '</div>'
  );
  const fiction = [...hero.window.document.querySelectorAll(SHAPE)].filter(isTagToggle);
  assert.equal(fiction.length, 1, 'the fiction-page toggle is found too');
  hero.window.close();
});

test('every tag rule is gated behind a root class', () => {
  // The stylesheet ships on every royalroad.com page, so an ungated tag rule
  // would restyle chips on pages no setting was asked about - /home among them.
  const tagRules = listCss
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments name these selectors too
    .split('}')
    .map((block) => block.split('{')[0].trim())
    .filter((selector) => selector.includes('tagsAdd=') || selector.includes('tags-toggle'));

  assert.ok(tagRules.length > 0, 'there are tag rules to check');
  for (const selector of tagRules) {
    for (const part of selector.split(',')) {
      const gate = ['.rrx-tags-all ', '.rrx-tags-hover ', '.rrx-fiction-tags-all '];
      assert.ok(
        gate.some((prefix) => part.trim().startsWith(prefix)),
        `ungated tag rule: ${part.trim()}`
      );
    }
  }
});

// --- reader-chosen tag colours -----------------------------------------------

test('a tag colour matches that tag and no other', () => {
  // Royal Road links a tag as `?tagsAdd=<slug>` with nothing after it, so the
  // match is anchored at the end. `*=` would have made "romance" colour
  // "romance_main" too, and the two are different tags.
  const text = css.buildTagCss(['romance #c084fc']);
  assert.match(text, /a\[href\$="tagsAdd=romance"\]/);
  assert.doesNotMatch(text, /tagsAdd=romance_main/);
});

test('anything that is not a slug and a colour is dropped', () => {
  // A slug goes straight into a selector, so it is rejected rather than escaped.
  assert.equal(css.buildTagCss(['litrpg;} body{display:none} a #fff']), '');
  assert.equal(css.buildTagCss(['litrpg']), '');
  assert.equal(css.buildTagCss(['litrpg #zzz']), '');
  assert.equal(css.buildTagCss(['#c084fc']), '');
  assert.equal(css.buildTagCss('not even a list'), '');
  assert.equal(css.buildTagCss([]), '');
});

test('the text colour follows the background, not the theme', () => {
  // Without this a dark pick keeps Royal Road's own light-on-dark chip text and
  // the tag is unreadable at exactly the moment the reader chose to mark it.
  assert.match(css.buildTagCss(['a #ffffff']), /color:#111/);
  assert.match(css.buildTagCss(['a #000000']), /color:#fff/);
});

test('one tag named twice keeps its first colour', () => {
  const text = css.buildTagCss(['litrpg #111111', 'litrpg #eeeeee']);
  assert.equal(text.split('\n').length, 1, 'one rule');
  assert.match(text, /#111111/);
});

test('colouring nothing leaves the stylesheet and the root class alone', () => {
  assert.equal(css.buildTagCss([]), '');
  assert.ok(!css.rootClassesFor({ 'tags.colors': [] }).includes('rrx-tag-colors'));
  assert.ok(css.rootClassesFor({ 'tags.colors': ['litrpg #c084fc'] }).includes('rrx-tag-colors'));
});

test('the home page is coloured by tag name, since it has no slug', () => {
  // /home writes a tag as `<span filterable tagname="Magic">`: no href and no
  // slug anywhere on the element, so the name is the only handle there is.
  const on = css.buildTagCss(['magic|Magic #c084fc'], { home: true });
  assert.match(on, /a\[href\$="tagsAdd=magic"\]/, 'still coloured where there is a slug');
  assert.match(on, /\[tagname="Magic"\]/, 'and by name where there is not');

  const off = css.buildTagCss(['magic|Magic #c084fc'], { home: false });
  assert.doesNotMatch(off, /tagname/, 'left alone until asked for');

  // An entry added before Royal Road's tag list had been cached has no name to
  // match on. It still colours everywhere a slug is enough.
  const slugOnly = css.buildTagCss(['magic #c084fc'], { home: true });
  assert.match(slugOnly, /tagsAdd=magic/);
  assert.doesNotMatch(slugOnly, /tagname/);
});

test('a tag name cannot break out of its attribute selector', () => {
  // The name reaches a selector verbatim, so a quote in it would end the
  // attribute and let the rest through as CSS. Dropped, not escaped - and the
  // slug rule survives, so the tag is still coloured where it can be.
  const text = css.buildTagCss(['x|bad"] * {display:none} [a #ffffff'], { home: true });
  assert.doesNotMatch(text, /display:none/);
  assert.doesNotMatch(text, /tagname/);
  assert.match(text, /tagsAdd=x/);
});

test('names with spaces and punctuation survive intact', () => {
  const [tag] = css.parseTagColors(['summoned_hero|Portal Fantasy / Isekai #abcdef']);
  assert.equal(tag.label, 'Portal Fantasy / Isekai');
  assert.equal(tag.slug, 'summoned_hero');
  assert.match(
    css.buildTagCss(['summoned_hero|Portal Fantasy / Isekai #abcdef'], { home: true }),
    /\[tagname="Portal Fantasy \/ Isekai"\]/
  );
});

// --- the covers overlay, against the markup it is written for ------------------

const viewsCss = fs.readFileSync(path.join(ROOT, 'src/content/inject-views.css'), 'utf8');

/** The selector list of the first rule after `from` whose body carries `decl`.
 *  Both delimiters are measured to their end: `lastIndexOf('*​/')` points at the
 *  star, and starting one past it leaves a stray slash on the front of the
 *  selector, which parses as nothing and matches nothing. */
function selectorFor(text, decl, from = 0) {
  const at = text.indexOf(decl, from);
  assert.ok(at > 0, `no rule sets ${decl}`);
  const open = text.lastIndexOf('{', at);
  const comment = text.lastIndexOf('*/', open);
  const rule = text.lastIndexOf('}', open);
  const prev = Math.max(comment >= 0 ? comment + 2 : 0, rule >= 0 ? rule + 1 : 0);
  return text
    .slice(prev, open)
    .replace(/\s+/g, ' ')
    .trim();
}

const OVERLAY_AT = () => {
  const at = viewsCss.indexOf('5. Following and Favourite');
  assert.ok(at > 0, 'the covers overlay section is gone');
  return at;
};

test('the covers overlay reaches the Following and Favourite icons, and only those', () => {
  // Dissolving the title row makes these two icons items of the tile with no
  // order, so they sorted ahead of everything and pushed the cover down on
  // marked cards only. jsdom has no layout, so what is checkable is that the
  // selector reaches the elements it was written for - a rule matching nothing
  // is the failure this catches.
  const selector = selectorFor(viewsCss, 'position: absolute', OVERLAY_AT());
  const d = docFor('card-loggedin-marked.html', 'rrx-view-grid').window.document;

  const hit = [...d.querySelectorAll(selector)];
  assert.equal(hit.length, 2, `expected the two icons, matched ${hit.length}: ${selector}`);
  for (const node of hit) {
    assert.ok(
      node.querySelector('i.fa-bookmark, i.fa-heart'),
      'matched something that is not one of the two icons'
    );
  }

  // The other two children of that row must stay in flow: the title is the
  // tile's last item and the buttons its first, and taking either out of flow
  // would empty the tile rather than tidy it.
  // Reached through the matched icon rather than by selector: the row's class
  // is literally "md:flex", and one lost backslash turns the escape into an
  // unknown pseudo-class that matches nothing and fails silently.
  const row = hit[0].parentElement;
  assert.ok(row, 'the shared title row is no longer shaped the way the rule expects');
  assert.ok(row.querySelector('a[data-vt-trigger] > h2'), 'not the title row');
  assert.ok(!hit.includes(row.querySelector('a[data-vt-trigger]')), 'the title was taken out of flow');
  assert.ok(
    !hit.includes(row.querySelector('div:has(> form[data-bookmark-form])')),
    'the Read / Read Later row was taken out of flow'
  );
});

test('a card with neither mark is left entirely alone', () => {
  const selector = selectorFor(viewsCss, 'position: absolute', OVERLAY_AT());
  const d = docFor('card-loggedin.html', 'rrx-view-grid').window.document;

  assert.ok(d.querySelector('.fiction-card-expanded'), 'the unmarked fixture has no card at all');
  assert.equal(d.querySelectorAll(selector).length, 0, 'an unmarked card got an overlay');
});

test('the overlay and the button row read the same height, not two guesses', () => {
  // The offset only lands on the cover because the row above it is pinned. If
  // one of these two stops naming the variable, the icons drift onto the
  // buttons or into the middle of the cover, and no test of either alone sees it.
  const defined = viewsCss.match(/--rrx-grid-actions-h:/g) || [];
  assert.equal(defined.length, 1, 'the height is declared more than once, so they can disagree');

  const actions = selectorFor(viewsCss, 'height: var(--rrx-grid-actions-h)');
  assert.match(actions, /form\[data-bookmark-form\]/, 'the pinned height is not on the button row');

  // The overlay reads it through `--rrx-grid-mark-top`, which is the button row
  // plus the column gap - where the cover starts, so the first chip is level
  // with the cover's top edge rather than floating below it.
  assert.match(
    viewsCss,
    /--rrx-grid-mark-top: calc\(var\(--rrx-grid-actions-h\) \+ [\d.]+rem\)/,
    'the chip top is no longer derived from the button row'
  );
  assert.match(viewsCss.slice(OVERLAY_AT()), /top: var\(--rrx-grid-mark-top\)/, 'the overlay ignores it');

  // And the definition has to sit on an ancestor of both, or `var()` resolves
  // to nothing and `top` is dropped entirely.
  const owner = selectorFor(viewsCss, '--rrx-grid-actions-h:');
  assert.match(owner, /^html\.rrx-view-grid \.fiction-card-expanded > div > div > div$/);
});

test('the overlay is pulled out by the tile inset, which is what the card pads by', () => {
  // The icons sit on the tile's edge rather than on the artwork, and the tile
  // box clips its descendants - so the pull-out has to match the padding
  // exactly. Too little and it is back on the cover; too much and the chip is
  // cut in half by `overflow: hidden`, with nothing in a test to say so.
  const padding = viewsCss.match(/\.fiction-card-expanded > div \{\s*padding: ([\d.]+)rem/);
  assert.ok(padding, 'the covers view no longer sets the card padding it is measured from');

  const inset = viewsCss.match(/--rrx-grid-inset: ([\d.]+)rem/);
  assert.ok(inset, 'the inset is gone');

  // Tailwind's `p-1`, on the box between the padded card and the column.
  const P1_REM = 0.25;
  assert.equal(
    Number(inset[1]),
    Number(padding[1]) + P1_REM,
    `inset ${inset[1]}rem does not match ${padding[1]}rem of card padding plus p-1`
  );

  const overlay = viewsCss.slice(OVERLAY_AT());
  assert.match(overlay, /left: calc\(var\(--rrx-grid-inset\) \* -1\)/, 'the overlay does not use it');
});

test('the second mark stacks under the first, sharing its column', () => {
  // Side by side, the second chip reached into the middle of the cover. Stacked
  // it needs the chip height to be known rather than left to the icon, or the
  // two overlap by however much the guess was wrong.
  const overlay = viewsCss.slice(OVERLAY_AT());

  assert.match(overlay, /height: var\(--rrx-grid-mark-h\)/, 'the chip height is not pinned');
  assert.match(
    overlay,
    /top: calc\(var\(--rrx-grid-mark-top\) \+ var\(--rrx-grid-mark-h\)/,
    'the second chip is not offset by a whole chip'
  );

  // And it must not set a left of its own, or it is beside the first again.
  const second = overlay.slice(overlay.indexOf(':nth-of-type(2)'));
  const body = second.slice(second.indexOf('{'), second.indexOf('}'));
  assert.doesNotMatch(body, /left:/, 'the second chip still moves sideways');
});

test('both marks are the same size, with their glyphs on one axis', () => {
  // The heart and the bookmark are different widths in Font Awesome, so a chip
  // that hugs its icon is a different width per mark and the two glyphs sit on
  // different centres - visible the moment they are stacked.
  const overlay = viewsCss.slice(OVERLAY_AT());

  assert.match(overlay, /width: var\(--rrx-grid-mark-w\)/, 'the chip width is not pinned');
  assert.match(overlay, /justify-content: center/, 'the glyph is not centred in the chip');
  assert.match(overlay, /width: 1em/, 'the glyphs keep their own advance widths');

  // Both chips take the width from the same variable, so neither can drift.
  const declared = viewsCss.match(/--rrx-grid-mark-w: [\d.]+rem/g) || [];
  assert.equal(declared.length, 1, 'the chip width is declared more than once');

  const second = overlay.slice(overlay.indexOf(':nth-of-type(2)'));
  const body = second.slice(second.indexOf('{'), second.indexOf('}'));
  assert.doesNotMatch(body, /width:/, 'the second chip sets a width of its own');
});

test('the marks drop the margin Royal Road gives them for the title row', () => {
  // Both icons carry `mt-1`, which lined them up with the title they used to sit
  // beside. Inside a chip that centres its contents that margin is dead weight
  // pushing the glyph off centre, and no amount of centring fixes it.
  const marked = docFor('card-loggedin-marked.html', 'rrx-view-grid').window.document;
  const icons = [...marked.querySelectorAll('div.hidden i.fa-bookmark, div.hidden i.fa-heart')];
  assert.ok(icons.length > 0, 'the capture no longer carries the icons this is about');
  assert.ok(
    icons.every((i) => i.className.includes('mt-')),
    'Royal Road stopped setting a top margin, so this override can go'
  );

  const overlay = viewsCss.slice(OVERLAY_AT());
  const rule = overlay.slice(overlay.indexOf('> div[data-rr-tooltip] i'));
  assert.match(rule.slice(0, rule.indexOf('}')), /margin: 0/, 'the margin is not cleared');
});
