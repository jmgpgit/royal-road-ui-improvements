'use strict';

/**
 * Which of Royal Road's two layouts a page asks for, and how to ask for the other.
 *
 * `rr_ui_mode` decides: `redesign` or `legacy`, and signed out no cookie means
 * legacy. `beta-ui-v2` used to decide it; by build 4.1.20260923 the server
 * ignores it both ways.
 *
 * Pure, so parsing can be tested without a DOM. What was actually served is
 * main.js's `SEL.newUiProbe`; on legacy every feature is inert.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DESIGN_COOKIE = 'rr_ui_mode';

  /** Royal Road's own values, keyed by the `design.mode` setting. */
  const LAYOUT = { new: 'redesign', old: 'legacy' };

  /** A year, as Royal Road's own switch writes it. */
  const DESIGN_MAX_AGE = 60 * 60 * 24 * 365;

  /** One cookie's value out of a `document.cookie` string, or null. Exact name,
   *  and the last copy: two can coexist, and the server reads the last. */
  function cookieValue(cookies, name) {
    let value = null;
    for (const part of String(cookies || '').split(';')) {
      const at = part.indexOf('=');
      if (at < 0 || part.slice(0, at).trim() !== name) continue;
      value = decodeURIComponent(part.slice(at + 1).trim());
    }
    return value;
  }

  /** 'redesign', 'legacy', or null when nothing was asked for. */
  const layoutAsked = (cookies) => cookieValue(cookies, DESIGN_COOKIE);

  /**
   * Asks for `layout`, written host-only as Royal Road's helper and its revert
   * link write it, so there is one cookie and their revert overwrites ours.
   *
   * A copy with a Domain is a different cookie under the same name and wins
   * whenever it is newer, so it is deleted first, as is the domain-scoped
   * `beta-ui-v2=always` that 1.5.4 and earlier wrote. Royal Road's own host-only
   * `beta-ui-v2` is not ours and stays.
   */
  const switchDirectives = (layout) => [
    `${DESIGN_COOKIE}=; path=/; domain=.royalroad.com; max-age=0`,
    'beta-ui-v2=; path=/; domain=.royalroad.com; max-age=0',
    `${DESIGN_COOKIE}=${layout}; path=/; samesite=lax; secure; max-age=${DESIGN_MAX_AGE}`,
  ];

  return { LAYOUT, cookieValue, layoutAsked, switchDirectives };
});
