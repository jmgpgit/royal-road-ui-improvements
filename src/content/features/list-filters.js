'use strict';

/**
 * Applies the filters to the cards on a list page.
 *
 * Filtering needs numbers parsed off each card, so it cannot be CSS and cannot run
 * before first paint. boot.js puts `rrx-filters-pending` on <html> while a filter is
 * active, hiding the list with `visibility` (not `display`, so no reflow) until the
 * first pass lands. A watchdog clears it regardless: a flash beats a list that never
 * un-hides.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  /** Longest the list may stay hidden waiting for a filter pass. */
  const REVEAL_WATCHDOG_MS = 1000;

  const FILTERED_CLASS = 'rrx-filtered';
  /** Cached on a property rather than a data attribute, to keep the DOM clean. */
  const DATA_KEY = '__rrxCard';

  let watchdog = null;

  function reveal() {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    document.documentElement.classList.remove(RRX.ROOT_CLASS.filtersPending);
  }

  /** Cached per card; re-parsing 50 cards on every sweep is waste. */
  function dataFor(card, ctx) {
    if (!card[DATA_KEY]) {
      const id = card.dataset.rrxFid ? Number(card.dataset.rrxFid) : null;
      card[DATA_KEY] = RRX.readCardData(card, id);
    }
    // Read fresh rather than cached with the rest: everything else on the record
    // comes off markup that only changes when the card is re-rendered, but this
    // is our own mark, and dropping a fiction has to take effect on the pass that
    // follows rather than whenever Royal Road next redraws the list.
    //
    // Not gated on `drop.enabled`. It was, so that one switch turned everything
    // off - but the filter panel offers the Dropped chip whatever that switch
    // says, and the toolbar counts it as narrowing the list, so gating it made
    // an explicitly chosen filter silently do nothing. `drop.enabled` decides
    // whether the button and the dimming appear; asking for them to be filtered
    // out is a separate thing to ask for.
    card[DATA_KEY].mine.dropped = !!ctx.droppedSet && ctx.droppedSet.has(card[DATA_KEY].id);
    return card[DATA_KEY];
  }

  /**
   * @returns {{total: number, shown: number}} counts for the toolbar
   */
  function apply(scope, ctx) {
    const cards = scope.querySelectorAll(SEL.listCard);
    const active = RRX.hasActiveFilters(ctx.settings);
    let shown = 0;

    for (const card of cards) {
      const keep = !active || RRX.matchesFilters(dataFor(card, ctx), ctx.settings);
      card.classList.toggle(FILTERED_CLASS, !keep);
      if (keep) shown += 1;
    }

    return { total: cards.length, shown };
  }

  const EMPTY_ID = 'rrx-no-matches';

  /** How many tags Royal Road is filtering site-wide for this reader, off the
   *  badge on its own button.
   *
   *  The button itself is on the list pages either way - it is in the signed-out
   *  captures - so its presence says nothing. Only the badge does, and it is
   *  there only when the count is above zero. The dialog is in the DOM, but
   *  signed out it holds a login prompt and nothing else, so the badge is all
   *  there is to read and all that is needed. */
  function globalFilterCount() {
    const trigger = document.querySelector(SEL.globalFiltersTrigger);
    if (!trigger) return 0;
    const digits = (trigger.textContent || '').match(/\d+/);
    return digits ? Number(digits[0]) : 0;
  }

  /**
   * Said out loud when a filter leaves nothing, because an empty list is
   * indistinguishable from a page that genuinely has no matches - and, signed
   * in, from the reader's own Global Filters cutting the list before we ever see
   * it. Theirs, not Royal Road's: its own dialog reads "Customize your
   * experience by including or excluding tags across the entire site", and
   * signed out offers only "You must be logged in to use global tag filters".
   * The count comes off Royal Road's button, so it is only mentioned when there
   * really is one.
   */
  function renderEmpty(ctx, counts) {
    const list = document.querySelector(SEL.listRoot);
    const existing = document.getElementById(EMPTY_ID);
    const show = counts.total > 0 && counts.shown === 0 && RRX.hasActiveFilters(ctx.settings);
    if (!list || !show) {
      if (existing) existing.remove();
      return;
    }

    // The endless-scroll status line makes this point itself once it has
    // scanned and found nothing, so only speak for it when there is no loader.
    const global = ctx.settings['list.infiniteScroll'] ? 0 : globalFilterCount();
    const text = global
      ? `Nothing on this page matches your filters. Your own Global Filters hide ${global} tag${global > 1 ? 's' : ''} site-wide as well - see Royal Road's Global Filters button.`
      : 'Nothing on this page matches your filters.';

    // Compared before writing: this runs on every sweep, and replacing an
    // identical node is a mutation that schedules the next one.
    if (existing && existing.textContent === text) return;
    const note = ui.el('div', { id: EMPTY_ID, class: 'rrx-ui rrx-no-matches', role: 'status', text });
    if (existing) existing.replaceWith(note);
    else list.appendChild(note);
  }

  function syncCards(scope, ctx) {
    if (!ctx.isListPage) {
      reveal();
      return;
    }
    ctx.filterCounts = apply(scope, ctx);
    if (scope === document) renderEmpty(ctx, ctx.filterCounts);
    reveal();
  }

  features.list.push({
    id: 'filters',
    settingKey: 'filters.enabled',
    pages: ['list'],
    label: 'Filters',
    title: 'Narrow this list by rating, size, tags, status or date',
    iconName: 'filters',
    // Pressed means "something is narrowing", not the master switch.
    isPressed: (ctx) => RRX.hasActiveFilters(ctx.settings),
    badge: (ctx) => RRX.countActiveFilters(ctx.settings) || undefined,
    onClick: (ctx, event) => {
      const toolbar = event.currentTarget.closest('.rrx-toolbar');
      if (RRX.panel.isOpen()) RRX.panel.close();
      else RRX.panel.open(toolbar, ctx);
    },
    syncCards,
  });

  // Armed unconditionally, not only when the class is already present. boot.js sets
  // it twice: synchronously from the localStorage mirror, then from the authoritative
  // storage read, which resolves after this module body runs. On a first load there is
  // no mirror yet, so the class arrives after this point, and a guarded watchdog would
  // never be set for the case that needs it most.
  watchdog = setTimeout(reveal, REVEAL_WATCHDOG_MS);

})(globalThis);
