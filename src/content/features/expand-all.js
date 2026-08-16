'use strict';

/**
 * Keep every fiction description expanded.
 *
 * No behaviour here: Royal Road's "show more" is pure CSS (inject.css), so the
 * feature is the `.rrx-expand-all` class on <html> plus a toolbar toggle. Its
 * own file so features stay one per file.
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
    // Latest-updates cards carry recent chapters instead of a blurb, so they
    // have no show-more widget.
    isRelevant: (ctx) => ctx.hasDescriptions,
  });
})(globalThis);
