'use strict';

/**
 * Which comments have arrived since you were last here. Royal Road has no
 * notion of a previous visit.
 *
 * It fetches the list as `?sorting=top`, so the list is ranked, not
 * chronological - a "new since your last visit" divider would land in an
 * arbitrary place. So there is no line; every comment carries its own verdict,
 * computed from its own timestamp.
 *
 * Nothing is hidden, only folded to a line that opens on hover: a comment you
 * have read is not one you wanted removed, and the reply under it may be new.
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
  /** Set while the reader has asked to see every comment in full. */
  const SHOW_ALL_CLASS = 'rrx-show-all';
  const ONLY_NEW_CLASS = 'rrx-comments-onlynew';

  /** Time on screen before this visit counts as having read them. Long enough
   *  that scrolling past on the way to the next chapter does not. */
  const DWELL_MS = 3000;

  /** How long a reload still counts as the same sitting: covers a refresh or a
   *  tab restore, but returning tomorrow folds what you read today. */
  const SAME_SITTING_S = 15 * 60;

  const chapterId = () => RRX.chapterIdFromHref(location.pathname);

  /** A comment's own timestamp, in unix seconds. Filtered to this comment: a
   *  comment contains its replies, each carrying a `<time>` of its own, so a
   *  plain query is as likely to find a reply's. */
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

  /** The watermark, read once and pinned for the visit. Advancing it as you
   *  read would make a comment stop being new while you were looking at it. It
   *  moves on the way out, and nowhere else. */
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
   * `syncCards` runs during main.js's own startup and on every sweep, so
   * `apply` is reached long before the async storage read can finish. Resolving
   * from a record that is not in yet gives 0 - "never visited" - and that gets
   * pinned for the page view, so every return looks like the first one and
   * nothing ever folds.
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
   * Past the expiry the chapter reads as one never visited: two months on, "new
   * since June" is not a useful question. Resolved here rather than when the
   * record is read, because the setting is only in hand once `onPage` runs.
   */
  function resolveSeen(settings) {
    const maxAge = maxAgeFor(settings);
    if (seenAt !== null && resolvedFor === maxAge) return seenAt;

    resolvedFor = maxAge;
    const age = record && record.a ? Math.floor(Date.now() / 1000) - record.a : Infinity;
    seenAt = record && age <= maxAge ? record.s || 0 : 0;
    return seenAt;
  }

  /** Move the watermark to the newest comment on the page, not to now: `now`
   *  would mark as read a comment posted while the tab sat open but never
   *  loaded, and write off page two when only page one was ever fetched. */
  function commit({ force = false } = {}) {
    if (!dwelt && !force) return;
    // The dwell observer and the pagehide handler outlive a mid-page switch-off,
    // so the setting is re-read here rather than trusted from onPage.
    if (lastCtx && lastCtx.settings['comments.seen'] === 'off') return;
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
    // block, and watching only that would never mark its comments as read.
    const anchor =
      document.querySelector(SEL.commentsPaginate) || document.querySelector(SEL.commentsContainer);
    if (!anchor) return;

    observer = new root.IntersectionObserver((entries) => {
      const showing = entries.some((entry) => entry.isIntersecting);
      if (showing && !dwellTimer) {
        dwellTimer = setTimeout(() => {
          dwelt = true;
          // A storage write from a pagehide handler is async against a page
          // being torn down and frequently never lands, which left the next
          // visit thinking it was the first. The pagehide call below still
          // runs, and picks up anything that loaded after this.
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
   * An inset shadow down the left edge was invisible: the comment's own
   * children paint their backgrounds over it, and Royal Road already tints that
   * same edge by reputation tier. `:scope >` so a reply's badge is never
   * mistaken for its parent's.
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

  /** Decide, then write, never interleaved: a comment is only folded if nothing
   *  new lives anywhere beneath it, which cannot be known while walking the
   *  list, and a fold-then-unfold would fight itself on the next sweep. */
  function mark(scope, mode) {
    const comments = [...(scope || document).querySelectorAll(SEL.comment)];
    if (!comments.length) return { total: 0, fresh: 0 };

    // No watermark means no previous visit, so nothing is already seen. Folding
    // here would collapse a whole page for a reader who has read none of it.
    const known = !!seenAt;

    // Reading the comments is what sets the watermark, so a reload a moment
    // later is correct to call them all seen - and collapsing the page you were
    // just looking at is still wrong. Inside the window comments are still
    // marked, so anything new is pointed at, but nothing folds.
    const sinceVisit = record && record.a ? Math.floor(Date.now() / 1000) - record.a : Infinity;
    const foldable = known && sinceVisit > SAME_SITTING_S;

    const key = `${seenAt}|${mode}`;
    for (const comment of comments) {
      if (comment.dataset.rrxSeenKey === key) continue;
      comment.dataset.rrxSeenKey = key;
      comment.dataset.rrxNew = known && timeOf(comment) > seenAt ? '1' : '0';
    }

    // Every new comment, and every comment above one: a reply is the likeliest
    // thing to be new, and folding what it answers would hide the question.
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
      const fold = foldable && mode === 'fold' && !showAll && !keep.has(comment) && !busy;
      if (fold) folded += 1;
      comment.classList.toggle(SEEN_CLASS, fold);
      // A new reply can be buried in a collapsed "N more replies" chain, where
      // its own mark is invisible. Flag the owner so the CSS can dot the
      // control; never expand it unasked.
      comment.classList.toggle(
        HAS_NEW_CLASS,
        !isNew && keep.has(comment) && !!comment.querySelector(SEL.commentDeepReplies)
      );
    }

    // What the low-effort rules are suppressing. comments.js applies both
    // classes whether or not "show everything" is on, so these stay countable
    // while the control is pressed, which keeps its label stable.
    //
    // Counted separately: a folded comment is a dimmed line you can open by
    // hovering, a hidden one is gone from the page with nothing to hover, and
    // only the second needs a control to exist at all. `folded` stays out of
    // both - it means "folded for having been read", and mixing the low-effort
    // folds in made the bar claim a watermark date on a chapter nobody had
    // opened, where `new Date(0)` reads as 1 January 1970.
    const lowEffort = document.querySelectorAll('.rrx-comment-thanks').length;
    const hidden = document.querySelectorAll('.rrx-comment-thanks-hidden').length;
    return { total: comments.length, fresh, folded, lowEffort, hidden };
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
   * What the bar says. Only shown when something is new or folded - a
   * first-visit greeting or a "nothing new" line every chapter would just be
   * furniture. How many comments the reader's own rules hid is said on Royal
   * Road's own count line instead - see comments.js.
   *
   * The folded case has to be spelled out and dated: a page that collapses most
   * of its own comments with no explanation looks broken rather than tidied.
   *
   * The date is the newest comment that was here last time, not the date of
   * that visit, and the wording has to say so. Read a chapter on the 16th whose
   * last comment was posted on the 15th and the boundary is the 15th; a comment
   * posted late on the 15th, after the ones that had loaded, is then genuinely
   * new despite the visit being later.
   */
  function label(counts) {
    // Nothing dated without a watermark to date it from.
    if (!seenAt) return counts.hidden ? `${counts.hidden} hidden` : '';

    const when = since();
    if (!counts.fresh) return counts.folded ? `Comments older than ${when} are folded` : '';
    const count = `${counts.fresh} new ${counts.fresh === 1 ? 'comment' : 'comments'} since ${when}`;
    return counts.folded ? `${count} · the rest folded` : count;
  }

  function render(counts) {
    const signature = [seenAt, counts.fresh, counts.folded, counts.lowEffort, counts.hidden, counts.total, onlyNew, showAll].join(
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
          // The date is not the date of the visit, and somebody will
          // reasonably wonder why it is a day early.
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
        // Each folded comment already opens on hover; this is for reading the lot.
        counts.folded || counts.lowEffort || counts.hidden || showAll
          ? ui.toggleButton({
              id: 'showAll',
              // Somebody whose comments are being hidden has nothing on screen
              // to hover, so "Unfold" would name the one case they cannot see.
              label: counts.hidden ? 'Show hidden' : 'Unfold',
              title: counts.hidden
                ? `Show every comment in full for this visit, including the ${counts.hidden} being hidden`
                : 'Show every comment in full for this visit',
              iconName: 'expandAll',
              pressed: showAll,
              onClick: () => {
                showAll = !showAll;
                // Both kinds of folding, not just the one this file owns: a
                // reader who presses "show every comment in full" and still
                // sees "tftc" collapsed is right to call that broken. The
                // low-effort folding lives in comments.js and is driven by CSS,
                // so an <html> class is what reaches it.
                document.documentElement.classList.toggle(SHOW_ALL_CLASS, showAll);
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

    // `#comments-pagination` first: server-rendered, carries the fetch URL, and
    // Royal Road leaves it alone. A chapter with too few comments to need pages
    // has none, so fall back to above the container. Never inside the container
    // - Royal Road's own AJAX replaces that wholesale, with no warning.
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
    // as it is.
    if (!loaded) return;

    resolveSeen(ctx.settings);
    const counts = mark(document, mode);
    const existing = document.getElementById(BAR_ID);
    // Something new to point at, or something folded or hidden to explain; with
    // none of those the bar would only state that nothing has changed.
    // `hidden` is the easy one to forget: a hidden comment is gone from the
    // page, so the bar is the only route back to it, and on an already-read
    // chapter it is the only reason the bar exists. Infinite scroll makes that
    // worse - the first page can be clean while a later one hides plenty.
    if (!counts.fresh && !counts.folded && !counts.lowEffort && !counts.hidden && !showAll) {
      if (existing) existing.remove();
      return;
    }
    render(counts);
  }

  function syncCards(scope, ctx) {
    if (ctx.page !== 'chapter') return;
    const mode = ctx.settings['comments.seen'];
    if (mode === 'off') return;

    // main.js does not wrap syncCards in a try/catch, so a throw here would
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
