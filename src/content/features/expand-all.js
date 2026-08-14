'use strict';

/**
 * Keep every fiction description expanded.
 *
 * There is no behaviour here on purpose. Royal Road's "show more" is driven
 * entirely by CSS (see inject.css), so this feature is the `.rrx-expand-all`
 * class on <html> plus a toolbar toggle. The module exists so features stay
 * one per file: adding another is a new file rather than an edit to main.js.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });

  features.list.push({
    id: 'expandAll',
    settingKey: 'list.expandAll',
    pages: ['list'],
    label: 'Expand all',
    title: 'Keep every fiction description expanded on list pages',
    iconName: 'expandAll',
    // Pointless on latest-updates, whose cards carry recent chapters instead of
    // a blurb and so have no show-more widget at all.
    isRelevant: (ctx) => ctx.hasDescriptions,
  });
})(globalThis);
