'use strict';

/**
 * Fiction page: force accordions open or shut.
 *
 * Three-state per accordion, not a boolean: Royal Road already opens About,
 * Chapters, Reviews and Recommendations and leaves Statistics closed, so "open
 * by default" did nothing on four of the five.
 *
 * Both directions go through Royal Road's own trigger. Force a panel open in CSS
 * and the first click to close does nothing, because the site still thinks it is
 * shut. Its handlers bind in a deferred module script that then applies its
 * remembered state, so a click before that lands is swallowed and one during it
 * is overwritten. Fixed retries lose that race; this watches for a short window
 * and re-asserts whenever the state settles wrong.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, FICTION_ACCORDIONS } = RRX;

  /**
   * How long to keep insisting. The whole window is used with no early exit:
   * Royal Road server-renders some panels in the state you asked for and then
   * changes its mind when its deferred script initialises, so stopping at the
   * first correct reading stops just before the moment that mattered.
   */
  const ENFORCE_MS = 8000;
  const POLL_MS = 250;

  const DONE_ATTR = 'data-rrx-accordion';

  /** Accordions the reader has touched themselves; we stop fighting those. */
  const userTouched = new Set();
  /**
   * The state each accordion's loop is insisting on. `onPage` runs again on every
   * settings change; without this a second loop starts on top of the first and the
   * two flap the panel open and shut every 250ms. Storing the wanted state rather
   * than a bare "busy" flag lets a changed setting take over a running loop.
   */
  const watching = new Map();

  const triggerOf = (accordion) => accordion.querySelector(SEL.accordionTrigger);
  const isOpen = (trigger) => trigger.getAttribute('aria-expanded') === 'true';

  /**
   * @param {string} id accordion element id
   * @param {'open'|'closed'} want
   */
  function setAccordion(id, want) {
    const accordion = document.getElementById(id);
    // Absent is normal: "Leave A Review" only renders when logged in.
    if (!accordion || userTouched.has(id)) return;
    if (watching.get(id) === want) return;
    // A loop may be running for the other state; recording the new answer first
    // makes it stand down on its next tick, so only one is ever clicking.
    watching.set(id, want);

    const trigger = triggerOf(accordion);
    if (!trigger) return;

    // A real click from the reader wins from then on.
    if (!accordion.dataset.rrxWatched) {
      accordion.dataset.rrxWatched = '1';
      trigger.addEventListener('click', (event) => {
        if (event.isTrusted) userTouched.add(id);
      });
    }

    const deadline = Date.now() + ENFORCE_MS;

    const tick = () => {
      const live = document.getElementById(id);
      if (!live || userTouched.has(id)) return;
      // A later call asked for the opposite; that loop owns this accordion now.
      if (watching.get(id) !== want) return;
      const t = triggerOf(live);
      if (!t) return;

      if (isOpen(t) === (want === 'open')) {
        live.setAttribute(DONE_ATTR, want);
      } else {
        // Wrong again: Royal Road's script has just re-applied its own state.
        live.removeAttribute(DONE_ATTR);
        t.click();
      }

      if (Date.now() < deadline) setTimeout(tick, POLL_MS);
    };

    tick();
  }

  /**
   * "About Fiction" holds a show-more block, not a plain panel: open and closed
   * mean the description expanded or clamped to its first few lines. Collapsing
   * the section itself just leaves an empty box.
   *
   * Insisted on for the same window as the accordions - the show-more is also set
   * up in a deferred script that applies its own remembered state, so checking the
   * box once at document_end only won when that script happened to run first.
   *
   * @param {'open'|'closed'} want
   */
  function setAbout(want) {
    const ID = 'about';
    if (userTouched.has(ID) || watching.get(ID) === want) return;
    watching.set(ID, want);

    const shouldCheck = want === 'open';
    const boxOf = () => document.querySelector(`${SEL.aboutAccordion} ${SEL.showMoreRoot}`);
    const checkboxOf = () => {
      const box = boxOf();
      return box && box.querySelector('input[type="checkbox"]');
    };

    const deadline = Date.now() + ENFORCE_MS;

    const tick = () => {
      const checkbox = checkboxOf();
      // Absent is normal early on: the section renders before its show-more is
      // initialised.
      if (checkbox && !userTouched.has(ID)) {
        // A later call asked for the opposite; that loop owns this now.
        if (watching.get(ID) !== want) return;

        if (!checkbox.dataset.rrxWatched) {
          checkbox.dataset.rrxWatched = '1';
          // A real click on the show-more wins from then on.
          checkbox.addEventListener('change', (event) => {
            if (event.isTrusted) userTouched.add(ID);
          });
        }

        if (checkbox.checked !== shouldCheck) {
          checkbox.checked = shouldCheck;
          // Royal Road's styling comes from :has(input:checked), so nothing else
          // needs telling; the event is only for anything that happens to listen.
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      if (Date.now() < deadline) setTimeout(tick, POLL_MS);
    };

    tick();
  }

  /** Show or hide the recommendations section outright. */
  function setRecommendations(want) {
    if (want === 'leave') return;
    const section = document.querySelector(SEL.recommendationsAccordion);
    if (section) section.classList.toggle('rrx-note-hidden', want === 'hide');
  }

  /** Royal Road always opens reviews sorted by "Top". Picking its own dropdown
   *  item routes the re-sort through Royal Road's handler, not around it - and
   *  through our own click listener, which restarts the pager in the new order.
   *  `rrxSorted` stops it clicking again on every settings change. */
  function setReviewSort(want) {
    if (want === 'leave' || reviewPager.sorting() === want) return;
    const dropdown = document.querySelector(SEL.reviewSortDropdown);
    if (!dropdown || dropdown.dataset.rrxSorted === want) return;

    const item = [...dropdown.querySelectorAll(SEL.dropdownItem)].find(
      (el) => el.getAttribute('data-rr-dropdown-option-value') === want
    );
    if (!item) return;
    dropdown.dataset.rrxSorted = want;
    item.click();
  }

  /** Reviews paginate exactly like comments, so they share the pager. */
  /** The sort hook is attached once, from `onPage`. */
  let sortHooked = false;

  const reviewPager = RRX.pager.create({
    rootSelector: SEL.reviewsPaginate,
    container: () => document.querySelector(SEL.reviewsContainer),
    sortDropdown: SEL.reviewSortDropdown,
  });

  features.list.push({
    id: 'fictionPage',
    pages: ['fiction'],
    /** The re-sort watch has to be here rather than in `onPage`: a reader
     *  changing Royal Road's own sort order never re-enters `onPage`, which runs
     *  at init and on a settings change only. In `onPage` it could only ever
     *  see a run that had not started yet, so it did nothing at all. */
    syncCards: (scope, ctx) => {
      // `owed` keeps this trying on later sweeps: one attempt is not enough,
      // because the container is not always there the instant the list is
      // swapped, and a `loadNext` that finds nothing arranges nothing.
      const restarted = reviewPager.noticeReplacement();
      if ((restarted || reviewPager.owed()) && ctx.settings['fiction.reviewsAutoLoad']) {
        reviewPager.loadNext();
      }
    },
    onPage: (ctx) => {
      // Once. Royal Road's review sort is a dropdown of the same shape as the
      // comment one, so the same hook serves both.
      if (!sortHooked) {
        sortHooked = true;
        RRX.pager.restartOnSort(reviewPager, SEL.reviewSortDropdown);
      }

      for (const [id, key] of Object.entries(FICTION_ACCORDIONS)) {
        const want = ctx.settings[key];
        if (want === 'open' || want === 'closed') setAccordion(id, want);
      }

      const about = ctx.settings['fiction.about'];
      if (about !== 'leave') setAbout(about);

      setRecommendations(ctx.settings['fiction.recommendations']);

      // Sort first, or extra pages load in the old order and the list ends up mixed.
      setReviewSort(ctx.settings['fiction.reviewSort']);
      if (ctx.settings['fiction.reviewsAutoLoad']) reviewPager.watch();
    },
  });

  RRX.fictionPage = {
    setAccordion,
    setAbout,
    setRecommendations,
    setReviewSort,
    reviewPager,
    userTouched,
    watching,
  };
})(globalThis);
