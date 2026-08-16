'use strict';

/**
 * Which comments have arrived since you were last here.
 *
 * Coming back to a chapter you follow, the question is never "what are the
 * comments" but "what is new". Royal Road answers neither: it shows the same
 * ranked list every time, with no notion of a previous visit.
 *
 * The shape of this is decided by one fact about that list. Royal Road fetches
 * it as `?sorting=top`, so it is RANKED, not chronological - a "new since your
 * last visit" divider would land in an arbitrary place, with old comments below
 * it and new ones above. So there is no line. Every comment carries its own
 * verdict, computed from its own timestamp.
 *
 * Nothing is ever hidden here. Seen comments fold to a line that opens again on
 * hover, and there is deliberately no hide option: a comment you have read is
 * not a comment you wanted removed, and the reply under it may be the new one.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  const BAR_ID = 'rrx-comments-new';
  const NEW_CLASS = 'rrx-comment-new';
  const SEEN_CLASS = 'rrx-comment-seen';
  const HAS_NEW_CLASS = 'rrx-has-new';
  const ONLY_NEW_CLASS = 'rrx-comments-onlynew';

  /**
   * How long the comments have to be on screen before this visit counts as
   * having read them. Short enough to catch a real look, long enough that
   * scrolling past on the way to the next chapter does not.
   */
  const DWELL_MS = 3000;

  const chapterId = () => RRX.chapterIdFromHref(location.pathname);

  /**
   * A comment's own timestamp, in unix seconds.
   *
   * Through `ownParts`, because a comment contains its replies and every one of
   * them carries a `<time>` of its own - the first one found by a plain query
   * is as likely to belong to a reply as to the comment asking.
   */
  function timeOf(comment) {
    const own = [...comment.querySelectorAll(SEL.commentTime)].filter(
      (el) => el.closest(SEL.comment) === comment
    );
    const stamp = own[0] && Number(own[0].getAttribute('unixtime'));
    return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
  }

  /** The newest comment actually rendered on the page. */
  function newestRendered(scope) {
    let newest = 0;
    for (const comment of (scope || document).querySelectorAll(SEL.comment)) {
      const stamp = timeOf(comment);
      if (stamp > newest) newest = stamp;
    }
    return newest;
  }

  // --- state ------------------------------------------------------------------

  /**
   * The watermark, read once and PINNED for the visit.
   *
   * Advancing it as you read would make the marks evaporate under you: a
   * comment you were part way through reading would stop being new while you
   * were looking at it. It moves on the way out, and nowhere else.
   */
  let seenAt = null;
  let dwelt = false;
  /** The newest comment already written, so a later page can still advance it. */
  let committedTo = 0;
  let onlyNew = false;
  /** Reader asked to see everything in full, for this page view only. */
  let showAll = false;
  let warned = false;
  let observer = null;
  let dwellTimer = null;

  /** What storage holds for this chapter, before the expiry is applied. */
  let record = null;
  /** The expiry the watermark was resolved against, so a change re-resolves. */
  let resolvedFor = null;

  /**
   * Whether the record has been read yet.
   *
   * Load-bearing, and easy to lose: `syncCards` runs during main.js's own
   * startup and again on every sweep, so `apply` is reached long before an
   * async storage read can finish. Resolving a watermark from a record that is
   * not in yet gives 0 - "never visited" - and pinning that, as the watermark
   * must be pinned, makes it 0 for the rest of the page view. Every return to
   * a chapter then looks like the first one, and nothing ever folds.
   */
  let loaded = false;

  const ready = (async () => {
    try {
      if (RRX.pageFromPath(location.pathname) !== 'chapter') return;
      const id = chapterId();
      if (!id) return;
      const chapters = await RRX.store.loadChapters();
      record = chapters[id] || null;
    } catch {
      record = null;
    } finally {
      loaded = true;
    }
  })();

  const maxAgeFor = (settings) => (settings['comments.seenDays'] || 60) * 24 * 60 * 60;

  /**
   * The watermark to judge against, given how long the reader keeps them.
   *
   * Past the expiry the chapter reads as one never visited: coming back after
   * two months, "new since June" is not a useful question and the conversation
   * is worth seeing whole again. Resolved here rather than when the record is
   * read, because the setting is only in hand once `onPage` runs - and it is
   * pinned afterwards, so the marks cannot evaporate mid-visit.
   */
  function resolveSeen(settings) {
    const maxAge = maxAgeFor(settings);
    if (seenAt !== null && resolvedFor === maxAge) return seenAt;

    resolvedFor = maxAge;
    const age = record && record.a ? Math.floor(Date.now() / 1000) - record.a : Infinity;
    seenAt = record && age <= maxAge ? record.s || 0 : 0;
    return seenAt;
  }

  /**
   * Move the watermark to the newest comment ON THE PAGE, not to now.
   *
   * `now` would mark as read a comment posted while the tab sat open but never
   * loaded, and would write off page two when only page one was ever fetched.
   * The newest thing actually rendered is the only claim that is true.
   */
  function commit({ force = false } = {}) {
    if (!dwelt && !force) return;
    const id = chapterId();
    const newest = newestRendered(document);
    if (!id || !newest || newest <= Math.max(seenAt || 0, committedTo)) return;
    committedTo = newest;
    const seenMaxAgeS = lastCtx ? maxAgeFor(lastCtx.settings) : undefined;
    Promise.resolve(RRX.store.markChapter(id, { s: newest }, { seenMaxAgeS })).catch(() => {});
  }

  /** Start counting once the comments have actually been on screen. */
  function watchDwell() {
    if (observer || typeof root.IntersectionObserver !== 'function') return;
    // Same fallback as the bar: a chapter with few comments has no pagination
    // block, and watching only that would mean its comments could never be
    // marked as read.
    const anchor =
      document.querySelector(SEL.commentsPaginate) || document.querySelector(SEL.commentsContainer);
    if (!anchor) return;

    observer = new root.IntersectionObserver((entries) => {
      const showing = entries.some((entry) => entry.isIntersecting);
      if (showing && !dwellTimer) {
        dwellTimer = setTimeout(() => {
          dwelt = true;
          // Written here rather than only on the way out. A storage write from
          // a pagehide handler is async against a page being torn down and
          // frequently never lands, which left the next visit thinking it was
          // the first. The pagehide call below still runs, and picks up
          // anything that loaded after this.
          commit();
        }, DWELL_MS);
      } else if (!showing && dwellTimer) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
      }
    });
    observer.observe(anchor);

    root.addEventListener('pagehide', () => commit());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') commit();
    });
  }

  // --- marking ----------------------------------------------------------------

  const PILL_CLASS = 'rrx-comment-newpill';

  /**
   * A word, not just a colour.
   *
   * The first version marked a new comment with an inset shadow down its left
   * edge, and it was invisible: the comment's own children paint their
   * backgrounds over an inset shadow, and Royal Road already tints that same
   * edge by reputation tier, so even where it showed it read as one more
   * variant of a colour that means something else. A badge cannot be painted
   * over, survives any theme, and says what it means.
   *
   * Placed as the comment's own first child, like the collapse toggle, and
   * scoped with `:scope >` so a reply's badge is never mistaken for its
   * parent's.
   */
  function badge(comment, isNew) {
    const existing = comment.querySelector(`:scope > .${PILL_CLASS}`);
    if (isNew === !!existing) return;
    if (!isNew) {
      existing.remove();
      return;
    }
    comment.insertBefore(
      ui.el('span', { class: `rrx-ui ${PILL_CLASS}`, text: 'New', title: 'Posted since you last read this chapter' }),
      comment.firstChild
    );
  }

  /**
   * Decide, then write - in that order, and never interleaved.
   *
   * The protection pass is why: a comment is only folded if nothing new lives
   * anywhere beneath it, and that cannot be known while walking the list. A
   * fold-then-unfold would also fight itself on the next sweep.
   */
  function mark(scope, mode) {
    const comments = [...(scope || document).querySelectorAll(SEL.comment)];
    if (!comments.length) return { total: 0, fresh: 0 };

    // No watermark means no previous visit, and on a first visit NOTHING is
    // already seen. Folding the lot here would be the feature's first
    // impression: a whole page of comments collapsed for a reader who has read
    // none of them.
    const known = !!seenAt;

    const key = `${seenAt}|${mode}`;
    for (const comment of comments) {
      if (comment.dataset.rrxSeenKey === key) continue;
      comment.dataset.rrxSeenKey = key;
      comment.dataset.rrxNew = known && timeOf(comment) > seenAt ? '1' : '0';
    }

    // Every new comment, and every comment above one. A reply is the most
    // likely thing to be new, and folding the conversation it answers would
    // hide the question.
    const keep = new Set();
    for (const comment of comments) {
      if (comment.dataset.rrxNew !== '1') continue;
      for (
        let node = comment;
        node;
        node = node.parentElement && node.parentElement.closest(SEL.comment)
      ) {
        keep.add(node);
      }
    }

    let fresh = 0;
    let folded = 0;
    for (const comment of comments) {
      const isNew = comment.dataset.rrxNew === '1';
      if (isNew) fresh += 1;

      comment.classList.toggle(NEW_CLASS, isNew);
      badge(comment, isNew);
      // Never over someone typing a reply into it.
      const busy = comment.contains(document.activeElement);
      const fold = known && mode === 'fold' && !showAll && !keep.has(comment) && !busy;
      if (fold) folded += 1;
      comment.classList.toggle(SEEN_CLASS, fold);
      // A new reply can be buried in a collapsed "N more replies" chain, where
      // its own mark is invisible. Flag the owner so the CSS can dot the
      // control - but never expand it unasked.
      comment.classList.toggle(
        HAS_NEW_CLASS,
        !isNew && keep.has(comment) && !!comment.querySelector(SEL.commentDeepReplies)
      );
    }

    return { total: comments.length, fresh, folded };
  }

  // --- the bar ----------------------------------------------------------------

  /** The boundary date, formatted in the reader's own locale. */
  function since() {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
        new Date(seenAt * 1000)
      );
    } catch {
      return 'your last visit';
    }
  }

  /**
   * The bar exists only when there is something new to say.
   *
   * No first-visit greeting and no "nothing new" line: both state the obvious
   * at the top of every chapter's comments, which is how furniture stops being
   * read at all. How many comments the reader's own rules hid is said on Royal
   * Road's own count line instead, where it belongs - see comments.js.
   */
  /**
   * What the bar says.
   *
   * The folded case has to be spelled out, and dated: a page that collapses
   * most of its own comments with no explanation looks broken rather than
   * tidied, and the reader cannot check the arithmetic without being told the
   * boundary.
   *
   * The date is the newest comment that was here last time, NOT the date of
   * that visit - and the wording has to say so, because they are usually
   * different. Read a chapter on the 16th whose last comment was posted on the
   * 15th and the boundary is the 15th; a comment posted late on the 15th, after
   * the ones that had loaded, is then genuinely new despite the visit being
   * later. Labelling that "since you were last here on the 16th" would make
   * correct behaviour look broken.
   */
  function label(counts) {
    const when = since();
    if (!counts.fresh) return `Comments older than ${when} are folded`;
    const count = `${counts.fresh} new ${counts.fresh === 1 ? 'comment' : 'comments'} since ${when}`;
    return counts.folded ? `${count} · the rest folded` : count;
  }

  function render(counts) {
    const signature = [seenAt, counts.fresh, counts.folded, counts.total, onlyNew, showAll].join(
      '|'
    );
    const existing = document.getElementById(BAR_ID);
    if (existing && existing.dataset.rrxSig === signature && existing.isConnected) return;

    const bar = ui.el(
      'div',
      {
        id: BAR_ID,
        class: 'rrx-ui rrx-comments-bar',
        role: 'group',
        'aria-label': 'New comments',
        'data-rrx-sig': signature,
      },
      [
        ui.el('span', {
          class: 'rrx-comments-bar__count',
          text: label(counts),
          // Spelling out the boundary, because the date is not the date of the
          // visit and somebody will reasonably wonder why it is a day early.
          title:
            'Dated by the newest comment that was here when you last read this chapter, ' +
            'which is what anything newer is measured against.',
        }),
        counts.fresh
          ? ui.toggleButton({
              id: 'onlyNew',
              label: 'Only new',
              title: 'Fold everything posted before your last visit',
              iconName: 'showHidden',
              pressed: onlyNew,
              badge: counts.fresh,
              onClick: () => {
                onlyNew = !onlyNew;
                document.documentElement.classList.toggle(ONLY_NEW_CLASS, onlyNew);
                apply(lastCtx);
              },
            })
          : null,
        // Only worth offering while something is actually folded. Each folded
        // comment already opens on hover; this is for reading the lot.
        counts.folded || showAll
          ? ui.toggleButton({
              id: 'showAll',
              label: 'Unfold',
              title: 'Show every comment in full for this visit',
              iconName: 'expandAll',
              pressed: showAll,
              onClick: () => {
                showAll = !showAll;
                apply(lastCtx);
              },
            })
          : null,
        counts.fresh
          ? ui.actionButton({
              id: 'markSeen',
              label: 'Clear the marks',
              title: 'Treat everything on this page as no longer new',
              iconName: 'expandAll',
              onClick: () => {
                commit({ force: true });
                seenAt = newestRendered(document);
                onlyNew = false;
                document.documentElement.classList.remove(ONLY_NEW_CLASS);
                apply(lastCtx);
              },
            })
          : null,
      ]
    );

    if (existing) {
      existing.replaceWith(bar);
      return;
    }

    // `#comments-pagination` first: it is server-rendered, it carries the fetch
    // URL, and Royal Road leaves it alone. But a chapter with few enough
    // comments to need no pages does not have one, so fall back to sitting
    // above the container. Never INSIDE the container - Royal Road's own AJAX
    // replaces that wholesale, taking anything in it with no warning.
    const paginate = document.querySelector(SEL.commentsPaginate);
    if (paginate) {
      paginate.prepend(bar);
      return;
    }
    const container = document.querySelector(SEL.commentsContainer);
    if (container && container.parentElement) container.parentElement.insertBefore(bar, container);
  }

  // --- wiring -----------------------------------------------------------------

  let lastCtx = null;

  function apply(ctx) {
    if (!ctx) return;
    lastCtx = ctx;
    const mode = ctx.settings['comments.seen'];
    if (mode === 'off') return;

    // Nothing until the record is in - see `loaded`. `onPage` re-enters as soon
    // as it is, and every sweep after that finds it waiting.
    if (!loaded) return;

    resolveSeen(ctx.settings);
    const counts = mark(document, mode);
    const existing = document.getElementById(BAR_ID);
    // Something new to point at, or something folded to explain. With neither -
    // a first visit, or nothing having happened since - the bar would only be
    // stating that nothing has changed.
    if (!counts.fresh && !counts.folded && !showAll) {
      if (existing) existing.remove();
      return;
    }
    render(counts);
  }

  function syncCards(scope, ctx) {
    if (ctx.page !== 'chapter') return;
    const mode = ctx.settings['comments.seen'];
    if (mode === 'off') return;

    // main.js does NOT wrap syncCards in a try/catch, and a throw here would
    // kill the sweep for every other feature. Warned once, so a real bug still
    // surfaces without filling the console.
    try {
      apply(ctx);
    } catch (err) {
      if (!warned) {
        warned = true;
        RRX.warn('commentsNew failed', err);
      }
    }
  }

  features.list.push({
    id: 'commentsNew',
    pages: ['chapter'],
    syncCards,
    onPage: (ctx) => {
      lastCtx = ctx;
      if (ctx.settings['comments.seen'] === 'off') return;
      watchDwell();
      ready.then(() => apply(ctx));
    },
  });

  RRX.commentsNew = {
    timeOf,
    newestRendered,
    mark,
    apply,
    commit,
    BAR_ID,
    NEW_CLASS,
    SEEN_CLASS,
    HAS_NEW_CLASS,
    ONLY_NEW_CLASS,
    resolveSeen,
    label,
    state: () => ({ seenAt, dwelt, committedTo, onlyNew, showAll }),
    setSeenAt: (value) => {
      seenAt = value;
      resolvedFor = Infinity;
    },
    setRecord: (value) => {
      record = value;
      loaded = true;
      seenAt = null;
      resolvedFor = null;
    },
    setDwelt: (value) => {
      dwelt = value;
    },
  };
})(globalThis);
