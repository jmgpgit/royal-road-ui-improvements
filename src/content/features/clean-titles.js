'use strict';

/**
 * Strip the genre-tag suffixes authors append to fiction titles, on the list
 * pages only.
 *
 *   Some Title - [Post-Apocalyptic Dungeon Core]   ->  Some Title
 *   Another Title (Book One Complete)              ->  Another Title
 *   A Third Title (OP MC/ Magic Academy/ LitRPG)   ->  A Third Title
 *
 * Only in lists: on a fiction's own page the full title is the heading of the
 * thing you deliberately opened, and shortening it there would be presumptuous.
 *
 * Never destructive: the original is kept on the element and restored the
 * moment the setting goes off, and the link's tooltip always shows it.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL } = RRX;

  const ORIGINAL = 'rrxFullTitle';
  /** The trimmed form, cached beside the original so it is computed once. */
  const TRIMMED = 'rrxShortTitle';

  /**
   * The separator characters an author puts before a bracketed tag list.
   *
   * Written as an escaped string rather than inline in each pattern: the dash
   * forms have to stay adjacent and escaped, or the character class turns into
   * a range and the regex will not compile.
   */
  const SEP = '\\-\\u2013\\u2014:|';

  /**
   * Bracketed runs, including the separator that led into them.
   *
   * Square, round and curly, plus the full-width forms some titles use. Curly
   * braces earn their place: "{Arc 6 Complete}" is a common way to flag
   * progress, and it turns up alongside the other kinds in one title.
   *
   * The inner class excludes every bracket character so a run stops at its own
   * closing bracket rather than running on to a later one.
   */
  const OPEN = '[({\\[\\uff08\\u3010]';
  const CLOSE = '[)}\\]\\uff09\\u3011]';
  const NOT_BRACKET = '[^(){}\\[\\]\\uff08\\uff09\\u3010\\u3011]';
  const BRACKETED = new RegExp(`\\s*[${SEP}]?\\s*${OPEN}${NOT_BRACKET}*${CLOSE}`, 'g');
  /** A separator left dangling once the brackets are gone. */
  const TRAILING_SEPARATOR = new RegExp(`[\\s${SEP},./]+$`);
  const LEADING_SEPARATOR = new RegExp(`^[\\s${SEP},./]+`);

  /**
   * @param {string} title
   * @returns {string} the title without its bracketed suffixes
   */
  function cleanTitle(title) {
    if (typeof title !== 'string') return '';
    let out = title;
    // Repeat, so "Title [A] (B)" and nested-looking runs both come out.
    for (let i = 0; i < 4; i += 1) {
      const next = out.replace(BRACKETED, ' ');
      if (next === out) break;
      out = next;
    }
    out = out.replace(TRAILING_SEPARATOR, '').replace(LEADING_SEPARATOR, '').replace(/\s+/g, ' ').trim();

    // Fall back to the original whenever trimming would leave nothing worth
    // showing. Some titles really are bracketed end to end ("[Placeholder]"),
    // and some leave only punctuation or a stray letter behind. A card with no
    // name on it is worse than a card with an untidy one, so anything short of
    // a readable remainder means the trim is abandoned rather than shipped.
    const readable = out.replace(/[^\p{L}\p{N}]/gu, '');
    return readable.length >= 2 ? out : title.trim();
  }

  /**
   * @param {ParentNode} scope
   * @param {boolean} on
   *
   * Runs on every sweep, so every write here is guarded by a read. The trimmed
   * form is computed once per heading and kept beside the original: recomputing
   * it meant four passes of a bracket regex per heading per sweep, for an answer
   * that cannot change while the title does not.
   */
  function apply(scope, on) {
    for (const card of scope.querySelectorAll(SEL.listCard)) {
      for (const heading of card.querySelectorAll(SEL.cardTitle)) {
        if (heading.dataset[ORIGINAL] === undefined) {
          const full = heading.textContent.trim();
          const short = cleanTitle(full);
          if (short === full) {
            heading.dataset[ORIGINAL] = ''; // nothing to do, and nothing to undo
            continue;
          }
          heading.dataset[ORIGINAL] = full;
          heading.dataset[TRIMMED] = short;
        }
        const full = heading.dataset[ORIGINAL];
        if (!full) continue;

        const wanted = on ? heading.dataset[TRIMMED] : full;
        if (heading.textContent !== wanted) heading.textContent = wanted;

        // The full title stays one hover away. Compared before writing: an
        // unconditional assignment is a DOM write on every sweep, for every
        // card, forever.
        if (on) {
          if (heading.title !== full) heading.title = full;
        } else if (heading.hasAttribute('title')) {
          heading.removeAttribute('title');
        }
      }
    }
  }

  features.list.push({
    id: 'cleanTitles',
    /*
     * Lists only, and never the fiction page's own heading.
     *
     * Not '/home' either: this walks `SEL.listCard`, which is
     * `.fiction-card-expanded`, and /home has none of those. It builds its
     * strips from three other card shapes entirely.
     */
    pages: ['list'],
    syncCards: (scope, ctx) => apply(scope, !!ctx.settings['list.cleanTitles']),
  });

  RRX.cleanTitles = { cleanTitle, apply };
})(globalThis);
