'use strict';

/**
 * The reading log: one count per chapter read to the end, and the time spent
 * reading chapter pages, for the dashboard.
 *
 * Read means the chapter's last line has been on screen after a scroll, on a
 * page not opened from a comment link, at least MIN_SHARE of the estimated
 * reading time after the page loaded. Once per page view; a chapter among the
 * recent finishes is not counted again (model.js, `logFinish`).
 *
 * Time is the gaps between the reader's scrolls, keys, clicks and touches
 * while the tab is visible, each capped at IDLE_MS. No timer runs: it is
 * credited when the next input comes, or when the tab is hidden or left.
 *
 * Independent of `chapter.resume`: it reuses resume's measure, not its records.
 * Nothing is written while `history.log` is off.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });

  /** Share of the estimated reading time that must pass before a finish counts.
   *  Loose on purpose: it is there to refuse a skim to the comments, not to
   *  judge reading speed. */
  const MIN_SHARE = 0.2;

  /** A gap longer than this between two inputs counts as this much. One fixed
   *  cap for every reader and chapter: a long paragraph read without scrolling
   *  and a walk away both land on it. The knob to calibrate from real use. */
  const IDLE_MS = 120 * 1000;
  /** Written once this much has built up, so a tab that dies loses at most this. */
  const FLUSH_MS = 60 * 1000;

  /** Snapshot at load, as resume.js does: Royal Road strips the fragment once
   *  the comments load. */
  const deepLink = !!location.hash || location.search.includes('comment=');

  let lastCtx = null;
  let counted = false;
  let listening = false;
  /** performance.now() of the last input while visible; null while hidden. */
  let last = null;
  /** Credited but not yet written, in ms. */
  let pending = 0;

  /** Re-checked at write time: the reader can switch this off in a tab that is
   *  already listening. */
  const on = () => !!lastCtx && !!lastCtx.settings['history.log'];

  function check() {
    if (counted || deepLink || !on()) return;
    const content = RRX.chapterTop && RRX.chapterTop.content();
    if (!content) return;
    const { seenFraction, END_FRACTION } = RRX.resume;
    if (seenFraction(content.getBoundingClientRect()) < END_FRACTION) return;

    const words = RRX.chapterMeta ? RRX.chapterMeta.wordCount() : 0;
    const minutes = words / (lastCtx.settings['chapter.wpm'] || 250);
    // performance.now() is time since this page's navigation started.
    if (root.performance.now() < MIN_SHARE * minutes * 60000) return;

    counted = true;
    Promise.resolve(
      RRX.store.markRead({
        chapterId: RRX.chapterIdFromHref(location.pathname),
        fictionId: RRX.fictionIdFromHref(location.pathname),
        title: RRX.recap ? RRX.recap.fictionTitleIn(document) : '',
        words,
      })
    ).catch((err) => RRX.warn('could not log the chapter', err));
  }

  /** One rect per frame, like resume's handler. */
  let queued = false;
  function onScroll() {
    if (queued || counted) return;
    queued = true;
    root.requestAnimationFrame(() => {
      queued = false;
      check();
    });
  }

  const visible = () => document.visibilityState === 'visible';

  function credit() {
    const now = root.performance.now();
    if (last !== null) pending += Math.min(now - last, IDLE_MS);
    last = now;
  }

  /** Whole seconds only; the remainder waits for the next flush. Dropped rather
   *  than written if the log was switched off meanwhile. */
  function flushTime() {
    const seconds = Math.floor(pending / 1000);
    pending -= seconds * 1000;
    if (!seconds || !on()) return;
    Promise.resolve(RRX.store.addReadingTime(seconds)).catch((err) =>
      RRX.warn('could not log reading time', err)
    );
  }

  function onInput() {
    if (!on() || !visible()) {
      last = null;
      return;
    }
    credit();
    if (pending >= FLUSH_MS) flushTime();
  }

  /** Hidden or left: credit the gap up to now and write. Visible again: the
   *  clock starts from here. */
  function onLeave() {
    if (last !== null && on()) credit();
    last = null;
    flushTime();
  }

  function onVisibility() {
    if (!visible()) onLeave();
    else if (on()) last = root.performance.now();
  }

  function apply(ctx) {
    lastCtx = ctx;
    if (!on() || listening) return;
    listening = true;
    if (visible()) last = root.performance.now();
    root.addEventListener('scroll', onScroll, { passive: true });
    for (const event of ['scroll', 'keydown', 'pointerdown', 'wheel', 'touchstart']) {
      root.addEventListener(event, onInput, { passive: true });
    }
    root.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
  }

  features.list.push({ id: 'readingLog', pages: ['chapter'], onPage: apply });

  RRX.readingLog = { apply, check, MIN_SHARE, IDLE_MS, FLUSH_MS };
})(globalThis);
