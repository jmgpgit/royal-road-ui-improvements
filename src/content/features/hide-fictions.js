'use strict';

/**
 * Permanently hide a fiction from every list.
 *
 * The generated stylesheet (common/css.js) does the hiding, so hidden cards never
 * paint and content Royal Road renders after us is covered too (AJAX pagination,
 * the React-rendered recommendations carousel). Here: reading a fiction's id and
 * metadata off its card, and hanging the minus / plus control on it.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, CARD_GROUPS, CARD_VARIANTS, ui } = RRX;

  const CARD_QUERY = CARD_VARIANTS.join(',');

  /** The same link selector the stylesheet matches on, so the button and the
   *  hiding never disagree - selectors.js says why this is not `a[href*="/fiction/"]`. */
  function linkQueryFor(card) {
    const group =
      CARD_GROUPS.find((g) => g.cards.some((sel) => card.matches(sel))) ||
      CARD_GROUPS[CARD_GROUPS.length - 1];
    return `${group.link}${SEL.fictionHref}`;
  }

  /**
   * The fiction a card is about.
   *
   * @returns {number} the id, when the card is unambiguously about one fiction
   * @returns {null}   never attributable - a container holding several fictions,
   *                   or a non-fiction card such as a partner-books slide. A card
   *                   we cannot pin to exactly one fiction must never get a hide
   *                   button, because hiding it would take the others with it.
   * @returns {undefined} nothing to read *yet* (no links at all) - React may not
   *                   have filled this card in, so it is worth retrying.
   */
  function readFictionId(card) {
    const ids = new Set();
    let links = 0;
    for (const a of card.querySelectorAll(linkQueryFor(card))) {
      links += 1;
      const id = RRX.fictionIdFromHref(a.getAttribute('href') || '');
      if (id) ids.add(id);
      if (ids.size > 1) return null;
    }
    if (ids.size === 1) return [...ids][0];
    return links === 0 ? undefined : null;
  }

  /** Snapshot enough of a card to render it in the manager later. */
  function readMeta(card, id) {
    const titleEl = card.querySelector(SEL.cardTitle);
    const link = card.querySelector(linkQueryFor(card));
    const cover = card.querySelector(SEL.cardCover) || card.querySelector(SEL.cardCoverFallback);

    let url = `/fiction/${id}`;
    if (link) {
      try {
        // Drop the ?utm_source=... Royal Road appends to list links.
        url = new URL(link.getAttribute('href'), root.location.origin).pathname;
      } catch {
        /* keep the fallback */
      }
    }

    return {
      // Server-rendered cards put the title in a heading; React recommendation
      // slides do not, but every variant has a cover whose alt is the title.
      title:
        (titleEl && titleEl.textContent.trim()) ||
        (cover && cover.getAttribute('alt')) ||
        `Fiction ${id}`,
      url,
      cover: (cover && cover.getAttribute('src')) || '',
    };
  }

  function removeControls(card) {
    for (const node of card.querySelectorAll(':scope > .rrx-card-btn, :scope > .rrx-hidden-badge')) {
      node.remove();
    }
  }

  /** Give one already-tagged card the control that matches the current state.
   *  Rebuilt only when the mode changes, so re-syncing is cheap. */
  function applyControls(card, id, ctx) {
    if (!ctx.settings['hide.enabled']) {
      removeControls(card);
      card.removeAttribute('data-rrx-hidden');
      return;
    }

    const isHidden = ctx.hiddenSet.has(id);
    const mode = isHidden ? 'restore' : 'hide';
    card.toggleAttribute('data-rrx-hidden', isHidden);

    const existing = card.querySelector(':scope > .rrx-card-btn');
    if (existing && existing.dataset.rrxMode === mode) {
      syncBadge(card, isHidden);
      return;
    }
    if (existing) existing.remove();

    const meta = isHidden ? null : readMeta(card, id);
    const button = ui.cardButton({
      label: isHidden ? 'Show this fiction again' : 'Hide this fiction from all lists',
      iconName: isHidden ? 'plus' : 'minus',
      modifier: isHidden ? 'rrx-card-btn--restore' : null,
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isHidden) ctx.unhide(id);
        else ctx.hide(id, meta);
      },
    });
    button.dataset.rrxMode = mode;
    card.appendChild(button);
    syncBadge(card, isHidden);
  }

  function syncBadge(card, isHidden) {
    const existing = card.querySelector(':scope > .rrx-hidden-badge');
    if (isHidden && !existing) {
      card.appendChild(ui.el('span', { class: 'rrx-ui rrx-hidden-badge', text: 'Hidden' }));
    } else if (!isHidden && existing) {
      existing.remove();
    }
  }

  /**
   * Tag every fiction card under `scope` and attach its control. Safe to call
   * repeatedly - cards with data-rrx-fid skip the id lookup.
   *
   * @param {ParentNode} scope
   * @param {object} ctx shared app context from main.js
   */
  function syncCards(scope, ctx) {
    const cards = scope.querySelectorAll(CARD_QUERY);
    for (const card of cards) {
      let id = card.dataset.rrxFid ? Number(card.dataset.rrxFid) : null;
      if (!id) {
        if (card.dataset.rrxSkip) continue;
        const found = readFictionId(card);
        // No links yet - leave it unmarked so a later sweep catches it once React fills it in.
        if (found === undefined) continue;
        if (found === null) {
          // Not ours. Remember the miss so we stop re-scanning it.
          card.dataset.rrxSkip = '1';
          continue;
        }
        id = found;
        card.dataset.rrxFid = String(id);
      }
      applyControls(card, id, ctx);
    }
  }

  features.list.push({
    id: 'showHidden',
    settingKey: 'hide.showHidden',
    pages: ['list', 'home', 'fiction'],
    label: 'Show hidden',
    title: 'Reveal hidden fictions in place, dimmed, so you can restore them',
    iconName: 'showHidden',
    isRelevant: (ctx) => ctx.settings['hide.enabled'],
    badge: (ctx) => ctx.hiddenSet.size,
    syncCards,
  });

  RRX.hideFictions = { syncCards, readFictionId, readMeta, CARD_QUERY };
})(globalThis);
