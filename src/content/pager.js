'use strict';

/**
 * Infinite scroll for Royal Road's `clientfetch` paginators.
 *
 * Comments and reviews use the same machinery: a `[data-rr-paginate]` root
 * carrying a `data-rr-paginate-fetch-url`, whose responses are a run of
 * `[data-rr-paginate-item]` blocks. Royal Road *replaces* the list with each
 * page, so its "next" moves you forward and loses everything behind, which is
 * the whole reason this exists. We fetch the same URL and append instead.
 *
 * Royal Road's own page controls are hidden once something has been appended,
 * and not before. After an append they are both wrong and a trap: clicking "2"
 * lands you in its replace-the-list world halfway through our run, with the two
 * disagreeing about what page you are on. Before one, they are correct and are
 * the only way through the list, so they stay.
 *
 * Nothing is fetched for a section that is not on screen. A collapsed accordion
 * reports a zero-size box, and a bottom of zero satisfies any "near the end?"
 * test, so an unguarded pager quietly downloads the whole list into something
 * nobody can see.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || RRX.pager) return;

  /** Start fetching when the end of the list is within this much of the viewport. */
  const TRIGGER_MARGIN = 1.5;
  /** A backstop against a broken selector turning into an endless request loop. */
  const MAX_PAGES = 200;

  /**
   * @param {object} options
   * @param {string} options.rootSelector    the `[data-rr-paginate]` element
   * @param {() => Element|null} options.container  where appended items go
   * @param {() => boolean} [options.ready]  false while the list has not loaded yet
   * @param {() => void} [options.prime]     called to make it load, when not ready
   * @param {() => object} [options.params]  query overrides for each fetch
   */
  function create({ rootSelector, container, ready, prime, params }) {
    const state = { next: 2, max: null, busy: false, done: false, started: false, added: 0 };

    const rootEl = () => document.querySelector(rootSelector);

    function maxPage() {
      const el = rootEl();
      const n = el && Number(el.getAttribute('data-rr-paginate-max-page'));
      return Number.isInteger(n) && n > 0 ? n : null;
    }

    function urlFor(page) {
      const el = rootEl();
      const base = el && el.getAttribute('data-rr-paginate-fetch-url');
      if (!base) return null;
      const url = new URL(base, root.location.origin);
      url.searchParams.set('page', String(page));
      // Royal Road's fetch URL carries the ordering it was rendered with, and it
      // does not always rewrite it when the reader changes the sort. Fetching
      // page 2 of the wrong order returns rows that are already on screen: they
      // all deduplicate away, the pager concludes there is nothing left, and
      // stops for good having added nothing. Whoever owns the sort says so here.
      for (const [key, value] of Object.entries((params && params()) || {})) {
        url.searchParams.set(key, String(value));
      }
      return `${url.pathname}${url.search}`;
    }

    /**
     * Suppress Royal Road's own page numbers, but only once we have actually
     * appended something.
     *
     * Hiding them as soon as the feature is switched on takes away the working
     * control and replaces it with nothing: if the trigger never fires, because
     * the panel is collapsed or you simply never scroll that far, the section
     * has no pagination and no auto-loading, which reads as broken. Until the
     * first append Royal Road's numbers are both correct and the only way
     * through, so they stay.
     */
    function hideFooter(on) {
      const el = rootEl();
      if (el) el.classList.toggle('rrx-endless', on);
    }

    async function loadNext() {
      if (state.busy || state.done) return;
      if (state.max === null) state.max = maxPage();
      if (state.max !== null && state.next > state.max) {
        state.done = true;
        return;
      }
      if (state.next > MAX_PAGES) {
        state.done = true;
        return;
      }

      const url = urlFor(state.next);
      const host = container();
      if (!url || !host) return;

      state.busy = true;
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!response.ok) {
          state.done = true;
          return;
        }
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

        // The comments endpoint reports the real page count on its response; the
        // reviews one does not, and takes it from the root instead.
        const pagination = doc.querySelector('[data-rr-paginate-pagination-max]');
        if (pagination) {
          const max = Number(pagination.getAttribute('data-rr-paginate-pagination-max'));
          if (Number.isInteger(max) && max > 0) state.max = max;
        }

        const seen = new Set(
          [...host.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean)
        );
        let added = 0;
        for (const item of doc.querySelectorAll('[data-rr-paginate-item]')) {
          const marker = item.querySelector('[id]');
          if (marker && seen.has(marker.id)) continue; // already appended
          host.appendChild(document.adoptNode(item));
          added += 1;
        }

        if (!added) state.done = true;
        else {
          state.added += added;
          state.next += 1;
        }
        if (state.max !== null && state.next > state.max) state.done = true;

        if (RRX.main) RRX.main.syncCards(document);
      } catch {
        state.done = true;
      } finally {
        state.busy = false;
        hideFooter(state.added > 0);
      }
    }

    function check() {
      if (state.busy || state.done) return;
      if (ready && !ready()) {
        if (prime) prime();
        return;
      }
      const anchor = container() || rootEl();
      if (!anchor) return;

      const box = anchor.getBoundingClientRect();
      // An element with no box is not on screen: it is inside a collapsed
      // accordion, or display:none. Its rect reads as all zeroes, and a bottom
      // of 0 satisfies any "are we near the end?" test, so without this the
      // pager fetches page after page into something nobody can see, from the
      // moment the page loads and without anyone scrolling.
      if (!box.width && !box.height) return;

      if (box.bottom > root.innerHeight * TRIGGER_MARGIN) return;
      loadNext();
    }

    function watch() {
      if (state.started) return;
      state.started = true;
      root.addEventListener('scroll', check, { passive: true });
      root.addEventListener('resize', check, { passive: true });
      if (prime) prime();
      // The list often appears asynchronously, so a scroll listener alone can
      // sit idle forever on a short page.
      const poll = setInterval(() => {
        if (state.done) return clearInterval(poll);
        check();
      }, 800);
      setTimeout(() => clearInterval(poll), 180000);
    }

    /** Sorting changed underneath us: everything loaded so far is stale. */
    function reset() {
      Object.assign(state, { next: 2, max: null, busy: false, done: false, added: 0 });
    }

    return { state, watch, check, loadNext, reset, maxPage, urlFor, hideFooter };
  }

  RRX.pager = { create, MAX_PAGES };
})(globalThis);
