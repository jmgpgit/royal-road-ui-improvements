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
  const { SEL } = RRX;

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
    // follows rather than whenever Royal Road next redraws the list. Gated on the
    // feature's own switch, so turning it off makes the marks inert everywhere
    // rather than leaving this one filter still acting on them.
    card[DATA_KEY].mine.dropped =
      !!ctx.settings['drop.enabled'] && !!ctx.droppedSet && ctx.droppedSet.has(card[DATA_KEY].id);
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

  function syncCards(scope, ctx) {
    if (!ctx.isListPage) {
      reveal();
      return;
    }
    ctx.filterCounts = apply(scope, ctx);
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
