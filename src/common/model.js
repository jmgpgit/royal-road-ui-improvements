'use strict';

/**
 * Pure data logic: fiction-id parsing, the hidden-fiction map, the synchronous
 * boot mirror, and backup import/export. Settings validation lives in schema.js
 * and is re-exported here so callers reach for one namespace (`RRX`).
 *
 * No extension APIs and no network, so it is all unit-testable under
 * `node --test` (test/model.test.js).
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
   * Extract a fiction id from any Royal Road URL: /fiction/181303,
   * /fiction/181303/slug, /fiction/181303/read, /fiction/181303/slug/chapter/123/x
   * and absolute forms. Deliberately not /fictions/... (the list pages).
   */
  function fictionIdFromHref(href) {
    if (typeof href !== 'string') return null;
    const m = /\/fiction\/(\d+)(?=[/?#]|$)/.exec(href);
    return m ? Number(m[1]) : null;
  }

  /**
   * Extract a chapter id from any Royal Road URL: /chapter/3766643 and
   * /chapter/3766643/slug, relative or absolute. A full
   * /fiction/149588/slug/chapter/3766643/x answers this and `fictionIdFromHref`,
   * which is what a chapter page needs. Deliberately not /fiction/149588: a
   * caller that conflated the two would look up nonsense.
   */
  function chapterIdFromHref(href) {
    if (typeof href !== 'string') return null;
    const m = /\/chapter\/(\d+)(?=[/?#]|$)/.exec(href);
    return m ? Number(m[1]) : null;
  }

  /**
   * Which kind of Royal Road page a path is. Here, in the pure module, because
   * boot.js needs it at document_start (before there is a DOM to inspect) and
   * main.js needs the same answer later; two copies would drift.
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

  /** `{ [fictionId]: { title, url, cover, hiddenAt } }`. Metadata is captured off
   *  the card at hide time so the manager renders covers and titles without
   *  hitting the network. */
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
  //   a   when it was last open, unix SECONDS (ms would cost three bytes a
  //       record for precision nothing here needs)
  //   p   index of the block in `.chapter-content` at the top of the viewport
  //   o   how far into that block, 0..1
  //   n   how many blocks the chapter had, and
  //   len how long its text was - the edit detector: a chapter rewritten under a
  //       saved position must not be restored to what is now a different scene
  //   s   newest comment already seen on this chapter, unix seconds. Kept in this
  //       record rather than its own key: same grain, same write
  //   d   how much of the chapter's text had been on screen, 0..1. Measured
  //       against the chapter box, not the page, which grows when the comments
  //       load; shown to the reader as a percentage
  //
  // Short names because this map grows without a ceiling and is re-serialised
  // whole on every write. Machine-read, never hand-edited; the legend lives here
  // and nowhere else.

  /** Keep the newest, and drop the emptiest first. */
  const CHAPTERS_MAX = 20000;
  const CHAPTERS_KEEP = 18000;

  /** How long a comment watermark is worth keeping, in seconds. Two months on,
   *  "what is new since June" is not a useful question. And unlike a reading
   *  position - which deletes itself when the chapter is finished - a watermark
   *  would otherwise be kept for every chapter whose comments ever loaded. */
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

      // All-junk fields still keep the key: the key is itself the fact that the
      // chapter was opened, and dropping it loses real history to one bad number.
      out[id] = record;
    }
    return out;
  }

  /**
   * Drop what is no longer worth keeping. A watermark expires after
   * `SEEN_MAX_AGE_S`; a reading position does not - somebody who put a chapter
   * down half way through last spring still wants it back, and it deletes itself
   * once they finish the chapter, so it cannot pile up the same way. A record
   * left holding neither goes: all it still says is that the chapter was opened,
   * which nothing reads. The cap is the backstop after that, oldest first and
   * positionless records before ones with a position.
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
      // No position (`p`) and no watermark: nothing left anybody asks for.
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
  // in the page's origin, so localStorage reads synchronously at document_start,
  // before Royal Road's deferred module scripts: no flash of soon-to-be-hidden
  // cards, and Embla never measures the carousel slides we are about to hide.

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
   * `BACKUP_VERSION` does not move when a section is added: parseBackup only
   * refuses files newer than itself, so bumping would make an older install
   * reject a whole file it could have restored settings and the hidden list from.
   * Bump it when an existing field changes meaning.
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
      // Absent in a backup written before reading progress existed; normalises
      // to {} rather than failing the import.
      chapters: normalizeChapters(data.chapters),
    };
  }

  return {
    MIRROR_KEY,
    BACKUP_FORMAT,
    BACKUP_VERSION,
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
