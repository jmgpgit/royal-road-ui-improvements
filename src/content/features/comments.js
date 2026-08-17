'use strict';

/**
 * Comment threads: collapsing, low-content folding, and loading the rest.
 * The purely visual half (separators, thread lines) is CSS in
 * inject-comments.css, keyed on the `data-depth` Royal Road already provides.
 *
 * Nesting has no fixed limit: `data-depth` and `data-parent-id` hold at every
 * level. Royal Road changes container at depth 3 - replies down to depth 2 sit
 * in `.comment-replies`, everything below in a `[data-rr-deep-replies]` holder
 * that starts hidden behind a "N more replies" button. Anything that walks a
 * chain has to accept both.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  /** Comments that are only an acknowledgement. Subtractive rather than a list
   *  of phrases: strip the thanks word, then the filler, and if nothing is left
   *  the comment said nothing. A bare "thank" folds; "thanks for the chapter,
   *  but the pacing dragged" does not. */
  const THANKS_LEAD =
    /^(thank you|thank u|thanks|thanx|thank|tysm|tyvm|tks|thx|ty|cheers|arigato|gracias|danke)\b/;
  /** Words that carry no content once the thanks is removed. */
  const FILLER =
    /\b(so|very|much|many|lots?|a|an|the|for|this|that|these|another|next|new|one|it|again|as|always|and|to|u|you|ur|your|author|op|man|mate|friend|dude|bro|sir|ma+te?|chapter|chappy|chappie|chappter|chap|chaps|ch|update|updates|post|release|read|awesome|great|amazing|nice|good|lovely|wonderful|excellent|fantastic|work|writing|story|tale|part|episode|instalment|installment|meal|feast|snack|food)\b/g;
  /** Acronyms that are the entire comment. `[f4]` because "4" stands in for
   *  "for" as readily as "f" does: t4tc and ty4tc are as common as tftc. */
  const THANKS_ACRONYMS = /^(t+y+[f4]+t*c+|t+[f4]+t*c+|ty|tyvm|tysm|thx|tks)$/;

  /** Position-claiming comments: "first!", "second", "3rd". Anchored to the
   *  whole comment because "first" is an ordinary English word - "the first
   *  time I read this I cried" must survive. */
  const ORDINAL_ONLY =
    /^(first|second|third|fourth|forth|fifth|1st|2nd|3rd|4th|5th)( comment| post| reply| here| again)?$/;

  /** ASCII emoticons, removed before punctuation is. Stripping punctuation
   *  first turns ":D" into a bare "d", which survives as the remainder and
   *  keeps "Thanks for the chapter! :D" out of the filter while ":)" folds. */
  const EMOTICONS = /(?:[:;=8][-–]?[)([\]dpo3s|/\\]+|\bx+d+\b|<3+|\^[_.-]?\^)/g;

  const normalise = (text) =>
    text
      .toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
      .replace(EMOTICONS, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();


  /** Is this comment nothing but thanks?
   *  @param {string} text the comment body */
  function isThanks(text) {
    const clean = normalise(text);
    if (!clean) return false;
    // Anything long enough to be saying something is left alone regardless.
    if (clean.split(' ').length > 8) return false;
    // Bare reactions - "interesting", "lol", "nice" - were tried here and taken
    // back out: folding those judges worth rather than content.
    // `comments.foldPatterns` is there for anyone who disagrees.
    if (ORDINAL_ONLY.test(clean)) return true;
    if (THANKS_ACRONYMS.test(clean.replace(/\s/g, ''))) return true;
    if (!THANKS_LEAD.test(clean)) return false;
    const remainder = clean.replace(THANKS_LEAD, '').replace(FILLER, '').replace(/\s+/g, ' ').trim();
    return remainder === '';
  }

  /** User-supplied patterns, one per line, matched case-insensitively against
   *  the comment text. A line that is not valid regex syntax becomes a literal
   *  phrase rather than being thrown away: someone typing "first!" into a box
   *  means the words, and a silent no-op would just look broken. Compiled once
   *  per distinct settings string, not once per comment. */
  let compiled = { source: null, patterns: [] };

  function customPatterns(source) {
    if (compiled.source === source) return compiled.patterns;
    const patterns = [];
    for (const line of String(source || '').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        patterns.push(new RegExp(trimmed, 'i'));
      } catch {
        patterns.push(new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      }
    }
    compiled = { source, patterns };
    return patterns;
  }

  /** Does this comment match any of the reader's own patterns? */
  const matchesPatterns = (text, source) => customPatterns(source).some((re) => re.test(text));

  /** Does this comment match the built-in rule or any of the reader's own? */
  function isLowValue(text, source) {
    return isThanks(text) || matchesPatterns(text, source);
  }

  /** What to do with a comment when both rules have an opinion. Hiding wins
   *  over folding: the stronger instruction is the one the reader will notice
   *  not being honoured. */
  function actionFor(text, settings) {
    const actions = [];
    if (isThanks(text)) actions.push(settings['comments.thanks']);
    if (matchesPatterns(text, settings['comments.foldPatterns'])) {
      actions.push(settings['comments.patternAction']);
    }
    if (actions.includes('hide')) return 'hide';
    if (actions.includes('fold')) return 'fold';
    return 'keep';
  }

  const bodyText = (comment) => {
    const body = ownBody(comment);
    return body ? body.textContent.trim() : '';
  };

  /** A comment contains its replies, so every "does this comment have X"
   *  question has to check the X it found belongs to this comment and not to
   *  someone answering it. */
  const ownParts = (comment, selector) =>
    [...comment.querySelectorAll(selector)].filter((el) => el.closest(SEL.comment) === comment);

  const ownBody = (comment) => ownParts(comment, SEL.commentBody)[0] || null;

  /** Did the fiction's own author write this? The feather badge is the marker,
   *  the "Author" tooltip beside it a second opinion for the day Royal Road
   *  swaps its icon set. Not the left border, which looks like an author marker
   *  and is not: it is a reputation tier. */
  function isAuthorComment(comment) {
    if (ownParts(comment, SEL.commentAuthorBadge).length) return true;
    return ownParts(comment, SEL.commentTooltip).some((t) => t.textContent.trim() === 'Author');
  }

  /** One Royal Road emoticon and nothing else. Every image must be an emoticon,
   *  since one paired with a screenshot is making a point, and there must be no
   *  text, so an emoticon used as punctuation after a sentence is left alone. */
  function isEmoteOnly(commentOrBody) {
    // Accepts the comment or its already-located body, so the hot path can find
    // the body once and hand it to everything that needs it.
    const body = commentOrBody && commentOrBody.matches(SEL.comment)
      ? ownBody(commentOrBody)
      : commentOrBody;
    if (!body) return false;
    if (body.textContent.trim()) return false;
    const images = [...body.querySelectorAll('img')];
    if (!images.length) return false;
    return images.every((img) => img.matches(SEL.commentEmote));
  }

  /** Everything that decides a comment's fate, including the parts needing the
   *  element rather than its text. The author exemption is applied last, over
   *  whatever the rules concluded, so a rule added later cannot forget it. */
  function actionForComment(comment, settings) {
    // Found once and passed down: locating a comment's own body scans its
    // subtree and climbs back out of every match.
    const body = ownBody(comment);
    const actions = [actionFor(body ? body.textContent.trim() : '', settings)];
    if (isEmoteOnly(body)) actions.push(settings['comments.emotes']);

    let action = 'keep';
    if (actions.includes('hide')) action = 'hide';
    else if (actions.includes('fold')) action = 'fold';

    if (action !== 'keep' && isAuthorComment(comment)) {
      // Hiding never reaches an author, whatever the toggle says: their reply is
      // the one comment on the page a reader came for. The toggle only decides
      // whether folding may.
      action = settings['comments.foldAuthors'] ? 'fold' : 'keep';
    }
    return action;
  }

  /** The reply container belonging to *this* comment. A grandchild, not a child
   *  (`[data-comment-id] > div.flex.flex-col > .comment-replies`), and every
   *  nested thread contains one too, so the owner has to be checked or a comment
   *  claims its grandchildren's replies as its own.
   *
   *  Two containers, not one: Royal Road switches to `[data-rr-deep-replies]`
   *  once a chain passes depth 2. Match only `.comment-replies` and a deep
   *  comment reads as childless - no collapse button, and "hide" takes its whole
   *  chain down with it. */
  function repliesOf(comment) {
    const containers = `${SEL.commentReplies}, ${SEL.commentDeepReplies}`;
    for (const replies of comment.querySelectorAll(containers)) {
      if (replies.closest(SEL.comment) === comment) return replies;
    }
    return null;
  }

  function addCollapseButton(comment) {
    // Cheapest test first: this runs for every comment on every sweep. `:scope >`
    // looks at direct children only, while `repliesOf` walks the whole subtree
    // and then climbs back out of every match.
    if (comment.querySelector(':scope > .rrx-thread-toggle')) return;
    const replies = repliesOf(comment);
    if (!replies) return;

    const count = replies.querySelectorAll(SEL.comment).length;
    const button = ui.el('button', {
      type: 'button',
      class: 'rrx-ui rrx-thread-toggle',
      'aria-expanded': 'true',
      title: 'Collapse this thread',
      onClick: () => {
        const collapsed = comment.classList.toggle('rrx-thread-collapsed');
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        button.title = collapsed ? `Show ${count} repl${count === 1 ? 'y' : 'ies'}` : 'Collapse this thread';
        button.textContent = collapsed ? `+ ${count}` : '−';
      },
    });
    button.textContent = '−';
    comment.insertBefore(button, comment.firstChild);
  }

  /** Marks our own annotation so a sweep cannot be triggered by it. */
  const COUNT_ID = 'rrx-hidden-count';

  /** How many comments the reader's rules took off the page - only the ones
   *  actually removed. A fold leaves a dimmed line that opens on hover, and a
   *  collapsed thread the reader collapsed a moment ago needs no reminding.
   *  `display: none` reaches one class, and only on comments with no replies,
   *  because hiding softens to folding for anything holding a chain. */
  const hiddenCount = (scope) =>
    (scope || document).querySelectorAll(
      '.rrx-comment-thanks-hidden:not(:has(.comment-replies, [data-rr-deep-replies]))'
    ).length;

  /** Said on Royal Road's own "Showing 31 to 40 of 137 comments" line, which
   *  would otherwise be quietly wrong about what is on the page.
   *
   *  That line is rendered by Royal Road's own script after the comments load -
   *  it is in no server response, so there is no selector for it and none can be
   *  written. It is found by looking inside the pagination block for the leaf
   *  that talks about a count; if that ever stops matching, the annotation
   *  simply does not appear. It is an addition to somebody else's sentence: it
   *  must never be the reason something breaks. */
  function showHiddenCount(scope) {
    const root = document.querySelector(SEL.commentsPaginate);
    if (!root) return;

    const count = hiddenCount(scope || document);
    const existing = document.getElementById(COUNT_ID);

    if (!count) {
      if (existing) existing.remove();
      return;
    }

    const text = ` (${count} hidden)`;
    if (existing) {
      if (existing.textContent !== text) existing.textContent = text;
      if (existing.isConnected) return;
    }

    // "of 137 comments", the one phrase that line always contains. Deliberately
    // not anchored to "Showing", the wording most likely to change.
    const SUMMARY = /of\s+[\d,]+\s+comments?/i;
    const summary = [...root.querySelectorAll('*')].find(
      (el) =>
        !el.children.length &&
        !el.closest('.' + RRX.UI_CLASS) &&
        SUMMARY.test(el.textContent || '')
    );
    if (!summary) return;

    summary.appendChild(
      existing && !existing.isConnected
        ? existing
        : ui.el('span', { id: COUNT_ID, class: 'rrx-ui rrx-hidden-count', text })
    );
  }

  function syncCards(scope, ctx) {
    if (ctx.page !== 'chapter') return;

    // A re-sort replaces the list, taking our appended pages with it. Noticed
    // here because nothing else runs afterwards unless the reader scrolls, and
    // by then the run has already stopped for good.
    // Three ways in. The click hook is the reliable one - it knows a re-sort
    // happened rather than inferring it - and `noticeReplacement` stays as the
    // fallback for a list Royal Road replaces for its own reasons. `owed` is
    // what keeps either of them trying: one `loadNext` is not enough, because
    // the container is not always there the instant the list is swapped.
    const restarted = pager.noticeReplacement();
    if ((restarted || pager.owed()) && ctx.settings['comments.autoLoad']) pager.loadNext();

    const collapsible = ctx.settings['comments.collapsible'];

    /* Can any rule reach a verdict other than "leave alone"? On the shipped
     * defaults none can: acknowledgements and emoticons are both set to keep,
     * and the pattern action has no patterns to act on. Without this, a reader
     * who has never opened the options still pays for the whole pipeline over
     * every comment on every sweep - reading each body, matching the rules, and
     * walking each reply chain twice looking for an author badge. */
    const canAct =
      ctx.settings['comments.thanks'] !== 'keep' ||
      ctx.settings['comments.emotes'] !== 'keep' ||
      (ctx.settings['comments.patternAction'] !== 'keep' &&
        ctx.settings['comments.foldPatterns'].trim() !== '');

    // Any of these changing means every verdict has to be recomputed.
    const ruleKey = [
      ctx.settings['comments.foldPatterns'],
      ctx.settings['comments.thanks'],
      ctx.settings['comments.patternAction'],
      ctx.settings['comments.emotes'],
      ctx.settings['comments.foldAuthors'],
    ].join('\0');

    for (const comment of scope.querySelectorAll(SEL.comment)) {
      if (collapsible) addCollapseButton(comment);

      // Cached per comment; several hundred of them get swept repeatedly. The
      // verdict is recorded even when no rule can act, so turning one on later
      // re-evaluates everything.
      if (comment.dataset.rrxRule !== ruleKey) {
        comment.dataset.rrxRule = ruleKey;
        comment.dataset.rrxAction = canAct ? actionForComment(comment, ctx.settings) : 'keep';
      }

      // A comment with replies is still acted on, it just keeps its chain: the
      // stylesheet reaches past the comment to its own body. Skipping these
      // would make every rule conditional on whether anyone happened to reply.
      //
      // Hiding softens to folding here: removing a comment that replies are
      // answering leaves the chain hanging on nothing.
      let action = comment.dataset.rrxAction;
      if (action === 'hide' && repliesOf(comment)) action = 'fold';
      comment.classList.toggle('rrx-comment-thanks', action === 'fold');
      comment.classList.toggle('rrx-comment-thanks-hidden', action === 'hide');
    }

    showHiddenCount(document);
  }

  // --- loading the rest ------------------------------------------------------

  /** Royal Road's comment pagination *replaces* the list with the next page, so
   *  its "next" moves you forward and loses everything behind. The shared pager
   *  fetches the same endpoint and appends instead: content/pager.js, which
   *  reviews uses too. */
  /** The sort hook is attached once, from `onPage`. */
  let sortHooked = false;

  const pager = RRX.pager.create({
    rootSelector: SEL.commentsPaginate,
    container: () => document.querySelector(SEL.commentsContainer),
    // Royal Road waits for a click before it fetches page one at all.
    ready: () => !!document.querySelector(SEL.commentsContainer),
    // The fetch URL's own `sorting` is whatever the page was rendered with, and
    // Royal Road does not rewrite it when the reader re-sorts.
    sortDropdown: SEL.commentSortDropdown,
    prime: () => {
      const loader = document.querySelector(SEL.commentLoader);
      if (!loader || loader.dataset.rrxClicked) return;
      loader.dataset.rrxClicked = '1';
      loader.click();
    },
  });

  const watchCommentScroll = () => pager.watch();

  features.list.push({
    id: 'comments',
    pages: ['chapter'],
    syncCards,
    /** Once, and only on a chapter: the listener is at the document, and a fiction
     *  page carries a sort dropdown of its own. */
    onPage: (ctx) => {
      // Once, and from here rather than the module body: the listener is at the
      // document, and a fiction page carries a sort dropdown of its own.
      if (!sortHooked) {
        sortHooked = true;
        RRX.pager.restartOnSort(pager, SEL.commentSortDropdown);
      }
      if (ctx.settings['comments.autoLoad']) watchCommentScroll();
      // The colour is a plain custom property so the CSS can stay static.
      const colour = ctx.settings['comments.threadColor'];
      if (colour) document.documentElement.style.setProperty('--rrx-thread-color', colour);
      else document.documentElement.style.removeProperty('--rrx-thread-color');
    },
  });

  RRX.comments = {
    isThanks,
    isLowValue,
    isAuthorComment,
    isEmoteOnly,
    matchesPatterns,
    actionFor,
    actionForComment,
    bodyText,
    customPatterns,
    syncCards,
    repliesOf,
    hiddenCount,
    showHiddenCount,
    watchCommentScroll,
    pager,
  };
})(globalThis);
