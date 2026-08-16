'use strict';

/**
 * Expand a fiction's description while the cursor rests on its card.
 *
 * Pure CSS (see inject.css): `.rrx-hover-expand` on <html> plus a `:hover` rule.
 * The settle delay is a `transition-delay`, not a JS timer, so sweeping down a
 * list opens nothing and no timer leaks when Royal Road swaps the list out. The
 * chevron stays clickable: a click ticks Royal Road's own checkbox, so hover
 * peeks and click pins the description open.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });

  features.list.push({
    id: 'hoverExpand',
    settingKey: 'list.hoverExpand',
    pages: ['list'],
    label: 'Expand on hover',
    title: 'Expand a description while the cursor rests on its card',
    iconName: 'hoverExpand',
    isRelevant: (ctx) => ctx.hasDescriptions,
    // Expand-all already holds everything open, so the toggle would be a no-op.
    isDisabled: (ctx) => ctx.settings['list.expandAll'],
    disabledTitle: 'Not needed while "Expand all" is on',
  });
})(globalThis);
