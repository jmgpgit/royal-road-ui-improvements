'use strict';

/**
 * document_start: before Royal Road's deferred module scripts and before first
 * paint. Applies the <html> classes and hide stylesheet from the synchronous
 * localStorage mirror, then repairs both from browser.storage.local when it
 * resolves - normally well before a ~1.8 MB list page finishes parsing.
 *
 * No old-UI check: only <html> is parsed this early, and the old layout's
 * `class="ie8 no-js"` sits inside an IE conditional comment, so in a real browser
 * its <html> is as bare as the redesign's. Nothing here needs the distinction -
 * the classes and stylesheet target redesign-only hooks, so they are inert on the
 * old UI (test/css.test.js enforces it). main.js probes with SEL.newUiProbe once
 * there is a DOM.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || RRX.boot) return;

  const html = document.documentElement;
  const STYLE_ID = 'rrx-hide-style';

  // Page kind from the URL alone, so page-scoped CSS works before there is a DOM.
  html.classList.add(`rrx-page-${RRX.pageFromPath(root.location.pathname)}`);

  function styleEl() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      // document.head does not exist yet at document_start; <style> is valid here.
      html.appendChild(el);
    }
    return el;
  }

  /**
   * @param {object} settings
   * @param {number[]} ids hidden fiction ids
   */
  function apply(settings, ids) {
    const s = RRX.normalizeSettings(settings);

    const wanted = new Set(RRX.rootClassesFor(s));
    for (const cls of RRX.MANAGED_CLASSES) html.classList.toggle(cls, wanted.has(cls));

    // Filters need parsed numbers off each card, so they cannot run this early.
    // Hide the list until the first pass lands, but only where a pass is coming:
    // the rule hides every `.fiction-list`, and /home has four while the legacy
    // layout has one of its own - a saved filter would blank lists on pages the
    // filter never runs on, with nothing left to reveal them. The URL cannot tell
    // the layouts apart, so main.js sets `legacy` after its DOM probe; `apply`
    // runs twice and the second run lands after that probe, which would otherwise
    // put the guard back with nothing left to take it off.
    const onList = !RRX.boot.legacy && RRX.pageFromPath(root.location.pathname) === 'list';
    html.classList.toggle(RRX.ROOT_CLASS.filtersPending, onList && RRX.hasActiveFilters(s));

    // Clear any --rrx var the settings no longer set, so turning a reader
    // override off actually drops its value.
    const vars = RRX.rootVarsFor(s);
    for (const name of [...html.style].filter((n) => n.startsWith('--rrx-') && !(n in vars))) {
      html.style.removeProperty(name);
    }
    for (const [name, value] of Object.entries(vars)) html.style.setProperty(name, value);

    const css = s['hide.enabled'] ? RRX.buildHideCss(ids) : '';
    const el = styleEl();
    if (el.textContent !== css) el.textContent = css;
  }

  // --- Royal Road's two layouts ---------------------------------------------

  /** Set only when a switch has been attempted, so a failed one cannot loop. */
  const SWITCHED_KEY = 'rrx:design:switched';

  const tried = {
    get() {
      try {
        return root.sessionStorage.getItem(SWITCHED_KEY) === '1';
      } catch {
        return false; // blocked storage costs the guard, not correctness
      }
    },
    set(on) {
      try {
        if (on) root.sessionStorage.setItem(SWITCHED_KEY, '1');
        else root.sessionStorage.removeItem(SWITCHED_KEY);
      } catch {
        /* no-op */
      }
    },
  };

  /**
   * Put Royal Road on the layout the reader asked for, and reload into it. The
   * cookie only decides what the *server* sends, so without the reload nothing
   * about the page already on screen changes.
   *
   * @param {boolean} wantNew
   */
  function applyDesign(wantNew) {
    try {
      if (wantNew) document.cookie = RRX.switchDirective();
      else for (const directive of RRX.clearDirectives()) document.cookie = directive;
    } catch {
      return false; // cookies blocked outright; nothing here can work
    }

    // A cookie write can silently do nothing (blocked storage; a delete whose
    // domain does not match the writer's), leaving the reload pointless.
    if (RRX.usesNewDesign(document.cookie) !== wantNew) {
      RRX.warn(`could not switch to Royal Road's ${wantNew ? 'new' : 'old'} design`);
      return false;
    }

    tried.set(true);
    root.location.reload();
    return true;
  }

  /**
   * Enforce the layout choice, before first paint, on every load - the cookie
   * outlives the tab, so the old layout has to keep clearing a cookie Royal Road
   * may set again, and a reload, hard ones included, must land on the layout
   * asked for. "leave" touches nothing, which makes it safe as the default.
   *
   * The flag makes a change that does not take cost one reload instead of a loop;
   * it clears once the layout matches, so a later disagreement - Royal Road's own
   * revert link, say - is corrected next time.
   */
  function enforceDesign(settings) {
    const mode = settings['design.mode'];
    if (mode !== 'new' && mode !== 'old') {
      tried.set(false);
      return false;
    }
    const wantNew = mode === 'new';
    if (RRX.usesNewDesign(document.cookie) === wantNew) {
      tried.set(false);
      return false;
    }
    if (tried.get()) return false;
    return applyDesign(wantNew);
  }

  /** `legacy` is set by main.js once its DOM probe has run; see `apply`. */
  RRX.boot = { apply, ready: null, legacy: false, applyDesign, enforceDesign, SWITCHED_KEY };

  // 1. Synchronous, pre-paint: whatever the last Royal Road page load recorded.
  let mirrored = null;
  try {
    mirrored = RRX.parseMirror(root.localStorage.getItem(RRX.MIRROR_KEY));
  } catch {
    /* localStorage can throw when site data is blocked; fall through to async */
  }
  const booted = mirrored ? mirrored.settings : RRX.DEFAULT_SETTINGS;
  apply(booted, mirrored ? mirrored.ids : []);

  // Everything below is wasted work on a page about to be replaced, so a swap
  // returns rather than falling through.
  if (RRX.boot.enforceDesign(booted)) return;

  // 2. Authoritative. Also repairs the mirror when the options page or another
  //    tab changed something while no Royal Road tab was open.
  RRX.boot.ready = RRX.ext.storage.local
    .get(['settings', 'hidden'])
    .then((raw) => {
      const settings = RRX.normalizeSettings(raw.settings);
      const hidden = RRX.normalizeHidden(raw.hidden);
      apply(settings, RRX.hiddenIds(hidden));

      // Again, now the authoritative answer is in. The mirror is only written by
      // a content script that ran, which never happens on the legacy layout - so
      // a reader who has only seen the old design has an empty mirror, and the
      // pre-paint attempt had nothing to go on. That is exactly the reader this
      // setting exists for. Costs one flash of the wrong layout; the mirror below
      // makes later loads the fast path, and `tried` keeps the two attempts from
      // becoming two reloads.
      RRX.boot.enforceDesign(settings);
      try {
        root.localStorage.setItem(RRX.MIRROR_KEY, JSON.stringify(RRX.buildMirror(settings, hidden)));
      } catch {
        /* no-op */
      }
      return { settings, hidden };
    })
    .catch((err) => {
      RRX.warn('could not read settings', err);
      return { settings: RRX.normalizeSettings(null), hidden: {} };
    });
})(globalThis);
