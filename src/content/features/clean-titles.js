'use strict';

/**
 * Strip the genre-tag suffixes authors append to fiction titles, on list pages
 * only - on a fiction's own page the full title is the heading of the thing you
 * deliberately opened.
 *
 *   Some Title - [Post-Apocalyptic Dungeon Core]   ->  Some Title
 *   Another Title (Book One Complete)              ->  Another Title
 *   A Third Title (OP MC/ Magic Academy/ LitRPG)   ->  A Third Title
 *
 * The original stays on the element, restored when the setting goes off and
 * shown in the link's tooltip.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL } = RRX;

  const ORIGINAL = 'rrxFullTitle';
  /** The trimmed form, cached beside the original so it is computed once. */
  const TRIMMED = 'rrxShortTitle';

  /** Separators before a bracketed tag list. The dash forms must stay adjacent
   *  and escaped, or the character class turns into a range and the regex will
   *  not compile. */
  const SEP = '\\-\\u2013\\u2014:|';

  /** Bracketed runs, with the separator that led into them: square, round and
   *  curly, plus the full-width forms. Curly braces earn their place -
   *  "{Arc 6 Complete}" is a common progress flag. NOT_BRACKET excludes every
   *  bracket character, so a run stops at its own closing bracket rather than a
   *  later one. */
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

    // Fall back to the original when trimming leaves nothing worth showing.
    // Some titles are bracketed end to end ("[Placeholder]"), others leave only
    // punctuation or a stray letter. A card with no name is worse than an untidy
    // one.
    const readable = out.replace(/[^\p{L}\p{N}]/gu, '');
    return readable.length >= 2 ? out : title.trim();
  }

  /**
   * @param {ParentNode} scope
   * @param {boolean} on
   *
   * Runs on every sweep, so every write is guarded by a read. The trimmed form
   * is cached beside the original: recomputing it cost four bracket-regex passes
   * per heading per sweep, for an answer that cannot change.
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
        // unconditional assignment is a DOM write per card per sweep.
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
    /* Lists only. Not '/home': this walks `SEL.listCard`, which is
     * `.fiction-card-expanded`, and /home has none - it builds its strips from
     * three other card shapes. */
    pages: ['list'],
    syncCards: (scope, ctx) => apply(scope, !!ctx.settings['list.cleanTitles']),
  });

  RRX.cleanTitles = { cleanTitle, apply };
})(globalThis);
