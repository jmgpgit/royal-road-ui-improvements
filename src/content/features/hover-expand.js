'use strict';

/**
 * Expand a fiction's description while the cursor rests on its card.
 *
 * Also pure CSS (see inject.css): `.rrx-hover-expand` on <html> plus a
 * `:hover` rule. The settle delay is a `transition-delay` rather than a JS
 * timer, which means sweeping the cursor down a list never opens anything, and
 * there is no timer to leak when Royal Road swaps the list out from under us.
 *
 * The chevron stays clickable while hovering, so "hover to peek, click to pin"
 * works: a click ticks Royal Road's own checkbox and the description stays open
 * after the cursor leaves.
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
