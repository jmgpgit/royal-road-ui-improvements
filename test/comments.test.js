'use strict';

/**
 * Comment features, against three real comment pages.
 *
 * Three rather than two on purpose. The first two both happen to stop at depth
 * 2, and that coincidence was once written down here as a fact about Royal
 * Road: that it never nests deeper, and that a reply's target is therefore
 * unrecoverable past three levels. Both were false. `chapter-comments-nested`
 * reaches depth 6, and every parent link in it resolves.
 *
 * The lesson is kept deliberately: where a test asserts what Royal Road sends,
 * it should say which page it saw that on, because one page is a sample and
 * never a guarantee.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const SKIP = need(
  'chapter-comments.new.html',
  'chapter-comments-deep.new.html',
  'chapter-comments-nested.new.html',
  // A whole chapter page rather than a comments fragment: the only capture that
  // carries Royal Road's "Load comments" button.
  'chapter.new.html'
);
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/filters.js',
  'src/common/css.js',
  'src/content/ui.js',
  'src/content/pager.js',
  'src/content/features/comments.js',
];

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

function load(name = 'chapter-comments.new.html') {
  const dom = new JSDOM(fixture(name), {
    url: 'https://www.royalroad.com/fiction/1/x/chapter/2/y',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  w.eval(`globalThis.browser = { storage: { local: {}, onChanged: {} }, runtime: {} };`);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return w;
}

const ctxWith = (w, over = {}) => ({
  page: 'chapter',
  settings: w.RRX.normalizeSettings(over),
});

/**
 * The reply container belonging to this comment. Mirrors the production helper:
 * `.comment-replies` is a GRANDCHILD of its comment, and nested threads have
 * their own, so the owner has to be checked.
 */
const repliesOf = (comment) =>
  [...comment.querySelectorAll('.comment-replies')].find(
    (r) => r.closest('[data-comment-id]') === comment
  ) || null;

// -- the "thanks for the chapter" fold ---------------------------------------

test('acknowledgement-only comments are recognised', () => {
  const w = load();
  const { isThanks } = w.RRX.comments;

  for (const text of [
    'thank you for the chapter',
    'Thanks for the chapter!',
    'thanks for the chapter.',
    'thank you for the chappie',
    'Thanks for the chappy :)',
    'TYFC',
    'tyftc',
    'tftc',
    'thx for the chapter',
    'Thank you for the chapter ❤️',
  ]) {
    assert.equal(isThanks(text), true, `should fold: ${JSON.stringify(text)}`);
  }
});

test('anything with something to say is left alone', () => {
  const w = load();
  const { isThanks } = w.RRX.comments;

  for (const text of [
    'Thanks for the chapter, but I think the pacing in the second half dragged a little.',
    'I thought that was fairly reasonable, given the alternative.',
    'Thanks!! Also, is Mera going to meet her father again?',
    'This chapter broke me.',
    '',
    'When is the next update? I have been refreshing all week.',
  ]) {
    assert.equal(isThanks(text), false, `must NOT fold: ${JSON.stringify(text)}`);
  }
});

test('a comment with replies is still folded, but keeps its chain', () => {
  // It used to be skipped outright, which meant a rule could silently do
  // nothing depending on whether anyone had replied. The chain is protected by
  // CSS reaching past the comment to its own body instead.
  const w = load();
  const ctx = ctxWith(w, { 'comments.thanks': 'fold' });
  w.RRX.comments.syncCards(w.document, ctx);

  const marked = [...w.document.querySelectorAll('.rrx-comment-thanks')];
  assert.ok(marked.length > 0, 'the fixture has acknowledgement comments');
  for (const comment of marked) {
    const replies = repliesOf(comment);
    if (!replies) continue;
    // The replies element must still be in the tree, and outside the part the
    // stylesheet folds (which is the comment's own body).
    assert.ok(replies.isConnected);
    assert.equal(replies.closest('[data-comment-id]'), comment);
  }
});

// -- collapsing ---------------------------------------------------------------

test('a collapse control appears only on comments that have replies', () => {
  const w = load();
  w.RRX.comments.syncCards(w.document, ctxWith(w, { 'comments.collapsible': true }));

  const withReplies = [...w.document.querySelectorAll('[data-comment-id]')].filter(repliesOf);
  assert.ok(withReplies.length > 0, 'the fixture has at least one thread');
  // Royal Road labels them too, so the two ways of asking must agree.
  assert.equal(
    withReplies.length,
    w.document.querySelectorAll('[data-has-replies="true"]').length,
    'repliesOf must find exactly the comments Royal Road marks as having replies'
  );

  assert.equal(w.document.querySelectorAll('.rrx-thread-toggle').length, withReplies.length);
  for (const c of withReplies) {
    assert.ok(c.querySelector(':scope > .rrx-thread-toggle'));
  }
});

test('collapsing hides the replies and says how many, and is reversible', () => {
  const w = load();
  w.RRX.comments.syncCards(w.document, ctxWith(w, { 'comments.collapsible': true }));

  const thread = [...w.document.querySelectorAll('[data-comment-id]')].find(repliesOf);
  const button = thread.querySelector(':scope > .rrx-thread-toggle');
  const count = repliesOf(thread).querySelectorAll('[data-comment-id]').length;
  assert.ok(count > 0);

  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(thread.classList.contains('rrx-thread-collapsed'));
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.textContent, `+ ${count}`, 'the count tells you what is hidden');

  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(!thread.classList.contains('rrx-thread-collapsed'));
  assert.equal(button.getAttribute('aria-expanded'), 'true');
});

test('re-syncing does not add a second control', () => {
  const w = load();
  const ctx = ctxWith(w, { 'comments.collapsible': true });
  w.RRX.comments.syncCards(w.document, ctx);
  const first = w.document.querySelectorAll('.rrx-thread-toggle').length;
  w.RRX.comments.syncCards(w.document, ctx);
  w.RRX.comments.syncCards(w.document, ctx);
  assert.equal(w.document.querySelectorAll('.rrx-thread-toggle').length, first);
});

// -- how deep a thread goes ---------------------------------------------------
//
// This used to assert the opposite: that depth stopped at 2 and that a reply's
// real target was therefore unrecoverable past three levels. Both halves were
// wrong, and wrong for the same reason. The page it was written against
// (chapter-comments-deep.new.html) happens to have no chain longer than three,
// so "what this page contains" got recorded as "what Royal Road sends". One
// sample can only ever show what the site did once.
//
// chapter-comments-nested.new.html is the counter-example: depth 6, and every
// parent link resolving cleanly the whole way down.

test('a reply chain goes deeper than three levels', () => {
  const w = load('chapter-comments-nested.new.html');
  const all = [...w.document.querySelectorAll('[data-comment-id]')];
  const depths = [...new Set(all.map((c) => Number(c.getAttribute('data-depth'))))].sort(
    (a, b) => a - b
  );

  assert.deepEqual(depths, [0, 1, 2, 3, 4, 5, 6], 'the depths this page actually contains');
  assert.ok(Math.max(...depths) > 2, 'the old three-level assumption, restated so it cannot return');
});

test('a reply names its parent at every depth, so the target is always recoverable', () => {
  const w = load('chapter-comments-nested.new.html');
  const all = [...w.document.querySelectorAll('[data-comment-id]')];
  const byId = new Map(all.map((c) => [c.getAttribute('data-comment-id'), c]));

  let checked = 0;
  for (const c of all) {
    const parentId = c.getAttribute('data-parent-id');
    if (!parentId) {
      assert.equal(c.getAttribute('data-depth'), '0', 'only a root comment has no parent');
      continue;
    }
    const parent = byId.get(parentId);
    assert.ok(parent, `comment ${c.getAttribute('data-comment-id')}: parent not on the page`);
    assert.equal(
      Number(parent.getAttribute('data-depth')) + 1,
      Number(c.getAttribute('data-depth')),
      'a reply always sits exactly one level below the comment it answers'
    );
    assert.ok(parent.contains(c), 'and it is nested inside that comment in the DOM');
    checked += 1;
  }
  assert.ok(checked > 30, `a busy page: ${checked} replies checked`);
});

test('past depth 2 the replies move to a different container, behind a button', () => {
  // This is the shape that made the earlier reading look right. Royal Road
  // switches wrapper and hides the rest of the chain, so a page can carry deep
  // replies while appearing to stop at three levels.
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;

  for (const depth of ['1', '2']) {
    for (const c of d.querySelectorAll(`[data-depth="${depth}"]`)) {
      assert.ok(
        c.parentElement.classList.contains('comment-replies'),
        `depth ${depth} sits in .comment-replies`
      );
    }
  }
  for (const depth of ['3', '4', '5', '6']) {
    for (const c of d.querySelectorAll(`[data-depth="${depth}"]`)) {
      assert.ok(
        c.parentElement.matches(w.RRX.SEL.commentDeepReplies),
        `depth ${depth} sits in a deep-replies holder instead`
      );
    }
  }

  const holders = d.querySelectorAll(w.RRX.SEL.commentDeepReplies);
  assert.ok(holders.length > 0, 'the fixture has deep chains');
  for (const holder of holders) {
    assert.ok(holder.classList.contains('hidden'), 'a deep chain starts hidden');
    const id = holder.getAttribute('data-rr-deep-replies');
    assert.ok(
      d.querySelector(`[data-rr-comment-expand-deep="${id}"]`),
      'and has a button that reveals it'
    );
  }
});

test('the shallower fixtures still parse, so neither shape is assumed', () => {
  // Two real pages that never go past depth 2, and one that has no deep-reply
  // holder at all. Whatever handles deep chains has to cope with their absence.
  for (const name of ['chapter-comments.new.html', 'chapter-comments-deep.new.html']) {
    const w = load(name);
    assert.equal(w.document.querySelectorAll(w.RRX.SEL.commentDeepReplies).length, 0, name);
    assert.ok(w.document.querySelectorAll('[data-comment-id]').length > 10, name);
    w.close();
  }
});

test('“hide” removes the comment; “fold” only dims it; “keep” does neither', () => {
  const w = load();
  const ctx = (mode) => ctxWith(w, { 'comments.thanks': mode });

  w.RRX.comments.syncCards(w.document, ctx('keep'));
  assert.equal(w.document.querySelectorAll('.rrx-comment-thanks').length, 0);
  assert.equal(w.document.querySelectorAll('.rrx-comment-thanks-hidden').length, 0);

  w.RRX.comments.syncCards(w.document, ctx('fold'));
  const folded = w.document.querySelectorAll('.rrx-comment-thanks').length;
  assert.equal(w.document.querySelectorAll('.rrx-comment-thanks-hidden').length, 0);

  w.RRX.comments.syncCards(w.document, ctx('hide'));
  assert.equal(w.document.querySelectorAll('.rrx-comment-thanks').length, 0, 'not both at once');
  assert.equal(
    w.document.querySelectorAll('.rrx-comment-thanks-hidden').length,
    folded,
    'the same comments, removed rather than dimmed'
  );

  // ...and back off again.
  w.RRX.comments.syncCards(w.document, ctx('keep'));
  assert.equal(w.document.querySelectorAll('.rrx-comment-thanks-hidden').length, 0);
});

test('further comment pages are appended, so earlier comments stay on the page', async () => {
  // Royal Road's own pagination REPLACES the list; that is the bug this fixes.
  const w = load();
  const first = fixture('chapter-comments.new.html');
  const second = fixture('chapter-comments-deep.new.html');

  // Stand in for the live page: the container Royal Road's first page produced,
  // plus the widget carrying the fetch URL.
  w.document.body.innerHTML = `
    <div id="comments-pagination" data-rr-paginate-fetch-url="/fiction/chapter/1/comments?sorting=top"></div>
    ${first}`;

  const requested = [];
  w.eval(`globalThis.__second = ${JSON.stringify(second)};
    globalThis.__requested = [];
    globalThis.fetch = async (url) => {
      globalThis.__requested.push(String(url));
      return { ok: true, status: 200, text: async () => globalThis.__second };
    };`);

  const before = [...w.document.querySelectorAll('[data-comment-id]')].map((c) =>
    c.getAttribute('data-comment-id')
  );
  assert.ok(before.length > 0);

  await w.RRX.comments.pager.loadNext();

  requested.push(...w.eval('globalThis.__requested'));
  assert.match(requested[0], /page=2/, 'asks for the next page by URL, not by clicking "next"');

  const after = [...w.document.querySelectorAll('[data-comment-id]')].map((c) =>
    c.getAttribute('data-comment-id')
  );
  assert.ok(after.length > before.length, 'the page grew');
  for (const id of before) {
    assert.ok(after.includes(id), `comment ${id} must still be on the page`);
  }
});

test('the same comment is never appended twice', async () => {
  const w = load();
  const page = fixture('chapter-comments.new.html');
  w.document.body.innerHTML = `
    <div id="comments-pagination" data-rr-paginate-fetch-url="/c?sorting=top"></div>
    ${page}`;
  // Serve the *same* page back, which is what a duplicate or looping response
  // would look like.
  w.eval(`globalThis.__same = ${JSON.stringify(page)};
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => globalThis.__same });`);

  const before = w.document.querySelectorAll('[data-comment-id]').length;
  await w.RRX.comments.pager.loadNext();
  assert.equal(w.document.querySelectorAll('[data-comment-id]').length, before, 'nothing added');
  assert.equal(w.RRX.comments.pager.state.done, true, 'and it stops asking');
});

test('a bare "thank" counts, and so do the usual short forms', () => {
  const w = load();
  const { isThanks } = w.RRX.comments;
  for (const text of [
    'thank',
    'Thanks',
    'Thank you!',
    'thanks!!!',
    'ty',
    'thank you so much',
    'thanks for the chapter',
    'Thanks for another great chapter!',
    'thanks author',
    'cheers',
  ]) {
    assert.equal(isThanks(text), true, `should fold: ${JSON.stringify(text)}`);
  }
});

test('a comment that begins with thanks but goes on is still left alone', () => {
  const w = load();
  const { isThanks } = w.RRX.comments;
  for (const text of [
    'thanks, but when is the next one',
    'Thank you: Mera is my favourite character',
    'thanks! did anyone else notice the foreshadowing',
  ]) {
    assert.equal(isThanks(text), false, `must NOT fold: ${JSON.stringify(text)}`);
  }
});

test('reader-supplied patterns fold too, as regex or as a plain phrase', () => {
  const w = load();
  const { isLowValue } = w.RRX.comments;
  const patterns = '^first!?$\nmoar please\nsomething(with(unbalanced parens';

  assert.equal(isLowValue('first!', patterns), true, 'regex');
  assert.equal(isLowValue('First', patterns), true, 'case-insensitive');
  assert.equal(isLowValue('this is first among equals', patterns), false, 'anchored, so not this');
  assert.equal(isLowValue('MOAR PLEASE', patterns), true, 'plain phrase');

  // An unparseable line must match literally rather than be silently dropped: // someone typing a phrase with a bracket in it should not get a dead setting.
  assert.equal(isLowValue('something(with(unbalanced parens', patterns), true);

  // And the built-in rule still applies alongside them.
  assert.equal(isLowValue('tyfc', patterns), true);
  assert.equal(isLowValue('A real comment about the plot.', patterns), false);
});

test('an empty pattern list changes nothing', () => {
  const w = load();
  const { isLowValue } = w.RRX.comments;
  assert.equal(isLowValue('A real comment.', ''), false);
  assert.equal(isLowValue('A real comment.', '\n\n  \n'), false);
  assert.equal(isLowValue('thanks', ''), true);
});

test('a pattern works on its own, without touching the acknowledgement rule', () => {
  // The reported bug: patterns were gated behind `comments.thanks`, which
  // defaults to "leave alone", so pasting a comment into the box did nothing
  // at all until an unrelated dropdown was also changed.
  const w = load();
  const settings = w.RRX.normalizeSettings({
    'comments.thanks': 'keep', // untouched, as it ships
    'comments.foldPatterns': 'sometimes a girl just needs a diabolical cackle.',
  });

  assert.equal(settings['comments.patternAction'], 'fold', 'patterns act by default');
  assert.equal(
    w.RRX.comments.actionFor('Sometimes a girl just needs a diabolical cackle.', settings),
    'fold'
  );
  // ...and the acknowledgement rule really is still off.
  assert.equal(w.RRX.comments.actionFor('thanks for the chapter', settings), 'keep');
});

test('a pasted comment matches verbatim, punctuation and all', () => {
  const w = load();
  const { matchesPatterns } = w.RRX.comments;
  const pasted = 'Sometimes a girl just needs a diabolical cackle.';

  assert.equal(matchesPatterns(pasted, pasted), true, 'exact paste');
  assert.equal(matchesPatterns(pasted, pasted.toLowerCase()), true, 'case does not matter');
  assert.equal(matchesPatterns(`  ${pasted}  `, pasted), true, 'surrounding whitespace');
  assert.equal(matchesPatterns('A completely different comment.', pasted), false);
});

test('the two rules combine, and hiding wins over folding', () => {
  const w = load();
  const { actionFor } = w.RRX.comments;
  const base = { 'comments.foldPatterns': 'cackle' };

  const foldThenHide = w.RRX.normalizeSettings({
    ...base,
    'comments.thanks': 'fold',
    'comments.patternAction': 'hide',
  });
  assert.equal(actionFor('thanks for the chapter', foldThenHide), 'fold', 'only the built-in rule');
  assert.equal(actionFor('a diabolical cackle', foldThenHide), 'hide', 'only the pattern');
  assert.equal(actionFor('thanks for the cackle', foldThenHide), 'hide', 'both: the stronger wins');

  const bothOff = w.RRX.normalizeSettings({
    ...base,
    'comments.thanks': 'keep',
    'comments.patternAction': 'keep',
  });
  assert.equal(actionFor('a diabolical cackle', bothOff), 'keep');
});

test('changing the pattern re-evaluates comments already on the page', () => {
  const w = load();
  const apply = (over) => w.RRX.comments.syncCards(w.document, ctxWith(w, over));

  apply({ 'comments.patternAction': 'hide', 'comments.foldPatterns': 'zzz-no-such-text' });
  assert.equal(w.document.querySelectorAll('.rrx-comment-thanks-hidden').length, 0);

  // A word that really is in this fixture's first comment.
  const firstText = w.document.querySelector('.comment-content').textContent.trim();
  const word = firstText.split(/\s+/).find((t) => t.length > 6) || firstText.slice(0, 12);
  apply({ 'comments.patternAction': 'hide', 'comments.foldPatterns': word });
  assert.ok(
    w.document.querySelectorAll('.rrx-comment-thanks-hidden').length > 0,
    `expected the cached verdict to be recomputed for ${JSON.stringify(word)}`
  );
});

test('position-claiming comments count as low effort', () => {
  const w = load();
  const { isThanks } = w.RRX.comments;
  for (const text of [
    'first',
    'First!',
    'FIRST!!!',
    'second',
    'third.',
    'fourth',
    'forth',
    'fifth',
    '1st',
    '3rd!',
    'first comment',
    'second post',
  ]) {
    assert.equal(isThanks(text), true, `should fold: ${JSON.stringify(text)}`);
  }
});

test('the word "first" inside a real sentence is left alone', () => {
  const w = load();
  const { isThanks } = w.RRX.comments;
  for (const text of [
    'the first time I read this I cried',
    'first of all, the pacing here is excellent',
    'That was the third act twist I was hoping for.',
    'first arc was better',
  ]) {
    assert.equal(isThanks(text), false, `must NOT fold: ${JSON.stringify(text)}`);
  }
});

test('a comment with replies is acted on even when it is the pattern target', () => {
  // Exactly the reported case: a comment pasted verbatim into the pattern box
  // that happens to have replies under it.
  const w = load();
  const withReplies = [...w.document.querySelectorAll('[data-comment-id]')].find(repliesOf);
  assert.ok(withReplies, 'the fixture has a comment with replies');
  const text = withReplies.querySelector('.comment-content').textContent.trim();

  w.RRX.comments.syncCards(
    w.document,
    ctxWith(w, { 'comments.patternAction': 'hide', 'comments.foldPatterns': text })
  );

  // Acted on despite having replies, but softened to a fold, because removing
  // the comment its replies are answering would leave the chain dangling.
  assert.ok(
    withReplies.classList.contains('rrx-comment-thanks'),
    'folded rather than skipped'
  );
  assert.equal(
    withReplies.classList.contains('rrx-comment-thanks-hidden'),
    false,
    'never hidden outright while it has replies'
  );
  assert.ok(repliesOf(withReplies).isConnected, 'and its replies are still in the tree');
});

test('hide still means hide for a comment with no replies', () => {
  const w = load();
  const alone = [...w.document.querySelectorAll('[data-comment-id]')].find((c) => !repliesOf(c));
  assert.ok(alone, 'the fixture has a reply-less comment');
  const text = alone.querySelector('.comment-content').textContent.trim();

  w.RRX.comments.syncCards(
    w.document,
    ctxWith(w, { 'comments.patternAction': 'hide', 'comments.foldPatterns': text })
  );
  assert.ok(alone.classList.contains('rrx-comment-thanks-hidden'));
  assert.equal(alone.classList.contains('rrx-comment-thanks'), false, 'not both at once');
});

test('nothing is ever hidden outright while it has replies', () => {
  const w = load();
  w.RRX.comments.syncCards(w.document, ctxWith(w, { 'comments.thanks': 'hide' }));
  for (const c of w.document.querySelectorAll('.rrx-comment-thanks-hidden')) {
    assert.equal(repliesOf(c), null, 'a hidden comment must have no chain under it');
  }
});

test('a deep chain gets a collapse button too, and collapsing takes all of it', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;
  const ctx = ctxWith(w, { 'comments.threading': true, 'comments.collapsible': true });
  w.RRX.comments.syncCards(d, ctx);

  // The parent of a deep chain holds its replies in a deep-replies holder, not
  // in .comment-replies. Before this was handled it read as childless and got
  // no button at all.
  const deepParents = [...d.querySelectorAll('[data-comment-id]')].filter((c) => {
    const holder = c.querySelector(w.RRX.SEL.commentDeepReplies);
    return holder && holder.closest('[data-comment-id]') === c;
  });
  assert.ok(deepParents.length > 0, 'the fixture has comments whose replies are deep-held');
  for (const c of deepParents) {
    assert.ok(
      c.querySelector(':scope > .rrx-thread-toggle'),
      `deep-chain parent ${c.getAttribute('data-comment-id')} has no collapse button`
    );
  }
  w.close();
});

test('"hide" still softens to a fold when the replies are deep-held', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;

  // Target one specific deep-chain parent by its own words, so the test says
  // what it means rather than depending on which comments happen to be thanks.
  const parent = [...d.querySelectorAll('[data-comment-id]')].find((c) => {
    const holder = c.querySelector(w.RRX.SEL.commentDeepReplies);
    return holder && holder.closest('[data-comment-id]') === c;
  });
  assert.ok(parent, 'the fixture has a deep-chain parent');
  // A run of plain letters and spaces lifted straight out of the comment: a
  // literal substring that is also a pattern matching only itself, with nothing
  // to escape either way.
  const own = parent.querySelector('.comment-content');
  assert.equal(own.closest('[data-comment-id]'), parent, 'that body is the comment’s own');
  const words = (own.textContent.match(/[a-z][a-z ]{9,29}/i) || [])[0];
  assert.ok(words, 'and it has some ordinary words to match on');

  const ctx = ctxWith(w, {
    'comments.foldPatterns': words,
    'comments.patternAction': 'hide',
  });
  w.RRX.comments.syncCards(d, ctx);

  assert.equal(
    parent.classList.contains('rrx-comment-thanks-hidden'),
    false,
    'a comment with a deep chain under it is never hidden outright'
  );
  assert.ok(parent.classList.contains('rrx-comment-thanks'), 'it is collapsed instead');
  w.close();
});

// -- the author, and emoticon-only comments -------------------------------------

test('the author is recognised by the feather, not by the border colour', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;
  const all = [...d.querySelectorAll('[data-comment-id]')];
  const authored = all.filter((c) => w.RRX.comments.isAuthorComment(c));
  assert.ok(authored.length > 5, `the fixture has author comments: found ${authored.length}`);

  // The tinted left border looks like an author marker and is not: it is a
  // reputation tier, and it disagrees with the feather on this very page.
  const bordered = all.filter((c) => {
    const row = c.querySelector(':scope > .wrap-anywhere > :first-child');
    return row && row.classList.contains('border-purple-600');
  });
  assert.notEqual(bordered.length, authored.length, 'border colour is not the author marker');

  // A reply nested under an author comment is not itself by the author.
  for (const c of authored) {
    assert.ok(
      [...c.querySelectorAll(w.RRX.SEL.commentAuthorBadge)].some(
        (b) => b.closest('[data-comment-id]') === c
      ),
      'the badge found belongs to this comment, not to one of its replies'
    );
  }
  w.close();
});

test('the author is never hidden, whatever the settings say', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;
  const authored = [...d.querySelectorAll('[data-comment-id]')].filter((c) =>
    w.RRX.comments.isAuthorComment(c)
  );

  // Every rule turned up as far as it goes, and a pattern matching everything.
  const brutal = {
    'comments.thanks': 'hide',
    'comments.emotes': 'hide',
    'comments.patternAction': 'hide',
    'comments.foldPatterns': '.*',
    'comments.foldAuthors': true,
  };
  w.RRX.comments.syncCards(d, ctxWith(w, brutal));

  for (const c of authored) {
    assert.equal(
      c.classList.contains('rrx-comment-thanks-hidden'),
      false,
      `author comment ${c.getAttribute('data-comment-id')} was hidden`
    );
    assert.ok(c.classList.contains('rrx-comment-thanks'), 'it is collapsed instead');
  }
  w.close();
});

test('by default the author is not touched at all', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;
  const authored = [...d.querySelectorAll('[data-comment-id]')].filter((c) =>
    w.RRX.comments.isAuthorComment(c)
  );

  w.RRX.comments.syncCards(
    d,
    ctxWith(w, {
      'comments.thanks': 'hide',
      'comments.emotes': 'hide',
      'comments.patternAction': 'hide',
      'comments.foldPatterns': '.*',
      // foldAuthors left at its default
    })
  );

  for (const c of authored) {
    assert.equal(c.classList.contains('rrx-comment-thanks'), false, 'not collapsed');
    assert.equal(c.classList.contains('rrx-comment-thanks-hidden'), false, 'not hidden');
  }
  // ...while everyone else was acted on, so the test is not passing vacuously.
  const touched = d.querySelectorAll('.rrx-comment-thanks, .rrx-comment-thanks-hidden').length;
  assert.ok(touched > 0, 'non-author comments were still acted on');
  w.close();
});

test('a comment that is only an emoticon is recognised, under either directory', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;
  const emotes = [...d.querySelectorAll('[data-comment-id]')].filter((c) =>
    w.RRX.comments.isEmoteOnly(c)
  );
  assert.ok(emotes.length > 3, `the fixture has emoticon-only comments: found ${emotes.length}`);

  // Royal Road serves them from two directories that differ in spelling as well
  // as in case, and both have to match.
  // From the body, not from the comment: the first image in a comment is the
  // commenter's avatar, which is served from /public/avatars/.
  const dirs = new Set(
    emotes.map(
      (c) =>
        (c
          .querySelector('.comment-content img')
          .getAttribute('src')
          .match(/\/public\/([^/]+)\//) || [])[1]
    )
  );
  assert.ok(dirs.size > 1, `both emoticon directories are covered: ${[...dirs].join(', ')}`);

  // These have no text at all, so every text rule sees an empty string. That is
  // why they need a rule of their own.
  for (const c of emotes) {
    assert.equal(w.RRX.comments.bodyText(c), '', 'an emoticon comment has no text');
    assert.equal(w.RRX.comments.isThanks(''), false, 'and the text rules cannot catch it');
  }
  w.close();
});

test('the emoticon rule is separate from the acknowledgement rule', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;
  const emote = [...d.querySelectorAll('[data-comment-id]')].find(
    (c) => w.RRX.comments.isEmoteOnly(c) && !w.RRX.comments.isAuthorComment(c)
  );
  assert.ok(emote, 'an emoticon comment that is not the author’s');

  // Acknowledgements on their strongest setting must not reach it.
  w.RRX.comments.syncCards(d, ctxWith(w, { 'comments.thanks': 'hide' }));
  assert.equal(emote.classList.contains('rrx-comment-thanks-hidden'), false);
  assert.equal(emote.classList.contains('rrx-comment-thanks'), false);

  w.RRX.comments.syncCards(d, ctxWith(w, { 'comments.emotes': 'fold' }));
  assert.ok(emote.classList.contains('rrx-comment-thanks'), 'its own setting collapses it');

  w.RRX.comments.syncCards(d, ctxWith(w, { 'comments.emotes': 'hide' }));
  assert.ok(emote.classList.contains('rrx-comment-thanks-hidden'), 'and hides it');

  w.RRX.comments.syncCards(d, ctxWith(w, { 'comments.emotes': 'keep' }));
  assert.equal(emote.classList.contains('rrx-comment-thanks-hidden'), false, 'and back off');
  w.close();
});

test('an emoticon alongside real words is left alone', () => {
  const w = load('chapter-comments-nested.new.html');
  const d = w.document;
  const mixed = [...d.querySelectorAll('[data-comment-id]')].filter((c) => {
    const body = c.querySelector('.comment-content');
    if (!body || body.closest('[data-comment-id]') !== c) return false;
    return body.querySelector('img') && body.textContent.trim();
  });
  assert.ok(mixed.length > 0, 'the fixture has a comment mixing an emoticon with words');
  for (const c of mixed) {
    assert.equal(w.RRX.comments.isEmoteOnly(c), false, 'it is saying something as well');
  }
  w.close();
});

test('the loader is clicked once and only once, however many sweeps run', () => {
  // Royal Road does not fetch page one of the comments until something clicks
  // its loader, so the pager does the click itself. The guard matters because
  // the sweep runs repeatedly: a second click would ask Royal Road for the same
  // page again.
  const w = load('chapter.new.html');
  const button = w.document.querySelector('#comment-loader');
  assert.ok(button, 'Royal Road still ships a "Load comments" button in the page HTML');

  let clicks = 0;
  button.addEventListener('click', () => {
    clicks += 1;
  });

  w.RRX.comments.watchCommentScroll();
  w.RRX.comments.watchCommentScroll();
  w.RRX.comments.watchCommentScroll();
  assert.equal(clicks, 1);
});

test('turning a rule on after the page loaded re-evaluates every comment', () => {
  // The pipeline is skipped entirely when no rule can reach a verdict, which is
  // the shipped default. The skip must not stick: the verdict is cached against
  // the rule settings, so changing one has to invalidate every cached answer.
  const w = load();
  const d = w.document;

  w.RRX.comments.syncCards(d, ctxWith(w, {}));
  assert.equal(d.querySelectorAll('.rrx-comment-thanks').length, 0, 'defaults touch nothing');

  w.RRX.comments.syncCards(d, ctxWith(w, { 'comments.thanks': 'fold' }));
  assert.ok(
    d.querySelectorAll('.rrx-comment-thanks').length > 0,
    'switching a rule on acts on comments the skipped pass never looked at'
  );

  // ...and back off again.
  w.RRX.comments.syncCards(d, ctxWith(w, {}));
  assert.equal(d.querySelectorAll('.rrx-comment-thanks').length, 0);
});
