'use strict';

/**
 * Every Royal Road DOM selector this extension depends on, in one place.
 *
 * Royal Road is actively iterating on the redesign, so when something breaks it
 * should break here and nowhere else. `main.js` runs a health check against
 * these on list pages and warns loudly if the list stops matching.
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
   * The per-fiction "unit" on every page shape we support, paired with the link
   * that identifies which fiction that unit is about. Hiding a fiction means
   * `display: none` on whichever card wraps it.
   *
   * The link selector is NOT just `a[href*="/fiction/"]`, and that matters:
   * author-written blurbs regularly link to *other* fictions ("if you liked this,
   * try..."). Matching any fiction link would put a hide button on the wrong
   * card and, far worse, make hiding fiction A also hide every card whose blurb
   * happens to recommend A. `data-vt-trigger="fiction-card"` marks the card's
   * own title/cover link and is present on 100% of server-rendered cards.
   *
   * Both carousel entries are deliberately scoped rather than global:
   *  - `[data-rr-carousel-item]` on its own would also match /home's splash
   *    carousel, whose slides are *blog posts*, and the colour-scheme picker.
   *  - the recommendations carousel is react-slick, so its real slide element is
   *    `.slick-slide`, not the `.px-2.group` div the component passes as a child.
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
      // rendered by React into <div id="recommendations"> (react-slick). These
      // slides are built client-side and carry no data-vt-trigger, but they hold
      // exactly one link and no blurb, so a bare <a> is unambiguous here.
      cards: ['.recommendations-carousel .slick-slide'],
      link: 'a',
    },
  ];

  const CARD_VARIANTS = CARD_GROUPS.flatMap((group) => group.cards);

  const SEL = {
    // --- redesign detection -------------------------------------------------
    /**
     * The single authority on "is this the redesign?", checked in main.js before
     * any UI is injected. There is deliberately no document_start check: the old
     * UI's distinguishing `<html class="ie8 no-js">` sits inside an IE
     * conditional comment and so never actually applies in a real browser.
     *
     * Nothing is lost by waiting. Everything boot.js does before this point -
     * `<html>` classes and the generated stylesheet - references hooks that
     * exist only in the redesign, so it is provably inert on the old UI
     * (enforced by test/selectors.test.js and test/dom.test.js).
     *
     * Kept broad: it has to pass on list pages, /home and fiction pages alike.
     * NB: `.fiction-list` is NOT usable here - the legacy UI has one too.
     */
    newUiProbe:
      '[data-rr-tooltip], [data-rr-paginate], [data-rr-carousel], [data-rr-expanded-fic-card], .fiction-card-horizontal',

    // --- list page skeleton -------------------------------------------------
    /**
     * Toolbar anchor and the "is this a list page?" test.
     *
     * `.fiction-list` is the ONLY wrapper common to every list page. The
     * paginate skeleton is not usable for this:
     *  - on most pages it wraps the list as
     *    [data-rr-paginate] > .rr-paginate-content > [data-rr-paginate-items-container] > .fiction-list
     *  - but on /fictions/search it is a footer widget *after* the results, with
     *    no content or items container at all - anchoring to it would drop the
     *    toolbar at the bottom of the page.
     * Its id is no better: "fiction-list-paginate" everywhere except
     * /fictions/search, where it is a random GUID. Never key off either.
     */
    listRoot: '.fiction-list',
    paginateRoot: '[data-rr-paginate]',
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
     * We find the labels and read back to the value, because the value div's
     * classes differ between the mobile and desktop grids but the label text
     * does not. Filtered against CARD_STATS, so `.uppercase` matching anything
     * else on the card is harmless.
     */
    cardStatLabel: '.uppercase',
    /** Tag chips - the slug is in the href. */
    cardTag: 'a[href*="tagsAdd="]',
    /** Last-updated. Several per card, all the same timestamp. */
    cardTime: 'time[unixtime]',
    /**
     * Status and type chips. Both are `<span>` with `bg-accent`, sharing the chip
     * row with the tag `<a>`s - which is why this is a span selector, not a
     * class the two could be told apart by.
     */
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
    /** The note body. Its DIRECT CHILDREN are the blocks a shoutout occupies. */
    authorNote: '.author-note',
    /**
     * The About-author panel root. `[data-author-role]` and not
     * `[data-author-id]`: the id is also on the follow forms inside the panel
     * (desktop and mobile), so keying off it matched three elements per panel.
     */
    authorPanel: '[data-author-role]',
    /** Text of the heading that titles the whole About-author section. */
    authorPanelHeading: 'About author',
    chapterContent: '.chapter-content',
    /**
     * The card holding the chapter itself: both navigation bars, the author
     * notes, the chapter text and the meta bar under it - and NOT the comments,
     * NOT the About-author panel. Exactly one per chapter page, and the direct
     * parent of `.chapter-content`.
     *
     * This is the scope that makes `chapterTime` answerable at all. Unscoped,
     * `time[unixtime]` finds three elements on a fresh chapter page - the
     * chapter's own stamp and two copies of the AUTHOR'S JOIN DATE - and dozens
     * more once the comments load, since every comment carries one.
     * `[data-author-role]` excludes the join dates but nothing excludes the
     * comments except a container.
     *
     * A bare class rather than a `data-rr-` hook, unusually, because Royal
     * Road's own extras stylesheet keys off it (`.chapter.font-size-14
     * .chapter-content p`), so it carries meaning to them and is not free to
     * churn.
     */
    chapterCard: '.chapter',
    /**
     * Royal Road's own previous-chapter link, which it marks by direction
     * rather than by label. Repeated above and below the chapter, and simply
     * absent on the first chapter of a fiction, which is how the recap knows
     * there is nothing before this one to show.
     */
    chapterPrev: '[data-vt-direction="prev"]',
    /**
     * The mirror of `chapterPrev`, absent on the latest chapter of a fiction.
     * Its absence is therefore a free, always-current check on whether a
     * chapter list we saved earlier has gone stale.
     */
    chapterNext: '[data-vt-direction="next"]',
    /**
     * A chapter timestamp. ALWAYS used scoped to `chapterCard`, never globally
     * - see the note there.
     *
     * Read through the `unixtime` attribute, never `textContent`: Royal Road
     * rewrites the rendered text client-side ("6 years", "10 days ago"), so a
     * guard comparing text would never settle. The attribute is server-rendered
     * and does not move.
     */
    chapterTime: 'time[unixtime]',
    /**
     * The tooltip naming a timestamp ("Created At"). English-only, so used to
     * label a stamp we already found rather than to find one.
     */
    chapterTimeLabel: '[data-rr-tooltip-content]',
    chapterContainer: '#chapter-page-container',
    commentLoader: '#comment-loader',
    commentsPaginate: '#comments-pagination',
    /** The list Royal Road's comment AJAX fills, and that we append pages to. */
    commentsContainer: '#comments-container',
    comment: '[data-comment-id]',
    /** NB: a grandchild of its comment, not a child. */
    commentReplies: '.comment-replies',
    commentBody: '.comment-content',
    /**
     * A comment's own body row: avatar, name, text, buttons, but *not* its
     * replies, which are a later sibling of this row. That distinction is what
     * lets us pad this row to make room for the collapse button without the
     * padding accumulating down a chain of nested replies.
     */
    commentBodyRow: '.wrap-anywhere > :first-child',
    /**
     * Past depth 2, Royal Road stops using `.comment-replies` and puts the rest
     * of the chain in one of these instead, `hidden` until the reader clicks the
     * "N more replies" button beside it. The nesting continues either way, so
     * anything that walks or styles a reply chain has to accept both.
     */
    commentDeepReplies: '[data-rr-deep-replies]',
    commentExpandDeep: '[data-rr-comment-expand-deep]',
    /**
     * The feather beside an author's own comment. Royal Road also tints that
     * comment's left border, but the border colour is a reputation tier, not an
     * author marker: it takes seven different values across one page and only
     * covers 12 of the 17 author comments on it. The feather covers all 17.
     */
    commentAuthorBadge: 'i.fa-feather-alt',
    /** Corroborates the feather. English-only, so never relied on alone. */
    commentTooltip: '[data-rr-tooltip-content]',
    /**
     * A Royal Road emoticon inside a comment.
     *
     * Two directories are in use: `/public/smilies/` and `/public/Smileys/`.
     * They differ in spelling as well as in case, and both are live, so
     * matching either one alone finds about half of them. Both begin "smil",
     * hence the prefix and the case-insensitive flag.
     */
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
    reviewSortDropdown: '#review-sort-dropdown',
    dropdownItem: '[data-rr-dropdown-item]',
  };

  /**
   * Fiction-page accordions, mapped to the setting that opens them. Each is a
   * `[data-rr-accordion-id]`; the trigger inside carries `aria-expanded`.
   */
  /**
   * Fiction-page sections that really are open/closed accordions.
   *
   * About and Recommendations are deliberately absent: About is a "show more"
   * block whose accordion-collapse empties it, and Recommendations has no
   * working collapse at all. Both are handled separately in fiction-page.js.
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

  /** Tooltip text Royal Road uses for the passive status icons. */
  const MINE_TOOLTIPS = {
    Following: 'follow',
    Favorited: 'favorite',
    Favorite: 'favorite', // the mobile variant says "Favorite", the desktop one "Favorited"
  };

  return { SEL, CARD_GROUPS, CARD_VARIANTS, CARD_STATS, MINE_TOOLTIPS, FICTION_ACCORDIONS };
});
