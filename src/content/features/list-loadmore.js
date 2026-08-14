'use strict';

/**
 * Infinite scroll for the fiction lists.
 *
 * Reaching the bottom fetches the next page and appends it, so a list reads as
 * one run instead of twenty at a time. With a filter on it matters more, since
 * filtering a single page often leaves a handful of results and a dead end, but
 * it is not conditional on one: a reader who turns this on wants it everywhere.
 *
 * Cards are put through the filters and the hidden list on the way in, so an
 * appended page obeys exactly the same rules as the one Royal Road served.
 *
 * The limits are constants rather than settings, because they exist to be
 * polite to somebody else's servers and that is not a preference:
 *   - one request at a time, never parallel, and never while one is in flight;
 *   - a deliberate gap between them;
 *   - a hard page ceiling, so a broken selector cannot become a request loop;
 *   - it stops for good the moment a page yields nothing new;
 *   - it stops on any non-200, and says so;
 *   - the status line always reports what was scanned, so a run that hits the
 *     ceiling can never be mistaken for "that is everything".
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  const BAR_ID = 'rrx-loadmore';

  /** Internal limits. Not settings: politeness is not a preference. */
  const MAX_PAGES = 25;
  const REQUEST_GAP_MS = 500;
  /** Start fetching when the end of the list is within this much of the viewport. */
  const TRIGGER_MARGIN = 1.5;

  const state = { pages: 0, added: 0, busy: false, done: '', error: '', watching: false };

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
        if (!RRX.matchesFilters(data, ctx.settings)) continue;
        if (ctx.hiddenSet.has(data.id)) continue;
        container.appendChild(adopted);
        addedNow += 1;
      }
      state.added += addedNow;

      // Let the normal pipeline decorate whatever was just appended.
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
      // Flags first: `eligible` parses a URL and queries the document, and this
      // runs on every scroll event.
      if (state.busy || state.done || state.error || !eligible(ctx)) return;
      const list = document.querySelector(SEL.listRoot);
      if (!list) return;
      const box = list.getBoundingClientRect();
      if (box.bottom <= root.innerHeight * TRIGGER_MARGIN) fetchNextPage(ctx);
    };

    root.addEventListener('scroll', check, { passive: true });
    root.addEventListener('resize', check, { passive: true });
    // A short filter may leave the whole list above the fold, in which case no
    // scroll ever fires and the first top-up has to be kicked off here.
    setTimeout(check, 300);
  }

  /**
   * Royal Road's own page numbers, once we have appended underneath them.
   *
   * Only after the first append, not as soon as the feature is switched on: up
   * to that point the footer is telling the truth and is still the quickest way
   * to jump deep into a list. The moment a second page is added it starts
   * claiming "Showing 1 to 20 of 25090" under five pages of results, and
   * clicking a number there hands you to Royal Road's replace-the-list
   * pagination, which disagrees with us about where you are.
   *
   * Toggling a class is free to do on every sweep: setting it to the value it
   * already holds emits no mutation record, so this cannot feed the observer.
   */
  function syncPaginator() {
    const paginate = document.querySelector(SEL.paginateRoot);
    if (paginate) paginate.classList.toggle('rrx-endless', state.pages > 0);
  }

  /** A quiet status line at the end of the list. */
  function render(ctx) {
    const existing = document.getElementById(BAR_ID);
    const list = document.querySelector(SEL.listRoot);

    if (!list) return;

    // Nothing more to fetch and nothing to report: take the line down and stop.
    // Removing it and then carrying on would put it straight back, which is one
    // mutation per sweep and, since mutations schedule sweeps, a page that never
    // settles.
    if (!eligible(ctx) && !state.error && !state.done) {
      if (existing) existing.remove();
      return;
    }

    let text;
    if (state.error) text = `${state.error}: stopped after ${state.pages} extra page(s)`;
    else if (state.busy) text = `loading more… · ${state.added} added`;
    else if (state.done) text = `${state.done} · scanned ${state.pages} extra page(s) · ${state.added} added`;
    else if (state.pages) text = `scanned ${state.pages} extra page(s) · ${state.added} added`;
    else return existing ? existing.remove() : undefined;

    const statusClass = `rrx-loadmore__status${state.error ? ' rrx-loadmore__status--error' : ''}`;

    // Rewrite only when the line actually changes.
    //
    // This runs on every sweep, and the sweep is driven by a MutationObserver.
    // Replacing an identical bar each time is a mutation, which schedules the
    // next sweep, which replaces it again: the page never goes quiet, and it
    // does so exactly when infinite scroll has grown the list to its largest.
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
   * from asking again, and `pages` remembers how far it has already read. All
   * three become wrong the moment the filter changes, and none of them clears
   * itself, so a relaxed filter would skip every page already scanned and a run
   * that ended on "no more results" would never start again for the rest of the
   * session. Nothing said when to let go, so nothing ever did.
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

  /** A new filter means the previous run's tally is meaningless. */
  function reset() {
    Object.assign(state, { pages: 0, added: 0, busy: false, done: '', error: '' });
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
