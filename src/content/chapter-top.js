'use strict';

/**
 * What sits between Royal Road's furniture and the chapter text, and in what
 * order. The recap arrives after a fetch, so left alone the reading, tab and
 * screen-reader order would depend on a cache hit; each block asks for a slot.
 *
 * No wrapper element: one broke the layout. The parent of `.chapter-content`
 * is `div.chapter.flex.flex-col.items-center`, so a wrapper with no width of
 * its own shrink-wraps and gets re-centred, and the recap changes width when
 * it opens - which slid every other block sideways. As separate children the
 * blocks size and centre on their own, in the same column as the author notes
 * and Royal Road's own cards, so they inherit its `gap-4`.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const { SEL } = RRX;

  /** Lower sorts higher up the page. Gaps left so a later block can land in
   *  the middle without renumbering. */
  const SLOTS = { resume: 5, meta: 10, recap: 20 };

  /** Marks a block as ours and records where it belongs. */
  const SLOT_ATTR = 'data-rrx-slot';

  /**
   * The chapter this page is *about*. Not the first `.chapter-content`:
   * continuous reading prepends earlier chapters, each carrying its own, so
   * anything inside an appended `.rrx-chapter` is skipped. Moved here from
   * recap.js so two callers cannot come to different answers.
   */
  function content() {
    const el = [...document.querySelectorAll(SEL.chapterContent)].find(
      (node) => !node.closest('.rrx-chapter')
    );
    return el && el.parentElement ? el : null;
  }

  /** Our blocks above the chapter, in document order. */
  const placed = (parent, except) =>
    [...parent.children].filter((el) => el.hasAttribute(SLOT_ATTR) && el !== except);

  /**
   * Put `node` above the chapter at `slot`, replacing whatever holds it - one
   * mutation record instead of two, and the sweep they feed is debounced.
   *
   * @param {Element} node must carry `rrx-ui` itself - main.js tests the node
   *   that was added, not the element it was added to
   * @param {number} slot one of SLOTS
   * @returns {boolean} false when there is no chapter to sit above
   */
  function place(node, slot) {
    const where = content();
    if (!where) return false;

    const parent = where.parentElement;
    node.setAttribute(SLOT_ATTR, String(slot));

    const others = placed(parent, node);
    const same = others.find((el) => el.getAttribute(SLOT_ATTR) === String(slot));
    if (same) {
      same.replaceWith(node);
      return true;
    }

    // Before the first block that belongs below this one, or before the chapter.
    const after = others.find((el) => Number(el.getAttribute(SLOT_ATTR)) > slot);
    parent.insertBefore(node, after || where);
    return true;
  }

  /** Take a slot's block away, if it is there. */
  function clear(slot) {
    const where = content();
    if (!where) return;
    const taken = placed(where.parentElement).find(
      (el) => el.getAttribute(SLOT_ATTR) === String(slot)
    );
    if (taken) taken.remove();
  }

  RRX.chapterTop = { SLOTS, SLOT_ATTR, place, clear, content };
})(globalThis);
