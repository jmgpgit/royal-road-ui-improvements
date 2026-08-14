'use strict';

/**
 * Cross-browser entry point. Every other file hangs off `globalThis.RRX`.
 *
 * Content scripts cannot be ES modules in Firefox or Chrome, so the files are
 * plain classic scripts listed in order in the manifest. All content scripts of
 * one extension share a single isolated-world global, so `RRX` is visible to the
 * document_start batch and the document_end batch alike. Extension pages (popup,
 * options) load the same files with <script src>.
 */
(function (root) {
  const RRX = (root.RRX = root.RRX || {});
  if (RRX.ext) return;

  // Firefox exposes the promise-based `browser`; Chrome only `chrome` (whose MV3
  // storage/runtime APIs are already promise-returning).
  RRX.ext = root.browser && root.browser.storage ? root.browser : root.chrome;

  /** Warnings are prefixed so they are findable in a page full of Royal Road's own. */
  RRX.warn = (...args) => console.warn('[rr-ui]', ...args);
})(globalThis);
