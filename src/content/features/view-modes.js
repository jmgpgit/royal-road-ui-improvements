'use strict';

/**
 * The list layout switcher.
 *
 * The layouts themselves are entirely in inject-views.css, gated behind an
 * `rrx-view-*` class that boot.js derives from `list.view`. All this file adds
 * is the toolbar control that cycles through them, which is why it is a
 * descriptor rather than a module with behaviour. The order it cycles in is
 * `RRX.VIEWS`, so adding a layout means adding it there and writing its CSS.
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
    // A cycle rather than a dropdown: five options, and the label always says
    // which one you are on, so a menu would be more clicks for no more clarity.
    isPressed: (ctx) => ctx.settings['list.view'] !== 'default',
    badge: (ctx) => LABELS[ctx.settings['list.view']],
    onClick: (ctx) => {
      const order = RRX.VIEWS;
      const next = order[(order.indexOf(ctx.settings['list.view']) + 1) % order.length];
      return ctx.setSetting('list.view', next);
    },
  });

})(globalThis);
