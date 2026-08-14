'use strict';

/**
 * Pure data logic: fiction-id parsing, the hidden-fiction map, the synchronous
 * boot mirror, and backup import/export.
 *
 * Settings validation lives in schema.js; this module only re-exports it so the
 * rest of the codebase has one place (`RRX`) to reach for either.
 *
 * Nothing here touches extension APIs or the network, so it is all unit-testable
 * under `node --test` (see test/model.test.js).
 */
(function (root, factory) {
  const schema = typeof module !== 'undefined' && module.exports
    ? require('./schema.js')
    : root.RRX;
  const api = factory(schema);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema) {
  const MIRROR_KEY = 'rrx:v1:boot';
  const BACKUP_FORMAT = 'royal-road-ui-improvements';
  const BACKUP_VERSION = 1;

  const { normalizeSettings } = schema;

  /**
   * Extract a fiction id from any Royal Road URL.
   *
   * Matches /fiction/181303, /fiction/181303/slug, /fiction/181303/read,
   * /fiction/181303/slug/chapter/123/x and absolute forms of the same.
   * Deliberately does NOT match /fictions/... (the list pages).
   */
  function fictionIdFromHref(href) {
    if (typeof href !== 'string') return null;
    const m = /\/fiction\/(\d+)(?=[/?#]|$)/.exec(href);
    return m ? Number(m[1]) : null;
  }

  /**
   * Which kind of Royal Road page a path is.
   *
   * Lives here, in the pure module, because boot.js needs it at document_start
   * (before there is a DOM to inspect) and main.js needs the same answer later.
   * Two copies of this would drift.
   *
   * @returns {'list'|'chapter'|'fiction'|'home'|'other'}
   */
  function pageFromPath(pathname) {
    const p = String(pathname || '');
    if (/^\/fiction\/\d+\/[^/]+\/chapter\//.test(p)) return 'chapter';
    if (/^\/fiction\/\d+(\/|$)/.test(p)) return 'fiction';
    if (p.startsWith('/fictions/')) return 'list';
    if (p === '/home' || p === '/') return 'home';
    return 'other';
  }

  /** Extract the fiction id from a `show-more-blurb-181303` checkbox id. */
  function fictionIdFromBlurbId(id) {
    if (typeof id !== 'string') return null;
    const m = /^show-more-blurb-(\d+)$/.exec(id);
    return m ? Number(m[1]) : null;
  }

  const isValidId = (n) => Number.isInteger(n) && n > 0;

  /** De-duplicated, validated, ascending list of fiction ids. */
  function normalizeIds(ids) {
    if (!Array.isArray(ids)) return [];
    const out = new Set();
    for (const raw of ids) {
      const n = Number(raw);
      if (isValidId(n)) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  }

  /**
   * The hidden store is `{ [fictionId]: { title, url, cover, hiddenAt } }`.
   * Metadata is captured off the card at hide time so the manager can render
   * covers and titles without hitting the network.
   */
  function normalizeHidden(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const id = Number(key);
      if (!isValidId(id)) continue;
      const rec = src[key] && typeof src[key] === 'object' ? src[key] : {};
      out[id] = {
        title: typeof rec.title === 'string' && rec.title ? rec.title : `Fiction ${id}`,
        url: typeof rec.url === 'string' && rec.url ? rec.url : `/fiction/${id}`,
        cover: typeof rec.cover === 'string' ? rec.cover : '',
        hiddenAt: Number.isFinite(Number(rec.hiddenAt)) ? Number(rec.hiddenAt) : 0,
      };
    }
    return out;
  }

  const hiddenIds = (hidden) => normalizeIds(Object.keys(normalizeHidden(hidden)));

  // --- synchronous boot mirror --------------------------------------------
  // browser.storage.local is async, which races first paint. Content scripts run
  // in the page's origin, so localStorage gives us a synchronous read at
  // document_start - before Royal Road's deferred module scripts run. That kills
  // the flash of soon-to-be-hidden cards AND means Embla never measures the
  // carousel slides we are about to hide.

  function buildMirror(settings, hidden) {
    return { v: 1, settings: normalizeSettings(settings), ids: hiddenIds(hidden) };
  }

  /** Never throws - a corrupt mirror just means we boot with defaults. */
  function parseMirror(rawJson) {
    try {
      const data = JSON.parse(rawJson);
      if (!data || data.v !== 1) return null;
      return { settings: normalizeSettings(data.settings), ids: normalizeIds(data.ids) };
    } catch {
      return null;
    }
  }

  // --- backup --------------------------------------------------------------

  function buildBackup(settings, hidden, now) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date(Number(now) || 0).toISOString(),
      settings: normalizeSettings(settings),
      hidden: normalizeHidden(hidden),
    };
  }

  /** Throws an Error with a user-facing message when the file is not ours. */
  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    if (!data || typeof data !== 'object') throw new Error('That file is not a backup.');
    if (data.format !== BACKUP_FORMAT) {
      throw new Error('That file was not exported by UI Improvements for Royal Road.');
    }
    if (Number(data.version) > BACKUP_VERSION) {
      throw new Error('That backup was made by a newer version of the extension.');
    }
    return {
      settings: normalizeSettings(data.settings),
      hidden: normalizeHidden(data.hidden),
    };
  }

  return {
    MIRROR_KEY,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    // Re-exported from schema.js so callers only ever reach for one namespace.
    normalizeSettings,
    fictionIdFromHref,
    fictionIdFromBlurbId,
    pageFromPath,
    normalizeIds,
    normalizeHidden,
    hiddenIds,
    buildMirror,
    parseMirror,
    buildBackup,
    parseBackup,
  };
});
