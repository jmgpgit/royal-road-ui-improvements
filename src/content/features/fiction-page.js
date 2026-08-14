'use strict';

/**
 * Fiction page: force accordions open or shut.
 *
 * Three-state per accordion, because a boolean was the wrong shape. Royal Road
 * already opens About, Chapters, Reviews and Recommendations and leaves
 * Statistics closed, so "open by default" did nothing on four of the five.
 *
 * Both directions go through Royal Road's own trigger rather than forcing the
 * panel with CSS: force it open in CSS and the first click to close does
 * nothing, because the site still thinks it is shut.
 *
 * The hard part is timing. Royal Road binds its accordion handlers in a deferred
 * module script and then applies its own remembered state, so a click dispatched
 * before that lands is swallowed, and one dispatched during it is overwritten.
 * A fixed number of quick retries loses that race. Instead this watches for a
 * short window and re-asserts whenever the state settles wrong, then stops.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, FICTION_ACCORDIONS } = RRX;

  /**
   * How long to keep insisting before accepting Royal Road's answer.
   *
   * The whole window is used, with deliberately no early exit once the state
   * looks right. Royal Road server-renders some panels in the state you asked
   * for and then changes its mind when its deferred script initialises, so a
   * watcher that stops at the first correct reading stops just before the only
   * moment that mattered.
   */
  const ENFORCE_MS = 8000;
  const POLL_MS = 250;

  const DONE_ATTR = 'data-rrx-accordion';

  /** Accordions the reader has touched themselves; we stop fighting those. */
  const userTouched = new Set();
  /**
   * The state each accordion's running loop is currently insisting on.
   *
   * `onPage` runs again on every settings change, so without this a second loop
   * starts on top of the first. Two loops with different answers click the same
   * trigger every 250ms for the rest of the window, flapping the panel open and
   * shut. Recording the wanted state rather than a bare "busy" flag is what
   * lets a changed setting take over a running loop instead of racing it.
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
    // Already insisting on exactly this: nothing to do.
    if (watching.get(id) === want) return;
    // A loop may be running for the *other* state. Recording the new answer
    // first makes that one stand down on its next tick, so only one is ever
    // clicking.
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

      // Keep watching for the whole window regardless of how it looks now.
      if (Date.now() < deadline) setTimeout(tick, POLL_MS);
    };

    tick();
  }

  /**
   * "About Fiction" holds a show-more block rather than a plain panel, so open
   * and closed mean the description expanded or clamped to its first few lines.
   * Collapsing the section itself just leaves an empty box.
   *
   * Insisted on for the same window as the accordions, and for the same reason:
   * Royal Road initialises this control in a deferred script and applies its own
   * remembered state. Setting the checkbox once at document_end wins the race
   * only when that script happens to run first, so "always open" appeared to
   * work sometimes and not others.
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
      // initialised, so keep looking rather than giving up.
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
          // Royal Road's styling is driven by :has(input:checked), so nothing
          // else needs telling, but fire the event in case anything listens.
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

  /**
   * The ordering the reader asked for, or '' while Royal Road's own is in use.
   * The pager reads it: see the `params` hook below.
   */
  let sortInUse = '';

  /**
   * Royal Road always opens reviews sorted by "Top". This picks its own item out
   * of the site's sort dropdown, so the re-sort goes through Royal Road's own
   * handler rather than being faked underneath it.
   */
  function setReviewSort(want) {
    if (want === 'leave') return;
    sortInUse = want;
    const paginate = document.querySelector(SEL.reviewsPaginate);
    const current = paginate && paginate.getAttribute('data-rr-paginate-fetch-url');
    if (current && current.includes(`sorting=${want}`)) return; // already there
    const dropdown = document.querySelector(SEL.reviewSortDropdown);
    if (!dropdown || dropdown.dataset.rrxSorted === want) return;

    const item = [...dropdown.querySelectorAll(SEL.dropdownItem)].find(
      (el) => el.getAttribute('data-rr-dropdown-option-value') === want
    );
    if (!item) return;
    dropdown.dataset.rrxSorted = want;
    item.click();
    // Everything the pager appended was in the old order.
    reviewPager.reset();
  }

  /**
   * Reviews paginate exactly like comments, so they share the pager.
   *
   * The ordering has to be passed explicitly. Royal Road leaves its own
   * `data-rr-paginate-fetch-url` on whatever the page was rendered with, so
   * after a re-sort the pager would ask for page 2 of the *old* order. On a
   * fiction with few reviews that page is entirely rows already on screen: they
   * deduplicate away, the pager sees nothing added, and stops for good.
   */
  const reviewPager = RRX.pager.create({
    rootSelector: SEL.reviewsPaginate,
    container: () => document.querySelector(SEL.reviewsContainer),
    params: () => (sortInUse ? { sorting: sortInUse } : {}),
  });

  features.list.push({
    id: 'fictionPage',
    pages: ['fiction'],
    onPage: (ctx) => {
      for (const [id, key] of Object.entries(FICTION_ACCORDIONS)) {
        const want = ctx.settings[key];
        if (want === 'open' || want === 'closed') setAccordion(id, want);
      }

      const about = ctx.settings['fiction.about'];
      if (about !== 'leave') setAbout(about);

      setRecommendations(ctx.settings['fiction.recommendations']);

      // Sort first: re-sorting after loading extra pages would leave the list
      // half in one order and half in another.
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
