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
  /** The list often appears asynchronously, so scroll events alone can sit idle
   *  forever on a short page. */
  const POLL_MS = 800;
  const POLL_WINDOW_MS = 180000;

  /**
   * @param {object} options
   * @param {string} options.rootSelector    the `[data-rr-paginate]` element
   * @param {() => Element|null} options.container  where appended items go
   * @param {() => boolean} [options.ready]  false while the list has not loaded yet
   * @param {() => void} [options.prime]     called to make it load, when not ready
   * @param {string} [options.sortDropdown]  Royal Road's own order dropdown
   */
  function create({ rootSelector, container, ready, prime, sortDropdown }) {
    const state = { next: 2, max: null, busy: false, done: false, started: false, added: 0 };
    /** Bumped by `reset`, so a fetch started before it can tell it is stale. */
    let run = 0;
    /** A restarted run owes the reader a page wherever they happen to be: they
     *  were already deep in this list before Royal Road replaced it, so the
     *  trigger geometry - which exists to stop the pager downloading a list
     *  nobody has scrolled to - has nothing left to protect. Held until a page
     *  actually lands, because one attempt can quietly do nothing: the container
     *  is not always there the instant the list is swapped. */
    let owed = false;
    /** A signature of the list we are waiting for Royal Road to replace, or null
     *  when we are not waiting. See `restart`. */
    let awaiting = null;
    /** The container element itself, so a wholesale replacement counts as a
     *  change even when the rows in it happen to look the same. */
    let awaitingHost = null;
    /** The order the reader picked, from their own click or from Royal Road's
     *  `rr-dropdown-change`. See `sorting`. */
    let sort = '';
    let pollTimer = null;
    let pollDeadline = null;

    const rootEl = () => document.querySelector(rootSelector);

    /**
     * The order to ask for, which is not the one on the fetch URL.
     *
     * Royal Road's paginator reads `data-rr-paginate-fetch-url` once, in its
     * constructor, into a `fetchUrl` property. A re-sort assigns that property
     * (`fetchUpdateUrlAndHook`) and never writes the attribute back, so from the
     * first re-sort onwards the attribute describes an order nobody is looking
     * at. Asking for page two of it returns rows already on screen, they all
     * deduplicate away, `added` is zero and the run stops - the list cuts off
     * and the page numbers come back.
     *
     * The reader's own choice is used instead, falling back to the dropdown
     * before they have made one.
     */
    function sorting() {
      return sort || (sortDropdown ? sortFrom(sortDropdown) : '');
    }

    /** The page Royal Road says it is showing. The reader may have arrived on
     *  page five through its own pagination, or been left on page two by a
     *  re-sort; ours is always the one after whatever is actually on screen. */
    function currentPage() {
      const el = rootEl();
      const n = el && Number(el.getAttribute('data-rr-paginate-current-page'));
      return Number.isInteger(n) && n > 0 ? n : 1;
    }

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
      const order = sorting();
      if (order) url.searchParams.set('sorting', order);
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
      // Before anything of ours is on screen, the next page is whatever follows
      // the one Royal Road is showing - not page two. Assuming page two meant a
      // reader on page five refetched page two, or a reader on page two
      // refetched the page they were already looking at: every row deduplicated
      // away, `added` came out zero, and the run ended before it began. Only
      // while `added` is zero, because after that Royal Road's number describes
      // the page it rendered, not the ones we have appended since.
      if (!state.added) state.next = currentPage() + 1;
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
      // Comments are `data-rr-paginate-lazy-load="true"`: until they are loaded
      // there is no container at all, only a "Load Comments" button, and after a
      // re-sort Royal Road can put the section back in exactly that state. Only
      // `check` used to press that button, so a restart driven from here found
      // nothing, returned, and waited for a scroll that had no reason to come.
      // `owed` is deliberately left set, so the next sweep tries again.
      if (!host) {
        if (prime) prime();
        return;
      }
      if (!url) return;

      // Which run this fetch belongs to. `reset` bumps it, so a response that
      // was already in the air when the list was swapped underneath us is
      // dropped rather than appended into a container that is no longer on the
      // page - which also left the restarted run believing it held a page it
      // never showed.
      const generation = run;
      const mine = () => generation === run;

      // The debt is discharged by *starting* a fetch, not by finishing one: the
      // reader is owed the page they were already scrolled past, not every page.
      // Cleared here rather than on success so that an attempt which quietly did
      // nothing - no container yet, the list still being swapped - is retried,
      // while a real fetch hands the list back to the trigger geometry.
      owed = false;
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

        // Like against like: the identifying id of each item already on screen,
        // against the identifying id of each item arriving. Every id in the
        // container was far too broad - a comment's reply tree, a tooltip, a
        // rating widget all carry ids of their own, and any one of them
        // colliding with an incoming item's marker dropped that item with no
        // trace. A review going missing from a re-sorted list was this.
        const markerOf = (item) => {
          const el = item.querySelector('[id]');
          return el ? el.id : '';
        };
        const seen = new Set(
          [...host.querySelectorAll('[data-rr-paginate-item]')].map(markerOf).filter(Boolean)
        );
        let added = 0;
        for (const item of doc.querySelectorAll('[data-rr-paginate-item]')) {
          const marker = markerOf(item);
          if (marker && seen.has(marker)) continue; // already appended
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

    /** Restartable, unlike the old inline one: it cleared itself for good the
     *  moment a run finished, so a run restarted after a re-sort had nothing
     *  left retrying for it and depended entirely on the reader scrolling. */
    function startPoll() {
      if (pollTimer) clearInterval(pollTimer);
      if (pollDeadline) clearTimeout(pollDeadline);
      const stop = () => {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      };
      pollTimer = setInterval(() => (state.done ? stop() : check()), POLL_MS);
      pollDeadline = setTimeout(stop, POLL_WINDOW_MS);
    }

    function watch() {
      if (state.started) return;
      state.started = true;
      root.addEventListener('scroll', check, { passive: true });
      root.addEventListener('resize', check, { passive: true });
      if (prime) prime();
      startPoll();
    }

    /** Every row, not a count and a first id. Page one of two different orders
     *  has the same number of rows, and can easily open on the same comment -
     *  the top comment often is the newest - so the short version could not tell
     *  the two apart, and a restart that could not see the list change never
     *  started. Every id is cheap: this runs on a sweep, over one page. */
    function listSignature() {
      const host = container();
      if (!host) return '';
      return [...host.querySelectorAll('[data-rr-paginate-item]')]
        .map((item) => {
          const marker = item.querySelector('[id]');
          return marker ? marker.id : '';
        })
        .join(',');
    }

    /**
     * Start over, because the reader asked for a different order.
     *
     * Driven by their click rather than inferred afterwards, which is what makes
     * it reliable: everything we appended is thrown away here and now, so it
     * cannot be left stranded under Royal Road's new page one if Royal Road only
     * clears the rows it rendered itself.
     *
     * Then it waits. Royal Road fetches page one of the new order, and until
     * that lands the fetch URL still describes the old one - so restarting
     * immediately would ask for page two of the order the reader just abandoned.
     * `owed` is granted once the list has visibly changed underneath us.
     */
    function restart() {
      const host = container();
      if (host) for (const item of host.querySelectorAll('[data-rrx-appended]')) item.remove();
      reset();
      hideFooter(false); // its page numbers are true again, until we append
      owed = false;
      awaitingHost = container();
      awaiting = listSignature();
    }

    /** The reader picked an order. Ignored when it is the one already in use:
     *  Royal Road re-renders the same page, so the signature `restart` waits on
     *  never changes and the run would sit waiting for a swap that already
     *  happened. */
    function resort(chosen) {
      if (!chosen || chosen === sorting()) return;
      sort = chosen;
      restart();
    }

    /** Whether a restarted run is still owed its first page. Resolves the wait
     *  above as a side effect, so the sweep only has to ask this one question. */
    function owedNow() {
      if (awaiting !== null) {
        // Still the list we were told to abandon: Royal Road has not finished.
        if (container() === awaitingHost && listSignature() === awaiting) return false;
        awaiting = null;
        awaitingHost = null;
        owed = true;
      }
      return owed;
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
      hideFooter(false); // its page numbers are true again, until we append
      owed = true;
      return true;
    }

    return {
      state,
      watch,
      check,
      loadNext,
      reset,
      noticeReplacement,
      restart,
      resort,
      sorting,
      /** A restart that has not yet managed to start a fetch. The sweep retries
       *  it: one `loadNext` is not enough, because the container is not always
       *  there the instant Royal Road swaps the list, and an attempt that finds
       *  nothing arranges nothing. No timer of its own - the sweep already runs
       *  on every mutation, and a re-sorted page makes plenty. */
      owed: owedNow,
      maxPage,
      urlFor,
      hideFooter,
    };
  }

  /**
   * The order a dropdown was rendered with. Only good until the reader picks
   * something else - see `sorting` - so it is the fallback, not the source.
   *
   * The two advertise it differently: the comment one keeps
   * `data-rr-dropdown-value` on the root and marks its option with
   * `data-rr-dropdown-selected`; the reviews one leaves the root empty and marks
   * only `aria-selected`.
   */
  function sortFrom(selector) {
    const dropdown = document.querySelector(selector);
    if (!dropdown) return '';
    const value = dropdown.getAttribute('data-rr-dropdown-value');
    if (value) return value;
    const chosen = dropdown.querySelector(
      '[data-rr-dropdown-item][aria-selected="true"], [data-rr-dropdown-item][data-rr-dropdown-selected="true"]'
    );
    return (chosen && chosen.getAttribute('data-rr-dropdown-option-value')) || '';
  }

  /** Royal Road's sort orders, across both lists. Used to tell a sort control
   *  apart from any other dropdown, since the comment one carries no id we can
   *  key on. */
  const SORT_VALUES = ['top', 'newest', 'oldest', 'upvotes'];

  /**
   * Tell `pager` which order the reader picked, and start it over.
   *
   * Two sources, because neither covers the other. The click is captured at the
   * document so it runs before Royal Road's handler, while our appended rows are
   * still there to be removed. `rr-dropdown-change` is Royal Road's own event -
   * it builds its new fetch URL from the very `detail.value` read here - and it
   * is the only one a keyboard selection fires.
   *
   * @param {string} selector Royal Road's order dropdown for this pager
   */
  function restartOnSort(pager, selector) {
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        const item = target.closest('[data-rr-dropdown-item][data-rr-dropdown-option-value]');
        if (!item) return;
        const value = item.getAttribute('data-rr-dropdown-option-value');
        // Not scoped with `closest(selector)`: Royal Road's dropdowns can portal
        // their content out of the element. The value list is what tells a sort
        // control apart, and the two pagers live on different pages anyway.
        if (SORT_VALUES.includes(value)) pager.resort(value);
      },
      true
    );
    const dropdown = selector && document.querySelector(selector);
    if (dropdown) {
      dropdown.addEventListener('rr-dropdown-change', (event) => {
        pager.resort(event.detail && event.detail.value);
      });
    }
  }

  RRX.pager = { create, restartOnSort, sortFrom, MAX_PAGES, SORT_VALUES };
})(globalThis);
