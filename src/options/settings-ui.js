'use strict';

/**
 * How the settings are presented, which box each one lives in, what it is
 * called, and what the explanatory line under it says.
 *
 * The options page builds itself from this rather than from hand-written HTML.
 * With this many settings, hand-written markup drifts: a key added to schema.js
 * and forgotten here fails a test instead of quietly becoming unreachable.
 *
 * Three boxes, matching the three parts of the site the extension touches:
 * fiction lists, fiction pages, chapter pages.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ACTION_LABELS = {
    keep: 'Leave alone',
    fold: 'Collapse to one line',
    hide: 'Hide completely',
  };

  const ACCORDION_LABELS = {
    leave: 'Leave as Royal Road has it',
    open: 'Always open',
    closed: 'Always closed',
  };

  /** Per-key wording. `note` is the explanatory line under the control. */
  const COPY = {
    // ── fiction lists ─────────────────────────────────────────────────────
    'list.expandAll': {
      label: 'Expand all descriptions',
      note: 'Every description on the list pages stays open, with no fade at the bottom and no chevron to click.',
    },
    'list.hoverExpand': {
      label: 'Expand on hover',
      note: 'Opens a description while the cursor rests on its card. Click the chevron to keep it open after you move away.',
    },
    'list.hoverDelayMs': {
      label: 'Hover delay',
      note: 'How long the cursor has to rest before a description opens. A longer delay stops descriptions flicking open as you move down the page.',
      unit: 'ms',
      max: 800,
      step: 25,
    },
    'list.view': {
      label: 'Layout',
      note: 'Cards is the Royal Road layout. The others show less description and smaller covers so that more fits on screen. Two columns needs a window at least 1280px wide.',
      optionLabels: {
        default: 'Cards',
        compact: 'Compact rows',
        'two-col': 'Two columns',
        grid: 'Cover grid',
      },
    },
    'list.maxWidthPx': {
      label: 'Maximum list width',
      note: 'Widens the list past the limit Royal Road sets. Leave empty to keep Royal Road’s width.',
      unit: 'px',
      step: 20,
    },
    'list.cleanTitles': {
      label: 'Trim tags out of titles',
      note: 'Drops bracketed tags from titles in the lists, so "Some Title [LitRPG, Dungeon Core]" reads as "Some Title". Hover to see the full title. A fiction’s own page is left alone.',
    },
    'list.showToolbar': {
      label: 'Show the toolbar above lists',
      note: 'The row of buttons this extension adds above the list. With it off, change settings from this page or from the browser toolbar button.',
    },

    // ── hiding ────────────────────────────────────────────────────────────
    'hide.enabled': {
      label: 'Allow hiding fictions',
      note: 'Puts a minus button on every card. Turning this off brings every hidden fiction back and keeps your list for later.',
    },
    'hide.showHidden': {
      label: 'Show hidden fictions in place',
      note: 'Hidden fictions stay in the lists, dimmed and labelled, each with a plus button to bring it back.',
    },

    // ── filters ───────────────────────────────────────────────────────────
    'filters.enabled': {
      label: 'Use filters',
      note: 'You set the filter values in the Filters panel on the list pages, not here. Turning this off keeps them saved but stops them being applied.',
    },
    'list.infiniteScroll': {
      label: 'Keep loading as you scroll',
      note: 'When you reach the bottom of a list, the next page is added underneath instead of you having to click through. Filters and hidden fictions still apply to whatever comes in.',
    },

    // ── fiction pages ─────────────────────────────────────────────────────
    'fiction.about': { label: 'About Fiction', optionLabels: ACCORDION_LABELS },
    'fiction.stats': { label: 'Statistics', optionLabels: ACCORDION_LABELS },
    'fiction.chapters': { label: 'Table of Contents', optionLabels: ACCORDION_LABELS },
    'fiction.recommendations': {
      label: 'Others Also Liked',
      optionLabels: { leave: 'Leave as Royal Road has it', show: 'Show', hide: 'Hide' },
    },
    'fiction.writeReview': { label: 'Leave A Review', optionLabels: ACCORDION_LABELS },
    'fiction.reviews': { label: 'Reviews', optionLabels: ACCORDION_LABELS },
    'fiction.reviewSort': {
      label: 'Sort reviews by',
      note: 'Royal Road always opens reviews on Top. This picks a different starting point.',
      optionLabels: {
        leave: 'Leave as Royal Road has it',
        top: 'Top',
        newest: 'Newest',
        oldest: 'Oldest',
        upvotes: 'Most Upvotes',
      },
    },
    'fiction.reviewsAutoLoad': {
      label: 'Keep loading reviews as you scroll',
      note: 'Adds the next page to the bottom instead of replacing the reviews you have already read.',
    },

    // ── chapter text ──────────────────────────────────────────────────────
    'reader.enabled': {
      label: 'Change how chapter text looks',
      note: 'Turns on the settings below. Royal Road’s own Reading Preferences keep working, and these are applied on top of them.',
    },
    'reader.lineHeight': {
      label: 'Line height',
      note: 'The spacing between lines inside a paragraph. Royal Road only spaces paragraphs apart, not lines. Leave empty to change nothing.',
      step: 0.05,
    },
    'reader.maxWidthPx': {
      label: 'Maximum reading width',
      note: 'Widens the text past the limit Royal Road sets. Leave empty to keep Royal Road’s width.',
      unit: 'px',
      step: 20,
    },
    'reader.justify': {
      label: 'Justify text',
      note: 'Lines up both the left and right edges of each paragraph.',
    },
    'reader.hyphens': {
      label: 'Hyphenate when justified',
      note: 'Breaks long words across lines. Without it, justified text leaves wide gaps between words.',
    },
    'reader.textColor': {
      label: 'Text colour',
      note: 'Any CSS colour: a hex value with or without the hash (#e8e8e8 or e8e8e8), or a name like white. Leave empty to follow your theme.',
      placeholder: '#e8e8e8',
    },
    'reader.fontFamily': {
      label: 'Font',
      note: 'One font name. Several separated by commas are fallbacks rather than choices: you get the first one that is installed, and the rest are only tried if it is missing. Only fonts already on this computer work, as Royal Road blocks new ones from loading.',
      placeholder: 'Georgia, serif',
    },

    // ── author notes and page furniture ───────────────────────────────────
    'notes.mode': {
      label: 'Author notes',
      note: 'Nothing is deleted. Whatever gets collapsed leaves a small button that brings it back. A shoutout is a block inside a note that links to a different fiction.',
      optionLabels: {
        off: 'Leave alone',
        shoutouts: 'Collapse shoutouts',
        all: 'Collapse every note',
      },
    },
    'notes.hideAuthorPanel': {
      label: 'Hide the About Author panel',
      note: 'Hides the author panel and its heading from chapter pages.',
    },

    // ── comments ──────────────────────────────────────────────────────────
    'comments.threading': {
      label: 'Clearer reply threads',
      note: 'Draws a line down each chain of replies, and turns on the settings below.',
    },
    'comments.separators': {
      label: 'Divider between threads',
      note: 'A line under each top-level comment, so one conversation stops running into the next.',
    },
    'comments.collapsible': {
      label: 'Collapse button on threads',
      note: 'Puts a small minus button beside any comment that has replies, so you can collapse the whole chain.',
    },
    'comments.threadColor': {
      label: 'Thread line colour',
      note: 'Any CSS colour, with or without the hash. Leave empty to follow your theme.',
      placeholder: '#4f8ef7',
    },
    'comments.dividerOpacity': {
      label: 'Divider strength',
      note: 'How dark the line between threads is drawn, against the text colour of your theme. Lower it if it stands out too much, raise it if you cannot see it at all.',
      unit: '%',
    },
    'comments.thanks': {
      label: 'Comments that only say thanks',
      note: 'Catches comments that are nothing but "thanks", "thanks for the chapter", "tyfc" or "first". Collapsing shrinks them to one dimmed line that opens on hover, and anything with more to say is left alone. A comment with replies is only ever collapsed, never hidden, so the replies still make sense.',
      optionLabels: ACTION_LABELS,
    },
    'comments.emotes': {
      label: 'Comments that are only an emoticon',
      note: 'A comment whose whole body is one Royal Road emoticon, with nothing written alongside it. An emoticon at the end of a real sentence does not count.',
      optionLabels: ACTION_LABELS,
    },
    'comments.patternAction': {
      label: 'Comments matching your own patterns',
      note: 'What happens to comments that match the patterns below. It works on its own, whatever the setting above is set to.',
      optionLabels: ACTION_LABELS,
    },
    'comments.foldPatterns': {
      label: 'Your patterns',
      note: 'One per line. Capital letters do not matter. A line matches anywhere in a comment, so "nice" also catches "that was nice". To match the whole comment only, put ^ at the start and $ at the end, as in ^nice$. Pasting a comment straight in works too.',
      placeholder: 'first!\n^nice$',
      multiline: true,
      rows: 4,
    },
    'comments.foldAuthors': {
      label: 'Apply comment filtering to the author too',
      note: 'Off by default. The author’s own comments are left alone, because a short reply from them is usually the one worth reading. They are never hidden either way; the most this can do is collapse them.',
    },
    'comments.autoLoad': {
      label: 'Keep loading comments as you scroll',
      note: 'Adds the next page to the bottom instead of replacing the comments you have already read.',
    },
  };

  /**
   * The three boxes, and what goes in each. `groups` splits a box into labelled
   * runs, so a long box still reads as a few short lists.
   */
  const SECTIONS = [
    {
      id: 'lists',
      title: 'Fiction lists',
      blurb: 'Rising Stars, Trending, Best Rated, Latest Updates, Search and the rest.',
      groups: [
        {
          title: 'Descriptions and layout',
          keys: [
            'list.expandAll',
            'list.hoverExpand',
            'list.hoverDelayMs',
            'list.view',
            'list.maxWidthPx',
            'list.cleanTitles',
            'list.showToolbar',
          ],
        },
        { title: 'Filters', keys: ['filters.enabled', 'list.infiniteScroll'] },
        { title: 'Hiding fictions', keys: ['hide.enabled', 'hide.showHidden'] },
      ],
    },
    {
      id: 'fiction',
      title: 'Fiction pages',
      blurb: 'The sections on a fiction’s own page, listed in the order they appear.',
      groups: [
        {
          title: 'Page sections',
          keys: [
            'fiction.about',
            'fiction.stats',
            'fiction.chapters',
            'fiction.recommendations',
            'fiction.writeReview',
            'fiction.reviews',
          ],
        },
        { title: 'Reviews', keys: ['fiction.reviewSort', 'fiction.reviewsAutoLoad'] },
      ],
    },
    {
      id: 'chapter',
      title: 'Chapter pages',
      blurb: 'The chapter text, the notes around it, and the comments underneath.',
      groups: [
        {
          title: 'Text',
          keys: [
            'reader.enabled',
            'reader.lineHeight',
            'reader.maxWidthPx',
            'reader.justify',
            'reader.hyphens',
            'reader.textColor',
            'reader.fontFamily',
          ],
        },
        {
          title: 'Author notes and extras',
          keys: ['notes.mode', 'notes.hideAuthorPanel'],
        },
        {
          title: 'Comments',
          keys: [
            'comments.threading',
            'comments.separators',
            'comments.dividerOpacity',
            'comments.collapsible',
            'comments.threadColor',
            'comments.thanks',
            'comments.emotes',
            'comments.patternAction',
            'comments.foldPatterns',
            // Last of the group: it qualifies every rule above it.
            'comments.foldAuthors',
            'comments.autoLoad',
          ],
        },
      ],
    },
  ];

  /** Every key the page renders, flattened. */
  const sectionKeys = () => SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.keys));

  /**
   * Settings the options page deliberately does not show, with the reason.
   * Every schema key must be in a section or here, or the options test fails.
   */
  const NOT_IN_OPTIONS = {
    'notes.blockedAuthors': 'a list of author ids, set by editing an exported settings file',
  };

  /** Filter values are set in the panel on the list pages, not here. */
  const isFilterValue = (key) => key.startsWith('filters.') && key !== 'filters.enabled';

  return {
    COPY,
    SECTIONS,
    NOT_IN_OPTIONS,
    isFilterValue,
    sectionKeys,
    ACTION_LABELS,
    ACCORDION_LABELS,
  };
});
