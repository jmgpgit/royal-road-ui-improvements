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
