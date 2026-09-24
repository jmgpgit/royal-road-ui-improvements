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
   * @param {number[]} [dropped] ids marked tried and dropped
   */
  function apply(settings, ids, dropped) {
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

    // One <style> for both: they are the same kind of thing, generated from the
    // same ids, and two elements would only be two places to keep in step.
    const css = [
      s['hide.enabled'] ? RRX.buildHideCss(ids) : '',
      s['drop.enabled'] ? RRX.buildDropCss(dropped) : '',
      RRX.buildTagCss(s['tags.colors'], { home: s['tags.colorHome'] }),
    ]
      .filter(Boolean)
      .join('\n');
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
   * Ask Royal Road for `layout` and reload into it: the cookie only decides what
   * the server sends next.
   *
   * @param {'redesign'|'legacy'} layout
   */
  function applyDesign(layout) {
    try {
      for (const directive of RRX.switchDirectives(layout)) document.cookie = directive;
    } catch {
      return false; // cookies blocked outright
    }

    // A write can silently do nothing, leaving the reload pointless.
    if (RRX.layoutAsked(document.cookie) !== layout) {
      RRX.warn(`could not ask Royal Road for its ${layout} layout`);
      return false;
    }

    tried.set(true);
    RRX.boot.switching = true;
    root.location.reload();
    return true;
  }

  /**
   * Enforce the choice before first paint, on every load, so hard reloads and
   * Royal Road's own switches are corrected. "leave" reads and writes nothing,
   * which makes it safe as the default.
   *
   * The flag makes a switch that does not take cost one reload, not a loop; it
   * clears once the cookie matches, so a later revert is corrected next time.
   */
  function enforceDesign(settings, served) {
    const layout = RRX.LAYOUT[settings['design.mode']];
    if (!layout) {
      tried.set(false);
      return false;
    }
    // `served` only from a popup change on a page already showing: the cookie
    // can be right while the page is not (another tab switched it, bfcache).
    const done = RRX.layoutAsked(document.cookie) === layout && (!served || served === layout);
    if (done) {
      tried.set(false);
      return false;
    }
    if (tried.get()) return false;
    return applyDesign(layout);
  }

  /** `legacy` is set by main.js once its DOM probe has run; see `apply`.
   *  `switching` means this page is being replaced. */
  RRX.boot = {
    apply,
    ready: null,
    legacy: false,
    switching: false,
    applyDesign,
    enforceDesign,
    SWITCHED_KEY,
  };

  // 1. Synchronous, pre-paint: whatever the last Royal Road page load recorded.
  let mirrored = null;
  try {
    mirrored = RRX.parseMirror(root.localStorage.getItem(RRX.MIRROR_KEY));
  } catch {
    /* localStorage can throw when site data is blocked; fall through to async */
  }
  const booted = mirrored ? mirrored.settings : RRX.DEFAULT_SETTINGS;
  apply(booted, mirrored ? mirrored.ids : [], mirrored ? mirrored.dropped : []);

  // Everything below is wasted work on a page about to be replaced, so a swap
  // returns rather than falling through.
  if (RRX.boot.enforceDesign(booted)) return;

  // 2. Authoritative. Also repairs the mirror when the options page or another
  //    tab changed something while no Royal Road tab was open.
  RRX.boot.ready = RRX.ext.storage.local
    .get(['settings', 'hidden', 'dropped'])
    .then((raw) => {
      const settings = RRX.normalizeSettings(raw.settings);
      const hidden = RRX.normalizeHidden(raw.hidden);
      const dropped = RRX.normalizeDropped(raw.dropped);
      apply(settings, RRX.hiddenIds(hidden), RRX.droppedIds(dropped));

      // Again, now the authoritative answer is in. The mirror is only written by
      // a content script that ran, which never happens on the legacy layout - so
      // a reader who has only seen the old design has an empty mirror, and the
      // pre-paint attempt had nothing to go on. That is exactly the reader this
      // setting exists for. Costs one flash of the wrong layout; the mirror below
      // makes later loads the fast path, and `tried` keeps the two attempts from
      // becoming two reloads.
      RRX.boot.enforceDesign(settings);
      try {
        root.localStorage.setItem(
          RRX.MIRROR_KEY,
          JSON.stringify(RRX.buildMirror(settings, hidden, dropped))
        );
      } catch {
        /* no-op */
      }
      return { settings, hidden, dropped };
    })
    .catch((err) => {
      RRX.warn('could not read settings', err);
      return { settings: RRX.normalizeSettings(null), hidden: {}, dropped: {} };
    });
})(globalThis);
