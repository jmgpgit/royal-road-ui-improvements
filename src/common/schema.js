'use strict';

/**
 * The settings schema, and the one generic normalizer that walks it.
 *
 * With roughly forty settings, the shape is declared once and everything else
 * reads from here: validation, defaults, the options page bindings and storage
 * round-tripping. Adding a setting means adding a line to SCHEMA and a control
 * bound with `data-setting="<key>"`, and no normalizer changes.
 *
 * Keys are flat, dotted strings (`'reader.lineHeight'`), not nested objects.
 * Flat keeps storage, `data-setting` binding and diffing trivial; the dots are
 * purely for grouping and for how the options page is laid out.
 *
 * `null` on a nullable numeric means "no constraint" - a filter set to null never
 * excludes anything. That is deliberately distinct from 0.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATUSES = ['ONGOING', 'HIATUS', 'COMPLETED', 'STUB', 'DROPPED'];
  const TYPES = ['Original', 'Fan Fiction'];
  const MINE = ['follow', 'favorite', 'ril'];
  const VIEWS = ['default', 'compact', 'grid', 'two-col'];

  /**
   * Accordion control is three-state, not a boolean.
   *
   * Royal Road already opens About, Chapters, Reviews and Recommendations by
   * default and leaves Statistics shut, so "open by default" was a no-op on
   * four of the five. What is actually useful is being able to force either way,
   * or leave Royal Road's own choice alone.
   */
  const ACCORDION_STATES = ['leave', 'open', 'closed'];

  /** A nullable numeric filter bound: null means "no constraint". */
  const bound = (min, max) => ({ type: 'number', default: null, nullable: true, min, max });

  const SCHEMA = {
    // ── fiction list pages ────────────────────────────────────────────────
    'list.expandAll': { type: 'bool', default: false },
    'list.hoverExpand': { type: 'bool', default: false },
    'list.hoverDelayMs': { type: 'int', default: 150, min: 0, max: 2000 },
    'list.showToolbar': { type: 'bool', default: true },
    /**
     * Strip "[LitRPG]" / "(Book One Complete)" suffixes from titles in lists.
     * Lists only - on a fiction's own page the full title is the heading of the
     * thing you deliberately opened.
     */
    'list.cleanTitles': { type: 'bool', default: false },
    /** Widen the fiction lists past Royal Road's own container. */
    'list.maxWidthPx': { type: 'int', default: null, nullable: true, min: 700, max: 4000 },
    'list.view': { type: 'enum', default: 'default', values: VIEWS },

    // ── hiding individual fictions (v1 feature) ───────────────────────────
    'hide.enabled': { type: 'bool', default: true },
    'hide.showHidden': { type: 'bool', default: false },

    // ── filters ───────────────────────────────────────────────────────────
    'filters.enabled': { type: 'bool', default: true },
    'filters.minRating': bound(0, 5),
    'filters.maxRating': bound(0, 5),
    'filters.minFollowers': bound(0, 1e9),
    'filters.maxFollowers': bound(0, 1e9),
    'filters.minViews': bound(0, 1e12),
    'filters.maxViews': bound(0, 1e12),
    'filters.minPages': bound(0, 1e7),
    'filters.maxPages': bound(0, 1e7),
    'filters.minChapters': bound(0, 1e6),
    'filters.maxChapters': bound(0, 1e6),
    'filters.tagsAll': { type: 'list', default: [] },
    'filters.tagsNone': { type: 'list', default: [] },
    'filters.status': { type: 'list', default: [], values: STATUSES },
    'filters.type': { type: 'list', default: [], values: TYPES },
    /** Updated within the last N days. */
    'filters.updatedWithinDays': bound(0, 3650),
    /** Not updated for at least N days - for finding things that have gone quiet. */
    'filters.staleForDays': bound(0, 3650),
    'filters.hideMine': { type: 'list', default: [], values: MINE },

    /**
     * Keep filling the list as you scroll rather than paging through it. Its
     * limits (pages scanned, the gap between requests) are constants in
     * list-loadmore.js rather than settings: they exist to be polite to Royal
     * Road's servers, which is not a preference.
     */
    'list.infiniteScroll': { type: 'bool', default: true },

    // ── chapter reader ────────────────────────────────────────────────────
    'reader.enabled': { type: 'bool', default: false },
    'reader.lineHeight': { type: 'number', default: null, nullable: true, min: 1, max: 3 },
    'reader.justify': { type: 'bool', default: false },
    'reader.hyphens': { type: 'bool', default: true },
    /** Any CSS colour; empty means leave Royal Road's alone. */
    'reader.textColor': { type: 'color', default: '', maxLength: 40 },
    /** A font-family stack. Local fonts only - Royal Road's CSP blocks remote font loads. */
    'reader.fontFamily': { type: 'string', default: '', maxLength: 200 },
    'reader.maxWidthPx': { type: 'int', default: null, nullable: true, min: 600, max: 4000 },

    /**
     * How the previous chapter's ending is shown at the top of a chapter.
     *
     * `always` prints it, `click` and `hover` keep it behind a summary you open,
     * and `off` fetches nothing at all. Reading several fictions at once makes
     * "what happened last time" the most common thing a reader has to leave the
     * page to answer, and Royal Road offers nothing for it.
     */
    'recap.mode': { type: 'enum', default: 'off', values: ['off', 'always', 'click', 'hover'] },
    /**
     * How much of the ending to show, in paragraphs. Trailing scene-break
     * markers do not count towards it: chapters routinely end on a line of
     * asterisks, and a recap of punctuation helps nobody.
     */
    'recap.paragraphs': { type: 'int', default: 4, min: 1, max: 15 },

    // ── author notes, panels ────────────────────────────────────
    // Defaults to off: collapsing part of an author's note is a judgement call,
    // and one the reader should opt into rather than discover.
    'notes.mode': { type: 'enum', default: 'off', values: ['off', 'shoutouts', 'all'] },
    'notes.hideAuthorPanel': { type: 'bool', default: false },
    /**
     * Royal Road author ids whose notes are always collapsed, whatever
     * `notes.mode` says. There is no control for this on the options page: it
     * is set by exporting your settings, adding ids, and importing them back.
     */
    'notes.blockedAuthors': { type: 'list', default: [] },

    // ── comments ──────────────────────────────────────────────────────────
    'comments.threading': { type: 'bool', default: true },
    /** A rule under each top-level comment, so threads stop running together. */
    'comments.separators': { type: 'bool', default: true },
    /** Empty means "use the theme's accent". Any CSS colour. */
    'comments.threadColor': { type: 'color', default: '', maxLength: 40 },
    /**
     * How strongly the divider between threads is drawn, as a percentage of
     * the theme's text colour.
     *
     * Adjustable because no single value works everywhere: Royal Road ships a
     * dozen themes, and on some of them the text colour sits close to the
     * background, so a rule that is a clear hairline on one is invisible on
     * another. The default is deliberately faint: it should read as a division
     * between conversations, not as a rule drawn across the page.
     */
    'comments.dividerOpacity': { type: 'int', default: 16, min: 1, max: 100 },
    /** A [−] on every thread that has replies. */
    'comments.collapsible': { type: 'bool', default: true },
    /** Keep loading comment pages as you scroll, instead of one click per page. */
    'comments.autoLoad': { type: 'bool', default: false },
    /**
     * What to do with comments that say nothing but "thanks for the chapter".
     * `fold` dims them to one line; `hide` removes them from the page.
     */
    'comments.thanks': { type: 'enum', default: 'keep', values: ['keep', 'fold', 'hide'] },
    /**
     * Extra patterns to fold or hide, one per line, matched case-insensitively.
     * A line that is not valid regex syntax is matched as a literal phrase.
     */
    'comments.foldPatterns': { type: 'string', default: '', maxLength: 2000 },
    /**
     * What matching those patterns does. Deliberately its own setting rather
     * than sharing the acknowledgement rule's action: that defaults to "leave
     * alone", and a pattern box that does nothing until an unrelated dropdown
     * is also changed reads as broken. Defaulting to `fold` means typing in the
     * box has an effect, which is what a box implies.
     */
    'comments.patternAction': { type: 'enum', default: 'fold', values: ['keep', 'fold', 'hide'] },
    /**
     * Comments whose whole body is a Royal Road emoticon and nothing else.
     *
     * Its own setting rather than part of the acknowledgement rule, because the
     * two do not travel together: plenty of readers who want "tyfc" gone are
     * happy to keep the emoticons, which carry a reaction that words did not.
     * It also cannot share the machinery, since these comments have no text at
     * all and every text rule sees an empty string.
     */
    'comments.emotes': { type: 'enum', default: 'keep', values: ['keep', 'fold', 'hide'] },
    /**
     * Whether the rules above are allowed to reach the author's own comments.
     *
     * Off by default: on a chapter page the author is the one person whose
     * short reply is worth reading, and "Thanks!" from them means something
     * different from the same word from anyone else. Hiding never reaches them
     * whatever this is set to; see `actionForComment`.
     */
    'comments.foldAuthors': { type: 'bool', default: false },

    // ── fiction page ──────────────────────────────────────────────────────
    // About Fiction is a "show more" block rather than a panel, so open and
    // closed are applied to its text rather than to the section around it.
    'fiction.about': { type: 'enum', default: 'leave', values: ACCORDION_STATES },
    'fiction.stats': { type: 'enum', default: 'leave', values: ACCORDION_STATES },
    'fiction.chapters': { type: 'enum', default: 'leave', values: ACCORDION_STATES },
    'fiction.recommendations': { type: 'enum', default: 'leave', values: ['leave', 'show', 'hide'] },
    'fiction.writeReview': { type: 'enum', default: 'leave', values: ACCORDION_STATES },
    'fiction.reviews': { type: 'enum', default: 'leave', values: ACCORDION_STATES },
    /** Royal Road always opens reviews on "Top"; this picks a different default. */
    'fiction.reviewSort': {
      type: 'enum',
      default: 'leave',
      values: ['leave', 'top', 'newest', 'oldest', 'upvotes'],
    },
    'fiction.reviewsAutoLoad': { type: 'bool', default: false },
  };

  /**
   * v1 shipped these six as bare keys. Reading them keeps existing installs'
   * settings intact through the upgrade; nothing writes them any more.
   */
  const LEGACY_KEYS = {
    expandAll: 'list.expandAll',
    hoverExpand: 'list.hoverExpand',
    hoverDelayMs: 'list.hoverDelayMs',
    showToolbar: 'list.showToolbar',
    hideEnabled: 'hide.enabled',
    showHidden: 'hide.showHidden',
  };

  const clamp = (n, spec) => {
    if (spec.min !== undefined) n = Math.max(spec.min, n);
    if (spec.max !== undefined) n = Math.min(spec.max, n);
    return n;
  };

  /** Coerce one raw value to its spec, falling back to the default. */
  function coerce(spec, value) {
    switch (spec.type) {
      case 'bool':
        return value === undefined ? spec.default : !!value;

      case 'int':
      case 'number': {
        if (value === null || value === undefined || value === '') {
          return spec.nullable ? null : spec.default;
        }
        let n = Number(value);
        if (!Number.isFinite(n)) return spec.nullable ? null : spec.default;
        if (spec.type === 'int') n = Math.round(n);
        return clamp(n, spec);
      }

      case 'enum':
        return spec.values.includes(value) ? value : spec.default;

      case 'string': {
        if (typeof value !== 'string') return spec.default;
        return spec.maxLength ? value.slice(0, spec.maxLength) : value;
      }

      /**
       * Like a string, but a bare hex value gets its `#` put back.
       *
       * "7FFFD4" is what people copy out of a colour picker, and it is not
       * valid CSS, so without this the field silently does nothing. Adding the
       * hash is unambiguous: a CSS colour keyword would have to be spelled with
       * only the letters a to f to be confused with a hex value, and none of
       * the 148 of them is. Anything that is not bare hex is passed through
       * untouched, so "red", "rgb(1 2 3)" and "" all still work.
       */
      case 'color': {
        if (typeof value !== 'string') return spec.default;
        const text = value.trim();
        const bare = /^[0-9a-f]+$/i.test(text) && [3, 4, 6, 8].includes(text.length);
        const out = bare ? `#${text}` : text;
        return spec.maxLength ? out.slice(0, spec.maxLength) : out;
      }

      case 'list': {
        if (!Array.isArray(value)) return [...spec.default];
        const seen = new Set();
        for (const item of value) {
          if (typeof item !== 'string' || !item) continue;
          if (spec.values && !spec.values.includes(item)) continue;
          seen.add(item);
        }
        return [...seen];
      }

      default:
        throw new Error(`unknown schema type: ${spec.type}`);
    }
  }

  /** The full default settings object. */
  function defaultSettings() {
    const out = {};
    for (const [key, spec] of Object.entries(SCHEMA)) out[key] = coerce(spec, undefined);
    return out;
  }

  /**
   * Coerce anything into a complete, valid settings object. Unknown keys are
   * dropped; v1's bare keys are read once and folded into their v2 names.
   */
  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};

    // Legacy first, so an explicit v2 key always wins over its v1 alias.
    const merged = {};
    for (const [legacy, key] of Object.entries(LEGACY_KEYS)) {
      if (src[legacy] !== undefined) merged[key] = src[legacy];
    }
    for (const key of Object.keys(SCHEMA)) {
      if (src[key] !== undefined) merged[key] = src[key];
    }

    const out = {};
    for (const [key, spec] of Object.entries(SCHEMA)) out[key] = coerce(spec, merged[key]);
    return out;
  }

  /** Keys under a dotted prefix, e.g. group('filters') -> ['filters.minRating', …]. */
  const group = (prefix) => Object.keys(SCHEMA).filter((k) => k.startsWith(`${prefix}.`));

  return {
    SCHEMA,
    LEGACY_KEYS,
    DEFAULT_SETTINGS: Object.freeze(defaultSettings()),
    STATUSES,
    TYPES,
    MINE,
    VIEWS,
    ACCORDION_STATES,
    coerce,
    defaultSettings,
    normalizeSettings,
    group,
  };
});
