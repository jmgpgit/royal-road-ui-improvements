'use strict';

/**
 * Minimal background script. It exists for exactly one reason: content scripts
 * cannot call runtime.openOptionsPage(), and opening a moz-extension:// URL
 * straight from a page is blocked unless the options page is made
 * web-accessible - which would expose it to royalroad.com for no benefit.
 *
 * Declared as both `scripts` (Firefox event page) and `service_worker`
 * (Chrome) in the manifest; each browser reads the key it supports.
 */
const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

ext.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'rrx:open-options') {
    ext.runtime.openOptionsPage();
  }
  // No response is sent; returning undefined keeps the channel from being held open.
});
