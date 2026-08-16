'use strict';

/**
 * What sits between Royal Road's furniture and the chapter text, and in what
 * order.
 *
 * Two features now want a block up there, and one of them - the recap - arrives
 * after a fetch, so insertion order is whatever the network decided that day.
 * Left alone, that puts the reading order, the tab order and the screen-reader
 * order at the mercy of a cache hit. Each block therefore asks for a slot, and
 * this module keeps them in slot order.
 *
 * Deliberately NO wrapper element. An earlier version put them in one, which
 * broke the layout: the parent of `.chapter-content` is
 * `div.chapter.flex.flex-col.items-center`, so a wrapper with no width of its
 * own shrink-wraps its contents and is then re-centred - and the recap changes
 * width when it opens, which slid every other block sideways with it. As
 * separate children each block is sized and centred on its own, exactly as the
 * recap was before any of this existed.
 *
 * The blocks are siblings of `.chapter-content`, which is also where Royal Road
 * puts the author notes and its own cards, so they inherit that column's
 * spacing (`gap-4`) for free.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const { SEL } = RRX;

  /**
   * Lower sorts higher up the page. Gaps left between them so a later block can
   * land in the middle without renumbering anything.
   */
  const SLOTS = { resume: 5, meta: 10, recap: 20 };

  /** Marks a block as ours *and* records where it belongs. */
  const SLOT_ATTR = 'data-rrx-slot';

  /**
   * The chapter this page is *about*.
   *
   * Not simply the first `.chapter-content`: continuous reading can prepend
   * earlier chapters above this one, and each carries its own. Anything nested
   * inside an appended chapter is skipped. This rule used to live in recap.js;
   * it is here so that two callers cannot come to different answers.
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
   * Put `node` above the chapter at `slot`, replacing whatever holds that slot
   * already.
   *
   * Replacing rather than removing and re-adding: two mutation records where
   * one will do, and the sweep those records feed is debounced, not free.
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

    // Before the first block that belongs below this one, and before the
    // chapter itself when there is none.
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
