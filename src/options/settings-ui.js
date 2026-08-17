'use strict';

/**
 * Which box each setting lives in, what it is called, and the note under it.
 * Boxes follow a reader through the site: the layout the rest depend on, then
 * lists, a fiction, a chapter, its comments.
 *
 * Built from this rather than hand-written HTML so a key added to schema.js and
 * forgotten here fails a test instead of quietly becoming unreachable.
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
    'design.mode': {
      label: 'Which Royal Road design to use',
      note: 'Royal Road serves two layouts and remembers your choice in a cookie. Everything this extension does is built on the newer one, so on the older one it does nothing at all. Choosing here holds on every page and needs no account. “Leave it to Royal Road” changes nothing, including undoing a choice you made before — pick the old design for that.',
      optionLabels: {
        leave: 'Leave it to Royal Road',
        new: 'Always the new design',
        old: 'Always the old design (this extension will do nothing)',
      },
    },
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
    'drop.enabled': {
      label: 'Mark fictions you tried and dropped',
      note: 'Puts a bookmark button on every card. A fiction you mark dims and is labelled Dropped wherever it comes up, so you can see you have already given it a go — but it stays in the list and stays clickable, in case you change your mind. To stop them appearing at all, add Dropped to “Hide mine” in the Filters panel. Turning this off keeps your list for later.',
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
    'fiction.statDeltas': {
      label: 'Show what has changed since you last looked',
      note: 'Royal Road only ever shows today’s total. This writes the change since your last visit under each figure on a fiction page, and sums it up on the Statistics header while that section is shut. The numbers are saved as you open the page, on this device and nowhere else, and forgotten after a year. Nothing is shown until you come back to a fiction you have already opened, and switching this off deletes everything it has saved.',
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

    'chapter.topTimestamp': {
      label: 'Show when the chapter was posted, at the top',
      note: 'Royal Road prints this under the chapter, past the author notes, where you cannot see it before you start reading. This repeats it above the text. Whatever dates Royal Road shows are mirrored, so if it ever adds an edited date that appears too.',
    },
    'chapter.wordCount': {
      label: 'Show how long the chapter is',
      note: 'Counted from the chapter text, so author notes and comments are not included. The estimate uses the reading speed below.',
      optionLabels: {
        off: 'Do not show it',
        words: 'Word count',
        time: 'Reading time',
        both: 'Both',
      },
    },
    'chapter.wpm': {
      label: 'Your reading speed',
      note: 'Used only for the estimate above. 250 words a minute is the usual figure for English prose.',
      unit: 'words a minute',
      step: 10,
    },
    'chapter.catchUp': {
      label: 'Show how many chapters you have left',
      note: 'Which chapter of the fiction this is, and how many come after it, on the line above the chapter. The count comes from the same list Royal Road fills its own "Select a chapter" dropdown from, fetched once per fiction and kept for the tab. Nothing is fetched while this is off.',
    },
    'chapter.resume': {
      label: 'Come back to where you stopped reading',
      note: 'Remembers how far down a chapter you got, and returns you there next time you open it. Opening a link to a particular comment goes to that comment instead. Nothing is remembered while this is off, and it is kept on this device.',
      optionLabels: {
        off: 'Do not remember',
        ask: 'Offer it at the top of the chapter',
        jump: 'Go straight there',
      },
    },
    'recap.mode': {
      label: 'Show the end of the previous chapter',
      note: 'Puts the closing paragraphs of the chapter before at the top of this one, for when you are reading several fictions at once and cannot remember how the last one left off. Nothing is fetched while this is off.',
      optionLabels: {
        off: 'Do not show it',
        always: 'Always show it',
        click: 'Hide it behind a click',
        hover: 'Show it on hover',
      },
    },
    'recap.paragraphs': {
      label: 'How much to show',
      note: 'Paragraphs from the end of the previous chapter. A closing line of asterisks does not count towards it.',
      unit: 'paragraphs',
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
      label: 'Comments matching your own regex patterns',
      note: 'What happens to comments that match the patterns below. It works on its own, whatever the setting above is set to.',
      optionLabels: ACTION_LABELS,
    },
    'comments.foldPatterns': {
      label: 'Your regex patterns',
      note: 'One per line. Capital letters do not matter. A line matches anywhere in a comment, so "nice" also catches "that was nice". To match the whole comment only, put ^ at the start and $ at the end, as in ^nice$. Pasting a comment straight in works too.',
      placeholder: 'first!\n^nice$',
      multiline: true,
      rows: 4,
    },
    'comments.foldAuthors': {
      label: 'Apply comment filtering to the author too',
      note: 'Off by default. The author’s own comments are left alone, because a short reply from them is usually the one worth reading. They are never hidden either way; the most this can do is collapse them.',
    },
    'comments.seen': {
      label: 'Mark comments posted since you last read the chapter',
      note: 'Compares when each comment was posted against when you last had this chapter open. It does not follow which comments you actually read, so an older one further down the list counts as read whether or not you ever scrolled to it. Nothing is ever hidden: the older ones can collapse to a dimmed line that opens on hover, and anything with a newer reply underneath it stays open. Your visit is recorded once the comments have been on screen for a few seconds, and forgotten after 60 days — so coming back to a chapter much later shows its comments afresh.',
      optionLabels: {
        off: 'Leave alone',
        mark: 'Mark the newer ones',
        fold: 'Mark the newer ones, and collapse the older ones',
      },
    },
    'comments.seenDays': {
      label: 'Forget a chapter after',
      note: 'How long to remember when you last read a chapter. Past this it counts as a chapter you have never opened, so its comments all read as new again — which is usually what you want on a reread months later. It also keeps this from growing without limit: one date per chapter, and only for as long as this says.',
      unit: 'days',
      step: 5,
    },
    'comments.autoLoad': {
      label: 'Keep loading comments as you scroll',
      note: 'Adds the next page to the bottom instead of replacing the comments you have already read.',
    },
  };

  /** The boxes and what goes in each, following a reader through the site:
   *  the layout everything depends on, then lists, a fiction, a chapter, its
   *  comments. Inside a box the order is down the page, so a setting sits where
   *  the thing it changes sits.
   *
   *  `groups` splits a box into labelled runs. `manager` renders one of the two
   *  fiction lists inside that group rather than after the box; `layout: 'grid'`
   *  lays a run of identical dropdowns out in columns. A box with one group
   *  needs no heading inside it. */
  const SECTIONS = [
    {
      id: 'design',
      title: 'Royal Road’s design',
      blurb: 'This extension only works on the newer of Royal Road’s two layouts.',
      groups: [{ keys: ['design.mode'] }],
    },
    {
      id: 'lists',
      title: 'Fiction lists',
      blurb: 'Rising Stars, Trending, Best Rated, Latest Updates, Search and the rest.',
      groups: [
        // The toolbar first: it is the only way to the filter panel, which is
        // why the switch that applies filters is on this page at all.
        { title: 'The toolbar and filters', keys: ['list.showToolbar', 'filters.enabled'] },
        { title: 'The list itself', keys: ['list.view', 'list.maxWidthPx', 'list.infiniteScroll'] },
        {
          title: 'Each card',
          keys: ['list.cleanTitles', 'list.expandAll', 'list.hoverExpand', 'list.hoverDelayMs'],
        },
        { title: 'Hiding fictions', keys: ['hide.enabled', 'hide.showHidden'], manager: 'hidden' },
        { title: 'Tried and dropped', keys: ['drop.enabled'], manager: 'dropped' },
      ],
    },
    {
      id: 'fiction',
      title: 'Fiction pages',
      blurb: 'A fiction’s own page, top to bottom.',
      groups: [
        {
          title: 'Which sections are open',
          layout: 'grid',
          keys: [
            'fiction.about',
            'fiction.stats',
            'fiction.chapters',
            'fiction.recommendations',
            'fiction.writeReview',
            'fiction.reviews',
          ],
        },
        { title: 'What has changed since last time', keys: ['fiction.statDeltas'] },
        { title: 'Reading reviews', keys: ['fiction.reviewSort', 'fiction.reviewsAutoLoad'] },
      ],
    },
    {
      id: 'chapter',
      title: 'Chapter pages',
      blurb: 'The chapter itself, and what sits above and below it.',
      groups: [
        // chapter-top.js places these above .chapter-content, in this order:
        // SLOTS = { resume: 5, meta: 10, recap: 20 }.
        {
          title: 'Before the chapter starts',
          keys: [
            'chapter.resume',
            'chapter.topTimestamp',
            'chapter.wordCount',
            'chapter.wpm',
            'chapter.catchUp',
            'recap.mode',
            'recap.paragraphs',
          ],
        },
        {
          title: 'The chapter text',
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
        { title: 'After the chapter', keys: ['notes.mode', 'notes.hideAuthorPanel'] },
      ],
    },
    {
      id: 'comments',
      title: 'Comments',
      blurb: 'Underneath every chapter.',
      groups: [
        {
          title: 'The comment list',
          keys: [
            'comments.threading',
            'comments.separators',
            'comments.dividerOpacity',
            'comments.collapsible',
            'comments.threadColor',
            'comments.autoLoad',
          ],
        },
        {
          title: 'Comments you would rather skip',
          keys: [
            'comments.thanks',
            'comments.emotes',
            'comments.patternAction',
            'comments.foldPatterns',
            // Last: it qualifies every rule above it.
            'comments.foldAuthors',
          ],
        },
        { title: 'Since your last visit', keys: ['comments.seen', 'comments.seenDays'] },
      ],
    },
  ];

  /** Every key the page renders, flattened. */
  const sectionKeys = () => SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.keys));

  /** Deliberately not shown, with the reason. Every schema key must be in a
   *  section or here, or the options test fails. */
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
