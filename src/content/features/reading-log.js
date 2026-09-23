'use strict';

/**
 * The reading log: one count per chapter read to the end, for the dashboard.
 *
 * Read means the chapter's last line has been on screen after a scroll, on a
 * page not opened from a comment link, at least MIN_SHARE of the estimated
 * reading time after the page loaded. Once per page view; a chapter among the
 * recent finishes is not counted again (model.js, `logFinish`).
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

  /** Snapshot at load, as resume.js does: Royal Road strips the fragment once
   *  the comments load. */
  const deepLink = !!location.hash || location.search.includes('comment=');

  let lastCtx = null;
  let counted = false;
  let listening = false;

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

  function apply(ctx) {
    lastCtx = ctx;
    if (!on() || listening) return;
    listening = true;
    root.addEventListener('scroll', onScroll, { passive: true });
  }

  features.list.push({ id: 'readingLog', pages: ['chapter'], onPage: apply });

  RRX.readingLog = { apply, check, MIN_SHARE };
})(globalThis);
