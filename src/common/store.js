'use strict';

/**
 * Persistence. `browser.storage.local` is the source of truth; a compact copy is
 * mirrored into the page's own localStorage so document_start can read it
 * synchronously (see model.js -> buildMirror for why).
 *
 * The mirror lives in royalroad.com's origin, so only content scripts can write
 * it. Options/popup changes reach it via `storage.onChanged` in any open Royal
 * Road tab, and boot.js repairs it from the authoritative store on the next load.
 */
(function (root) {
  const RRX = (root.RRX = root.RRX || {});
  if (RRX.store) return;

  const ext = RRX.ext;
  const KEY_SETTINGS = 'settings';
  const KEY_HIDDEN = 'hidden';
  const KEY_CHAPTERS = 'chapters';

  /**
   * The scratchpad the scroll handler writes to, in royalroad.com's own
   * localStorage. See `writePosition`.
   */
  const POS_KEY = 'rrx:v1:pos';
  const POS_MAX = 300;

  async function load() {
    const raw = await ext.storage.local.get([KEY_SETTINGS, KEY_HIDDEN]);
    return {
      settings: RRX.normalizeSettings(raw[KEY_SETTINGS]),
      hidden: RRX.normalizeHidden(raw[KEY_HIDDEN]),
    };
  }

  /**
   * Reading progress, deliberately NOT part of `load()`.
   *
   * Every page pays for `load()`, and only chapter pages have any use for this.
   * It is also the one map with no ceiling, so keeping it out means a list page
   * never deserialises thousands of records to render a toolbar.
   */
  async function loadChapters() {
    const raw = await ext.storage.local.get(KEY_CHAPTERS);
    return RRX.normalizeChapters(raw[KEY_CHAPTERS]);
  }

  /**
   * Merge one chapter's record. A merge rather than a replace, and re-read
   * inside the call the way `hide` is, so a long-lived tab holding a stale copy
   * cannot resurrect records another tab has pruned.
   *
   * @param {number} chapterId
   * @param {{f?:number,a?:number,p?:number,o?:number,n?:number,len?:number}} patch
   */
  async function markChapter(chapterId, patch, { seenMaxAgeS } = {}) {
    const id = Number(chapterId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const chapters = await loadChapters();
    const now = Math.floor(Date.now() / 1000);
    // Every write stamps the record, which is what makes an expiry possible at
    // all: without it there is no telling how old a watermark is.
    const merged = { ...chapters, [id]: { ...(chapters[id] || {}), a: now, ...(patch || {}) } };
    const next = RRX.pruneChapters(RRX.normalizeChapters(merged), { now, seenMaxAgeS });
    await ext.storage.local.set({ [KEY_CHAPTERS]: next });
    return next[id] || null;
  }

  /**
   * Drop where the reader was in a chapter, and nothing else.
   *
   * A record holds two unrelated things - a reading position and the comment
   * watermark - with two different lifetimes. Finishing a chapter ends the
   * position; it says nothing about which comments have been seen, and someone
   * who reads a chapter, reads its comments, and then moves on must not come
   * back to find the whole conversation unread again. The record goes only when
   * both halves are gone.
   */
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

  /** Used by import. Replaces every key wholesale. */
  async function replaceAll({ settings, hidden, chapters }) {
    const next = {
      [KEY_SETTINGS]: RRX.normalizeSettings(settings),
      [KEY_HIDDEN]: RRX.normalizeHidden(hidden),
      [KEY_CHAPTERS]: RRX.normalizeChapters(chapters),
    };
    await ext.storage.local.set(next);
    return {
      settings: next[KEY_SETTINGS],
      hidden: next[KEY_HIDDEN],
      chapters: next[KEY_CHAPTERS],
    };
  }

  /**
   * Settings, and only settings.
   *
   * Reset used to go through `replaceAll`, which meant every future key had to
   * be remembered and threaded through it or be quietly dropped from the
   * returned state. This has no opinion about anything but settings, so it
   * cannot forget one.
   */
  async function resetSettings() {
    const next = RRX.normalizeSettings({});
    await ext.storage.local.set({ [KEY_SETTINGS]: next });
    return next;
  }

  /**
   * Subscribe to changes from any context (other tabs, options page, popup).
   * @returns {() => void} unsubscribe
   */
  function onChange(callback) {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      // `chapters` is deliberately absent. Its subscriber would be main.js,
      // which reacts by rebuilding the toolbar, re-syncing every card and
      // re-entering every feature's onPage - in EVERY open Royal Road tab. That
      // is the right response to a settings change and an absurd one to somebody
      // scrolling a chapter, which is what writes this key. Nothing else needs
      // to hear about it: the next page load reads the truth.
      if (!(KEY_SETTINGS in changes) && !(KEY_HIDDEN in changes)) return;
      load().then(callback);
    };
    ext.storage.onChanged.addListener(listener);
    return () => ext.storage.onChanged.removeListener(listener);
  }

  /**
   * Write the synchronous boot mirror. Only meaningful from a content script,
   * where localStorage belongs to royalroad.com. Failures (private browsing,
   * quota, disabled storage) are non-fatal: we just lose the no-flicker path.
   */
  function writeMirror(settings, hidden) {
    try {
      const payload = JSON.stringify(RRX.buildMirror(settings, hidden));
      if (root.localStorage.getItem(RRX.MIRROR_KEY) !== payload) {
        root.localStorage.setItem(RRX.MIRROR_KEY, payload);
      }
    } catch {
      /* no-op */
    }
  }

  // --- the scroll scratchpad -------------------------------------------------
  //
  // Positions are written while the reader scrolls, which is far too often for
  // storage.local: every write there re-serialises the whole chapter map, and
  // it is async, so the last one before the tab closes may never land. This is
  // synchronous, per-origin, and small - the same trade the boot mirror makes.
  // storage.local still gets one write per visit, on the way out, and whatever
  // did not make it is reconciled from here on the next load.

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

      // Oldest out first. Bounded because this shares royalroad.com's origin
      // budget with the boot mirror, and it is only a scratchpad.
      const keys = Object.keys(pos);
      if (keys.length > POS_MAX) {
        keys
          .sort((a, b) => (pos[a].at || 0) - (pos[b].at || 0))
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
    replaceAll,
    onChange,
    writeMirror,
    readPositions,
    writePosition,
    clearPosition,
    POS_KEY,
  };
})(globalThis);
