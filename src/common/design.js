'use strict';

/**
 * Which of Royal Road's two layouts a page is being served in, and how to ask
 * for the other one.
 *
 * Royal Road keeps the choice in a cookie. Setting it to `always` returns the
 * redesign, and that works whether or not you are signed in: the redesign is
 * not account-only, it is cookie-only. Setting it is the whole mechanism, so
 * this file is three lines of logic and a lot of explanation.
 *
 * Pure, and separate from the code that touches `document.cookie`, so the
 * parsing can be tested without a DOM.
 *
 * The extension needs this because it only works on the redesign: on the legacy
 * layout main.js finds no `SEL.newUiProbe` and stops, so every feature is
 * silently inert. Reading the cookie is how it can tell someone that, and offer
 * a way out, instead of just doing nothing.
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

  /**
   * One cookie's value out of a `document.cookie` string, or null.
   *
   * Names are matched exactly rather than by prefix, so a future
   * `beta-ui-v2-something` cannot be mistaken for this one.
   */
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

  /**
   * The assignment that asks for the redesign.
   *
   * `domain` is set one level up so the choice holds across Royal Road's
   * subdomains, matching what Royal Road's own switch does, and `samesite=lax`
   * so it survives arriving from a link somewhere else.
   */
  const switchDirective = () =>
    `${DESIGN_COOKIE}=${DESIGN_NEW}; ${SCOPE}; max-age=${DESIGN_MAX_AGE}`;

  /**
   * The assignments that give the choice back to Royal Road, which serves the
   * old layout to anyone who has not opted in.
   *
   * The cookie is deleted rather than set to some other value, because "no
   * opinion" is a state Royal Road already understands, and inventing a value
   * for it would be guessing at somebody else's server.
   *
   * There are two of them, and that is the whole point. A cookie written with a
   * `domain` and one written without are *different cookies* that can both
   * exist under the same name, and a delete only removes the one whose domain
   * it matches. We write ours with a domain; Royal Road may well write its own
   * without. Clearing only our shape would leave theirs behind, the server would
   * go on seeing the opt-in, and the reader would be stuck on a layout they
   * asked to leave with no way to tell why.
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
