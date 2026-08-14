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

  async function load() {
    const raw = await ext.storage.local.get([KEY_SETTINGS, KEY_HIDDEN]);
    return {
      settings: RRX.normalizeSettings(raw[KEY_SETTINGS]),
      hidden: RRX.normalizeHidden(raw[KEY_HIDDEN]),
    };
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

  /** Used by import. Replaces both keys wholesale. */
  async function replaceAll({ settings, hidden }) {
    const next = {
      [KEY_SETTINGS]: RRX.normalizeSettings(settings),
      [KEY_HIDDEN]: RRX.normalizeHidden(hidden),
    };
    await ext.storage.local.set(next);
    return { settings: next[KEY_SETTINGS], hidden: next[KEY_HIDDEN] };
  }

  /**
   * Subscribe to changes from any context (other tabs, options page, popup).
   * @returns {() => void} unsubscribe
   */
  function onChange(callback) {
    const listener = (changes, area) => {
      if (area !== 'local') return;
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

  RRX.store = { load, saveSettings, hide, unhide, unhideAll, replaceAll, onChange, writeMirror };
})(globalThis);
