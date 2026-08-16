'use strict';

/** Exists only because content scripts cannot call runtime.openOptionsPage(), and
 *  opening the moz-extension:// URL from a page needs the options page marked
 *  web-accessible - which would expose it to royalroad.com for nothing.
 *
 *  Manifest declares both `scripts` (Firefox) and `service_worker` (Chrome); each
 *  browser reads the key it supports. */
const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

ext.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'rrx:open-options') {
    ext.runtime.openOptionsPage();
  }
  // Returning undefined keeps the message channel from being held open.
});
