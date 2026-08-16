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
   * Extract a chapter id from any Royal Road URL.
   *
   * Matches /chapter/3766643 and /chapter/3766643/slug, relative or absolute,
   * so a full /fiction/149588/slug/chapter/3766643/x answers both this and
   * `fictionIdFromHref` - which is exactly what a chapter page needs.
   *
   * Deliberately does NOT match /fiction/149588: a fiction is not a chapter,
   * and a caller that conflated the two would look up nonsense.
   */
  function chapterIdFromHref(href) {
    if (typeof href !== 'string') return null;
    const m = /\/chapter\/(\d+)(?=[/?#]|$)/.exec(href);
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

  // --- reading progress -----------------------------------------------------
  //
  // `{ [chapterId]: { f, a, p, o, n, len } }`, one record per chapter opened.
  //
  //   f   the fiction it belongs to, 0 when unknown
  //   a   when it was last open, unix SECONDS (milliseconds cost three bytes a
  //       record for precision nothing here needs)
  //   p   index of the block in `.chapter-content` at the top of the viewport
  //   o   how far into that block, 0..1
  //   n   how many blocks the chapter had, and
  //   len how long its text was - together, the edit detector: a chapter that
  //       has been rewritten under a saved position must not be restored to a
  //       paragraph that is now a different scene
  //   s   the newest comment already seen on this chapter, unix seconds. Kept
  //       here rather than in its own key because it is the same grain and the
  //       same write: one record per chapter, one flush on the way out
  //   d   how much of the chapter's TEXT had been on screen, 0..1. Measured
  //       against the chapter box rather than the page, which grows when the
  //       comments load, and reported to the reader as a percentage
  //
  // Short names because this is the one map that grows without a ceiling and is
  // re-serialised whole on every write. It is machine-read and never hand-edited;
  // the legend is here and nowhere else.

  /** Keep the newest, and drop the emptiest first. */
  const CHAPTERS_MAX = 20000;
  const CHAPTERS_KEEP = 18000;

  /**
   * How long a comment watermark is worth keeping, in seconds.
   *
   * Two reasons, and they point the same way. Coming back to a chapter after
   * two months, "what is new since June" is not a useful question and the
   * comments are worth seeing afresh. And a watermark is the one thing here
   * that would otherwise accumulate forever: a reading position deletes itself
   * when the chapter is finished, but a watermark would be kept for every
   * chapter whose comments were ever loaded.
   */
  const SEEN_MAX_AGE_S = 60 * 24 * 60 * 60;

  function normalizeChapters(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const id = Number(key);
      if (!isValidId(id)) continue;
      const rec = src[key] && typeof src[key] === 'object' ? src[key] : {};

      const int = (value, min) => {
        const n = Number(value);
        return Number.isFinite(n) && n >= min ? Math.floor(n) : null;
      };

      const record = { f: int(rec.f, 1) || 0, a: int(rec.a, 0) || 0 };
      const seen = int(rec.s, 1);
      if (seen !== null) record.s = seen;
      const p = int(rec.p, 0);
      if (p !== null) {
        record.p = p;
        const o = Number(rec.o);
        record.o = Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 0;
        const n = int(rec.n, 0);
        const len = int(rec.len, 0);
        if (n !== null) record.n = n;
        if (len !== null) record.len = len;
        const d = Number(rec.d);
        if (Number.isFinite(d)) record.d = Math.min(1, Math.max(0, d));
      }

      // A record whose every field was junk still keeps its key: the key is
      // itself the fact that this chapter was opened, and throwing it away
      // would lose real reading history to one bad number.
      out[id] = record;
    }
    return out;
  }

  /**
   * Drop what is no longer worth keeping.
   *
   * Two passes, because the two things a record holds have different lifetimes.
   *
   * A watermark expires after `SEEN_MAX_AGE_S` (see there). A reading position
   * does not: somebody who put a chapter down half way through last spring
   * still wants it back, and unlike a watermark it deletes itself as soon as
   * they finish the chapter, so it cannot pile up the same way. A record left
   * holding neither is dropped: its only remaining fact is that the chapter was
   * once opened, which nothing reads.
   *
   * The cap is the backstop after that, oldest first, and records with no
   * position before ones that have one.
   *
   * @param {number} now unix SECONDS, passed in because this module has no clock
   */
  function pruneChapters(
    chapters,
    { now = 0, seenMaxAgeS = SEEN_MAX_AGE_S, max = CHAPTERS_MAX, keep = CHAPTERS_KEEP } = {}
  ) {
    const src = chapters && typeof chapters === 'object' ? chapters : {};
    const out = {};

    for (const [id, rec] of Object.entries(src)) {
      const record = { ...rec };
      const stale = now && record.a && now - record.a > seenMaxAgeS;
      if (stale) delete record.s;
      // `p` is the position; without it and without a watermark there is
      // nothing here anybody asks for.
      if (record.p === undefined && record.s === undefined && stale) continue;
      out[id] = record;
    }

    const entries = Object.entries(out);
    if (entries.length <= max) return out;

    entries.sort((a, b) => {
      const aHas = a[1] && a[1].p !== undefined ? 1 : 0;
      const bHas = b[1] && b[1].p !== undefined ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return (b[1].a || 0) - (a[1].a || 0);
    });

    const capped = {};
    for (const [id, rec] of entries.slice(0, keep)) capped[id] = rec;
    return capped;
  }

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

  /**
   * `BACKUP_VERSION` does NOT move when a section is added. parseBackup only
   * refuses files *newer* than itself, so bumping would make an older install
   * reject a whole file it could have restored the settings and hidden list
   * from perfectly well. Bump it when an existing field changes meaning.
   *
   * Takes the state object rather than one argument per section, so the next
   * thing worth backing up does not change this signature again.
   */
  function buildBackup(state, now) {
    const src = state && typeof state === 'object' ? state : {};
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date(Number(now) || 0).toISOString(),
      settings: normalizeSettings(src.settings),
      hidden: normalizeHidden(src.hidden),
      chapters: normalizeChapters(src.chapters),
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
      // Absent in a backup written before reading progress existed, which
      // normalises to {} rather than failing the import.
      chapters: normalizeChapters(data.chapters),
    };
  }

  return {
    MIRROR_KEY,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    // Re-exported from schema.js so callers only ever reach for one namespace.
    normalizeSettings,
    fictionIdFromHref,
    chapterIdFromHref,
    fictionIdFromBlurbId,
    pageFromPath,
    normalizeIds,
    normalizeHidden,
    hiddenIds,
    normalizeChapters,
    pruneChapters,
    CHAPTERS_MAX,
    SEEN_MAX_AGE_S,
    buildMirror,
    parseMirror,
    buildBackup,
    parseBackup,
  };
});
