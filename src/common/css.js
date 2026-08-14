'use strict';

/**
 * Generates the dynamic stylesheet that hides fictions, plus the <html> class
 * list that switches the static features on and off.
 *
 * Hiding is done in CSS rather than by walking the DOM for three reasons:
 *  - it applies before first paint, so hidden cards never flash;
 *  - it applies to content Royal Road injects later (AJAX pagination, the
 *    React-rendered recommendations carousel) with no observer;
 *  - it lands before Embla measures its carousel slides, so /home carousels
 *    lay out correctly around the hidden ones.
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

  /**
   * Marks every element this extension injects.
   *
   * A contract in three directions: inject.css resets these elements away from
   * Royal Road's styling, buildHideCss exempts them from the dimming applied to
   * a hidden card, and main.js ignores them in its MutationObserver so a sweep
   * cannot be triggered by its own output.
   */
  const UI_CLASS = 'rrx-ui';

  /**
   * Every <html> class the extension drives. Each one gates a block of
   * inject-*.css, which is what keeps the stylesheets inert until a setting
   * turns them on.
   */
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

  /**
   * The classes `rootClassesFor` owns, and which boot.js may therefore clear.
   * `ready` and `filtersPending` are excluded on purpose: they are lifecycle
   * flags, not settings, and clearing them on a settings change would be wrong.
   */
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
    // expand-all already keeps everything open; adding hover on top would only
    // pay for pointless transition work.
    if (s['list.hoverExpand'] && !s['list.expandAll']) out.push(ROOT_CLASS.hoverExpand);
    if (s['list.view'] !== 'default') out.push(`rrx-view-${s['list.view']}`);
    if (s['list.maxWidthPx'] !== null) out.push(ROOT_CLASS.listWide);

    if (s['hide.enabled'] && s['hide.showHidden']) out.push(ROOT_CLASS.showHidden);

    if (s['comments.threading']) {
      out.push(ROOT_CLASS.comments);
      if (s['comments.separators']) out.push(ROOT_CLASS.commentRules);
      // The collapse button needs room reserved for it on every comment, not
      // only the ones that end up with a button, or comments in the same thread
      // would not line up with each other.
      if (s['comments.collapsible']) out.push(ROOT_CLASS.commentCollapsible);
    }

    if (s['reader.enabled']) {
      if (s['reader.lineHeight'] !== null) out.push(ROOT_CLASS.lineHeight);
      if (s['reader.justify']) {
        out.push(ROOT_CLASS.justify);
        // Justified text without hyphenation opens rivers of whitespace, so the
        // two travel together unless explicitly separated.
        if (s['reader.hyphens']) out.push(ROOT_CLASS.hyphens);
      }
      if (s['reader.textColor']) out.push(ROOT_CLASS.textColor);
      if (s['reader.fontFamily']) out.push(ROOT_CLASS.font);
      if (s['reader.maxWidthPx'] !== null) out.push(ROOT_CLASS.wide);
    }

    // notes.hideAuthorPanel is applied by author-notes.js, not by a class: its
    // target is only identifiable by climbing the DOM, which CSS alone cannot
    // reason about safely.

    return out;
  }

  /**
   * CSS custom properties driven by settings. Kept separate from classes because
   * these carry values rather than switching blocks on and off.
   */
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

  /**
   * The href test for one hidden fiction. The trailing slash is what keeps
   * /fiction/1813 from matching /fiction/181303; the `$=` variant covers the
   * rare slug-less link.
   */
  const hrefTest = (id) => [`[href*="/fiction/${id}/"]`, `[href$="/fiction/${id}"]`];

  /** `:is(<link><href>, …)` for one card group's link selector. */
  function linkMatch(group, ids) {
    return ids.flatMap((id) => hrefTest(id).map((href) => `${group.link}${href}`)).join(',');
  }

  /**
   * Build the hide stylesheet.
   *
   * Emitted per card *group* rather than per fiction: a single `:has()` holding
   * an `:is()` list of ids keeps the rule count constant no matter how many
   * fictions are hidden, which matters because `:has()` is re-evaluated on every
   * style recalculation.
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
        // "Show hidden" mode: dim the card's own content but not the controls we
        // inject into it. Opacity cannot be undone by a descendant, so the
        // dimming applies to the card's children and skips anything marked
        // .rrx-ui.
        `html.${ROOT_CLASS.showHidden} ${match}>*:not(.${UI_CLASS}){opacity:.4!important;` +
          `filter:grayscale(.75)!important;pointer-events:none!important}`,
        `html.${ROOT_CLASS.showHidden} ${match}{position:relative;` +
          `outline:1px dashed var(--color-outline,currentColor);outline-offset:2px;` +
          `border-radius:var(--radius-md,.375rem)}`
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
    hrefTest,
  };
});
