'use strict';

/**
 * Cross-browser entry point; every other file hangs off `globalThis.RRX`.
 * Content scripts cannot be ES modules in Firefox or Chrome, so these are
 * classic scripts in manifest order, all sharing one isolated-world global:
 * RRX spans the document_start and document_end batches. Extension pages load
 * the same files with <script src>.
 */
(function (root) {
  const RRX = (root.RRX = root.RRX || {});
  if (RRX.ext) return;

  // Firefox exposes the promise-based `browser`; Chrome only `chrome`, whose
  // MV3 storage/runtime APIs are promise-returning anyway.
  RRX.ext = root.browser && root.browser.storage ? root.browser : root.chrome;

  /** Prefixed so warnings are findable among Royal Road's own. */
  RRX.warn = (...args) => console.warn('[rr-ui]', ...args);
})(globalThis);
