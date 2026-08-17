'use strict';

/**
 * Infinite scroll for the fiction lists: reaching the bottom fetches the next
 * page and appends it, filter on or not. Cards go through the filters and the
 * hidden list on the way in, so an appended page obeys the same rules as the
 * one Royal Road served.
 *
 * The limits below are constants, not settings; politeness to someone else's
 * servers is not a preference. One request at a time with a gap, a page ceiling
 * so a broken selector cannot loop, a stop on the first page that yields
 * nothing new or on any non-200, and a status line that always says how much
 * was scanned so the ceiling cannot read as "that is everything".
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  const BAR_ID = 'rrx-loadmore';

  const MAX_PAGES = 25;
  /** Consecutive pages matching nothing before the status line offers a reason.
   *  It does not stop the run: the whole point of scanning ahead is that the one
   *  match can be on page five, and giving up at four would guarantee never
   *  finding it. */
  const DRY_PAGES = 4;
  const REQUEST_GAP_MS = 500;
  /** Fetch when the list's end is within this many viewport heights. */
  const TRIGGER_MARGIN = 1.5;

  const state = { pages: 0, added: 0, dry: 0, busy: false, done: '', error: '', watching: false };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function pageUrl(pageNum) {
    const url = new URL(root.location.href);
    url.searchParams.set('page', String(pageNum));
    return url.toString();
  }

  function currentPage() {
    const fromUrl = Number(new URL(root.location.href).searchParams.get('page'));
    if (Number.isInteger(fromUrl) && fromUrl > 0) return fromUrl;
    const el = document.querySelector(SEL.paginateRoot);
    const attr = el && Number(el.getAttribute('data-rr-paginate-current-page'));
    return Number.isInteger(attr) && attr > 0 ? attr : 1;
  }

  function maxPage() {
    const el = document.querySelector(SEL.paginateRoot);
    const n = el && Number(el.getAttribute('data-rr-paginate-max-page'));
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /** Is there anything left to fetch? */
  function eligible(ctx) {
    if (!ctx.isListPage || !ctx.settings['list.infiniteScroll']) return false;
    const last = maxPage();
    return last === null || currentPage() + state.pages < last;
  }

  async function fetchNextPage(ctx) {
    if (state.busy || state.done || state.error) return;
    if (state.pages >= MAX_PAGES) {
      state.done = `stopped at ${MAX_PAGES} pages`;
      render(ctx);
      return;
    }

    state.busy = true;
    render(ctx);

    const page = currentPage() + state.pages + 1;
    try {
      await sleep(REQUEST_GAP_MS);
      const response = await fetch(pageUrl(page), { credentials: 'same-origin' });
      if (!response.ok) {
        state.error = `Royal Road returned ${response.status}`;
        return;
      }

      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const cards = [...doc.querySelectorAll(SEL.listCard)];
      state.pages += 1;
      if (!cards.length) {
        state.done = 'no more results';
        return;
      }

      // The next page's chips may name tags the vocabulary has not seen yet.
      if (RRX.tags) RRX.tags.harvestChips(doc);

      const container =
        document.querySelector(`${SEL.listRoot} [data-rr-paginate-item]`) ||
        document.querySelector(SEL.listRoot);
      if (!container) return;

      let addedNow = 0;
      for (const card of cards) {
        const adopted = document.adoptNode(card);
        const data = RRX.readCardData(adopted);
        // Ours rather than Royal Road's, so nothing on the card can carry it:
        // without this, "Hide mine -> Dropped" let every dropped fiction in and
        // counted it, and list-filters hid it again a moment later.
        data.mine.dropped = ctx.droppedSet ? ctx.droppedSet.has(data.id) : false;
        if (!RRX.matchesFilters(data, ctx.settings)) continue;
        if (ctx.hiddenSet.has(data.id)) continue;
        container.appendChild(adopted);
        addedNow += 1;
      }
      state.added += addedNow;
      state.dry = addedNow ? 0 : state.dry + 1;

      // Let the normal pipeline decorate what was just appended.
      RRX.main.syncCards(document);
    } catch (err) {
      state.error = err.message || 'request failed';
    } finally {
      state.busy = false;
      render(ctx);
    }
  }

  function watch(ctx) {
    if (state.watching) return;
    state.watching = true;

    const check = () => {
      // Flags first: `eligible` parses a URL and queries the document, on every
      // scroll event.
      if (state.busy || state.done || state.error || !eligible(ctx)) return;
      const list = document.querySelector(SEL.listRoot);
      if (!list) return;
      const box = list.getBoundingClientRect();
      if (box.bottom <= root.innerHeight * TRIGGER_MARGIN) fetchNextPage(ctx);
    };

    root.addEventListener('scroll', check, { passive: true });
    root.addEventListener('resize', check, { passive: true });
    // A short filter can leave the whole list above the fold, and then no
    // scroll ever fires.
    setTimeout(check, 300);
  }

  /**
   * Hides Royal Road's page numbers, but only after the first append: until
   * then the footer is accurate and the quickest way to jump deep into a list.
   * Once we have appended it claims "Showing 1 to 20 of 25090" over five pages
   * of results, and its links hand you to Royal Road's replace-the-list
   * pagination, which disagrees with us about where you are. Setting a class to
   * the value it already holds emits no mutation record, so this can run on
   * every sweep without feeding the observer.
   */
  function syncPaginator() {
    const paginate = document.querySelector(SEL.paginateRoot);
    // `added`, not `pages`, which is what the paragraph above describes and what
    // the code said for a while. A page fetched and filtered away entirely adds
    // nothing to the list but still counted, so a filter matching nothing took
    // Royal Road's page numbers away and left an empty list with no way on.
    if (paginate) paginate.classList.toggle('rrx-endless', state.added > 0);
  }

  /** How many tags the reader has filtered site-wide, off the badge on Royal
   *  Road's own button. Theirs rather than Royal Road's: the dialog reads
   *  "Customize your experience by including or excluding tags across the
   *  entire site", and signed out only "You must be logged in to use global
   *  tag filters".
   *
   *  The button itself is on the list pages either way - it is in the signed-out
   *  captures - so its presence says nothing. Only the badge does, and it is
   *  there only when the count is above zero. The dialog is in the DOM, but
   *  signed out it holds that login prompt and nothing else, so the badge is all
   *  there is to read and all that is needed. */
  function globalFilterCount() {
    const trigger = document.querySelector(SEL.globalFiltersTrigger);
    if (!trigger) return 0;
    const digits = (trigger.textContent || '').match(/\d+/);
    return digits ? Number(digits[0]) : 0;
  }

  /** Offered after a run of pages matches nothing, and only when there is
   *  something to point at. Royal Road cuts these lists before we see them, so
   *  a filter that looks broken may be working on what is left of the site. */
  function dryHint() {
    if (state.dry < DRY_PAGES) return '';
    const global = globalFilterCount();
    if (!global) return '';
    return ` · Your own Global Filters hide ${global} tag${global > 1 ? 's' : ''} site-wide, which may be why there are no results. Or you have very niche tastes.`;
  }

  /** A quiet status line at the end of the list. */
  function render(ctx) {
    const existing = document.getElementById(BAR_ID);
    const list = document.querySelector(SEL.listRoot);

    if (!list) return;

    // Nothing left to fetch and nothing to report: take the line down and stop.
    // Carrying on would put it straight back, and mutations schedule sweeps.
    if (!eligible(ctx) && !state.error && !state.done) {
      if (existing) existing.remove();
      return;
    }

    let text;
    if (state.error) text = `${state.error}: stopped after ${state.pages} extra page(s)`;
    else if (state.busy) text = `loading more… · ${state.added} added`;
    else if (state.done) text = `${state.done} · scanned ${state.pages} extra page(s) · ${state.added} added`;
    else if (state.pages)
      text = `scanned ${state.pages} extra page(s) · ${state.added} added${dryHint()}`;
    else return existing ? existing.remove() : undefined;

    const statusClass = `rrx-loadmore__status${state.error ? ' rrx-loadmore__status--error' : ''}`;

    // Rewrite only when the line actually changes: replacing an identical bar
    // is a mutation, and mutations schedule the sweep that replaces it again.
    // The page would never go quiet, worst once the list has grown largest.
    const status = existing && existing.firstElementChild;
    if (status && status.textContent === text && status.className === statusClass) return;

    const bar = ui.el('div', { id: BAR_ID, class: 'rrx-ui rrx-loadmore', role: 'status' }, [
      ui.el('span', { class: statusClass, text }),
    ]);

    if (existing) existing.replaceWith(bar);
    else list.appendChild(bar);
  }

  /**
   * The filter values the current tally was gathered under.
   *
   * `state` latches on purpose: `done` and `error` stop a finished or failed run
   * from asking again, `pages` remembers how far it has read. Nothing clears
   * them, so before this a relaxed filter skipped every page already scanned and
   * a run that ended on "no more results" never started again that session.
   */
  let ranUnder = null;

  /** Start over when the filter values change underneath the tally. */
  function syncFilterRun(ctx) {
    const signature = JSON.stringify(RRX.describeFilters(ctx.settings));
    if (ranUnder === null) {
      ranUnder = signature;
      return;
    }
    if (signature === ranUnder) return;
    ranUnder = signature;
    reset();
  }

  function reset() {
    Object.assign(state, { pages: 0, added: 0, dry: 0, busy: false, done: '', error: '' });
  }

  features.list.push({
    id: 'infiniteScroll',
    settingKey: 'list.infiniteScroll',
    pages: ['list'],
    label: 'Endless',
    iconName: 'loadMore',
    title: 'Keep adding the following pages to the bottom of the list as you scroll',
    // A single-page list has no next page, so there is nothing to offer there.
    isRelevant: () => maxPage() !== 1,
    syncCards: (scope, ctx) => {
      if (scope !== document) return;
      syncFilterRun(ctx);
      watch(ctx);
      syncPaginator();
      render(ctx);
    },
  });

  RRX.loadMore = {
    fetchNextPage,
    watch,
    render,
    reset,
    syncFilterRun,
    state,
    pageUrl,
    currentPage,
    maxPage,
    syncPaginator,
  };
})(globalThis);
