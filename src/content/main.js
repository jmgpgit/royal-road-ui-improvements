'use strict';

/**
 * document_end. Owns the pieces CSS cannot do: the toolbar, the per-card
 * controls, and keeping both alive as Royal Road swaps content in.
 *
 * Hiding itself stays in boot.js's generated stylesheet - this file only feeds
 * it fresh ids.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || !RRX.boot || RRX.main) return;

  const { SEL, ui } = RRX;
  const TOOLBAR_ID = 'rrx-toolbar';

  /** Shared state handed to features. */
  const ctx = {
    settings: RRX.normalizeSettings(null),
    hidden: {},
    hiddenSet: new Set(),
    /** 'list' | 'chapter' | 'fiction' | 'home' | 'other' */
    page: 'other',
    isListPage: false,
    hasDescriptions: false,
    /** Set by list-filters.js after each pass: {total, shown}. */
    filterCounts: null,
    hide,
    unhide,
    setSetting,
    setSettings,
  };

  /**
   * Which Royal Road page this is. Features declare the pages they belong to, so
   * chapter-only work never runs on a list and the other way round.
   */
  const detectPage = () => RRX.pageFromPath(root.location.pathname);

  // --- state ---------------------------------------------------------------

  function adoptState(settings, hidden) {
    ctx.settings = RRX.normalizeSettings(settings);
    ctx.hidden = RRX.normalizeHidden(hidden);
    ctx.hiddenSet = new Set(RRX.hiddenIds(ctx.hidden));
  }

  /** Push current state everywhere: stylesheet, mirror, toolbar, card controls. */
  function applyState() {
    RRX.boot.apply(ctx.settings, [...ctx.hiddenSet]);
    RRX.store.writeMirror(ctx.settings, ctx.hidden);
    // Cards first: filtering sets ctx.filterCounts, which the toolbar reports.
    syncCards(document);
    renderToolbar();
  }

  async function setSetting(key, value) {
    return setSettings({ [key]: value });
  }

  /** Commit several settings at once: the filter panel applies ~20 in one go. */
  async function setSettings(patch) {
    adoptState({ ...ctx.settings, ...patch }, ctx.hidden);
    applyState(); // optimistic: the UI must not wait on storage
    await RRX.store.saveSettings(patch);
  }

  async function hide(id, meta) {
    adoptState(ctx.settings, { ...ctx.hidden, [id]: { ...meta, hiddenAt: Date.now() } });
    applyState();
    ui.toast(`Hidden “${(meta && meta.title) || `Fiction ${id}`}”`, 'Undo', () => unhide(id));
    await RRX.store.hide(id, meta);
  }

  async function unhide(id) {
    const next = { ...ctx.hidden };
    delete next[Number(id)];
    adoptState(ctx.settings, next);
    applyState();
    await RRX.store.unhide(id);
  }

  // --- page shape ----------------------------------------------------------

  function refreshPageShape() {
    ctx.page = detectPage();
    ctx.isListPage = ctx.page === 'list' && !!document.querySelector(SEL.listRoot);
    ctx.hasDescriptions = !!document.querySelector(SEL.showMoreRoot);
  }

  /** Features that declare no `pages` run everywhere. */
  const activeFeatures = () =>
    RRX.features.list.filter((f) => !f.pages || f.pages.includes(ctx.page));

  // --- toolbar -------------------------------------------------------------

  /**
   * Prepended into `.fiction-list`, the one wrapper every list page shares (see
   * selectors.js for why the paginate skeleton cannot be used). On pages that do
   * page content in via AJAX this gets swapped out with the list; the observer
   * puts it straight back.
   */
  function toolbarAnchor() {
    return document.querySelector(SEL.listRoot);
  }

  /**
   * Everything the rendered toolbar depends on, so identical rebuilds can be
   * skipped. Settings go in wholesale rather than per-feature: a feature's
   * visibility can hinge on a setting that is not its own (`showHidden` hides
   * itself when `hideEnabled` is off), and missing one of those would leave a
   * stale button on screen.
   */
  function toolbarSignature() {
    return JSON.stringify([
      ctx.settings,
      ctx.page,
      ctx.hasDescriptions,
      ctx.hiddenSet.size,
      ctx.filterCounts,
    ]);
  }

  function renderToolbar() {
    const existing = document.getElementById(TOOLBAR_ID);
    if (!ctx.isListPage || !ctx.settings['list.showToolbar']) {
      if (existing) existing.remove();
      return;
    }
    const anchor = toolbarAnchor();
    if (!anchor) return;

    // Royal Road's ad slots mutate constantly; rebuilding the toolbar on every
    // sweep would churn the DOM and steal focus mid-click.
    const signature = toolbarSignature();
    if (existing && existing.dataset.rrxSig === signature && existing.isConnected) return;

    // The filter panel lives inside the toolbar, so a rebuild destroys it. It
    // must still be a rebuild though - skipping it left stale labels on the
    // other buttons - so re-open the panel afterwards instead of bailing out.
    const panelWasOpen = RRX.panel && RRX.panel.isOpen();

    const buttons = [];
    for (const feature of activeFeatures()) {
      if (!feature.settingKey) continue; // not a toolbar toggle
      if (feature.isRelevant && !feature.isRelevant(ctx)) continue;
      const disabled = feature.isDisabled ? feature.isDisabled(ctx) : false;
      const button = ui.toggleButton({
        id: feature.id,
        label: feature.label,
        title: disabled ? feature.disabledTitle || feature.title : feature.title,
        iconName: feature.iconName,
        pressed: !disabled && !!(feature.isPressed ? feature.isPressed(ctx) : ctx.settings[feature.settingKey]),
        badge: feature.badge ? feature.badge(ctx) : undefined,
        // A feature may open a panel instead of flipping its own setting.
        onClick: feature.onClick
          ? (event) => feature.onClick(ctx, event)
          : () => setSetting(feature.settingKey, !ctx.settings[feature.settingKey]),
      });
      if (disabled) button.disabled = true;
      buttons.push(button);
    }

    if (ctx.filterCounts && ctx.filterCounts.shown !== ctx.filterCounts.total) {
      buttons.push(
        ui.el('span', {
          class: 'rrx-toolbar__count',
          text: `${ctx.filterCounts.shown} of ${ctx.filterCounts.total}`,
          title: RRX.describeFilters(ctx.settings).join(' · '),
        })
      );
    }

    buttons.push(ui.el('span', { class: 'rrx-toolbar__spacer' }));
    buttons.push(
      ui.actionButton({
        id: 'manage',
        label: 'Manage',
        title: 'Open settings and the hidden-fiction list',
        iconName: 'manage',
        // The background listener sends no reply, which some browsers surface as
        // a rejected promise; there is nothing to recover from either way.
        onClick: () =>
          Promise.resolve(RRX.ext.runtime.sendMessage({ type: 'rrx:open-options' })).catch(() => {}),
      })
    );

    const toolbar = ui.el(
      'div',
      {
        id: TOOLBAR_ID,
        class: 'rrx-ui rrx-toolbar',
        role: 'group',
        'aria-label': 'UI Improvements for Royal Road',
        'data-rrx-sig': signature,
      },
      [ui.el('span', { class: 'rrx-toolbar__brand', text: 'RR UI' }), ...buttons]
    );

    if (existing) existing.replaceWith(toolbar);
    else anchor.prepend(toolbar);

    if (panelWasOpen) RRX.panel.open(toolbar, ctx, { keepDraft: true });
  }

  // --- cards ---------------------------------------------------------------

  function syncCards(scope) {
    for (const feature of activeFeatures()) {
      if (feature.syncCards) feature.syncCards(scope, ctx);
    }
  }

  /** One-shot work a feature wants done per page load (accordions, notes, …). */
  function runOnce() {
    for (const feature of activeFeatures()) {
      if (!feature.onPage) continue;
      try {
        feature.onPage(ctx);
      } catch (err) {
        RRX.warn(`feature "${feature.id}" failed`, err);
      }
    }
  }

  // --- keeping up with Royal Road ------------------------------------------

  /**
   * Royal Road pages content in server-side (swapping .rr-paginate-content) and
   * renders the fiction-page recommendations with React well after load, so a
   * one-shot pass is not enough.
   *
   * Debounced rather than run per-mutation: the ad slots on these pages mutate
   * more or less continuously, and a sweep per mutation would be pure waste.
   */
  const SWEEP_DEBOUNCE_MS = 200;

  function observe() {
    let timer = null;
    const sweep = () => {
      timer = null;
      refreshPageShape();
      renderToolbar();
      syncCards(document);
    };
    /**
     * Only element insertions can bring in new cards, and only Royal Road's
     * insertions can bring in cards at all.
     *
     * Our own controls carry `rrx-ui`, and treating those as relevant is how a
     * sweep feeds itself: sweep injects a control, the observer sees it,
     * another sweep is scheduled, forever. Individual features guard against
     * writing when nothing changed, but excluding our own markup here means one
     * that forgets to cannot spin the whole page up.
     */
    const isOurs = (node) => node.classList && node.classList.contains(RRX.UI_CLASS);
    const observer = new MutationObserver((records) => {
      // A sweep is already booked, so nothing the records say can change the
      // outcome. Checked first: this fires constantly on pages with ad slots,
      // and walking every record to reach the same answer is pure waste.
      if (timer) return;
      const relevant = records.some((r) =>
        [...r.addedNodes].some((n) => n.nodeType === Node.ELEMENT_NODE && !isOurs(n))
      );
      if (!relevant) return;
      timer = setTimeout(sweep, SWEEP_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Royal Road is actively changing this UI. If the page clearly is a fiction
   * list but nothing matches our card selector, say so once and name the file to
   * fix rather than failing silently.
   */
  function healthCheck() {
    if (!ctx.isListPage) return;
    if (document.querySelector(SEL.listCard)) return;
    RRX.warn(
      `no fiction cards matched "${SEL.listCard}" on a list page - ` +
        'Royal Road markup may have changed. Update src/common/selectors.js.'
    );
  }

  async function init() {
    if (!document.querySelector(SEL.newUiProbe)) {
      // Not the redesign, so nothing below will run. Say so before leaving, and
      // release the pre-paint guard: boot.js sets it from the URL alone, which
      // cannot tell the two layouts apart, and the legacy layout has a
      // `.fiction-list` of its own. Left set, that list is blanked with nothing
      // remaining to reveal it. Telling boot.js as well as clearing the class
      // matters, because its second, authoritative apply lands after this and
      // would otherwise put the guard straight back.
      RRX.boot.legacy = true;
      document.documentElement.classList.remove(RRX.ROOT_CLASS.filtersPending);

      // Two things still matter on this layout, and nothing else does.
      const { settings, hidden } = await RRX.boot.ready;

      // Write the boot mirror even here: it is the only way a legacy page can
      // leave behind what the next one needs to switch before it paints.
      RRX.store.writeMirror(settings, hidden);

      // And react to the layout choice changing in the popup, so this tab
      // follows straight away rather than at the next navigation. Without it the
      // popup appears to do nothing on the page you are looking at, which is the
      // page you changed it for.
      RRX.store.onChange(({ settings: next }) => RRX.boot.enforceDesign(next));
      return;
    }
    const { settings, hidden } = await RRX.boot.ready;
    adoptState(settings, hidden);
    refreshPageShape();
    healthCheck();
    applyState();
    runOnce();
    document.documentElement.classList.add(RRX.ROOT_CLASS.ready);

    // Options page, popup, or another tab changed something.
    RRX.store.onChange(({ settings: s, hidden: h }) => {
      // Asking for the old layout has to work from here too, and it ends this
      // page, so it comes before anything that would restyle a page about to go.
      if (RRX.boot.enforceDesign(s)) return;
      adoptState(s, h);
      applyState();
      runOnce();
    });

    observe();
  }

  RRX.main = { ctx, init, applyState, renderToolbar, syncCards, detectPage };
  init().catch((err) => RRX.warn('init failed', err));
})(globalThis);
