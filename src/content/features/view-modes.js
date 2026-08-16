'use strict';

/**
 * The list layout switcher. The layouts are in inject-views.css, gated behind
 * an `rrx-view-*` class boot.js derives from `list.view`; this file only adds
 * the toolbar control that cycles them - hence a descriptor, not a module.
 * Cycle order is `RRX.VIEWS`, so a new layout means an entry there plus CSS.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });

  const LABELS = {
    default: 'Cards',
    compact: 'Compact',
    'two-col': 'Two columns',
    grid: 'Covers',
  };

  features.list.push({
    id: 'view',
    settingKey: 'list.view',
    pages: ['list'],
    label: 'View',
    iconName: 'view',
    title: 'Switch how this list is laid out',
    // A cycle rather than a dropdown: the badge always says which layout you
    // are on, so a menu would be more clicks for no more clarity.
    isPressed: (ctx) => ctx.settings['list.view'] !== 'default',
    badge: (ctx) => LABELS[ctx.settings['list.view']],
    onClick: (ctx) => {
      const order = RRX.VIEWS;
      const next = order[(order.indexOf(ctx.settings['list.view']) + 1) % order.length];
      return ctx.setSetting('list.view', next);
    },
  });

})(globalThis);
