'use strict';

/**
 * document_start. Runs before Royal Road's deferred module scripts and before
 * first paint.
 *
 * Reads the synchronous localStorage mirror and applies the <html> classes plus
 * the generated hide stylesheet immediately, then repairs both from the
 * authoritative browser.storage.local as soon as that resolves (normally well
 * before a ~1.8 MB list page has finished parsing).
 *
 * There is no old-UI check here, and that is deliberate. At document_start the
 * only thing parsed is <html>, and the two UIs are not distinguishable from it:
 * the old layout's `class="ie8 no-js"` lives inside an IE conditional comment,
 * so in a real browser its <html> is as bare as the redesign's.
 *
 * Nothing needs the distinction this early. Both things this file does - the
 * <html> classes and the generated stylesheet - are written against hooks that
 * exist only in the redesign, so they are inert on the old UI whether we can
 * tell or not (test/css.test.js enforces that). main.js makes the real call with
 * SEL.newUiProbe once there is a DOM to look at, before any UI is injected.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || RRX.boot) return;

  const html = document.documentElement;
  const STYLE_ID = 'rrx-hide-style';

  // Which kind of page this is, from the URL alone, so page-scoped CSS works
  // before there is a DOM to look at.
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
    // Hide the list until the first pass lands, but only where a pass is
    // actually coming: only when a filter is set, and only on a fiction list.
    //
    // The page check is not cosmetic. The rule this gates hides `.fiction-list`
    // wherever it appears, and /home has four of them while the legacy layout
    // has one of its own. Without it, a saved filter blanks lists on pages the
    // filter feature never runs on, and nothing is left to reveal them.
    //
    // `legacy` is the other half of it. The URL alone cannot tell the two Royal
    // Road layouts apart, and the legacy one has a `.fiction-list` too, so
    // main.js sets this the moment its DOM probe says which layout this is.
    // `apply` runs twice, once synchronously and once from storage, and the
    // second one lands after that probe: without this it would put the guard
    // straight back on a page that has nothing left to take it off again.
    const onList = !RRX.boot.legacy && RRX.pageFromPath(root.location.pathname) === 'list';
    html.classList.toggle(RRX.ROOT_CLASS.filtersPending, onList && RRX.hasActiveFilters(s));

    // Set what the settings call for, and clear any rrx var they no longer do,
    // so turning a reader override off actually drops its value.
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
   * Put Royal Road on the layout the reader asked for, and reload into it.
   *
   * The reload is the point: the cookie decides what the *server* sends, so on
   * its own it changes nothing about the page already in front of somebody.
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

    // Confirm before reloading. A cookie write can silently do nothing - blocked
    // storage, or a delete whose domain does not match the one that wrote it -
    // and reloading then just fetches the same page again for no reason.
    if (RRX.usesNewDesign(document.cookie) !== wantNew) {
      RRX.warn(`could not switch to Royal Road's ${wantNew ? 'new' : 'old'} design`);
      return false;
    }

    tried.set(true);
    root.location.reload();
    return true;
  }

  /**
   * Enforce the layout choice, before first paint, on every load.
   *
   * Every load, not just when something changes, because the cookie outlives the
   * tab: choosing the old layout has to keep clearing a cookie Royal Road may
   * have set again, or the choice would hold once and then quietly stop. It is
   * also why this reads the setting rather than reacting to it being changed -
   * a reload, including a hard one, must land on the layout that was asked for.
   *
   * "leave" touches nothing at all, which is what makes it safe as the default:
   * installing this extension does not decide which version of a site anybody
   * sees until they say so.
   *
   * The flag makes a change that does not take cost one reload instead of an
   * endless loop, and is cleared as soon as the layout matches, so a later
   * disagreement - Royal Road's own revert link, say - is corrected next time.
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

  // Before anything is painted: if this is not the layout that was asked for,
  // swap it now. Everything below is wasted work on a page about to be replaced,
  // so this returns rather than falling through.
  if (RRX.boot.enforceDesign(booted)) return;

  // 2. Authoritative. Also repairs the mirror when the options page or another
  //    tab changed something while no Royal Road tab was open.
  RRX.boot.ready = RRX.ext.storage.local
    .get(['settings', 'hidden'])
    .then((raw) => {
      const settings = RRX.normalizeSettings(raw.settings);
      const hidden = RRX.normalizeHidden(raw.hidden);
      apply(settings, RRX.hiddenIds(hidden));

      // Again, now that the authoritative answer is in. The mirror is written
      // only by a content script that got as far as running, which never happens
      // on the legacy layout - so somebody who has only ever seen the old design
      // has an empty mirror, and the pre-paint attempt above had nothing to go
      // on. That is precisely the reader this setting exists for. This lands
      // after first paint rather than before it, which costs a flash of the
      // wrong layout once; the mirror written below makes every later load the
      // fast path. `tried` keeps the two attempts from becoming two reloads.
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
