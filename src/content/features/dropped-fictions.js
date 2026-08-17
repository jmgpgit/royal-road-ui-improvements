'use strict';

/**
 * Mark a fiction as one you tried and stopped reading.
 *
 * Hiding answers "never show me this again" and takes the card off the page.
 * This answers a different question - "did I already give this a go?" - which
 * only helps if the card is still there to be asked about. So a dropped fiction
 * dims and says so, and stays where it is, legible and clickable.
 *
 * The dimming is generated CSS (common/css.js), for the same reasons hiding is:
 * it lands before first paint and covers cards Royal Road renders after us.
 * Here: the control, the badge, and the attribute the filter reads.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { ui } = RRX;

  const BADGE_CLASS = 'rrx-dropped-badge';

  function removeControls(card) {
    for (const node of card.querySelectorAll(`:scope > [data-rrx-btn="drop"], :scope > .${BADGE_CLASS}`)) {
      node.remove();
    }
  }

  function syncBadge(card, isDropped) {
    const existing = card.querySelector(`:scope > .${BADGE_CLASS}`);
    if (isDropped && !existing) {
      card.appendChild(ui.el('span', { class: `rrx-ui ${BADGE_CLASS}`, text: 'Dropped' }));
    } else if (!isDropped && existing) {
      existing.remove();
    }
  }

  /** Rebuilt only when the mode changes, so re-syncing is cheap. */
  function applyControls(card, id, ctx) {
    if (!ctx.settings['drop.enabled']) {
      removeControls(card);
      card.removeAttribute('data-rrx-dropped');
      return;
    }

    const isDropped = ctx.droppedSet.has(id);
    const mode = isDropped ? 'undrop' : 'drop';
    card.toggleAttribute('data-rrx-dropped', isDropped);

    const existing = card.querySelector(':scope > [data-rrx-btn="drop"]');
    if (existing && existing.dataset.rrxMode === mode) {
      syncBadge(card, isDropped);
      return;
    }
    if (existing) existing.remove();

    const meta = isDropped ? null : RRX.hideFictions.readMeta(card, id);
    const button = ui.cardButton({
      label: isDropped ? 'No longer dropped' : 'Mark as tried and dropped',
      iconName: isDropped ? 'undrop' : 'drop',
      modifier: isDropped ? 'rrx-card-btn--dropped' : null,
      name: 'drop',
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isDropped) ctx.undrop(id);
        else ctx.drop(id, meta);
      },
    });
    button.dataset.rrxMode = mode;
    card.appendChild(button);
    syncBadge(card, isDropped);
  }

  function syncCards(scope, ctx) {
    RRX.hideFictions.eachCard(scope, (card, id) => applyControls(card, id, ctx));
  }

  // No toolbar button: there is nothing to reveal, since dropped fictions never
  // leave the page. Hiding them is what `filters.hideMine` is for.
  features.list.push({
    id: 'dropped',
    pages: ['list', 'home', 'fiction'],
    syncCards,
  });

  RRX.droppedFictions = { syncCards };
})(globalThis);
