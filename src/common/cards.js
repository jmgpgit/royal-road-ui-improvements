'use strict';

/**
 * Reads a fiction card into the plain record the filters run against.
 *
 * Missing fields become `null` (or `[]`), which `filters.js` reads as "unknown,
 * so do not exclude": a markup change on Royal Road's side quietly stops one
 * filter narrowing rather than blanking the page. Pure DOM reads, so it is
 * testable under jsdom against the captures in test/fixtures/.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? Object.assign({}, require('./selectors.js'), require('./schema.js'), require('./model.js'))
    : root.RRX;
  const api = factory(deps);
  if (isNode) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  const { SEL, CARD_STATS, MINE_TOOLTIPS, STATUSES, TYPES, fictionIdFromHref } = deps;

  /** "2,116" -> 2116. Anything unparseable is null, never 0. */
  function parseCount(text) {
    if (typeof text !== 'string') return null;
    const digits = text.replace(/[^\d]/g, '');
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }

  function readRating(card) {
    const el = card.querySelector(SEL.cardRating);
    if (!el) return null;
    const n = Number(el.getAttribute('data-rr-initial-rating'));
    return Number.isFinite(n) ? n : null;
  }

  /** Followers / Pages / Chapters / Views, read label-first. */
  function readStats(card) {
    const out = { followers: null, pages: null, chapters: null, views: null };
    for (const label of card.querySelectorAll(SEL.cardStatLabel)) {
      const field = CARD_STATS[label.textContent.trim()];
      if (!field || out[field] !== null) continue;
      const tile = label.parentElement;
      const valueEl = tile && tile.firstElementChild;
      if (!valueEl || valueEl === label) continue;
      out[field] = parseCount(valueEl.textContent);
    }
    return out;
  }

  /** Status and type share the chip row and the same classes, so they are told
   *  apart by text against the known vocabularies. Unrecognised chips are ignored. */
  function readChips(card) {
    let status = null;
    let type = null;
    for (const chip of card.querySelectorAll(SEL.cardChip)) {
      const text = chip.textContent.trim();
      if (!status && STATUSES.includes(text)) status = text;
      else if (!type && TYPES.includes(text)) type = text;
    }
    return { status, type };
  }

  /** Tag slugs, de-duplicated: every card renders its chips twice (mobile + desktop). */
  function readTags(card) {
    const tags = new Set();
    for (const a of card.querySelectorAll(SEL.cardTag)) {
      const href = a.getAttribute('href') || '';
      const slug = decodeURIComponent(href.split('tagsAdd=')[1] || '').split('&')[0].trim();
      if (slug) tags.add(slug);
    }
    return [...tags];
  }

  /** Unix seconds of the last chapter update. */
  function readUpdatedAt(card) {
    const el = card.querySelector(SEL.cardTime);
    if (!el) return null;
    const n = Number(el.getAttribute('unixtime'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** Read Later is a real form whose `mark` input says what a click *would* do, so
   *  `mark="False"` means already marked. Follow and Favourite are tooltip-wrapped
   *  icons Royal Road omits entirely when unset, so absence is normal. */
  function readMine(card) {
    // `dropped` is ours rather than Royal Road's, so nothing here can read it;
    // list-filters.js fills it in from the stored list. Declared anyway, so the
    // record has one shape wherever it is built.
    const mine = { follow: false, favorite: false, ril: false, dropped: false };

    const form = card.querySelector(SEL.cardRilForm);
    if (form) {
      const mark = form.querySelector(SEL.cardMarkInput);
      if (mark) mine.ril = String(mark.value).toLowerCase() === 'false';
    }

    for (const tip of card.querySelectorAll(SEL.cardTooltipContent)) {
      const key = MINE_TOOLTIPS[tip.textContent.trim()];
      if (key) mine[key] = true;
    }

    // Icon fallback, in case the tooltip wording changes.
    if (card.querySelector(SEL.cardFollowIcon)) mine.follow = true;
    if (card.querySelector(SEL.cardFavoriteIcon)) mine.favorite = true;

    return mine;
  }

  /**
   * @param {Element} card a `.fiction-card-expanded` (or another card variant)
   * @param {number|null} id the fiction id, if already known
   * @returns {object} the filter record
   */
  function readCardData(card, id) {
    const link = card.querySelector(`a${SEL.fictionHref}`);
    const fictionId =
      id || (link ? fictionIdFromHref(link.getAttribute('href') || '') : null) || null;

    return {
      id: fictionId,
      rating: readRating(card),
      ...readStats(card),
      ...readChips(card),
      tags: readTags(card),
      updatedAt: readUpdatedAt(card),
      mine: readMine(card),
    };
  }

  return { readCardData, parseCount, readRating, readStats, readChips, readTags, readUpdatedAt, readMine };
});
