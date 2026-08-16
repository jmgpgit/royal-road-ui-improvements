'use strict';

/**
 * Royal Road's tag vocabulary, for the filter panel's tag pickers.
 *
 * Slugs do not match labels - `romance` is "Romance Subplot", `harem` is
 * "Multiple Lovers" - so the panel offers the real list. Royal Road adds tags,
 * so it is read from the `#tagsAdd` select on `/fictions/search`: free when we
 * are already there, fetched otherwise, cached for a week.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || RRX.tags) return;

  const CACHE_KEY = 'tagCatalogue';
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const SOURCE_URL = '/fictions/search';

  /** In-memory copy, so the panel renders synchronously once warmed. */
  let catalogue = [];
  let fetching = null;

  /** @returns {Array<{slug: string, label: string}>} */
  function parseSelect(select) {
    if (!select) return [];
    return [...select.querySelectorAll('option')]
      .map((option) => ({
        slug: (option.getAttribute('value') || '').trim(),
        label: option.textContent.trim(),
      }))
      .filter((tag) => tag.slug && tag.label);
  }

  const byLabel = (a, b) => a.label.localeCompare(b.label);

  /** Merge into the catalogue by slug; earlier labels win. */
  async function save(tags) {
    const bySlug = new Map(catalogue.map((t) => [t.slug, t]));
    for (const tag of tags) if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, tag);
    catalogue = [...bySlug.values()].sort(byLabel);
    try {
      await RRX.ext.storage.local.set({ [CACHE_KEY]: { at: Date.now(), tags: catalogue } });
    } catch {
      /* a failed write just means we fetch again next week */
    }
    return catalogue;
  }

  /** Every tag chip on the page, as slug + label. Not redundant with the select:
   *  `#tagsAdd` holds 72 *tags* but no *genres*, while a card chips both under the
   *  same `tagsAdd` parameter - "Adventure" and the rest filter but are not in it. */
  function harvestChips(scope = document) {
    const found = new Map();
    for (const a of scope.querySelectorAll('a[href*="tagsAdd="]')) {
      const slug = decodeURIComponent((a.getAttribute('href') || '').split('tagsAdd=')[1] || '')
        .split('&')[0]
        .trim();
      const label = a.textContent.trim();
      if (slug && label && !found.has(slug)) found.set(slug, { slug, label });
    }
    return [...found.values()];
  }

  /** Pull whatever the page we are already on can tell us. */
  function harvest(scope = document) {
    const tags = [...parseSelect(scope.querySelector('#tagsAdd')), ...harvestChips(scope)];
    if (tags.length) save(tags);
    return tags;
  }

  async function fetchCatalogue() {
    const response = await fetch(SOURCE_URL, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`tag list: HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const tags = [...parseSelect(doc.querySelector('#tagsAdd')), ...harvestChips(doc)];
    if (!tags.length) throw new Error('tag list: #tagsAdd had no options');
    return save(tags);
  }

  /** Best available list, refreshing in the background when stale. Never throws:
   *  an empty list just means the pickers fall back to free text. */
  async function load() {
    // Page chips are free, and on a list page they carry the genres the select omits.
    harvest();
    if (catalogue.length >= 72) return catalogue;

    let cached = null;
    try {
      cached = (await RRX.ext.storage.local.get(CACHE_KEY))[CACHE_KEY];
    } catch {
      /* fall through to the fetch */
    }

    if (cached && Array.isArray(cached.tags) && cached.tags.length) {
      await save(cached.tags);
      // Stale but usable: serve it now, refresh quietly for next time.
      if (Date.now() - (cached.at || 0) > MAX_AGE_MS) fetchCatalogue().catch(() => {});
      return catalogue;
    }

    if (!fetching) fetching = fetchCatalogue().catch(() => catalogue);
    return fetching;
  }

  const all = () => catalogue;
  const labelFor = (slug) => (catalogue.find((t) => t.slug === slug) || {}).label || slug;
  const slugFor = (label) => {
    const hit = catalogue.find((t) => t.label.toLowerCase() === label.trim().toLowerCase());
    return hit ? hit.slug : null;
  };

  /** Tags whose label or slug contains `query`, best matches first. */
  function search(query, limit = 10) {
    const q = query.trim().toLowerCase();
    if (!q) return catalogue.slice(0, limit);
    const starts = [];
    const contains = [];
    for (const tag of catalogue) {
      const label = tag.label.toLowerCase();
      if (label.startsWith(q)) starts.push(tag);
      else if (label.includes(q) || tag.slug.includes(q)) contains.push(tag);
    }
    return [...starts, ...contains].slice(0, limit);
  }

  RRX.tags = { load, all, harvest, harvestChips, search, labelFor, slugFor, parseSelect, CACHE_KEY };
})(globalThis);
