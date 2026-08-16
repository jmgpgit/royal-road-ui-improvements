'use strict';

/**
 * Whether a card survives the active filters, and how to describe them to the
 * reader. Pure: no DOM, no storage.
 *
 * Two rules keep a markup change or a half-filled form from emptying the page:
 * an unset filter (`null` or empty list) excludes nothing, and an unknown card
 * field (`null`, because it could not be read) excludes nothing either. A
 * filter rejects on evidence, never on the absence of it.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode ? require('./schema.js') : root.RRX;
  const api = factory(deps);
  if (isNode) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  const { normalizeSettings, group } = deps;

  const DAY = 86400;

  /** Numeric filters, as [settings key, card field, direction]. */
  const RANGES = [
    ['filters.minRating', 'rating', 'min'],
    ['filters.maxRating', 'rating', 'max'],
    ['filters.minFollowers', 'followers', 'min'],
    ['filters.maxFollowers', 'followers', 'max'],
    ['filters.minViews', 'views', 'min'],
    ['filters.maxViews', 'views', 'max'],
    ['filters.minPages', 'pages', 'min'],
    ['filters.maxPages', 'pages', 'max'],
    ['filters.minChapters', 'chapters', 'min'],
    ['filters.maxChapters', 'chapters', 'max'],
  ];

  /**
   * Filter values out of a full settings object, memoised on the settings
   * object's identity: `matchesFilters` calls this once per card, so uncached,
   * fifty cards means fifty `normalizeSettings` walks of the whole schema for
   * fifty identical answers. Identity is a safe key because `main.js` replaces
   * `ctx.settings` wholesale rather than mutating it; one entry is enough,
   * since a sweep passes the same object every time.
   */
  let filterCache = { settings: null, values: null };

  function activeFilters(settings) {
    if (settings !== null && settings === filterCache.settings) return filterCache.values;
    const s = normalizeSettings(settings);
    const out = {};
    for (const key of group('filters')) out[key] = s[key];
    if (settings !== null) filterCache = { settings, values: out };
    return out;
  }

  /** Is anything actually narrowing the list? */
  function hasActiveFilters(settings) {
    const f = activeFilters(settings);
    if (!f['filters.enabled']) return false;
    return Object.entries(f).some(([key, value]) => {
      if (key === 'filters.enabled') return false;
      if (value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    });
  }

  /**
   * @param {object} card a record from cards.js
   * @param {object} settings full settings (filter keys are picked out here)
   * @param {number} [nowSeconds] injected so date filters are testable
   * @returns {boolean} true if the card should stay visible
   */
  function matchesFilters(card, settings, nowSeconds) {
    const f = activeFilters(settings);
    if (!f['filters.enabled']) return true;
    if (!card) return true;

    for (const [key, field, dir] of RANGES) {
      const limit = f[key];
      if (limit === null) continue;
      const value = card[field];
      if (value === null || value === undefined) continue; // unknown never excludes
      if (dir === 'min' && value < limit) return false;
      if (dir === 'max' && value > limit) return false;
    }

    const tags = Array.isArray(card.tags) ? card.tags : [];
    // Conjunction: every named tag must be present.
    if (f['filters.tagsAll'].length && !f['filters.tagsAll'].every((t) => tags.includes(t))) {
      return false;
    }
    // Veto. Only when the card listed tags, so one whose chips failed to parse
    // is not treated as tag-free and kept.
    if (f['filters.tagsNone'].length && tags.length) {
      if (f['filters.tagsNone'].some((t) => tags.includes(t))) return false;
    }

    if (f['filters.status'].length && card.status && !f['filters.status'].includes(card.status)) {
      return false;
    }
    if (f['filters.type'].length && card.type && !f['filters.type'].includes(card.type)) {
      return false;
    }

    const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
    if (card.updatedAt) {
      const ageDays = (now - card.updatedAt) / DAY;
      if (f['filters.updatedWithinDays'] !== null && ageDays > f['filters.updatedWithinDays']) {
        return false;
      }
      if (f['filters.staleForDays'] !== null && ageDays < f['filters.staleForDays']) {
        return false;
      }
    }

    // `mine` is absent when logged out; nothing to hide then.
    const mine = card.mine || {};
    if (f['filters.hideMine'].some((kind) => mine[kind])) return false;

    return true;
  }

  /** Short human-readable summary of what is narrowing the list, for the UI. */
  function describeFilters(settings) {
    const f = activeFilters(settings);
    if (!f['filters.enabled']) return [];
    const parts = [];

    const range = (label, minKey, maxKey) => {
      const min = f[minKey];
      const max = f[maxKey];
      if (min !== null && max !== null) parts.push(`${label} ${min} to ${max}`);
      else if (min !== null) parts.push(`${label} ≥ ${min}`);
      else if (max !== null) parts.push(`${label} ≤ ${max}`);
    };

    range('rating', 'filters.minRating', 'filters.maxRating');
    range('followers', 'filters.minFollowers', 'filters.maxFollowers');
    range('views', 'filters.minViews', 'filters.maxViews');
    range('pages', 'filters.minPages', 'filters.maxPages');
    range('chapters', 'filters.minChapters', 'filters.maxChapters');

    if (f['filters.tagsAll'].length) parts.push(`+${f['filters.tagsAll'].join(' +')}`);
    if (f['filters.tagsNone'].length) parts.push(`−${f['filters.tagsNone'].join(' −')}`);
    if (f['filters.status'].length) parts.push(f['filters.status'].join('/'));
    if (f['filters.type'].length) parts.push(f['filters.type'].join('/'));
    if (f['filters.updatedWithinDays'] !== null) {
      parts.push(`updated ≤ ${f['filters.updatedWithinDays']}d ago`);
    }
    if (f['filters.staleForDays'] !== null) {
      parts.push(`quiet ≥ ${f['filters.staleForDays']}d`);
    }
    if (f['filters.hideMine'].length) parts.push(`not ${f['filters.hideMine'].join('/')}`);

    return parts;
  }

  /** How many distinct filters are narrowing, for the toolbar badge. */
  const countActiveFilters = (settings) => describeFilters(settings).length;

  return {
    RANGES,
    activeFilters,
    hasActiveFilters,
    matchesFilters,
    describeFilters,
    countActiveFilters,
  };
});
