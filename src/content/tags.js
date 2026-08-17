'use strict';

/**
 * Royal Road's tag vocabulary, for the filter panel's tag pickers.
 *
 * Slugs do not match labels - `romance` is "Romance Subplot", `harem` is
 * "Multiple Lovers" - so the panel offers the real list. Royal Road adds tags,
 * so it is read from `/fictions/search`, which is the only page that states the
 * whole vocabulary: the `#tagsAdd` select for the 72 tags and the genre buttons
 * for the 22 genres, which the select carries not one of. Free when we are
 * already there, fetched otherwise, cached for a week.
 *
 * Every other page contributes its chips, which are a sample rather than the
 * list - so they fill the cache in but never mark it complete.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || RRX.tags) return;
  const { SEL } = RRX;

  const CACHE_KEY = 'tagCatalogue';
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const SOURCE_URL = '/fictions/search';

  /** In-memory copy, so the panel renders synchronously once warmed. */
  let catalogue = [];
  let fetching = null;

  /** Whether `catalogue` holds Royal Road's published vocabulary rather than
   *  whatever tags happened to be on the pages visited.
   *
   *  This used to be inferred from `catalogue.length >= 72`, which is not the
   *  same question: the rising-stars capture alone carries 73 distinct slugs on
   *  its cards, so a count that size proves only that a busy page was read. The
   *  fetch was skipped on that basis and the picker offered whatever had been
   *  seen - which is how a rare tag becomes untypeable, and why a reader with
   *  global filters set sees even less. */
  let full = false;

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

  /** When the catalogue was last *fetched*, which is not when the key was last
   *  written: page chips are merged in on any page carrying them, and a cached
   *  copy is written straight back on every read. Stamping those with "now" made
   *  the week count from the last time the filter panel was opened, so anybody
   *  who opened it more often than weekly never refreshed at all. */
  let fetchedAt = 0;

  const merge = (into, from) => {
    for (const tag of from || []) {
      if (tag && tag.slug && tag.label && !into.has(tag.slug)) into.set(tag.slug, tag);
    }
    return into;
  };

  const sorted = (bySlug) => [...bySlug.values()].sort(byLabel);

  /** Merge into the catalogue by slug; earlier labels win. */
  async function save(tags, options) {
    if (options && options.full) full = true;
    // Synchronously, before any await: `load()` reads `catalogue` straight after
    // calling harvest() to decide whether it still needs the cache.
    catalogue = sorted(merge(new Map(catalogue.map((t) => [t.slug, t])), tags));

    try {
      const stored = (await RRX.ext.storage.local.get(CACHE_KEY))[CACHE_KEY];
      const held = Array.isArray(stored && stored.tags) ? stored.tags : [];
      // Harvesting page chips writes too, and can run before anything has read
      // the key, so the stored stamp is the fallback rather than "now" - merging
      // three more genres in is not a fetch and must not look like one.
      if (!fetchedAt) fetchedAt = Number(stored && stored.at) || 0;

      // The cache can know more than this page does: `#tagsAdd` carries 72 tags
      // and a fiction page carries a handful. Merging the other way round would
      // let any page overwrite the vocabulary with its own few.
      catalogue = sorted(merge(new Map(catalogue.map((t) => [t.slug, t])), held));

      // Once the published vocabulary has been read, a later partial harvest
      // cannot take that back.
      full = full || !!(stored && stored.full);

      // Every page with tag links harvests, so most harvests learn nothing. The
      // union can only grow, so equal sizes means the cache already had it all -
      // unless this pass is what proves the stored copy complete.
      if (catalogue.length === held.length && full === !!(stored && stored.full)) return catalogue;

      await RRX.ext.storage.local.set({
        [CACHE_KEY]: { at: fetchedAt || Date.now(), tags: catalogue, full },
      });
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
    for (const a of scope.querySelectorAll(SEL.cardTag)) {
      const slug = decodeURIComponent((a.getAttribute('href') || '').split('tagsAdd=')[1] || '')
        .split('&')[0]
        .trim();
      const label = a.textContent.trim();
      if (slug && label && !found.has(slug)) found.set(slug, { slug, label });
    }
    return [...found.values()];
  }

  /** The 22 genres, which `#tagsAdd` does not carry a single one of. */
  function parseGenres(scope) {
    const out = [];
    for (const button of scope.querySelectorAll(SEL.genreButton)) {
      const slug = (button.getAttribute('data-tag') || '').trim();
      const named = button.querySelector(SEL.genreLabel);
      const label = ((named || button).textContent || '').trim();
      if (slug && label) out.push({ slug, label });
    }
    return out;
  }

  /** Royal Road's published vocabulary, which only `/fictions/search` states in
   *  full: the select and the genre buttons together, 94 on the capture. */
  function parseVocabulary(scope) {
    return [...parseSelect(scope.querySelector(SEL.tagSelect)), ...parseGenres(scope)];
  }

  /** Pull whatever the page we are already on can tell us. */
  function harvest(scope = document) {
    const vocabulary = parseVocabulary(scope);
    const tags = [...vocabulary, ...harvestChips(scope)];
    // Chips are a sample of what is published; the select and the genre buttons
    // are the thing itself, so only they can mark the catalogue complete.
    if (tags.length) save(tags, { full: vocabulary.length > 0 });
    return tags;
  }

  async function fetchCatalogue() {
    const response = await fetch(SOURCE_URL, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`tag list: HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const vocabulary = parseVocabulary(doc);
    if (!vocabulary.length) throw new Error('tag list: #tagsAdd had no options');
    fetchedAt = Date.now();
    return save([...vocabulary, ...harvestChips(doc)], { full: true });
  }

  /** Best available list, refreshing in the background when stale. Never throws:
   *  an empty list just means the pickers fall back to free text. */
  async function load() {
    // Free, and on `/fictions/search` it is the whole vocabulary rather than a
    // sample of it.
    harvest();
    if (full) return catalogue;

    let cached = null;
    try {
      cached = (await RRX.ext.storage.local.get(CACHE_KEY))[CACHE_KEY];
    } catch {
      /* fall through to the fetch */
    }

    if (cached && Array.isArray(cached.tags) && cached.tags.length) {
      fetchedAt = Number(cached.at) || 0;
      await save(cached.tags, { full: cached.full });
      const stale = Date.now() - (cached.at || 0) > MAX_AGE_MS;
      // Complete and fresh: done. Complete but stale: serve it now and refresh
      // quietly. Incomplete is the case that used to be indistinguishable from
      // the first, and it is worth waiting for - the reader is looking at a tag
      // picker that cannot offer what it does not know.
      if (full && !stale) return catalogue;
      if (full) {
        fetchCatalogue().catch(() => {});
        return catalogue;
      }
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

  /**
    * Tags whose label or slug contains `query`, best matches first.
    *
    * `limit` bounds ranking noise, so it does not apply to an empty query: there
    * is nothing to rank, and with nothing typed the menu is the only way to find
    * out which tags exist. Eight of seventy-odd, alphabetically, read as a list
    * that had failed to load. The menu scrolls.
    */
  function search(query, limit = 10) {
    const q = query.trim().toLowerCase();
    if (!q) return catalogue.slice();
    const starts = [];
    const contains = [];
    for (const tag of catalogue) {
      const label = tag.label.toLowerCase();
      if (label.startsWith(q)) starts.push(tag);
      else if (label.includes(q) || tag.slug.includes(q)) contains.push(tag);
    }
    return [...starts, ...contains].slice(0, limit);
  }

  RRX.tags = {
    load,
    all,
    harvest,
    harvestChips,
    parseGenres,
    parseVocabulary,
    isFull: () => full,
    search,
    labelFor,
    slugFor,
    parseSelect,
    CACHE_KEY,
  };
})(globalThis);
