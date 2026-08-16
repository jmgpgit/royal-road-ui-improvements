'use strict';

/**
 * Come back to where you stopped reading.
 *
 * Royal Road remembers which chapters you have read, and nothing about where in
 * one you were. Close a chapter half way and the next visit starts at the top,
 * which on a four-thousand-word chapter means finding your place by eye.
 *
 * The position is stored relative to a paragraph, never as a pixel offset: the
 * recap arrives after a fetch, the ad slots resolve late, images decode, and the
 * reader's own width and font settings change the height of everything above.
 * A block index survives all of that, because it is measured from something
 * inside the chapter rather than from the top of the document.
 *
 * Nothing is written while the feature is off.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  /** A reader further down than this has already placed themselves. */
  const TOP_PX = 40;
  /** Once this much of the chapter TEXT has been on screen, it has been read. */
  const END_FRACTION = 0.99;
  /** The scroll handler writes to localStorage at most this often. */
  const SAVE_EVERY_MS = 1000;
  /** ...and once more this long after scrolling stops, so the last move lands. */
  const SETTLE_MS = 1500;
  /** A chapter whose text has moved by more than this is treated as rewritten. */
  const EDIT_TOLERANCE = 0.05;

  const chapterId = () => RRX.chapterIdFromHref(location.pathname);
  const fictionId = () => RRX.fictionIdFromHref(location.pathname);

  /** The blocks a position can be expressed against. */
  function blocks() {
    const content = RRX.chapterTop && RRX.chapterTop.content();
    return content ? [...content.children] : [];
  }

  /**
   * Where the reader is.
   *
   * Two measurements, because they answer different questions.
   *
   * `p`/`o` - a block index and a fraction into that block - is what a restore
   * scrolls to. It is expressed against something inside the chapter, so it
   * survives the recap arriving late, images decoding, and the reader's own
   * width and font changing the height of everything.
   *
   * `d` is how much of the chapter has been read, and it is measured
   * GEOMETRICALLY AGAINST THE CHAPTER TEXT ALONE - never the page. The page is
   * the wrong ruler twice over: the comments load after it and make it taller,
   * so the same scroll position means different things a second apart; and the
   * author notes, the About-author panel and the comments are not the chapter,
   * so scrolling through them is not progress through it. A block index is the
   * wrong ruler too - blocks run from one line to a dozen here - which is why
   * "almost at the end" read as a third of the way through.
   *
   * It counts to the BOTTOM of the viewport, so the chapter is done when its
   * last line has been on screen, not when its last line reaches the top.
   *
   * @returns {{p:number,o:number,n:number,len:number,d:number}|null}
   */
  function measure() {
    const content = RRX.chapterTop && RRX.chapterTop.content();
    if (!content) return null;

    const children = [...content.children];
    if (!children.length) return null;

    // The first block whose bottom is still below the top of the viewport is
    // the one being read; anything above it has been passed.
    let index = children.findIndex((el) => el.getBoundingClientRect().bottom > 0);
    if (index < 0) index = children.length - 1;

    const block = children[index].getBoundingClientRect();
    const into = block.height > 0 ? Math.min(1, Math.max(0, -block.top / block.height)) : 0;

    const box = content.getBoundingClientRect();
    const height = box.height || 1;
    const seen = root.innerHeight - box.top;

    return {
      p: index,
      o: Number(into.toFixed(3)),
      n: children.length,
      len: (content.textContent || '').length,
      d: Number(Math.min(1, Math.max(0, seen / height)).toFixed(3)),
      // Has the chapter text itself reached the top of the viewport? Until it
      // has, the reader is still in the hero, the notes or the recap, and
      // `p`/`o` cannot describe where they are: the topmost VISIBLE block is
      // block 0 at offset 0, which means "the start of the chapter" - a place
      // BELOW them. Restoring to it scrolls them forward, which is the one
      // thing a resume must never do.
      started: box.top <= 0,
    };
  }

  /**
   * Worth coming back to?
   *
   * No if the chapter has not been started - see `started` above - and no once
   * it has been finished, because an offer to resume something you have read is
   * noise on every future visit.
   */
  const worthKeeping = (now) => !!now && now.started && now.d < END_FRACTION;

  /** How far through, for the reader. Older records predate `d`. */
  const doneFraction = (record, now) => {
    if (record && Number.isFinite(record.d)) return record.d;
    if (record && record.n) return Math.min(1, record.p / record.n);
    return now && now.n ? Math.min(1, record.p / now.n) : 0;
  };

  /**
   * Has the chapter changed under the saved position?
   *
   * Two signals, because either alone is fooled: a chapter can gain a paragraph
   * without changing length much (a split), or be rewritten in place without
   * changing the count. When they disagree with what was stored, the block index
   * is not trustworthy and the fraction of the whole chapter is used instead.
   */
  function edited(saved, now) {
    if (!saved || !now) return false;
    if (saved.n && now.n && saved.n !== now.n) return true;
    if (!saved.len || !now.len) return false;
    return Math.abs(now.len - saved.len) / saved.len > EDIT_TOLERANCE;
  }

  /** Where to scroll to, in document coordinates. */
  function targetFor(saved, now) {
    const children = blocks();
    if (!children.length) return null;

    if (edited(saved, now)) {
      // Fall back to the same proportion of the chapter, which is vague but
      // honest - better than landing confidently in a scene that moved.
      const content = RRX.chapterTop.content();
      const box = content.getBoundingClientRect();
      const fraction = doneFraction(saved, now);
      return { top: box.top + root.scrollY + box.height * fraction, exact: false };
    }

    const block = children[Math.min(saved.p, children.length - 1)];
    const box = block.getBoundingClientRect();
    return { top: box.top + root.scrollY + box.height * (saved.o || 0), exact: true };
  }

  // --- state ------------------------------------------------------------------

  let saved = null; // the record for this chapter, read once
  let restored = false;
  let userScrolled = false;
  let restoring = false;
  let dirty = null; // the newest measurement not yet flushed to storage.local
  let lastWrite = 0;
  let settleTimer = null;
  let listening = false;

  /**
   * Started at script evaluation rather than in `onPage`, so the record is
   * normally in hand before the reader could have scrolled - the difference
   * between opening where you left off and lurching there a moment later.
   */
  const ready = (async () => {
    if (RRX.pageFromPath(location.pathname) !== 'chapter') return;
    const id = chapterId();
    if (!id) return;
    try {
      const chapters = await RRX.store.loadChapters();
      const scratch = RRX.store.readPositions()[id];
      const record = chapters[id];

      // The scratchpad wins when it is newer: the flush on the way out is
      // best-effort and may not have landed, and this is where it is noticed.
      saved = scratch && (!record || (scratch.a || 0) > (record.a || 0)) ? scratch : record || null;
      if (saved && saved.p === undefined) saved = null;
    } catch {
      saved = null;
    }
  })();

  function remember(now) {
    const id = chapterId();
    if (!id || !now) return;
    dirty = { ...now, f: fictionId() || 0, a: Math.floor(Date.now() / 1000) };
    RRX.store.writePosition(id, dirty);
  }

  /** One write per visit, on the way out. */
  function flush() {
    const id = chapterId();
    if (!id || !dirty) return;
    const patch = dirty;
    dirty = null;
    // Fire and forget: a pagehide handler cannot await, which is exactly why
    // the scratchpad above is written synchronously as well.
    Promise.resolve(RRX.store.markChapter(id, patch)).catch(() => {});
  }

  /**
   * Forget this chapter: it has been read, or never started.
   *
   * Both halves, because they are written at different times - the scratchpad
   * as you scroll, the record on the way out - and a record left behind in
   * either would resume a chapter that is finished.
   */
  function forget(id) {
    dirty = null;
    RRX.store.clearPosition(id);
    Promise.resolve(RRX.store.forgetChapter(id)).catch(() => {});
  }

  function onScroll() {
    if (restoring) return;
    userScrolled = true;

    const now = measure();
    if (!now) return;

    if (!worthKeeping(now)) {
      forget(chapterId());
      return;
    }

    const stamp = Date.now();
    if (stamp - lastWrite >= SAVE_EVERY_MS) {
      lastWrite = stamp;
      remember(now);
    }

    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => remember(measure()), SETTLE_MS);
  }

  function listen() {
    if (listening) return;
    listening = true;
    root.addEventListener('scroll', onScroll, { passive: true });
    // Any deliberate act counts as taking over: opening the recap, or clicking
    // into the page, must stop us re-applying a position over the top of it.
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      root.addEventListener(event, () => {
        userScrolled = true;
      }, { passive: true, once: true });
    }
    // Both, because pagehide can be skipped when a tab is killed and
    // visibilitychange does not fire for every same-tab navigation.
    root.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  /** Next frame if there is one, next tick otherwise: jsdom has no frames. */
  const soon = (fn) =>
    typeof root.requestAnimationFrame === 'function'
      ? root.requestAnimationFrame(fn)
      : setTimeout(fn, 0);

  function scrollTo(top) {
    restoring = true;
    root.scrollTo(0, Math.max(0, Math.round(top)));
    // Cleared on the next frame so our own scroll does not read as the reader's.
    soon(() => {
      restoring = false;
    });
  }

  function announce(exact) {
    ui.toast(
      exact ? 'Resumed where you left off' : 'Resumed (the chapter has changed)',
      'Back to top',
      () => scrollTo(0)
    );
  }

  /**
   * The chip for `ask` mode: offers the jump instead of taking it. Lives in the
   * rail above the chapter, so it cannot cover anything the reader is reading.
   */
  function offer(percent) {
    const chip = ui.el('button', {
      type: 'button',
      id: 'rrx-resume',
      class: 'rrx-ui rrx-resume',
      text: `Resume where you stopped (${percent}%)`,
      onClick: () => {
        const now = measure();
        const target = targetFor(saved, now);
        if (target) scrollTo(target.top);
        RRX.chapterTop.clear(RRX.chapterTop.SLOTS.resume);
      },
    });
    RRX.chapterTop.place(chip, RRX.chapterTop.SLOTS.resume);
  }

  /**
   * Restore, offer, or do neither.
   *
   * Runs at most once per page load. `onPage` re-enters on every settings
   * change, and a second restore would drag the reader back to where they were
   * ten minutes ago.
   */
  function restore(mode) {
    if (restored || userScrolled) return;

    // A link to a specific comment is a request to go somewhere else, and it
    // wins outright. Royal Road's own permalinks are `?comment=N#comment-N`.
    if (location.hash || location.search.includes('comment=')) return;
    if (root.scrollY >= TOP_PX) return;
    if (!saved || saved.p === undefined) return;

    const now = measure();
    if (!now || !now.n) return;

    restored = true;
    const percent = Math.round(doneFraction(saved, now) * 100);
    if (mode === 'ask') {
      offer(percent);
      return;
    }

    const target = targetFor(saved, now);
    if (!target) return;
    scrollTo(target.top);
    announce(target.exact);
  }

  /**
   * The chapter before this one, if the reader got here by finishing it.
   *
   * Clicking Royal Road's own "next chapter" is the one arrival that says the
   * previous chapter is done. Checked against the referrer rather than assumed
   * from the link alone: opening chapter 40 from the table of contents also has
   * a previous chapter, and someone who stopped half way through 39 would lose
   * their place in it for no reason.
   */
  function finishedBefore() {
    const link = document.querySelector(SEL.chapterPrev);
    if (!link) return null;
    const previous = RRX.chapterIdFromHref(link.getAttribute('href') || '');
    if (!previous) return null;
    return RRX.chapterIdFromHref(document.referrer || '') === previous ? previous : null;
  }

  /**
   * Keep the reader on the block they were restored to while the page settles.
   *
   * Everything above the chapter arrives late and at its own pace: the ad slots
   * resolve, images decode, and the recap is fetched, so it can appear a second
   * or more after the restore and push the whole chapter down underneath
   * somebody who is already reading. The saved position survives all of that -
   * it is measured against a paragraph - but the scroll offset that expressed it
   * does not, so it is re-applied whenever the chapter actually moves.
   *
   * Bounded three ways, because a thing that scrolls the page unasked has to be
   * impossible to leave running: it stops at the first sign of the reader doing
   * anything, it stops once the chapter has held still, and it stops after
   * SETTLE_BUDGET_MS whatever happens.
   */
  const SETTLE_BUDGET_MS = 6000;
  const SHIFT_PX = 4;

  function holdPosition() {
    const contentTop = () => {
      const content = RRX.chapterTop && RRX.chapterTop.content();
      return content ? content.getBoundingClientRect().top + root.scrollY : null;
    };

    let was = contentTop();
    let observer = null;
    const stop = () => {
      if (observer) observer.disconnect();
      observer = null;
      clearTimeout(budget);
    };
    const budget = setTimeout(stop, SETTLE_BUDGET_MS);

    const check = () => {
      if (userScrolled || !saved) return stop();
      const now = contentTop();
      if (now === null || Math.abs(now - was) < SHIFT_PX) return;
      was = now;
      const target = targetFor(saved, measure());
      // No toast: the reader was already told once, and this is the same
      // restore being kept rather than a new one.
      if (target) scrollTo(target.top);
    };

    const content = RRX.chapterTop && RRX.chapterTop.content();
    if (content && content.parentElement && typeof root.ResizeObserver === 'function') {
      observer = new root.ResizeObserver(check);
      observer.observe(content.parentElement);
    }
    root.addEventListener('load', check, { once: true });
    return stop;
  }

  function apply(ctx) {
    const mode = ctx.settings['chapter.resume'];
    if (mode === 'off') return;

    const previous = finishedBefore();
    if (previous) forget(previous);

    listen();
    ready.then(() => {
      const before = restored;
      restore(mode);
      // Only for a restore that actually happened, and never for `ask`: there
      // the reader chooses the moment, by which time the page has settled.
      if (!before && restored && mode !== 'ask') holdPosition();
    });
  }

  features.list.push({
    id: 'resume',
    pages: ['chapter'],
    onPage: apply,
  });

  RRX.resume = {
    measure,
    edited,
    targetFor,
    doneFraction,
    worthKeeping,
    finishedBefore,
    restore,
    apply,
    ready,
    flush,
  };
})(globalThis);
