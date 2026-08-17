'use strict';

/**
 * Every Royal Road DOM selector this extension depends on, in one place, so a
 * redesign change breaks here and nowhere else. `main.js` health-checks these on
 * list pages and warns loudly if the list stops matching.
 *
 * Verified against Royal Road build 4.1.20260807.38. Ground-truth captures of
 * every page shape live in `test/fixtures/`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * The per-fiction unit on each page shape, paired with the link naming which
   * fiction it is about. Hiding a fiction is `display: none` on the card.
   *
   * The link is not `a[href*="/fiction/"]`, and that matters: author blurbs
   * regularly link to other fictions ("if you liked this, try..."), so that
   * would put the hide button on the wrong card and make hiding A hide every
   * card whose blurb recommends A. `data-vt-trigger="fiction-card"` marks the
   * card's own title/cover link and is on 100% of server-rendered cards.
   *
   * Carousels are scoped rather than global: bare `[data-rr-carousel-item]`
   * would also match /home's splash carousel, whose slides are blog posts, and
   * the colour-scheme picker.
   */
  const CARD_GROUPS = [
    {
      cards: [
        // /fictions/* list pages, including latest-updates and search
        '.fiction-card-expanded',
        // /home "Rising Stars" / "Best Rated" strips
        '.fiction-card-horizontal',
        // /home "Latest Updates" strip
        '.fiction-update-card',
        // /home fiction carousels, e.g. "Popular This Week" (Embla)
        '.fiction-carousel [data-rr-carousel-item]',
      ],
      link: 'a[data-vt-trigger="fiction-card"]',
    },
    {
      // /fiction/{id}/... "similar fictions": fetched from /fictions/similar and
      // rendered by React into <div id="recommendations">. It is react-slick, so
      // the real slide is `.slick-slide`, not the `.px-2.group` div the
      // component passes as a child. Built client-side, so no data-vt-trigger,
      // but a slide holds one link and no blurb, so a bare <a> is unambiguous.
      cards: ['.recommendations-carousel .slick-slide'],
      link: 'a',
    },
  ];

  const CARD_VARIANTS = CARD_GROUPS.flatMap((group) => group.cards);

  const SEL = {
    // --- redesign detection -------------------------------------------------
    /**
     * The single authority on "is this the redesign?", checked in main.js before
     * any UI is injected. No document_start check: the old UI's distinguishing
     * `<html class="ie8 no-js">` sits inside an IE conditional comment and so
     * never applies in a real browser. Nothing is lost by waiting - what boot.js
     * does first, `<html>` classes and the generated stylesheet, references
     * hooks that exist only in the redesign, so it is provably inert on the old
     * UI (enforced by test/selectors.test.js and test/dom.test.js).
     *
     * Kept broad: it has to pass on list pages, /home and fiction pages alike.
     * Not `.fiction-list` - the legacy UI has one of those too.
     */
    newUiProbe:
      '[data-rr-tooltip], [data-rr-paginate], [data-rr-carousel], [data-rr-expanded-fic-card], .fiction-card-horizontal',

    // --- list page skeleton -------------------------------------------------
    /**
     * Toolbar anchor and the "is this a list page?" test. `.fiction-list` is the
     * only wrapper common to every list page.
     *
     * Not the paginate skeleton: on /fictions/search it is a footer widget
     * *after* the results, with no content or items container, so anchoring to
     * it drops the toolbar at the bottom of the page. Elsewhere it wraps the
     * list as [data-rr-paginate] > .rr-paginate-content >
     * [data-rr-paginate-items-container] > .fiction-list. Its id is no better:
     * "fiction-list-paginate" everywhere except /fictions/search, where it is a
     * random GUID.
     */
    listRoot: '.fiction-list',
    paginateRoot: '[data-rr-paginate]',
    /** Royal Road's own site-wide tag filters. The button is on every list page
     *  signed in or out, so finding it proves nothing; the badge inside it
     *  carries the count, and only appears when there is one. Its dialog is not
     *  in the DOM until opened. */
    globalFiltersTrigger: '[data-rr-global-filters-trigger]',
    /** The fiction's own header, which is where its tags are. Scoping to it
     *  keeps the tag rules off every other tag row on the page. */
    fictionHero: '#fiction-hero',
    listCard: '.fiction-card-expanded',

    // --- description "show more" widget (pure CSS on RR's side) --------------
    // <div data-rr-show-more>
    //   <input type=checkbox id="show-more-blurb-{fictionId}" class="peer sr-only">
    //   <div data-rr-show-more-content style="max-height:96px">…blurb…</div>
    //   <div data-rr-show-more-wrapper><div class="gradient-wrapper"></div><label/></div>
    // </div>
    showMoreRoot: '[data-rr-show-more]',
    showMoreContent: '[data-rr-show-more-content]',
    showMoreWrapper: '[data-rr-show-more-wrapper]',
    showMoreGradient: '.gradient-wrapper',
    blurbCheckboxPrefix: 'show-more-blurb-',

    // --- bits we read off a card to build its "hidden" record ---------------
    cardTitle: 'h1, h2, h3',
    cardCover: 'img[data-type="cover"]',
    cardCoverFallback: 'img[src]',
    /** Appended to a group's `link` selector to reach only fiction URLs. */
    fictionHref: '[href*="/fiction/"]',

    // --- bits we read off a card to filter on -------------------------------
    /** Star widget. Two per card (mobile + desktop); both carry the same value. */
    cardRating: '[data-rr-initial-rating]',
    /**
     * Stat tiles are `<div><div>2,116</div><div class="… uppercase">Followers</div></div>`.
     * We find the label and read back to the value: the value div's classes
     * differ between the mobile and desktop grids, the label text does not.
     * Filtered against CARD_STATS, so stray `.uppercase` matches are harmless.
     */
    cardStatLabel: '.uppercase',
    /** Tag chips - the slug is in the href. */
    cardTag: 'a[href*="tagsAdd="]',

    /** The published tag vocabulary, on `/fictions/search` only. The select is
     *  72 tags and carries no genres at all; the genre buttons are the other 22,
     *  and not one of them appears in the select. Chips off a list page overlap
     *  both and cover neither, which is why these two are what "the whole
     *  vocabulary" means. */
    tagSelect: '#tagsAdd',
    genreButton: '.genre-tag-btn[data-tag]',
    /** The button's own text includes its tooltip on some renders. */
    genreLabel: '.tag-label',
    /** Last-updated. Several per card, all the same timestamp. */
    cardTime: 'time[unixtime]',
    /** Status and type chips: `<span>` with `bg-accent`, sharing the chip row
     *  with the tag `<a>`s - hence a span selector, since no class tells the two
     *  apart. */
    cardChip: 'span.bg-accent',

    // --- personal state, three different mechanisms -------------------------
    /** Read Later is a real form; `mark=False` means it is already marked. */
    cardRilForm: 'form[data-bookmark-type="ril"]',
    cardMarkInput: 'input[name="mark"]',
    /** Follow/Favourite are passive tooltip icons, absent entirely when unset. */
    cardTooltipContent: '[data-rr-tooltip-content]',
    cardFollowIcon: 'i.fa-bookmark.text-primary',
    cardFavoriteIcon: 'i.fa-heart.text-danger',

    // --- chapter page -------------------------------------------------------
    /** The card Royal Road wraps an author note in, header included. */
    authorNoteCard: '.author-note-card',
    /** The note body. Its direct children are the blocks a shoutout occupies. */
    authorNote: '.author-note',
    /** About-author panel root. `[data-author-role]` and not `[data-author-id]`:
     *  the id is also on the follow forms inside the panel (desktop and mobile),
     *  so keying off it matched three elements per panel. */
    authorPanel: '[data-author-role]',
    /** Text of the heading that titles the whole About-author section. */
    authorPanelHeading: 'About author',
    chapterContent: '.chapter-content',
    /**
     * The card holding the chapter itself: both navigation bars, the author
     * notes, the chapter text and the meta bar under it - and not the comments,
     * not the About-author panel. Exactly one per chapter page, and the direct
     * parent of `.chapter-content`.
     *
     * This scope is what makes `chapterTime` answerable. Unscoped,
     * `time[unixtime]` finds three elements on a fresh chapter page - the
     * chapter's own stamp and two copies of the author's join date - and dozens
     * more once the comments load, since every comment carries one.
     * `[data-author-role]` excludes the join dates; only a container excludes
     * the comments.
     *
     * A bare class rather than a `data-rr-` hook, unusually, because Royal
     * Road's own extras stylesheet keys off it (`.chapter.font-size-14
     * .chapter-content p`), so it is not free to churn.
     */
    chapterCard: '.chapter',
    /** Royal Road's own previous-chapter link, marked by direction rather than
     *  by label. Repeated above and below the chapter, and absent on a fiction's
     *  first chapter - which is how the recap knows there is nothing to show. */
    chapterPrev: '[data-vt-direction="prev"]',
    /** Mirror of `chapterPrev`, absent on the latest chapter - a free,
     *  always-current check on whether a saved chapter list has gone stale. */
    chapterNext: '[data-vt-direction="next"]',
    /**
     * A chapter timestamp. Always used scoped to `chapterCard`, never globally -
     * see the note there.
     *
     * Read through the `unixtime` attribute, never `textContent`: Royal Road
     * rewrites the rendered text client-side ("6 years", "10 days ago"), so a
     * guard comparing text would never settle. The attribute is server-rendered
     * and does not move.
     */
    chapterTime: 'time[unixtime]',
    /** The tooltip naming a timestamp ("Created At"). English-only, so used to
     *  label a stamp we already found rather than to find one. */
    chapterTimeLabel: '[data-rr-tooltip-content]',
    chapterContainer: '#chapter-page-container',
    commentLoader: '#comment-loader',
    commentsPaginate: '#comments-pagination',
    /** The comment sort control, `data-reader-preference-binding="commentSorting"`. */
    commentSortDropdown: '#comment-sort-dropdown',
    /** The list Royal Road's comment AJAX fills, and that we append pages to. */
    commentsContainer: '#comments-container',
    comment: '[data-comment-id]',
    /** NB: a grandchild of its comment, not a child. */
    commentReplies: '.comment-replies',
    commentBody: '.comment-content',
    /** A comment's own body row - avatar, name, text, buttons - but not its
     *  replies, which are a later sibling. That is what lets us pad this row for
     *  the collapse button without the padding accumulating down nested
     *  replies. */
    commentBodyRow: '.wrap-anywhere > :first-child',
    /** Past depth 2, Royal Road stops using `.comment-replies` and puts the rest
     *  of the chain in one of these, `hidden` until the reader clicks "N more
     *  replies". The nesting continues either way, so anything that walks or
     *  styles a reply chain has to accept both. */
    commentDeepReplies: '[data-rr-deep-replies]',
    commentExpandDeep: '[data-rr-comment-expand-deep]',
    /** The feather beside an author's own comment. Royal Road also tints that
     *  comment's left border, but the colour is a reputation tier, not an author
     *  marker: seven values across one page, covering 12 of its 17 author
     *  comments. The feather covers all 17. */
    commentAuthorBadge: 'i.fa-feather-alt',
    /** Corroborates the feather. English-only, so never relied on alone. */
    commentTooltip: '[data-rr-tooltip-content]',
    /**
     * When a comment was posted. Exactly one per comment, and always resolved
     * through the `ownParts` discipline the rest of this file's comment
     * selectors need: a comment contains its replies, each carrying one of these
     * too. Read through the `unixtime` attribute rather than the text, which
     * Royal Road rewrites client-side into "3 days ago".
     *
     * Rejected: ordering by `data-comment-id` - it looks monotonic and needs no
     * parsing, but Royal Road has never promised that, and it says nothing about
     * an edited or imported comment.
     */
    commentTime: 'time[unixtime]',
    /** A Royal Road emoticon inside a comment. Two directories are live,
     *  `/public/smilies/` and `/public/Smileys/` - they differ in spelling as
     *  well as case, so matching either alone finds about half of them. Both
     *  begin "smil", hence the prefix and the case-insensitive flag. */
    commentEmote: 'img[src*="/public/smil" i]',
    /** Royal Road's own Reading Preferences dialog, which we add a link to. */
    readingPrefsDialog: '#reading-preferences [data-rr-dialog-content]',

    // --- fiction page -------------------------------------------------------
    accordionTrigger: '[data-rr-accordion-trigger]',
    /** "About Fiction": an accordion wrapping a show-more, not a plain panel. */
    aboutAccordion: '#about-accordion',
    recommendationsAccordion: '#recommendations-accordion',
    reviewsPaginate: '#reviews-pagination',
    reviewsContainer: '#reviews-pagination [data-rr-paginate-items-container]',
    /** The sort control. Reading which option is *chosen* from it is a trap and
     *  was tried: once Royal Road has initialised the dropdown the reviews one
     *  marks its choice `aria-selected="true"` while leaving
     *  `data-rr-dropdown-selected="false"` on every option, the comments one
     *  sets both, and the captures predate initialisation so they show neither.
     *  The order in effect is on the paginate root's own fetch URL instead. */
    reviewSortDropdown: '#review-sort-dropdown',
    dropdownItem: '[data-rr-dropdown-item]',

    // --- fiction page: the numbers ------------------------------------------
    /** The Statistics panel. Royal Road ships it *closed*, but its contents are
     *  server-rendered and in the DOM either way, so they read fine. */
    statsAccordion: '#stats-accordion',
    /** Where a readout goes: between the trigger and the collapsing content, so
     *  it shows whether or not the panel is open and a click on it does not
     *  toggle the panel. */
    statsAccordionItem: '#stats-accordion [data-rr-accordion-item]',
    statsAccordionContent: '#stats-accordion [data-rr-accordion-content]',
    /** The chapter count, which is not a stat tile: it lives on the table of
     *  contents, as an attribute. */
    chaptersCount: '#chapters[data-chapters]',
    /** Five sit in the panel - the overall score and four sub-scores - each
     *  beside its own heading, which is how they are told apart. */
    ratingWidget: '[data-rr-rating-selector]',
    /** Inside a widget: "4.83 out of 5". The stars and `data-rr-initial-rating`
     *  are both rounded to 4.8; this is the only place the real figure is. */
    ratingValue: '[data-rr-tooltip-content]',
    /** The score as a number, rather than text to parse out of a tooltip. */
    ratingLd: 'script[type="application/ld+json"]',
    /** The tooltip beside the title - the one score source outside the panel. */
    ratingTooltip: '#fiction-rating-tooltip [data-rr-tooltip-content] span.font-semibold',
  };

  /**
   * Fiction-page sections that really are open/closed accordions, mapped to the
   * setting that opens them. Each is a `[data-rr-accordion-id]`; the trigger
   * inside carries `aria-expanded`.
   *
   * About and Recommendations are deliberately absent: About is a "show more"
   * block whose accordion-collapse empties it, and Recommendations has no
   * working collapse at all. Both are handled in fiction-page.js.
   */
  const FICTION_ACCORDIONS = {
    'stats-accordion': 'fiction.stats',
    'chapters-accordion': 'fiction.chapters',
    'reviews-accordion': 'fiction.reviews',
    // Only rendered when logged in; absent is handled as a no-op.
    'write-a-review-accordion': 'fiction.writeReview',
  };

  /** Stat tile labels we understand, mapped to the field they populate. */
  const CARD_STATS = {
    Followers: 'followers',
    Pages: 'pages',
    Chapters: 'chapters',
    Views: 'views',
  };

  /** The Statistics tiles, by label text, in the order Royal Road lays them out.
   *  By label because a tile carries no id and no `data-rr-` hook, only Tailwind
   *  classes: anything positional mispairs silently when one moves. */
  const FICTION_STATS = {
    'Total Views': 'v',
    /** Total views over chapters, so it moves whenever a chapter is posted.
     *  Tracked anyway: every tile is annotated, and one left blank reads as a
     *  fault. */
    'Avg. Views': 'w',
    Followers: 'f',
    Favorites: 'm',
    Ratings: 'r',
    Pages: 'p',
  };

  /** The star ratings, by the heading each sits under. */
  const FICTION_SCORES = {
    'Overall Score': 's',
    Style: 'sty',
    Story: 'sto',
    Grammar: 'gra',
    Character: 'cha',
  };

  /** Tooltip text Royal Road uses for the passive status icons. */
  const MINE_TOOLTIPS = {
    Following: 'follow',
    Favorited: 'favorite',
    Favorite: 'favorite', // mobile says "Favorite", desktop "Favorited"
  };

  return {
    SEL,
    CARD_GROUPS,
    CARD_VARIANTS,
    CARD_STATS,
    FICTION_STATS,
    FICTION_SCORES,
    MINE_TOOLTIPS,
    FICTION_ACCORDIONS,
  };
});
