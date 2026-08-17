'use strict';

/**
 * The dynamic hide stylesheet, and the <html> classes that switch the static
 * features on and off. Hiding is CSS rather than a DOM walk: it lands before
 * first paint so hidden cards never flash, covers content injected later (AJAX
 * pagination, the React recommendations carousel) with no observer, and beats
 * Embla's slide measurement so /home carousels lay out around the hidden ones.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? Object.assign({}, require('./selectors.js'), require('./schema.js'), require('./model.js'))
    : root.RRX;
  const api = factory(deps);
  if (isNode) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  const { CARD_GROUPS, VIEWS, normalizeIds, normalizeSettings } = deps;

  /** How far a dropped fiction's card fades. Enough to read as set aside while
   *  skimming, not so far the title cannot be read - the card is still there to
   *  be reconsidered. */
  const DROP_OPACITY = 0.55;

  /** Marks every element this extension injects: inject.css resets them away from
   *  Royal Road's styling, buildHideCss exempts them from a hidden card's dimming,
   *  and main.js's MutationObserver ignores them so it cannot sweep on its own output. */
  const UI_CLASS = 'rrx-ui';

  /** Every <html> class the extension drives. Each gates a block of inject-*.css,
   *  keeping the stylesheets inert until a setting turns them on. */
  const ROOT_CLASS = {
    expandAll: 'rrx-expand-all',
    hoverExpand: 'rrx-hover-expand',
    showHidden: 'rrx-show-hidden',
    comments: 'rrx-comments',
    commentRules: 'rrx-comment-rules',
    commentCollapsible: 'rrx-comment-collapsible',
    lineHeight: 'rrx-line-height',
    justify: 'rrx-justify',
    hyphens: 'rrx-hyphens',
    textColor: 'rrx-text-color',
    font: 'rrx-font',
    wide: 'rrx-wide',
    listWide: 'rrx-list-wide',
    // Not derived from settings - set and cleared by their own code paths.
    filtersPending: 'rrx-filters-pending',
    ready: 'rrx-ready',
  };

  const VIEW_CLASSES = VIEWS.filter((v) => v !== 'default').map((v) => `rrx-view-${v}`);

  /** What `rootClassesFor` owns, so boot.js may clear it. `ready` and `filtersPending`
   *  are lifecycle flags, not settings; clearing them on a settings change is wrong. */
  const MANAGED_CLASSES = [
    ...Object.values(ROOT_CLASS).filter(
      (c) => c !== ROOT_CLASS.ready && c !== ROOT_CLASS.filtersPending
    ),
    ...VIEW_CLASSES,
  ];

  /** Which <html> classes a given settings object implies. */
  function rootClassesFor(settings) {
    const s = normalizeSettings(settings);
    const out = [];

    if (s['list.expandAll']) out.push(ROOT_CLASS.expandAll);
    // expand-all already keeps everything open; hover on top is pure transition cost.
    if (s['list.hoverExpand'] && !s['list.expandAll']) out.push(ROOT_CLASS.hoverExpand);
    if (s['list.view'] !== 'default') out.push(`rrx-view-${s['list.view']}`);
    if (s['list.maxWidthPx'] !== null) out.push(ROOT_CLASS.listWide);

    if (s['hide.enabled'] && s['hide.showHidden']) out.push(ROOT_CLASS.showHidden);

    if (s['comments.threading']) {
      out.push(ROOT_CLASS.comments);
      if (s['comments.separators']) out.push(ROOT_CLASS.commentRules);
      // Room for the collapse button is reserved on every comment, not only the
      // ones that get a button, or a thread's comments would not line up.
      if (s['comments.collapsible']) out.push(ROOT_CLASS.commentCollapsible);
    }

    if (s['reader.enabled']) {
      if (s['reader.lineHeight'] !== null) out.push(ROOT_CLASS.lineHeight);
      if (s['reader.justify']) {
        out.push(ROOT_CLASS.justify);
        // Justified text without hyphenation opens rivers of whitespace.
        if (s['reader.hyphens']) out.push(ROOT_CLASS.hyphens);
      }
      if (s['reader.textColor']) out.push(ROOT_CLASS.textColor);
      if (s['reader.fontFamily']) out.push(ROOT_CLASS.font);
      if (s['reader.maxWidthPx'] !== null) out.push(ROOT_CLASS.wide);
    }

    // notes.hideAuthorPanel is applied by author-notes.js, not a class: its target
    // is only identifiable by climbing the DOM.

    return out;
  }

  /** Settings-driven CSS custom properties. Separate from classes because these
   *  carry values rather than switching blocks on and off. */
  function rootVarsFor(settings) {
    const s = normalizeSettings(settings);
    const vars = { '--rrx-hover-delay': `${s['list.hoverDelayMs']}ms` };
    if (s['list.maxWidthPx'] !== null) vars['--rrx-list-max'] = `${s['list.maxWidthPx']}px`;
    if (s['comments.threading'] && s['comments.separators']) {
      vars['--rrx-divider'] = String(s['comments.dividerOpacity'] / 100);
    }
    if (s['reader.enabled']) {
      if (s['reader.lineHeight'] !== null) vars['--rrx-line-height'] = String(s['reader.lineHeight']);
      if (s['reader.textColor']) vars['--rrx-text-color'] = s['reader.textColor'];
      if (s['reader.fontFamily']) vars['--rrx-font'] = s['reader.fontFamily'];
      if (s['reader.maxWidthPx'] !== null) vars['--rrx-reader-max'] = `${s['reader.maxWidthPx']}px`;
    }
    return vars;
  }

  /** The href test for one hidden fiction. The trailing slash keeps /fiction/1813 from
   *  matching /fiction/181303; the `$=` variant covers the rare slug-less link. */
  const hrefTest = (id) => [`[href*="/fiction/${id}/"]`, `[href$="/fiction/${id}"]`];

  /** `:is(<link><href>, …)` for one card group's link selector. */
  function linkMatch(group, ids) {
    return ids.flatMap((id) => hrefTest(id).map((href) => `${group.link}${href}`)).join(',');
  }

  /**
   * Emitted per card *group*, not per fiction: one `:has()` holding an `:is()` list
   * of ids keeps the rule count constant however many fictions are hidden, and
   * `:has()` is re-evaluated on every style recalculation.
   *
   * @param {Array<number|string>} ids hidden fiction ids
   * @returns {string} CSS text ('' when nothing is hidden)
   */
  function buildHideCss(ids) {
    const clean = normalizeIds(ids);
    if (!clean.length) return '';

    const rules = [];
    for (const group of CARD_GROUPS) {
      const match = `:is(${group.cards.join(',')}):has(:is(${linkMatch(group, clean)}))`;
      rules.push(
        `html:not(.${ROOT_CLASS.showHidden}) ${match}{display:none!important}`,
        // "Show hidden": dim the card's content but not our controls. Opacity cannot
        // be undone by a descendant, so it goes on the children, skipping .rrx-ui.
        `html.${ROOT_CLASS.showHidden} ${match}>*:not(.${UI_CLASS}){opacity:.4!important;` +
          `filter:grayscale(.75)!important;pointer-events:none!important}`,
        `html.${ROOT_CLASS.showHidden} ${match}{position:relative;` +
          `outline:1px dashed var(--color-outline,currentColor);outline-offset:2px;` +
          `border-radius:var(--radius-md,.375rem)}`
      );
    }
    return rules.join('\n');
  }

  /**
   * The same per-group `:has()` shape as `buildHideCss`, for fictions marked as
   * tried and dropped. Deliberately not `display:none` and not
   * `pointer-events:none`: a dropped fiction stays in the list, stays legible
   * and stays clickable, because the mark exists to be reconsidered. Somebody
   * who wants them gone can filter them out, or hide them.
   *
   * @param {Array<number|string>} ids dropped fiction ids
   * @returns {string} CSS text ('' when nothing is dropped)
   */
  function buildDropCss(ids) {
    const clean = normalizeIds(ids);
    if (!clean.length) return '';

    const rules = [];
    for (const group of CARD_GROUPS) {
      const match = `:is(${group.cards.join(',')}):has(:is(${linkMatch(group, clean)}))`;
      // On the children, skipping our own controls: opacity on the card cannot be
      // undone by a descendant, so the badge and buttons would fade with it.
      // `!important` for the same reason the hide sheet needs it - this lands in
      // <html> at document_start, so any later Royal Road rule of equal
      // specificity would win, and the card would simply not dim.
      rules.push(
        `${match}>*:not(.${UI_CLASS}){opacity:${DROP_OPACITY}!important;filter:grayscale(.5)!important}`
      );
    }
    return rules.join('\n');
  }

  return {
    UI_CLASS,
    ROOT_CLASS,
    VIEW_CLASSES,
    MANAGED_CLASSES,
    rootClassesFor,
    rootVarsFor,
    buildHideCss,
    buildDropCss,
    hrefTest,
  };
});
