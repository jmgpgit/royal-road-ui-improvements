'use strict';

/**
 * Which of Royal Road's two layouts a page is served in, and how to ask for the
 * other one.
 *
 * The choice lives in a cookie. Setting it to `always` returns the redesign,
 * signed in or not - the redesign is cookie-only, not account-only.
 *
 * Pure, and separate from the code that touches `document.cookie`, so parsing
 * can be tested without a DOM.
 *
 * The extension only works on the redesign: on the legacy layout main.js finds
 * no `SEL.newUiProbe` and stops, so every feature is silently inert. Reading the
 * cookie is how it can say so and offer a way out.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Royal Road's own name for the choice. */
  const DESIGN_COOKIE = 'beta-ui-v2';

  /** The value that asks for the redesign. Royal Road's revert link writes another. */
  const DESIGN_NEW = 'always';

  /** A year. Long enough that nobody is asked twice, short enough to lapse. */
  const DESIGN_MAX_AGE = 60 * 60 * 24 * 365;

  /** One cookie's value out of a `document.cookie` string, or null. Names match
   *  exactly, not by prefix, so a future `beta-ui-v2-something` cannot be taken
   *  for this one. */
  function cookieValue(cookies, name) {
    for (const part of String(cookies || '').split(';')) {
      const at = part.indexOf('=');
      if (at < 0) continue;
      if (part.slice(0, at).trim() !== name) continue;
      return decodeURIComponent(part.slice(at + 1).trim());
    }
    return null;
  }

  /** Whether this page was asked for in the redesign. */
  const usesNewDesign = (cookies) => cookieValue(cookies, DESIGN_COOKIE) === DESIGN_NEW;

  /** Everything but the lifetime, shared so the two directives cannot drift. */
  const SCOPE = 'path=/; domain=.royalroad.com; samesite=lax';

  /** Asks for the redesign. `domain` one level up so the choice holds across
   *  Royal Road's subdomains, as their own switch does; `samesite=lax` so it
   *  survives arriving from an outside link. */
  const switchDirective = () =>
    `${DESIGN_COOKIE}=${DESIGN_NEW}; ${SCOPE}; max-age=${DESIGN_MAX_AGE}`;

  /**
   * Gives the choice back to Royal Road, which serves the old layout to anyone
   * who has not opted in. Deleted rather than set to another value: "no opinion"
   * is a state their server already understands.
   *
   * Two directives because a cookie written with a `domain` and one written
   * without are different cookies under the same name, and a delete only removes
   * the one whose domain it matches. We write ours with a domain; Royal Road may
   * write its own without. Clearing only our shape leaves theirs behind and the
   * server goes on seeing the opt-in.
   */
  const clearDirectives = () => [
    `${DESIGN_COOKIE}=; ${SCOPE}; max-age=0`,
    `${DESIGN_COOKIE}=; path=/; samesite=lax; max-age=0`,
  ];

  return {
    DESIGN_COOKIE,
    DESIGN_NEW,
    DESIGN_MAX_AGE,
    cookieValue,
    usesNewDesign,
    switchDirective,
    clearDirectives,
  };
});
