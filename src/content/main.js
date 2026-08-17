'use strict';

/**
 * document_end. Owns what CSS cannot: the toolbar, the per-card controls, and
 * keeping both alive as Royal Road swaps content in. Hiding itself stays in
 * boot.js's generated stylesheet - this file only feeds it fresh ids.
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
    dropped: {},
    droppedSet: new Set(),
    /** 'list' | 'chapter' | 'fiction' | 'home' | 'other' */
    page: 'other',
    isListPage: false,
    hasDescriptions: false,
    /** Set by list-filters.js after each pass: {total, shown}. */
    filterCounts: null,
    hide,
    unhide,
    drop,
    undrop,
    setSetting,
    setSettings,
  };

  /** Features declare the pages they belong to, so chapter-only work never runs
   *  on a list and the other way round. */
  const detectPage = () => RRX.pageFromPath(root.location.pathname);

  // --- state ---------------------------------------------------------------

  function adoptState(settings, hidden, dropped) {
    ctx.settings = RRX.normalizeSettings(settings);
    ctx.hidden = RRX.normalizeHidden(hidden);
    ctx.hiddenSet = new Set(RRX.hiddenIds(ctx.hidden));
    ctx.dropped = RRX.normalizeDropped(dropped);
    ctx.droppedSet = new Set(RRX.droppedIds(ctx.dropped));
  }

  /** Push current state everywhere: stylesheet, mirror, toolbar, card controls. */
  function applyState() {
    RRX.boot.apply(ctx.settings, [...ctx.hiddenSet], [...ctx.droppedSet]);
    RRX.store.writeMirror(ctx.settings, ctx.hidden, ctx.dropped);
    // Cards first: filtering sets ctx.filterCounts, which the toolbar reports.
    syncCards(document);
    renderToolbar();
  }

  async function setSetting(key, value) {
    return setSettings({ [key]: value });
  }

  /** Batched: the filter panel applies ~20 settings in one go. */
  async function setSettings(patch) {
    adoptState({ ...ctx.settings, ...patch }, ctx.hidden, ctx.dropped);
    applyState(); // optimistic: the UI must not wait on storage
    await RRX.store.saveSettings(patch);
  }

  const titleOf = (id, meta) => (meta && meta.title) || `Fiction ${id}`;

  async function hide(id, meta) {
    adoptState(ctx.settings, { ...ctx.hidden, [id]: { ...meta, hiddenAt: Date.now() } }, ctx.dropped);
    applyState();
    ui.toast(`Hidden “${titleOf(id, meta)}”`, 'Undo', () => unhide(id));
    await RRX.store.hide(id, meta);
  }

  async function unhide(id) {
    const next = { ...ctx.hidden };
    delete next[Number(id)];
    adoptState(ctx.settings, next, ctx.dropped);
    applyState();
    await RRX.store.unhide(id);
  }

  async function drop(id, meta) {
    adoptState(ctx.settings, ctx.hidden, {
      ...ctx.dropped,
      [id]: { ...meta, droppedAt: Date.now() },
    });
    applyState();
    ui.toast(`Marked “${titleOf(id, meta)}” as dropped`, 'Undo', () => undrop(id));
    await RRX.store.drop(id, meta);
  }

  async function undrop(id) {
    const next = { ...ctx.dropped };
    delete next[Number(id)];
    adoptState(ctx.settings, ctx.hidden, next);
    applyState();
    await RRX.store.undrop(id);
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

  /** `.fiction-list` is the one wrapper every list page shares (selectors.js says
   *  why the paginate skeleton cannot be used). AJAX paging swaps it out along
   *  with the list; the observer puts the toolbar back. */
  function toolbarAnchor() {
    return document.querySelector(SEL.listRoot);
  }

  /** Everything the toolbar depends on, so identical rebuilds can be skipped.
   *  Settings go in wholesale because a feature's visibility can hinge on a
   *  setting that is not its own (`showHidden` hides itself when `hideEnabled` is
   *  off), and missing one would leave a stale button on screen. */
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

    // Ad slots mutate constantly; a rebuild every sweep would churn the DOM and
    // steal focus mid-click.
    const signature = toolbarSignature();
    if (existing && existing.dataset.rrxSig === signature && existing.isConnected) return;

    // A rebuild destroys the filter panel inside it. Bailing out instead left
    // stale labels on the other buttons, so rebuild and re-open the panel.
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
        title: 'Open settings and the hidden and dropped lists',
        iconName: 'manage',
        // The background listener sends no reply, which some browsers surface as
        // a rejected promise.
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

  /**
   * Mark Royal Road's "show the rest of the tags" toggles, so the stylesheet can
   * hide them where a setting has already opened the row.
   *
   * By shape, not by id: the lists call it `tags-toggle-<fiction id>` and a
   * fiction page calls it `show-more-tags`. Guessing the second from the first
   * is exactly how this was missed the first time. What both share is a label
   * wrapping an `sr-only` checkbox with a tag link after it - which is also what
   * makes Tailwind's `peer-has-checked:` work, so it cannot drift.
   *
   * `classList.add` of a class already there changes no attribute and so emits
   * no mutation record, which is what keeps this off the observer's back.
   */
  function markTagToggles(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    for (const label of root.querySelectorAll('label:has(> input.sr-only[type="checkbox"])')) {
      if (label.parentElement && label.parentElement.querySelector('a[href*="tagsAdd="]')) {
        label.classList.add('rrx-tag-toggle');
      }
    }
  }

  function syncCards(scope) {
    markTagToggles(scope);
    for (const feature of activeFeatures()) {
      if (feature.syncCards) feature.syncCards(scope, ctx);
    }
  }

  /** One-shot work a feature wants done per page load (accordions, notes, …). */
  function runOnce() {
    // Learn the tag vocabulary from the page the reader already opened. A list
    // page carries ~600 tag links and a fiction page its own handful, so this
    // costs a querySelectorAll and no request at all. It used to be learnt only
    // by opening the filter panel, which is optional and which many readers
    // never do - and until it is learnt, a tag colour has no name recorded and
    // so cannot reach the home page, where the chips carry no slug.
    if (RRX.tags) RRX.tags.harvest();

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

  /** Royal Road pages content in server-side (swapping .rr-paginate-content) and
   *  renders fiction-page recommendations with React well after load, so one pass
   *  is not enough. Debounced because the ad slots mutate continuously. */
  const SWEEP_DEBOUNCE_MS = 200;

  function observe() {
    let timer = null;
    const sweep = () => {
      timer = null;
      refreshPageShape();
      renderToolbar();
      syncCards(document);
    };
    /** Our own controls carry `rrx-ui`, and counting those as relevant is how a
     *  sweep feeds itself: sweep injects a control, the observer sees it, another
     *  sweep is scheduled, forever. Features guard against writing when nothing
     *  changed, but excluding our markup here means one that forgets to cannot
     *  spin the whole page up. */
    const isOurs = (node) => node.classList && node.classList.contains(RRX.UI_CLASS);
    const observer = new MutationObserver((records) => {
      // A sweep is already booked; nothing the records say changes that. Checked
      // before walking them because this fires constantly on ad-slot pages.
      if (timer) return;
      const relevant = records.some((r) =>
        [...r.addedNodes].some((n) => n.nodeType === Node.ELEMENT_NODE && !isOurs(n))
      );
      if (!relevant) return;
      timer = setTimeout(sweep, SWEEP_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Royal Road is actively changing this UI. A list page with nothing matching
   *  the card selector names the file to fix rather than failing silently. */
  function healthCheck() {
    if (!ctx.isListPage) return;
    if (document.querySelector(SEL.listCard)) return;
    RRX.warn(
      `no fiction cards matched "${SEL.listCard}" on a list page - ` +
        'Royal Road markup may have changed. Update src/common/selectors.js.'
    );
  }

  async function init() {
    // Housekeeping, before anything about this page matters: it ages out the
    // stored maps whether or not the features that fill them are still on, and
    // it is one read of a single number on all but one page load a day. Runs on
    // the legacy layout too - the data is the same data.
    RRX.store.tidy().catch((err) => RRX.warn('housekeeping failed', err));

    // "Forget reading history" runs on the options page, which cannot reach the
    // scroll scratchpad: that lives in royalroad.com's localStorage and only a
    // content script can touch it. Started here so the read overlaps `boot.ready`
    // and awaited below, before anything can restore a position out of it.
    const forgotten = RRX.store.honourForget();

    // The same press, heard live by a tab that was already open. Keyed on the
    // stamp rather than on `chapters` going empty: housekeeping dropping the last
    // record leaves an empty map too, and that is not a reader asking to forget.
    RRX.ext.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[RRX.store.KEY_FORGOT]) RRX.store.honourForget();
    });

    if (!document.querySelector(SEL.newUiProbe)) {
      // Not the redesign. Release the pre-paint guard: boot.js sets it from the
      // URL alone, which cannot tell the two layouts apart, and legacy has a
      // `.fiction-list` of its own that stays blanked with nothing left to reveal
      // it. Set boot.legacy too, or boot's later authoritative apply puts the
      // guard straight back.
      RRX.boot.legacy = true;
      document.documentElement.classList.remove(RRX.ROOT_CLASS.filtersPending);

      const { settings, hidden, dropped } = await RRX.boot.ready;

      // The mirror is the only way a legacy page leaves behind what the next one
      // needs to switch before it paints.
      RRX.store.writeMirror(settings, hidden, dropped);

      // Follow a layout change from the popup straight away, or the popup appears
      // to do nothing on the page you changed it for.
      RRX.store.onChange(({ settings: next }) => RRX.boot.enforceDesign(next));
      return;
    }
    const { settings, hidden, dropped } = await RRX.boot.ready;
    await forgotten;
    adoptState(settings, hidden, dropped);
    refreshPageShape();
    healthCheck();
    applyState();
    runOnce();
    document.documentElement.classList.add(RRX.ROOT_CLASS.ready);

    // Options page, popup, or another tab changed something.
    RRX.store.onChange(({ settings: s, hidden: h, dropped: d }) => {
      // Switching to the old layout ends this page, so it comes before anything
      // that would restyle a page about to go.
      if (RRX.boot.enforceDesign(s)) return;
      adoptState(s, h, d);
      applyState();
      runOnce();
    });

    observe();
  }

  RRX.main = { ctx, init, applyState, renderToolbar, syncCards, detectPage };
  init().catch((err) => RRX.warn('init failed', err));
})(globalThis);
