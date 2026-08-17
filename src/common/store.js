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

  async function saveSettings(patch) {
    const { settings } = await load();
    const next = RRX.normalizeSettings({ ...settings, ...patch });
    await ext.storage.local.set({ [KEY_SETTINGS]: next });
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
  async function replaceAll({ settings, hidden, dropped, chapters }) {
    const next = {
      [KEY_SETTINGS]: RRX.normalizeSettings(settings),
      [KEY_HIDDEN]: RRX.normalizeHidden(hidden),
      [KEY_DROPPED]: RRX.normalizeDropped(dropped),
      [KEY_CHAPTERS]: RRX.normalizeChapters(chapters),
    };
    await ext.storage.local.set(next);
    return {
      settings: next[KEY_SETTINGS],
      hidden: next[KEY_HIDDEN],
      dropped: next[KEY_DROPPED],
      chapters: next[KEY_CHAPTERS],
    };
  }

  /** Settings only. Reset went through `replaceAll` for a while, which meant every
   *  future key had to be threaded through it or be silently dropped. */
  async function resetSettings() {
    const next = RRX.normalizeSettings({});
    await ext.storage.local.set({ [KEY_SETTINGS]: next });
    return next;
  }

  /** Changes from any context - other tabs, options page, popup.
   *  @returns {() => void} unsubscribe */
  function onChange(callback) {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      // `chapters` is deliberately absent: its subscriber would be main.js, which
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
    POS_KEY,
  };
})(globalThis);
