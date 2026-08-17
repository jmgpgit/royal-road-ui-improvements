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

  /** `{ [fictionId]: { title, url, cover, <stamp> } }`. Metadata is captured off
   *  the card when the mark is made, so the manager renders covers and titles
   *  without hitting the network.
   *  @param {string} stamp the field holding when it happened, in ms */
  function normalizeMarks(raw, stamp) {
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
        [stamp]: Number.isFinite(Number(rec[stamp])) ? Number(rec[stamp]) : 0,
      };
    }
    return out;
  }

  /** Hidden and dropped are two maps rather than one with a flag: they are
   *  different answers ("never show me this" against "I read some and stopped"),
   *  a fiction can be both, and one map would make every read decide which kind
   *  of record it was looking at. */
  const normalizeHidden = (raw) => normalizeMarks(raw, 'hiddenAt');
  const normalizeDropped = (raw) => normalizeMarks(raw, 'droppedAt');

  const hiddenIds = (hidden) => normalizeIds(Object.keys(normalizeHidden(hidden)));
  const droppedIds = (dropped) => normalizeIds(Object.keys(normalizeDropped(dropped)));

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

  /** A record nothing has touched for this long goes, whatever it holds. A
   *  position deletes itself when the chapter is finished, but a chapter put
   *  down and never reopened had no expiry at all: those only ever left through
   *  the cap, which is a backstop rather than a policy. */
  const CHAPTERS_MAX_AGE_S = 365 * 24 * 60 * 60;

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
    {
      now = 0,
      seenMaxAgeS = SEEN_MAX_AGE_S,
      maxAgeS = CHAPTERS_MAX_AGE_S,
      max = CHAPTERS_MAX,
      keep = CHAPTERS_KEEP,
    } = {}
  ) {
    const src = chapters && typeof chapters === 'object' ? chapters : {};
    const out = {};

    for (const [id, rec] of Object.entries(src)) {
      const record = { ...rec };
      const age = now && record.a ? now - record.a : 0;
      if (age > seenMaxAgeS) delete record.s;
      // Untouched for a year: whatever it holds, nobody is coming back for it.
      if (age > maxAgeS) continue;
      // No position (`p`) and no watermark: nothing left anybody asks for.
      if (record.p === undefined && record.s === undefined && age > seenMaxAgeS) continue;
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

  // --- fiction statistics, and what changed since last time -----------------
  //
  // `{ [fictionId]: { now: <reading>, prev: <reading> } }`, where a reading is
  //
  //   a  when it was taken, unix SECONDS
  //   v  total views          w  average views per chapter
  //   f  followers            m  favourites
  //   r  how many people rated it                 p  pages
  //   c  chapters
  //   s  the overall score out of 5, to two decimals, and its four sub-scores
  //      the same way: sty style, sto story, gra grammar, cha character
  //
  // `now` is the last numbers seen; `prev` is the ones a delta is shown against.
  // Two slots rather than one because the two questions differ: "what does the
  // page say" is answered on every load, "what has moved since you last looked"
  // must survive a refresh. Rolling `prev` forward on every visit would make
  // reloading the page the way to erase the answer you just read.

  /** The scores, which are the fields carrying a fraction rather than a count. */
  const STAT_SCORES = ['s', 'sty', 'sto', 'gra', 'cha'];

  /** Every field of a reading but its timestamp, in the order Royal Road lays
   *  them out: the tiles, the scores below them, then the chapter count, which
   *  is on the table of contents. The summary reads in this order too. */
  const STAT_FIELDS = ['v', 'w', 'f', 'm', 'r', 'p', ...STAT_SCORES, 'c'];

  const isScore = (field) => STAT_SCORES.includes(field);

  /** How long a look lasts. Inside it a reload compares against the same
   *  baseline; past it, the numbers on screen become the next baseline.
   *
   *  It governs when the baseline moves, never whether there is one: gating both
   *  on it meant a second visit inside twelve hours only overwrote the last
   *  reading, so the day somebody switched the feature on it could not answer. */
  const LOOK_WINDOW_S = 12 * 60 * 60;

  /** How far back "since you last looked" may reach. Visits closer together
   *  than the window chain into one look that never ends, so somebody opening a
   *  fiction every few hours stayed measured against a baseline set weeks
   *  earlier and the figures grew without bound. Past this the baseline
   *  re-anchors even mid-look. */
  const MAX_SPAN_S = 7 * 24 * 60 * 60;

  /** Past this a baseline answers a question nobody asked, and it bounds a map
   *  that would otherwise grow for every fiction ever opened. */
  const STATS_MAX_AGE_S = 365 * 24 * 60 * 60;
  const STATS_MAX = 2000;
  const STATS_KEEP = 1500;

  function normalizeReading(raw) {
    const src = raw && typeof raw === 'object' ? raw : null;
    if (!src) return null;
    const at = Number(src.a);
    const out = { a: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0 };
    for (const field of STAT_FIELDS) {
      const n = Number(src[field]);
      if (!Number.isFinite(n) || n < 0) continue;
      out[field] = isScore(field) ? Math.round(n * 100) / 100 : Math.floor(n);
    }
    return out;
  }

  function normalizeStats(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const id = Number(key);
      if (!isValidId(id)) continue;
      const entry = src[key] && typeof src[key] === 'object' ? src[key] : {};
      const now = normalizeReading(entry.now);
      // Without a current reading there is nothing to compare next time, so the
      // record says nothing at all.
      if (!now) continue;
      const prev = normalizeReading(entry.prev);
      out[id] = prev ? { now, prev } : { now };
    }
    return out;
  }

  /**
   * Fold a fresh reading into a fiction's record.
   *
   * @param {object|null} entry what is stored for this fiction, if anything
   * @param {object} reading the numbers on the page now, without a timestamp
   * @param {{now:number, windowS?:number}} opts `now` in unix SECONDS
   */
  function rollStats(entry, reading, { now, windowS = LOOK_WINDOW_S, maxSpanS = MAX_SPAN_S } = {}) {
    const taken = normalizeReading({ ...reading, a: now });
    if (!taken) return null;

    const previous = entry && typeof entry === 'object' ? normalizeStats({ 1: entry })[1] : null;
    // Nothing seen before: this visit is the first thing to compare against.
    if (!previous) return { now: taken };

    // Second visit ever, whenever it comes. The comparison starts as soon as
    // there is an earlier reading to make it against - waiting for the window
    // here is what made the feature silent for its first half-day.
    if (!previous.prev) return { now: taken, prev: previous.now };

    // A new look: a real gap since the last visit. What was on screen last time
    // becomes what this one is measured against, and it is at least a window
    // old, which is what stops a burst of visits collapsing the span.
    if (now - previous.now.a >= windowS) return { now: taken, prev: previous.now };

    // Same look, so keep the baseline: a reload must not quietly answer its own
    // question. Except once the span has outgrown what "since you last looked"
    // can honestly mean - visits closer together than the window would otherwise
    // chain into a single look with no end.
    if (now - previous.prev.a >= maxSpanS) return { now: taken, prev: previous.now };

    return { now: taken, prev: previous.prev };
  }

  /**
   * What has changed since the reader last looked.
   *
   * Every field that can be compared, zeros included: each is written under its
   * own figure, and one left blank among annotated neighbours reads as a figure
   * the extension failed to read. A field missing from either reading is left
   * out entirely - that one really was not compared.
   *
   * @returns {{since:number, changes:Array<[string, number]>}|null} null on a
   *   first visit, and null when nothing moved at all - there is no line worth
   *   drawing to say a fiction is exactly where you left it.
   */
  function statsDelta(entry) {
    const record = entry && typeof entry === 'object' ? normalizeStats({ 1: entry })[1] : null;
    if (!record || !record.prev) return null;

    const changes = [];
    let moved = false;
    for (const field of STAT_FIELDS) {
      const before = record.prev[field];
      const after = record.now[field];
      if (before === undefined || after === undefined) continue; // unread, not zero
      const change = isScore(field) ? Math.round((after - before) * 100) / 100 : after - before;
      if (change) moved = true;
      changes.push([field, change]);
    }
    return moved ? { since: record.prev.a, changes } : null;
  }

  /** Oldest out first, and anything whose newest reading has gone stale. The
   *  order is asserted in the tests: a cap that drops the wrong records still
   *  looks like it is working. */
  function pruneStats(
    stats,
    { now = 0, maxAgeS = STATS_MAX_AGE_S, max = STATS_MAX, keep = STATS_KEEP } = {}
  ) {
    const src = normalizeStats(stats);
    const out = {};
    for (const [id, record] of Object.entries(src)) {
      if (now && record.now.a && now - record.now.a > maxAgeS) continue;
      out[id] = record;
    }

    const entries = Object.entries(out);
    if (entries.length <= max) return out;

    entries.sort((a, b) => (b[1].now.a || 0) - (a[1].now.a || 0));
    const capped = {};
    for (const [id, record] of entries.slice(0, keep)) capped[id] = record;
    return capped;
  }

  // --- synchronous boot mirror --------------------------------------------
  // browser.storage.local is async, which races first paint. Content scripts run
  // in the page's origin, so localStorage reads synchronously at document_start,
  // before Royal Road's deferred module scripts: no flash of soon-to-be-hidden
  // cards, and Embla never measures the carousel slides we are about to hide.

  function buildMirror(settings, hidden, dropped) {
    return {
      v: 1,
      settings: normalizeSettings(settings),
      ids: hiddenIds(hidden),
      dropped: droppedIds(dropped),
    };
  }

  /** Never throws - a corrupt mirror just means we boot with defaults. `v` does
   *  not move when a field is added: absent reads as empty, and an install that
   *  has not run since the field existed still gets its settings and hidden ids
   *  before paint rather than none of it. */
  function parseMirror(rawJson) {
    try {
      const data = JSON.parse(rawJson);
      if (!data || data.v !== 1) return null;
      return {
        settings: normalizeSettings(data.settings),
        ids: normalizeIds(data.ids),
        dropped: normalizeIds(data.dropped),
      };
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
      dropped: normalizeDropped(src.dropped),
      chapters: normalizeChapters(src.chapters),
      stats: normalizeStats(src.stats),
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
      // Absent in a backup written before their feature existed; normalise to
      // {} rather than failing the import.
      dropped: normalizeDropped(data.dropped),
      chapters: normalizeChapters(data.chapters),
      stats: normalizeStats(data.stats),
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
    normalizeDropped,
    hiddenIds,
    droppedIds,
    normalizeChapters,
    pruneChapters,
    CHAPTERS_MAX,
    SEEN_MAX_AGE_S,
    CHAPTERS_MAX_AGE_S,
    STAT_FIELDS,
    STAT_SCORES,
    LOOK_WINDOW_S,
    MAX_SPAN_S,
    STATS_MAX,
    STATS_MAX_AGE_S,
    normalizeStats,
    rollStats,
    statsDelta,
    pruneStats,
    buildMirror,
    parseMirror,
    buildBackup,
    parseBackup,
  };
});
