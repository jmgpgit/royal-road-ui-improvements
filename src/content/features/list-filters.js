'use strict';

/**
 * Applies the filters to the cards on a list page.
 *
 * Filtering is JavaScript, unlike hiding: it needs parsed numbers off each card,
 * which CSS cannot do. That means it cannot run before first paint, so `boot.js`
 * puts `rrx-filters-pending` on <html> when any filter is active - which hides
 * the list with `visibility` (not `display`, so no reflow) until the first pass
 * completes. A watchdog clears it regardless, because a page that never un-hides
 * is far worse than a brief flash.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL } = RRX;

  /** Longest the list may stay hidden waiting for a filter pass. */
  const REVEAL_WATCHDOG_MS = 1000;

  const FILTERED_CLASS = 'rrx-filtered';
  /** Where the parsed record is cached: a property, so the DOM stays clean. */
  const DATA_KEY = '__rrxCard';

  let watchdog = null;

  function reveal() {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    document.documentElement.classList.remove(RRX.ROOT_CLASS.filtersPending);
  }

  /** Parsed once per card and cached; re-reading 50 cards on every sweep is waste. */
  function dataFor(card) {
    if (!card[DATA_KEY]) {
      const id = card.dataset.rrxFid ? Number(card.dataset.rrxFid) : null;
      card[DATA_KEY] = RRX.readCardData(card, id);
    }
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
      const keep = !active || RRX.matchesFilters(dataFor(card), ctx.settings);
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
    // Pressed reflects "something is narrowing", not the master switch, so the
    // button reads as on exactly when the list is actually filtered.
    isPressed: (ctx) => RRX.hasActiveFilters(ctx.settings),
    badge: (ctx) => RRX.countActiveFilters(ctx.settings) || undefined,
    onClick: (ctx, event) => {
      const toolbar = event.currentTarget.closest('.rrx-toolbar');
      if (RRX.panel.isOpen()) RRX.panel.close();
      else RRX.panel.open(toolbar, ctx);
    },
    syncCards,
  });

  // If something goes wrong before the first pass - a thrown feature, a page
  // shape we did not expect - the list must still become visible.
  //
  // Armed unconditionally, NOT only when the class is already present. boot.js
  // sets it twice: synchronously from the localStorage mirror, then again from
  // the authoritative storage read, which resolves after this module body has
  // run. On a first load there is no mirror yet, so the class arrives after
  // this point, and a guarded watchdog would never have been set for the one
  // case that needs it most.
  watchdog = setTimeout(reveal, REVEAL_WATCHDOG_MS);

})(globalThis);
