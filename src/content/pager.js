'use strict';

/**
 * Infinite scroll for Royal Road's `clientfetch` paginators.
 *
 * Comments and reviews share one mechanism: a `[data-rr-paginate]` root carrying
 * `data-rr-paginate-fetch-url`, whose responses are a run of
 * `[data-rr-paginate-item]` blocks. Royal Road replaces the list with each page,
 * losing everything behind it; we fetch the same URL and append instead.
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
    /** Bumped by `reset`, so a fetch started before it can tell it is stale. */
    let run = 0;

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
      // The fetch URL carries the ordering it was rendered with, and Royal Road
      // does not always rewrite it when the reader changes the sort. Page 2 of
      // the wrong order returns rows already on screen: they all deduplicate
      // away and the pager stops for good, having added nothing.
      for (const [key, value] of Object.entries((params && params()) || {})) {
        url.searchParams.set(key, String(value));
      }
      return `${url.pathname}${url.search}`;
    }

    /** Royal Road's page numbers go away only once something has been appended.
     *  After an append they are a trap: clicking "2" drops you into its
     *  replace-the-list world halfway through our run. Before one they are
     *  correct and the only way through, and hiding them early leaves a section
     *  with no pagination and no auto-loading whenever the trigger never fires -
     *  collapsed panel, or never scrolled that far. */
    function hideFooter(on) {
      const el = rootEl();
      // Compared before writing: `check` calls this on every scroll event.
      if (el && el.classList.contains('rrx-endless') !== on) el.classList.toggle('rrx-endless', on);
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

      // Which run this fetch belongs to. `reset` bumps it, so a response that
      // was already in the air when the list was swapped underneath us is
      // dropped rather than appended into a container that is no longer on the
      // page - which also left the restarted run believing it held a page it
      // never showed.
      const generation = run;
      const mine = () => generation === run;

      state.busy = true;
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!mine()) return;
        if (!response.ok) {
          state.done = true;
          return;
        }
        const text = await response.text();
        if (!mine()) return;
        const doc = new DOMParser().parseFromString(text, 'text/html');

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
          // Marked so a replacement can be noticed: see `noticeReplacement`.
          item.setAttribute('data-rrx-appended', '1');
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
        if (mine()) state.done = true;
      } finally {
        // Never the new run's flags: `reset` has already cleared them.
        if (mine()) {
          state.busy = false;
          hideFooter(state.added > 0);
        }
      }
    }

    function check() {
      // Re-assert rather than trust the one write in `loadNext`: Royal Road's
      // pagination re-renders on its own account and takes the class with it.
      // Once every page is in, `state.done` is true and no load ever runs
      // again to put the numbers away, so the reappearance would be permanent.
      if (state.added > 0) hideFooter(true);
      if (state.busy || state.done) return;
      if (ready && !ready()) {
        if (prime) prime();
        return;
      }
      const anchor = container() || rootEl();
      if (!anchor) return;

      const box = anchor.getBoundingClientRect();
      // No box means not on screen: collapsed accordion, or display:none. The
      // rect reads all zeroes, and a bottom of 0 satisfies the "near the end?"
      // test, so without this the pager downloads the whole list on page load,
      // into something nobody can see, without anyone scrolling.
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
      // The list often appears asynchronously, so scroll events alone can sit
      // idle forever on a short page.
      const poll = setInterval(() => {
        if (state.done) return clearInterval(poll);
        check();
      }, 800);
      setTimeout(() => clearInterval(poll), 180000);
    }

    /** Sorting changed underneath us: everything loaded so far is stale. */
    function reset() {
      run += 1;
      Object.assign(state, { next: 2, max: null, busy: false, done: false, added: 0 });
    }

    /**
     * Notice when Royal Road has replaced the list under us, and start over.
     *
     * Changing the comment sort makes it refetch page one and swap the
     * container's contents, taking every page we appended with it. Our counters
     * know nothing about that: `next` is still deep into the run and `done` is
     * set once the last page has been seen, so nothing ever loads again and the
     * rest of the comments are simply gone. Reported as "resort and the rest
     * disappear, and infinite scroll stops working".
     *
     * Detected by absence rather than by watching the sort, so it holds for any
     * reason Royal Road swaps the list - a sort, a mode toggle, whatever it adds
     * next - and whether the reader did it or we did.
     *
     * @returns {boolean} whether the run was restarted
     */
    function noticeReplacement() {
      if (!state.added) return false;
      const host = container();
      if (!host || host.querySelector('[data-rrx-appended]')) return false;
      reset();
      hideFooter(false); // its page numbers are true again
      return true;
    }

    return { state, watch, check, loadNext, reset, noticeReplacement, maxPage, urlFor, hideFooter };
  }

  RRX.pager = { create, MAX_PAGES };
})(globalThis);
