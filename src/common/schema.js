'use strict';

/**
 * The settings schema, and the one generic normalizer that walks it.
 *
 * Declared once; validation, defaults, the options page bindings and storage
 * round-tripping all read from here. A new setting is a line in SCHEMA plus a
 * control with `data-setting="<key>"`, and no normalizer changes.
 *
 * Keys are flat dotted strings (`'reader.lineHeight'`) - flat keeps storage,
 * binding and diffing trivial; the dots only group. `null` on a nullable
 * numeric means "no constraint", deliberately distinct from 0.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const RRX = (root.RRX = root.RRX || {});
  Object.assign(RRX, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATUSES = ['ONGOING', 'HIATUS', 'COMPLETED', 'STUB', 'DROPPED'];
  const TYPES = ['Original', 'Fan Fiction'];
  const MINE = ['follow', 'favorite', 'ril', 'dropped'];
  const VIEWS = ['default', 'compact', 'grid', 'two-col'];

  /**
   * Three-state, not a boolean: Royal Road already opens About, Chapters,
   * Reviews and Recommendations by default and leaves Statistics shut, so "open
   * by default" was a no-op on four of the five. Force either way, or leave
   * Royal Road's own choice alone.
   */
  const ACCORDION_STATES = ['leave', 'open', 'closed'];

  /** A nullable numeric filter bound: null means "no constraint". */
  const bound = (min, max) => ({ type: 'number', default: null, nullable: true, min, max });

  const SCHEMA = {
    // ── which of Royal Road's two layouts to use ──────────────────────────
    /**
     * Three states rather than a switch: "leave alone" has to be the default,
     * because installing an extension should not change which version of a site
     * somebody sees, and on/off would make "off" mean both "I have not chosen"
     * and "put me back on the old one". Royal Road remembers the choice in a
     * cookie, so going back needs it actively cleared, not just left alone.
     */
    'design.mode': { type: 'enum', default: 'leave', values: ['leave', 'new', 'old'] },

    // ── fiction list pages ────────────────────────────────────────────────
    'list.expandAll': { type: 'bool', default: false },
    'list.hoverExpand': { type: 'bool', default: false },
    'list.hoverDelayMs': { type: 'int', default: 150, min: 0, max: 2000 },
    'list.showToolbar': { type: 'bool', default: true },
    /** Strip "[LitRPG]" / "(Book One Complete)" suffixes from titles. Lists only
     *  - on a fiction's own page the full title is the heading of the thing you
     *  deliberately opened. */
    'list.cleanTitles': { type: 'bool', default: false },
    /** Widen the fiction lists past Royal Road's own container. */
    'list.maxWidthPx': { type: 'int', default: null, nullable: true, min: 700, max: 4000 },
    'list.view': { type: 'enum', default: 'default', values: VIEWS },
    'list.tagsExpand': { type: 'enum', default: 'off', values: ['off', 'hover', 'always'] },
    /** `<slug> <#hex>` per entry. A list rather than a map because the schema
     *  has no map type, and one more type is a worse trade than one encoding. */
    'tags.colors': { type: 'list', default: [] },
    'tags.colorHome': { type: 'bool', default: false },

    // ── hiding individual fictions (v1 feature) ───────────────────────────
    'hide.enabled': { type: 'bool', default: true },
    'hide.showHidden': { type: 'bool', default: false },

    /** Mark a fiction as one you tried and stopped reading. Its card dims and
     *  says so wherever it turns up, but stays where it is and stays clickable -
     *  changing your mind is the point, and hiding already covers "never show me
     *  this again".
     *
     *  On by default, beside hiding: the two are the same gesture on the same
     *  card, and a reader who never presses either sees two buttons and nothing
     *  else happens. Still its own switch, so the drop button can go without
     *  taking hiding with it. Nothing is marked until a button is pressed, and
     *  the filter chip works whatever this says. */
    'drop.enabled': { type: 'bool', default: true },

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

    /** Its limits (pages scanned, the gap between requests) are constants in
     *  list-loadmore.js rather than settings: they exist to be polite to Royal
     *  Road's servers, which is not a preference. */
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
     * `always` prints it, `click` and `hover` keep it behind a summary you open,
     * `off` fetches nothing at all. Reading several fictions at once makes "what
     * happened last time" the thing readers most often leave the page to answer,
     * and Royal Road offers nothing for it.
     */
    'recap.mode': { type: 'enum', default: 'off', values: ['off', 'always', 'click', 'hover'] },
    /** How much of the ending to show, in paragraphs. Trailing scene-break
     *  markers do not count: chapters routinely end on a line of asterisks. */
    'recap.paragraphs': { type: 'int', default: 4, min: 1, max: 15 },

    // ── chapter facts ─────────────────────────────────────────────────────
    /** Repeat the chapter's own timestamps above the text. Royal Road prints
     *  them below it, past the author notes and the About-author panel, where
     *  they cannot answer "how old is this?" before you start. Whatever stamps
     *  it renders are mirrored, so a new edited-at needs no change here. */
    'chapter.topTimestamp': { type: 'bool', default: false },
    /** How long the chapter is, above it. One setting rather than two switches:
     *  the count and the estimate are the same measurement shown two ways, and a
     *  "reading time" toggle that does nothing until "word count" is also on
     *  reads as broken. */
    'chapter.wordCount': { type: 'enum', default: 'off', values: ['off', 'words', 'time', 'both'] },
    /** Reading speed for that estimate. 250 is the conventional figure for
     *  English prose, so it will not read as wrong before anyone tunes it. */
    'chapter.wpm': { type: 'int', default: 250, min: 100, max: 1000 },
    /** Where this chapter sits in its fiction, and how many are left after it.
     *  Royal Road's "Select a chapter" dropdown numbers them, but the page ships
     *  it empty and fills it from `/fictions/chapterlist` only on focus, so the
     *  count costs that same request - about 3 KB for a hundred chapters, once
     *  per fiction per tab. Nothing is fetched while this is off. */
    'chapter.catchUp': { type: 'bool', default: false },
    /** Come back to where you stopped reading. Three states rather than a
     *  switch: landing somewhere you did not ask to be is startling the first
     *  time, so `ask` offers the jump and `jump` takes it. Nothing is recorded
     *  while this is `off`. */
    'chapter.resume': { type: 'enum', default: 'off', values: ['off', 'ask', 'jump'] },

    // ── author notes, panels ────────────────────────────────────
    // Off by default: collapsing part of an author's note is a judgement call,
    // and one the reader should opt into rather than discover.
    'notes.mode': { type: 'enum', default: 'off', values: ['off', 'shoutouts', 'all'] },
    'notes.hideAuthorPanel': { type: 'bool', default: false },
    /** Royal Road author ids whose notes are always collapsed, whatever
     *  `notes.mode` says. No control on the options page: export your settings,
     *  add ids, import them back. */
    'notes.blockedAuthors': { type: 'list', default: [] },

    // ── comments ──────────────────────────────────────────────────────────
    'comments.threading': { type: 'bool', default: true },
    /** A rule under each top-level comment, so threads stop running together. */
    'comments.separators': { type: 'bool', default: true },
    /** Empty means "use the theme's accent". Any CSS colour. */
    'comments.threadColor': { type: 'color', default: '', maxLength: 40 },
    /** How strongly the divider between threads is drawn, as a percentage of the
     *  theme's text colour. Adjustable because Royal Road ships a dozen themes
     *  and on some the text sits close to the background, so a clear hairline on
     *  one is invisible on another. Deliberately faint by default: a division
     *  between conversations, not a rule drawn across the page. */
    'comments.dividerOpacity': { type: 'int', default: 16, min: 1, max: 100 },
    /** A [−] on every thread that has replies. */
    'comments.collapsible': { type: 'bool', default: true },
    /** `mark` points out comments new since your last visit; `fold` also
     *  collapses the ones you have seen. Nothing is ever hidden - the new reply
     *  may be underneath a comment you already read. Royal Road serves the list
     *  ranked rather than chronologically, so there is no "new from here" line;
     *  each comment is judged on its own timestamp. */
    'comments.seen': { type: 'enum', default: 'off', values: ['off', 'mark', 'fold'] },
    /** How long a chapter's last-visit mark is worth keeping, in days. Past it
     *  the chapter reads as never visited, which is the useful answer - "new
     *  since June" means nothing on a reread months later - and stops the one
     *  cumulative thing here growing forever: a reading position deletes itself
     *  when the chapter is finished, a watermark would not. */
    'comments.seenDays': { type: 'int', default: 60, min: 1, max: 365 },
    /** Keep loading comment pages as you scroll, instead of one click per page. */
    'comments.autoLoad': { type: 'bool', default: false },
    /** Comments that say nothing but "thanks for the chapter". `fold` dims them
     *  to one line; `hide` removes them from the page. */
    'comments.thanks': { type: 'enum', default: 'keep', values: ['keep', 'fold', 'hide'] },
    /** Extra patterns to fold or hide, one per line, matched case-insensitively.
     *  A line that is not valid regex syntax is matched as a literal phrase. */
    'comments.foldPatterns': { type: 'string', default: '', maxLength: 2000 },
    /** What matching those patterns does. Its own setting rather than sharing
     *  the acknowledgement rule's action: that defaults to "leave alone", and a
     *  pattern box that does nothing until an unrelated dropdown is also changed
     *  reads as broken. */
    'comments.patternAction': { type: 'enum', default: 'fold', values: ['keep', 'fold', 'hide'] },
    /** Comments whose whole body is a Royal Road emoticon and nothing else. Its
     *  own setting because the two do not travel together: plenty of readers who
     *  want "tyfc" gone keep the emoticons, which carry a reaction words did
     *  not. It cannot share the machinery either - these have no text at all,
     *  and every text rule sees an empty string. */
    'comments.emotes': { type: 'enum', default: 'keep', values: ['keep', 'fold', 'hide'] },
    /** Whether the rules above may reach the author's own comments. Off by
     *  default: on a chapter page the author is the one person whose short reply
     *  is worth reading, and "Thanks!" from them means something different.
     *  Hiding never reaches them whatever this is set to; see `actionForComment`. */
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
    /** "Since you last looked: +312 followers". Records the numbers on the page
     *  as you open it, so the second visit has something to compare against.
     *  Off by default, and nothing is recorded while it is off - it is the only
     *  setting here that starts keeping a record of what you looked at. */
    'fiction.statDeltas': { type: 'bool', default: false },
    'fiction.tagsExpandAll': { type: 'bool', default: false },
  };

  /** v1 shipped these six as bare keys. Reading them keeps existing installs'
   *  settings intact through the upgrade; nothing writes them any more. */
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

      /** Like a string, but a bare hex value gets its `#` put back. "7FFFD4" is
       *  what people copy out of a colour picker and is not valid CSS, so
       *  without this the field silently does nothing. Unambiguous: no CSS
       *  colour keyword is spelled with only the letters a to f. Anything that
       *  is not bare hex passes through untouched, so "red", "rgb(1 2 3)" and ""
       *  all still work. */
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

  /** Coerce anything into a complete, valid settings object. Unknown keys are
   *  dropped; v1's bare keys are read once and folded into their v2 names. */
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
