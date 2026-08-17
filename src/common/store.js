'use strict';

/**
 * Persistence. `browser.storage.local` is the source of truth; a compact copy is
 * mirrored into royalroad.com's own localStorage so document_start can read it
 * synchronously (model.js -> buildMirror). Only content scripts can write that
 * origin, so options/popup changes reach it via `storage.onChanged` in an open
 * Royal Road tab, and boot.js repairs it from the store on the next load.
 */
(function (root) {
  const RRX = (root.RRX = root.RRX || {});
  if (RRX.store) return;

  const ext = RRX.ext;
  const KEY_SETTINGS = 'settings';
  const KEY_HIDDEN = 'hidden';
  const KEY_DROPPED = 'dropped';
  const KEY_CHAPTERS = 'chapters';
  const KEY_STATS = 'stats';
  /** When housekeeping last ran. One number, and the reason it exists is below. */
  const KEY_TIDIED = 'tidiedAt';
  const TIDY_EVERY_MS = 24 * 60 * 60 * 1000;

  /** Scroll scratchpad, in royalroad.com's own localStorage. See `writePosition`. */
  const POS_KEY = 'rrx:v1:pos';
  const POS_MAX = 300;

  async function load() {
    const raw = await ext.storage.local.get([KEY_SETTINGS, KEY_HIDDEN, KEY_DROPPED]);
    return {
      settings: RRX.normalizeSettings(raw[KEY_SETTINGS]),
      hidden: RRX.normalizeHidden(raw[KEY_HIDDEN]),
      dropped: RRX.normalizeDropped(raw[KEY_DROPPED]),
    };
  }

  /** Reading progress, deliberately not part of `load()`: every page pays for that
   *  one, only chapter pages need this, and it is the one map with no ceiling - a
   *  list page should not deserialise thousands of records to draw a toolbar. */
  async function loadChapters() {
    const raw = await ext.storage.local.get(KEY_CHAPTERS);
    return RRX.normalizeChapters(raw[KEY_CHAPTERS]);
  }

  /** Fiction statistics, kept out of `load()` for the same reason as chapters:
   *  only fiction pages need it, and every other page would pay to deserialise
   *  it. It is also out of `onChange`, so recording a snapshot in one tab does
   *  not rebuild the toolbar in every other. */
  async function loadStats() {
    const raw = await ext.storage.local.get(KEY_STATS);
    return RRX.normalizeStats(raw[KEY_STATS]);
  }

  /**
   * Fold this visit's numbers into a fiction's record, and return the record so
   * the caller can say what changed. Re-read inside the call, like `markChapter`.
   *
   * @param {number} fictionId
   * @param {object} reading the numbers read off the page, without a timestamp
   */
  async function markFictionStats(fictionId, reading) {
    const id = Number(fictionId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const stats = await loadStats();
    const now = Math.floor(Date.now() / 1000);
    const record = RRX.rollStats(stats[id], reading, { now });
    if (!record) return null;

    // Re-read before writing: the write is the whole map, and opening several
    // fiction pages at once means several tabs doing this at the same moment, so
    // whichever read first would otherwise write back a map missing everything
    // recorded since. storage.local has no compare-and-set, so this narrows the
    // window rather than closing it.
    const fresh = await loadStats();
    const next = RRX.pruneStats({ ...fresh, [id]: record }, { now });
    await ext.storage.local.set({ [KEY_STATS]: next });
    // What was stored, which is not always what was passed: a record can be
    // pruned away in the same write that made it.
    return next[id] || null;
  }

  async function forgetStats() {
    await ext.storage.local.set({ [KEY_STATS]: {} });
    return {};
  }

  /**
   * Age out the two growing maps, whatever is or is not still writing to them.
   *
   * Both prunes live inside their own write path, and every write path is behind
   * a setting - so turning the reading features off stopped the writes *and* the
   * expiries, and what was there stayed for good. An expiry that only runs while
   * the feature is on is not an expiry, it is a side effect of continued use.
   *
   * Once a day, from any Royal Road page. The cost on all the other loads is one
   * read of a single number.
   *
   * @returns {boolean} whether housekeeping actually ran
   */
  async function tidy() {
    const raw = await ext.storage.local.get(KEY_TIDIED);
    // A negative elapsed means the stamp is in the future - a clock that jumped
    // forward and came back. Treated as due, or housekeeping would stop until
    // real time caught up with the jump.
    const elapsed = Date.now() - (Number(raw[KEY_TIDIED]) || 0);
    if (elapsed >= 0 && elapsed < TIDY_EVERY_MS) return false;
    // Stamped before the work, so a failure half way through cannot put every
    // page load into a retry loop over a map this size.
    await ext.storage.local.set({ [KEY_TIDIED]: Date.now() });

    const now = Math.floor(Date.now() / 1000);
    const { settings } = await load();
    // Threaded, never defaulted: pruning against the built-in 60 days would
    // silently override whatever the reader set `comments.seenDays` to - the
    // 1.4.1 bug, from the other direction.
    const seenMaxAgeS = (settings['comments.seenDays'] || 60) * 86400;

    for (const [key, load1, prune] of [
      [KEY_CHAPTERS, loadChapters, (map) => RRX.pruneChapters(map, { now, seenMaxAgeS })],
      [KEY_STATS, loadStats, (map) => RRX.pruneStats(map, { now })],
    ]) {
      const before = await load1();
      // Compared rather than written blind: at the chapter map's ceiling this is
      // megabytes, and most days there is nothing to drop.
      if (JSON.stringify(prune(before)) === JSON.stringify(before)) {
        if (key === KEY_CHAPTERS) prunePositions(before);
        continue;
      }
      // Re-read and re-prune before writing. Housekeeping runs at document_end
      // alongside the features that write these maps, and the write is the whole
      // map: without this, a record written while the prune was deciding was
      // read back stale and clobbered by it.
      const fresh = await load1();
      const next = prune(fresh);
      await ext.storage.local.set({ [key]: next });
      if (key === KEY_CHAPTERS) prunePositions(next);
    }
    return true;
  }

  /** Drop scratchpad entries for chapters the store no longer knows about -
   *  what "forget reading history" leaves behind when no Royal Road tab was open
   *  to hear it. Recent ones are kept: the scratchpad exists precisely because
   *  the flush on the way out may not have landed yet. */
  function prunePositions(chapters) {
    try {
      const pos = readPositions();
      const cutoff = Math.floor((Date.now() - TIDY_EVERY_MS) / 1000);
      let dropped = false;
      for (const id of Object.keys(pos)) {
        if (chapters[id] || (pos[id] && (pos[id].a || 0) > cutoff)) continue;
        delete pos[id];
        dropped = true;
      }
      if (dropped) root.localStorage.setItem(POS_KEY, JSON.stringify({ v: 1, pos }));
    } catch {
      /* no-op */
    }
  }

  /**
   * Merges rather than replaces, and re-reads inside the call the way `hide` does,
   * so a long-lived tab holding a stale copy cannot resurrect pruned records.
   * @param {number} chapterId
   * @param {{f?:number,a?:number,p?:number,o?:number,n?:number,len?:number}} patch
   */
  async function markChapter(chapterId, patch, { seenMaxAgeS } = {}) {
    const id = Number(chapterId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const chapters = await loadChapters();
    const now = Math.floor(Date.now() / 1000);
    // Stamped on every write; without it there is no telling how old a record is.
    const merged = { ...chapters, [id]: { ...(chapters[id] || {}), a: now, ...(patch || {}) } };
    const next = RRX.pruneChapters(RRX.normalizeChapters(merged), { now, seenMaxAgeS });
    await ext.storage.local.set({ [KEY_CHAPTERS]: next });
    return next[id] || null;
  }

  /** Drops the reading position, not the comment watermark: the two halves of a
   *  record have different lifetimes. Finishing a chapter says nothing about which
   *  comments were seen, so the record goes only when both halves are gone. */
  async function forgetPosition(chapterId) {
    const id = Number(chapterId);
    const chapters = await loadChapters();
    const record = chapters[id];
    if (!record) return chapters;

    const kept = { ...record };
    for (const field of ['p', 'o', 'n', 'len', 'd']) delete kept[field];
    if (kept.s === undefined) delete chapters[id];
    else chapters[id] = kept;

    await ext.storage.local.set({ [KEY_CHAPTERS]: chapters });
    return chapters;
  }

  /** Drop one chapter's record entirely, both halves. */
  async function forgetChapter(chapterId) {
    const id = Number(chapterId);
    const chapters = await loadChapters();
    if (!(id in chapters)) return chapters;
    delete chapters[id];
    await ext.storage.local.set({ [KEY_CHAPTERS]: chapters });
    return chapters;
  }

  async function forgetChapters() {
    await ext.storage.local.set({ [KEY_CHAPTERS]: {} });
    return {};
  }

  /**
   * What a settings write has to clean up after itself.
   *
   * Switching the fiction readings off throws away what was read: "nothing is
   * saved while this is off" has to mean nothing is kept either. Unlike the
   * hidden and dropped lists, this is not something the reader wrote and cannot
   * be browsed or restored, so there is nothing to keep it for.
   *
   * Shared because there are three ways to arrive at the setting being off -
   * changing it, resetting every setting, and importing a backup - and only the
   * first of them used to notice.
   */
  async function settleSettings(next) {
    if (!next['fiction.statDeltas']) await forgetStats();
    return next;
  }

  async function saveSettings(patch) {
    const { settings } = await load();
    const next = RRX.normalizeSettings({ ...settings, ...patch });
    await ext.storage.local.set({ [KEY_SETTINGS]: next });
    if (settings['fiction.statDeltas']) await settleSettings(next);
    return next;
  }

  /**
   * @param {number} id
   * @param {{title?:string,url?:string,cover?:string}} meta captured off the card
   *        before it disappears, so the manager can render it without a fetch.
   */
  async function hide(id, meta) {
    const { hidden } = await load();
    const next = { ...hidden, [id]: { ...(meta || {}), hiddenAt: Date.now() } };
    const normalized = RRX.normalizeHidden(next);
    await ext.storage.local.set({ [KEY_HIDDEN]: normalized });
    return normalized;
  }

  async function unhide(id) {
    const { hidden } = await load();
    const next = { ...hidden };
    delete next[Number(id)];
    await ext.storage.local.set({ [KEY_HIDDEN]: next });
    return next;
  }

  async function unhideAll() {
    await ext.storage.local.set({ [KEY_HIDDEN]: {} });
    return {};
  }

  /** @param {{title?:string,url?:string,cover?:string}} meta as for `hide` */
  async function drop(id, meta) {
    const { dropped } = await load();
    const next = RRX.normalizeDropped({ ...dropped, [id]: { ...(meta || {}), droppedAt: Date.now() } });
    await ext.storage.local.set({ [KEY_DROPPED]: next });
    return next;
  }

  async function undrop(id) {
    const { dropped } = await load();
    const next = { ...dropped };
    delete next[Number(id)];
    await ext.storage.local.set({ [KEY_DROPPED]: next });
    return next;
  }

  async function undropAll() {
    await ext.storage.local.set({ [KEY_DROPPED]: {} });
    return {};
  }

  /** Used by import. Replaces every key wholesale. */
  async function replaceAll({ settings, hidden, dropped, chapters, stats }) {
    const next = {
      [KEY_SETTINGS]: RRX.normalizeSettings(settings),
      [KEY_HIDDEN]: RRX.normalizeHidden(hidden),
      [KEY_DROPPED]: RRX.normalizeDropped(dropped),
      [KEY_CHAPTERS]: RRX.normalizeChapters(chapters),
      [KEY_STATS]: RRX.normalizeStats(stats),
    };
    await ext.storage.local.set(next);
    // An imported file can carry readings alongside a setting that says they are
    // not kept. The setting wins, or importing would be a way to put back what
    // switching it off is meant to remove.
    await settleSettings(next[KEY_SETTINGS]);

    const kept = next[KEY_SETTINGS]['fiction.statDeltas'] ? next[KEY_STATS] : {};
    return {
      settings: next[KEY_SETTINGS],
      hidden: next[KEY_HIDDEN],
      dropped: next[KEY_DROPPED],
      chapters: next[KEY_CHAPTERS],
      stats: kept,
    };
  }

  /** Settings only. Reset went through `replaceAll` for a while, which meant every
   *  future key had to be threaded through it or be silently dropped. */
  async function resetSettings() {
    const next = RRX.normalizeSettings({});
    await ext.storage.local.set({ [KEY_SETTINGS]: next });
    // Reset returns every setting to its default, and this one's default is off.
    return settleSettings(next);
  }

  /** Changes from any context - other tabs, options page, popup.
   *  @returns {() => void} unsubscribe */
  function onChange(callback) {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      // `chapters` and `stats` are deliberately absent: their subscriber would be main.js, which
      // rebuilds the toolbar, re-syncs every card and re-enters every feature's
      // onPage in every open Royal Road tab - absurd for somebody scrolling a
      // chapter, which is what writes this key. The next page load reads the truth.
      if (!(KEY_SETTINGS in changes) && !(KEY_HIDDEN in changes) && !(KEY_DROPPED in changes)) return;
      load().then(callback);
    };
    ext.storage.onChanged.addListener(listener);
    return () => ext.storage.onChanged.removeListener(listener);
  }

  /** The boot mirror. Only meaningful from a content script, where localStorage
   *  belongs to royalroad.com; failure costs the no-flicker path, not correctness. */
  function writeMirror(settings, hidden, dropped) {
    try {
      const payload = JSON.stringify(RRX.buildMirror(settings, hidden, dropped));
      if (root.localStorage.getItem(RRX.MIRROR_KEY) !== payload) {
        root.localStorage.setItem(RRX.MIRROR_KEY, payload);
      }
    } catch {
      /* no-op */
    }
  }

  // --- the scroll scratchpad -------------------------------------------------
  // Scroll writes are too frequent for storage.local: each re-serialises the whole
  // chapter map, and is async, so the last before the tab closes may never land.
  // storage.local gets one write per visit on the way out; whatever did not make
  // it is reconciled from here on the next load.

  function readPositions() {
    try {
      const raw = root.localStorage.getItem(POS_KEY);
      const data = raw ? JSON.parse(raw) : null;
      return data && data.v === 1 && data.pos && typeof data.pos === 'object' ? data.pos : {};
    } catch {
      return {};
    }
  }

  function writePosition(chapterId, position) {
    try {
      const pos = readPositions();
      pos[Number(chapterId)] = position;

      // Oldest out first, bounded because this shares royalroad.com's origin
      // budget with the boot mirror. The timestamp is `a`, the same short name the
      // stored record uses; it read `.at` here for a while, which no writer sets,
      // so every comparison came out 0, the sort held its input order, and
      // integer-like keys enumerate ascending - the cap dropped the lowest chapter
      // id rather than the oldest. It stayed hidden because the cap still worked.
      const keys = Object.keys(pos);
      if (keys.length > POS_MAX) {
        keys
          .sort((a, b) => (pos[a].a || 0) - (pos[b].a || 0))
          .slice(0, keys.length - POS_MAX)
          .forEach((key) => delete pos[key]);
      }
      root.localStorage.setItem(POS_KEY, JSON.stringify({ v: 1, pos }));
    } catch {
      /* blocked or full storage costs the fast path, not correctness */
    }
  }

  /** The whole scratchpad. Only a content script can do this - it is
   *  royalroad.com's localStorage, not the extension's - so the options page
   *  cannot, and `tidy` and the storage listener in main.js do it instead. */
  function clearPositions() {
    try {
      root.localStorage.removeItem(POS_KEY);
    } catch {
      /* no-op */
    }
  }

  function clearPosition(chapterId) {
    try {
      const pos = readPositions();
      delete pos[Number(chapterId)];
      root.localStorage.setItem(POS_KEY, JSON.stringify({ v: 1, pos }));
    } catch {
      /* no-op */
    }
  }

  RRX.store = {
    load,
    loadChapters,
    loadStats,
    markFictionStats,
    forgetStats,
    tidy,
    markChapter,
    forgetPosition,
    forgetChapter,
    forgetChapters,
    saveSettings,
    resetSettings,
    hide,
    unhide,
    unhideAll,
    drop,
    undrop,
    undropAll,
    replaceAll,
    onChange,
    writeMirror,
    readPositions,
    writePosition,
    clearPosition,
    clearPositions,
    POS_KEY,
  };
})(globalThis);
