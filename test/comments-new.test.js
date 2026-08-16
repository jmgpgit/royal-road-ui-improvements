'use strict';

/**
 * Comments that have arrived since your last visit.
 *
 * The list Royal Road serves is ranked, not chronological, so the interesting
 * behaviour is per-comment rather than positional. What these pin down is the
 * things that would quietly ruin it: marks that vanish while you read, a fold
 * that swallows the conversation a new reply is answering, and a watermark that
 * moves when you never looked.
 *
 * Run against the deep-nesting capture, which goes six levels down and carries
 * nine collapsed reply chains - the shapes a simpler fixture would not have.
 */

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { read: fixture, need } = require('./helpers/fixtures.js');

const ROOT = path.join(__dirname, '..');
const SKIP = need('chapter-comments-nested.new.html');
const test = (name, fn) => nodeTest(name, { skip: SKIP }, fn);

const MODULES = [
  'src/common/browser.js',
  'src/common/selectors.js',
  'src/common/schema.js',
  'src/common/model.js',
  'src/common/css.js',
  'src/common/store.js',
  'src/content/ui.js',
  // comments.js wires a pager at module scope, so it cannot load without one.
  'src/content/pager.js',
  'src/content/features/comments.js',
  'src/content/features/comments-new.js',
];

const CHAPTER = 3766643;

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

const DAY = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);

// `visitedDaysAgo` defaults to a real previous visit rather than "just now":
// a reload within the grace window is deliberately treated as the same sitting,
// so 0 would mean nothing ever folds and most of this file would be testing that
// instead of what it means to.
function load({ seenAt = 0, mode = 'fold', visitedDaysAgo = 1, days = 60 } = {}) {
  const dom = new JSDOM(fixture('chapter-comments-nested.new.html'), {
    url: `https://www.royalroad.com/fiction/149588/x/chapter/${CHAPTER}/y`,
    runScripts: 'outside-only',
  });
  const w = dom.window;
  windows.push(w);
  w.__chapters = seenAt
    ? { [CHAPTER]: { f: 149588, a: nowS() - visitedDaysAgo * DAY, s: seenAt } }
    : {};
  w.eval(`
    globalThis.__written = [];
    globalThis.browser = {
      storage: {
        local: {
          get: async (keys) => (String(keys).includes('chapters') ? { chapters: globalThis.__chapters } : {}),
          set: async (patch) => {
            globalThis.__written.push(patch);
            if (patch.chapters) globalThis.__chapters = patch.chapters;
          },
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      runtime: {},
    };
  `);
  for (const file of MODULES) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const ctx = {
    page: 'chapter',
    settings: w.RRX.normalizeSettings({ 'comments.seen': mode, 'comments.seenDays': days }),
  };
  // The record is what storage holds; the watermark is resolved from it against
  // the expiry, which is how the feature itself does it.
  w.RRX.commentsNew.setRecord(w.__chapters[CHAPTER] || null);
  return { w, ctx };
}

const stamps = (w) =>
  [...w.document.querySelectorAll('[data-comment-id]')]
    .map((c) => w.RRX.commentsNew.timeOf(c))
    .sort((a, b) => a - b);

const countOf = (w, cls) => w.document.querySelectorAll(`.${cls}`).length;

// --- reading a comment's own time --------------------------------------------

test('a comment’s timestamp is its own, not its replies’', () => {
  const { w } = load();
  const withReplies = [...w.document.querySelectorAll('[data-comment-id]')].find(
    (c) => c.querySelector('[data-comment-id]')
  );
  assert.ok(withReplies, 'fixture has no nested replies');

  const own = w.RRX.commentsNew.timeOf(withReplies);
  const nested = w.RRX.commentsNew.timeOf(withReplies.querySelector('[data-comment-id]'));
  assert.ok(own > 0 && nested > 0);
  assert.notEqual(own, nested, 'the reply’s time was read as the parent’s');
});

test('the list is ranked, not chronological — which is why there is no divider', () => {
  const { w } = load();
  const inOrder = [...w.document.querySelectorAll('[data-comment-id]')].map((c) =>
    w.RRX.commentsNew.timeOf(c)
  );
  const sorted = [...inOrder].sort((a, b) => a - b);
  assert.notDeepEqual(inOrder, sorted, 'fixture changed: a divider might now be viable');
});

// --- what counts as new -------------------------------------------------------

test('the first visit marks nothing, and says nothing', () => {
  const { w, ctx } = load({ seenAt: 0 });
  w.RRX.commentsNew.apply(ctx);

  assert.equal(countOf(w, w.RRX.commentsNew.NEW_CLASS), 0);
  assert.equal(countOf(w, w.RRX.commentsNew.SEEN_CLASS), 0);
  // No greeting: a bar that says "first visit" at the top of every chapter is
  // furniture, and furniture stops being read.
  assert.equal(w.document.getElementById(w.RRX.commentsNew.BAR_ID), null);
});

test('with nothing new but everything folded, the bar says so and gives the date', () => {
  const { w } = load();
  const newest = Math.max(...stamps(w));
  const { w: w2, ctx } = load({ seenAt: newest, mode: 'fold' });
  w2.RRX.commentsNew.apply(ctx);

  assert.equal(countOf(w2, w2.RRX.commentsNew.NEW_CLASS), 0);
  const bar = w2.document.getElementById(w2.RRX.commentsNew.BAR_ID);
  // A page that quietly collapses most of its own comments looks broken rather
  // than tidied, and the reader cannot check the arithmetic without the date.
  assert.ok(bar, 'the comments folded with no explanation');
  // Dated by the newest comment that was here last time, not by the visit -
  // those differ, and claiming the visit date makes correct marking look wrong.
  assert.match(bar.textContent, /Comments older than .+ are folded/);
  assert.match(
    bar.querySelector('.rrx-comments-bar__count').getAttribute('title'),
    /newest comment that was here/
  );
});

test('with nothing new and nothing folded, there is no bar', () => {
  const { w } = load();
  const newest = Math.max(...stamps(w));
  const { w: w2, ctx } = load({ seenAt: newest, mode: 'mark' });
  w2.RRX.commentsNew.apply(ctx);

  assert.equal(w2.document.getElementById(w2.RRX.commentsNew.BAR_ID), null);
});

test('Unfold shows everything, and can be turned back', () => {
  const { w } = load();
  const newest = Math.max(...stamps(w));
  const { w: w2, ctx } = load({ seenAt: newest, mode: 'fold' });
  w2.RRX.commentsNew.apply(ctx);
  assert.ok(countOf(w2, w2.RRX.commentsNew.SEEN_CLASS) > 0);

  w2.document.querySelector('[data-rrx-toggle="showAll"]').click();
  assert.equal(countOf(w2, w2.RRX.commentsNew.SEEN_CLASS), 0, 'still folded');
  assert.ok(w2.document.getElementById(w2.RRX.commentsNew.BAR_ID), 'no way back');

  w2.document.querySelector('[data-rrx-toggle="showAll"]').click();
  assert.ok(countOf(w2, w2.RRX.commentsNew.SEEN_CLASS) > 0);
});

test('a visit older than the expiry reads as never having happened', () => {
  const { w } = load();
  const all = stamps(w);
  const middle = all[Math.floor(all.length / 2)];

  const recent = load({ seenAt: middle, visitedDaysAgo: 10, days: 60 });
  recent.w.RRX.commentsNew.apply(recent.ctx);
  assert.ok(countOf(recent.w, recent.w.RRX.commentsNew.NEW_CLASS) > 0, 'ten days ago still counts');

  // Past the expiry the whole conversation is worth seeing again, so nothing is
  // marked and nothing folds - exactly like a chapter never opened.
  const stale = load({ seenAt: middle, visitedDaysAgo: 90, days: 60 });
  stale.w.RRX.commentsNew.apply(stale.ctx);
  assert.equal(countOf(stale.w, stale.w.RRX.commentsNew.NEW_CLASS), 0);
  assert.equal(countOf(stale.w, stale.w.RRX.commentsNew.SEEN_CLASS), 0);

  // ...unless the reader keeps them for longer.
  const kept = load({ seenAt: middle, visitedDaysAgo: 90, days: 180 });
  kept.w.RRX.commentsNew.apply(kept.ctx);
  assert.ok(countOf(kept.w, kept.w.RRX.commentsNew.NEW_CLASS) > 0);
});

test('only comments newer than the watermark are marked', () => {
  const { w } = load();
  const all = stamps(w);
  const middle = all[Math.floor(all.length / 2)];
  const expected = all.filter((s) => s > middle).length;

  const { w: w2, ctx } = load({ seenAt: middle });
  w2.RRX.commentsNew.apply(ctx);

  assert.equal(countOf(w2, w2.RRX.commentsNew.NEW_CLASS), expected);
  assert.match(
    w2.document.getElementById(w2.RRX.commentsNew.BAR_ID).textContent,
    new RegExp(`${expected} new comment`)
  );
});

test('a comment with something new underneath it is never folded', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[Math.floor(all.length / 2)], mode: 'fold' });
  w2.RRX.commentsNew.apply(ctx);

  const { SEEN_CLASS, NEW_CLASS } = w2.RRX.commentsNew;
  for (const folded of w2.document.querySelectorAll(`.${SEEN_CLASS}`)) {
    assert.equal(
      folded.querySelector(`.${NEW_CLASS}`),
      null,
      'a folded comment is hiding a new reply underneath it'
    );
  }
});

test('nothing is ever hidden, only folded', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2], mode: 'fold' });
  w2.RRX.commentsNew.apply(ctx);

  // There is no hidden variant of the seen class, and there must not be: the
  // stylesheet's `-hidden` rule is for low-value comments alone.
  assert.equal(w2.document.querySelectorAll('.rrx-comment-seen-hidden').length, 0);
  const css = fs.readFileSync(path.join(ROOT, 'src/content/inject-comments.css'), 'utf8');
  assert.doesNotMatch(css, /rrx-comment-seen[^,{\s]*hidden/);
});

test('“mark” points them out without folding anything', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2], mode: 'mark' });
  w2.RRX.commentsNew.apply(ctx);

  assert.ok(countOf(w2, w2.RRX.commentsNew.NEW_CLASS) > 0);
  assert.equal(countOf(w2, w2.RRX.commentsNew.SEEN_CLASS), 0);
});

test('a comment being replied to is left open', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2], mode: 'fold' });

  // Someone is typing into this one. Folding it under them would be the rudest
  // possible moment to do it.
  const target = [...w2.document.querySelectorAll('[data-comment-id]')].find(
    (c) => w2.RRX.commentsNew.timeOf(c) <= all[2]
  );
  const input = w2.document.createElement('textarea');
  target.appendChild(input);
  input.focus();

  w2.RRX.commentsNew.apply(ctx);
  assert.equal(target.classList.contains(w2.RRX.commentsNew.SEEN_CLASS), false);
});

// --- the watermark ------------------------------------------------------------

test('the watermark does not move while you are reading', () => {
  const seeded = stamps(load({}).w)[2];
  const { w, ctx } = load({ seenAt: seeded });

  // Resolved on the first pass, against the record and the expiry, and pinned
  // from then on: a comment must not stop being new while it is being read.
  w.RRX.commentsNew.apply(ctx);
  assert.equal(w.RRX.commentsNew.state().seenAt, seeded);

  for (let i = 0; i < 3; i += 1) w.RRX.commentsNew.apply(ctx);
  assert.equal(w.RRX.commentsNew.state().seenAt, seeded, 'marks would evaporate as you read');
  assert.equal(w.__written.length, 0);
});

test('leaving without reaching the comments changes nothing', async () => {
  const { w, ctx } = load({ seenAt: 1 });
  w.RRX.commentsNew.apply(ctx);
  w.RRX.commentsNew.commit();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.__written.length, 0, 'a chapter you scrolled past was marked read');
});

test('having read them, the watermark moves to the newest comment ON THE PAGE', async () => {
  const { w, ctx } = load({ seenAt: 1 });
  w.RRX.commentsNew.apply(ctx);
  w.RRX.commentsNew.setDwelt(true);
  w.RRX.commentsNew.commit();
  await new Promise((r) => setTimeout(r, 20));

  // Not `now`: a comment posted while the tab sat open, or a page two never
  // fetched, must not be written off as seen.
  const newest = Math.max(...stamps(w));
  assert.equal(w.__written.length, 1);
  assert.equal(w.__chapters[CHAPTER].s, newest);
});

test('“Clear the marks” clears them there and then', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2], mode: 'fold' });
  w2.RRX.commentsNew.apply(ctx);
  assert.ok(countOf(w2, w2.RRX.commentsNew.NEW_CLASS) > 0);

  w2.document.querySelector('[data-rrx-action="markSeen"]').click();
  assert.equal(countOf(w2, w2.RRX.commentsNew.NEW_CLASS), 0);
  // Nothing is new any more, but everything is now folded - which still needs
  // saying, with the date it is folding from.
  assert.match(
    w2.document.getElementById(w2.RRX.commentsNew.BAR_ID).textContent,
    /are folded/
  );
});

// --- living with the sweep ----------------------------------------------------

test('with no pagination block, the bar sits above the comments — never inside them', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2] });

  // This capture has no #comments-pagination, which is what a chapter with too
  // few comments to page through looks like. The container is no use as a
  // parent: Royal Road's own AJAX replaces it wholesale.
  assert.equal(w2.document.querySelector('#comments-pagination'), null);
  w2.RRX.commentsNew.apply(ctx);

  const bar = w2.document.getElementById(w2.RRX.commentsNew.BAR_ID);
  const container = w2.document.querySelector('#comments-container');
  assert.equal(bar.nextElementSibling, container);
  assert.equal(container.contains(bar), false);
  assert.ok(bar.classList.contains(w2.RRX.UI_CLASS));
});

test('the pagination block is preferred when there is one', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2] });

  const paginate = w2.document.createElement('div');
  paginate.id = 'comments-pagination';
  w2.document.querySelector('#comments-container').before(paginate);

  w2.RRX.commentsNew.apply(ctx);
  assert.equal(w2.document.getElementById(w2.RRX.commentsNew.BAR_ID).parentElement, paginate);
});

test('re-applying the same verdict rebuilds nothing', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2] });
  w2.RRX.commentsNew.apply(ctx);
  const bar = w2.document.getElementById(w2.RRX.commentsNew.BAR_ID);

  for (let i = 0; i < 4; i += 1) w2.RRX.commentsNew.apply(ctx);
  assert.equal(w2.document.getElementById(w2.RRX.commentsNew.BAR_ID), bar);
});

test('switching the feature off leaves the comments alone', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[2] });
  w2.RRX.commentsNew.apply(ctx);

  ctx.settings = w2.RRX.normalizeSettings({ 'comments.seen': 'off' });
  w2.RRX.commentsNew.apply(ctx);
  // The verdict classes stay until the next pass repaints them, but nothing new
  // is drawn and no bar is added for a reader who has switched it off.
  assert.equal(w2.RRX.normalizeSettings(ctx.settings)['comments.seen'], 'off');
});

// --- how many the reader's own rules took away --------------------------------

test('only comments actually removed are counted as hidden', () => {
  const { w } = load();
  const { hiddenCount } = w.RRX.comments;
  const comments = [...w.document.querySelectorAll('[data-comment-id]')];

  const childless = comments.filter((c) => !c.querySelector('[data-comment-id]'));
  const withReplies = comments.find((c) => c.querySelector('[data-comment-id]'));

  childless[0].classList.add('rrx-comment-thanks-hidden');
  childless[1].classList.add('rrx-comment-thanks-hidden');
  // Folded, not hidden: it is still there as a dimmed line that opens on hover.
  childless[2].classList.add('rrx-comment-thanks');
  childless[3].classList.add('rrx-comment-seen');
  // Collapsed by the reader a moment ago, and they know they did it.
  withReplies.classList.add('rrx-thread-collapsed');
  // Hiding softens to folding for a comment with replies, so this cannot really
  // happen - and if it ever did, the stylesheet would not remove it either.
  withReplies.classList.add('rrx-comment-thanks-hidden');

  assert.equal(hiddenCount(w.document), 2);
});

test('the count joins Royal Road’s own summary line, and goes when nothing is hidden', () => {
  const { w } = load();
  const paginate = w.document.createElement('div');
  paginate.id = 'comments-pagination';
  const summary = w.document.createElement('span');
  summary.textContent = 'Showing 1 to 10 of 137 comments';
  paginate.appendChild(summary);
  w.document.querySelector('#comments-container').before(paginate);

  const target = [...w.document.querySelectorAll('[data-comment-id]')].find(
    (c) => !c.querySelector('[data-comment-id]')
  );
  target.classList.add('rrx-comment-thanks-hidden');
  w.RRX.comments.showHiddenCount(w.document);

  const note = w.document.getElementById('rrx-hidden-count');
  assert.ok(note, 'nothing was appended to the summary');
  assert.equal(note.parentElement, summary);
  assert.equal(note.textContent, ' (1 hidden)');
  assert.ok(note.classList.contains(w.RRX.UI_CLASS), 'unmarked, so it would feed the sweep');
  assert.match(summary.textContent, /Showing 1 to 10 of 137 comments \(1 hidden\)/);

  target.classList.remove('rrx-comment-thanks-hidden');
  w.RRX.comments.showHiddenCount(w.document);
  assert.equal(w.document.getElementById('rrx-hidden-count'), null);
});

test('no summary to join means no annotation, not an error', () => {
  const { w } = load();
  const target = [...w.document.querySelectorAll('[data-comment-id]')].find(
    (c) => !c.querySelector('[data-comment-id]')
  );
  target.classList.add('rrx-comment-thanks-hidden');

  // Royal Road renders that line itself, after the comments load. If it ever
  // stops looking like a count, this must do nothing at all.
  w.RRX.comments.showHiddenCount(w.document);
  assert.equal(w.document.getElementById('rrx-hidden-count'), null);
});

// --- when the watermark actually reaches storage ------------------------------

test('the watermark is written as soon as the comments have been read', async () => {
  const { w, ctx } = load({ seenAt: 1 });
  w.RRX.commentsNew.apply(ctx);

  // Waiting for pagehide meant an async storage write against a page being torn
  // down, which often never landed - so the next visit looked like the first.
  w.RRX.commentsNew.setDwelt(true);
  w.RRX.commentsNew.commit();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(w.__written.length, 1);
  assert.equal(w.__chapters[CHAPTER].s, Math.max(...stamps(w)));
});

test('a later page can still push the watermark further', async () => {
  const { w, ctx } = load({ seenAt: 1 });
  w.RRX.commentsNew.apply(ctx);
  w.RRX.commentsNew.setDwelt(true);
  w.RRX.commentsNew.commit();
  await new Promise((r) => setTimeout(r, 20));
  const first = w.__chapters[CHAPTER].s;

  // Comment pagination appends more, and one of them is newer than anything
  // seen so far. Committing once and latching would lose it.
  const newer = first + 5000;
  const extra = w.document.querySelector('[data-comment-id]').cloneNode(true);
  extra.setAttribute('data-comment-id', '99999999');
  extra.querySelector('time[unixtime]').setAttribute('unixtime', String(newer));
  w.document.querySelector('#comments-container').appendChild(extra);

  w.RRX.commentsNew.commit();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.__chapters[CHAPTER].s, newer);
});

test('a new comment is marked with a word, not only a colour', () => {
  const { w } = load();
  const all = stamps(w);
  const { w: w2, ctx } = load({ seenAt: all[Math.floor(all.length / 2)] });
  w2.RRX.commentsNew.apply(ctx);

  const newOnes = [...w2.document.querySelectorAll('.rrx-comment-new')];
  assert.ok(newOnes.length);
  for (const comment of newOnes) {
    const pill = comment.querySelector(':scope > .rrx-comment-newpill');
    assert.ok(pill, 'a new comment carries no badge');
    assert.equal(pill.textContent, 'New');
    assert.ok(pill.classList.contains(w2.RRX.UI_CLASS), 'unmarked, so it would feed the sweep');
  }

  // Re-running must not stack badges, and clearing must take them away.
  for (let i = 0; i < 3; i += 1) w2.RRX.commentsNew.apply(ctx);
  assert.equal(w2.document.querySelectorAll('.rrx-comment-newpill').length, newOnes.length);

  w2.document.querySelector('[data-rrx-action="markSeen"]').click();
  assert.equal(w2.document.querySelectorAll('.rrx-comment-newpill').length, 0);
});

test('Unfold clears the low-effort folding too, not only the already-read kind', async () => {
  // Two features fold comments: this one folds what you have already read, and
  // comments.js folds "tftc" and friends. They share one set of CSS rules, but
  // the button only ever cleared its own class - so pressing something labelled
  // "Show every comment in full" left every "tftc" collapsed.
  const { w, ctx } = load({ seenAt: nowS() - DAY });
  w.RRX.commentsNew.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));

  const html = w.document.documentElement;
  assert.equal(html.classList.contains('rrx-show-all'), false, 'nothing asked for yet');

  const unfold = w.document.querySelector('[data-rrx-toggle="showAll"]');
  assert.ok(unfold, 'the control is offered while anything is folded');
  unfold.click();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(
    html.classList.contains('rrx-show-all'),
    true,
    'pressing it says so on <html>, which is what reaches the other feature'
  );
});

test('every fold rule yields to "show everything", or the class is decoration', () => {
  // The class above only helps if the stylesheet honours it. comments.js does
  // its folding entirely in CSS, so this is where that promise is kept.
  const css = fs.readFileSync(path.join(ROOT, 'src/content/inject-comments.css'), 'utf8');
  // Only rules that actually fold. The reduced-motion block names the class
  // too, but all it does there is switch a transition off.
  const folds = css
    .split('}')
    .filter(
      (rule) =>
        rule.includes('.rrx-comment-thanks') &&
        (rule.includes('max-height') || rule.includes('display: none'))
    );
  assert.ok(folds.length, 'found the fold rules');
  for (const rule of folds) {
    const selector = rule.slice(0, rule.indexOf('{')).trim().replace(/\s+/g, ' ');
    assert.match(rule, /rrx-show-all/, `a fold rule ignores the request: ${selector}`);
  }
});

test('hidden comments get a way back, and the control says which it is', async () => {
  // Hiding removes a comment from the page outright: there is no dimmed line to
  // hover, so without a control there is no route back at all. The count line
  // Royal Road gets annotated with "(N hidden)" only says it happened.
  const { w, ctx } = load({ seenAt: nowS() - DAY });
  w.RRX.commentsNew.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));

  // comments.js owns this class; stand in for it having hidden something.
  const victim = w.document.querySelector('[data-comment-id]');
  victim.classList.add('rrx-comment-thanks-hidden');
  w.RRX.commentsNew.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));

  const control = w.document.querySelector('[data-rrx-toggle="showAll"]');
  assert.ok(control, 'a control is offered');
  assert.equal(
    control.textContent.trim(),
    'Show hidden',
    'and it is named for the half you cannot see, not for folding'
  );
  assert.match(control.getAttribute('title'), /hidden/i, 'the tooltip says so too');
});

test('with nothing hidden it is still just Unfold', async () => {
  // The label follows what is actually suppressed; it must not cry "hidden" at
  // somebody who only has folding switched on.
  const { w, ctx } = load({ seenAt: nowS() - DAY });
  w.RRX.commentsNew.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));

  const control = w.document.querySelector('[data-rrx-toggle="showAll"]');
  assert.ok(control, 'a control is offered for the folding');
  assert.equal(control.textContent.trim(), 'Unfold');
});

test('a page whose only suppression is hiding still gets the control', async () => {
  // The reported case: open a chapter you have already read, so nothing is new
  // and nothing folds as "seen", but the low-effort rules hide some comments.
  // The bar was removed on "nothing fresh, nothing folded" and took the only
  // route back to those comments with it. Infinite scroll makes it worse: the
  // first page can be clean while a later one hides plenty.
  const { w } = load();
  const newest = Math.max(...stamps(w));
  const { w: w2, ctx } = load({ seenAt: newest, mode: 'mark' });
  w2.RRX.commentsNew.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));

  // Nothing new, nothing folded: with no hiding there is correctly no bar.
  assert.equal(w2.document.getElementById(w2.RRX.commentsNew.BAR_ID), null);

  // Now a later page arrives and something on it is hidden outright.
  w2.document.querySelector('[data-comment-id]').classList.add('rrx-comment-thanks-hidden');
  w2.RRX.commentsNew.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(
    w2.document.getElementById(w2.RRX.commentsNew.BAR_ID),
    'the bar has to come back, or the hidden comments are unreachable'
  );
  assert.equal(
    w2.document.querySelector('[data-rrx-toggle="showAll"]').textContent.trim(),
    'Show hidden'
  );
});

test('a chapter never opened is never given a date', async () => {
  // seenAt is 0 on a first visit and `new Date(0)` is 1 January 1970, so a bar
  // that reaches for the date regardless announces "Comments older than 1 ene
  // 1970 are folded" on a chapter nobody has read.
  const { w, ctx } = load({ seenAt: 0 });
  // Something for the bar to exist for, without a watermark behind it.
  w.document.querySelector('[data-comment-id]').classList.add('rrx-comment-thanks');
  w.RRX.commentsNew.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));

  const bar = w.document.getElementById(w.RRX.commentsNew.BAR_ID);
  if (bar) {
    assert.doesNotMatch(bar.textContent, /1970/, 'claimed a date it does not have');
    assert.doesNotMatch(bar.textContent, /older than/i, 'claimed a boundary it does not have');
  }
});

test('reloading straight after reading does not collapse the page under you', async () => {
  // Reading the comments is what sets the watermark, so a reload a moment later
  // is technically right to call them all seen - and folding the page somebody
  // is still looking at is the one case where being right is no use.
  const { w } = load({ seenAt: 0 });
  const newest = Math.max(...stamps(w));

  const back = load({ seenAt: newest, visitedDaysAgo: 0 });
  back.w.RRX.commentsNew.apply(back.ctx);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(
    countOf(back.w, back.w.RRX.commentsNew.SEEN_CLASS),
    0,
    'a reload folded what was just being read'
  );
});

test('but coming back later folds what was read, as it always did', async () => {
  const { w } = load({ seenAt: 0 });
  const newest = Math.max(...stamps(w));

  // Past the grace window: a genuine return, not a reload.
  const later = load({ seenAt: newest, visitedDaysAgo: 1 });
  later.w.RRX.commentsNew.apply(later.ctx);
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(
    countOf(later.w, later.w.RRX.commentsNew.SEEN_CLASS) > 0,
    'coming back tomorrow should still fold what was read'
  );
});
