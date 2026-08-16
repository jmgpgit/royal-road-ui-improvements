'use strict';

/**
 * The end of the previous chapter, at the top of this one.
 *
 * Reading several fictions at once, the hardest thing to recover is not the plot
 * but the last few paragraphs: how the chapter you are continuing from actually
 * ended. Royal Road offers nothing for that, and the alternative is opening the
 * previous chapter in another tab and scrolling to the bottom.
 *
 * The previous chapter is fetched once and cached in `sessionStorage`, so moving
 * forward through a fiction costs one request per chapter, and going back over
 * chapters you have already seen costs none. The cache is per tab session and
 * dies with it, which is the right lifetime for something this cheap to rebuild.
 *
 * Nothing is fetched at all while the feature is off.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  const BLOCK_ID = 'rrx-recap';
  const CACHE_PREFIX = 'rrx:recap:';

  /**
   * Paragraphs that are only a scene break.
   *
   * Chapters very often end on a line of asterisks or dashes. Counting those
   * towards the recap spends the reader's paragraphs on punctuation, so they are
   * skipped from the end before anything is taken.
   */
  const SEPARATOR_ONLY = /^[\s*\-_~=.·•—–]+$/;

  const chapterKey = (url) => {
    const match = String(url).match(/\/chapter\/(\d+)/);
    return match ? match[1] : null;
  };

  function cacheGet(key) {
    try {
      return root.sessionStorage.getItem(CACHE_PREFIX + key);
    } catch {
      return null; // storage can be blocked; the feature just costs a fetch
    }
  }

  function cacheSet(key, html) {
    try {
      root.sessionStorage.setItem(CACHE_PREFIX + key, html);
    } catch {
      /* quota or blocked storage: not worth reporting for a cache */
    }
  }

  /**
   * The closing paragraphs of a chapter document.
   *
   * @param {Document} doc a parsed chapter page
   * @param {number} wanted how many paragraphs of prose to keep
   * @returns {string} HTML, or '' when the chapter cannot be read
   */
  function tailOf(doc, wanted) {
    const content = doc.querySelector(SEL.chapterContent);
    if (!content) return '';

    const paragraphs = [...content.querySelectorAll('p')];
    // Trailing separators first, then anything empty, so `wanted` buys prose.
    let end = paragraphs.length;
    while (end > 0) {
      const text = paragraphs[end - 1].textContent.trim();
      if (text && !SEPARATOR_ONLY.test(text)) break;
      end -= 1;
    }
    const kept = paragraphs.slice(Math.max(0, end - wanted), end);
    if (!kept.length) return '';

    // Rebuilt as text rather than adopted as markup: a recap needs the author's
    // words, not their images, scripts or the shoutout blocks that sometimes sit
    // at the end of a chapter.
    return kept.map((p) => p.textContent.trim()).filter(Boolean).join('\n\n');
  }

  /** @returns {string|null} the previous chapter's URL, if there is one */
  const previousUrl = () => {
    const link = document.querySelector(SEL.chapterPrev);
    return link ? link.getAttribute('href') : null;
  };

  async function fetchTail(url, wanted) {
    const key = chapterKey(url);
    if (!key) return '';

    const cached = cacheGet(key);
    if (cached !== null) return cached;

    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Royal Road returned ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

    // Cached whole rather than trimmed, so changing the paragraph count does not
    // mean fetching the chapter again.
    const full = tailOf(doc, 999);
    cacheSet(key, full);
    return full;
  }

  const trim = (text, wanted) => text.split('\n\n').slice(-wanted).join('\n\n');

  /** Build the block. `mode` decides whether it starts open and what opens it. */
  function render(text, mode, href) {
    const paragraphs = text.split('\n\n').map((line) => ui.el('p', { text: line }));
    const body = ui.el('div', { class: 'rrx-recap__body' }, [
      ...paragraphs,
      ui.el('a', {
        class: 'rrx-recap__link',
        href,
        text: 'Read the whole previous chapter',
      }),
    ]);

    if (mode === 'always') {
      return ui.el('aside', { id: BLOCK_ID, class: 'rrx-ui rrx-recap rrx-recap--open' }, [
        ui.el('p', { class: 'rrx-recap__label', text: 'Previously' }),
        body,
      ]);
    }

    // `<details>` for click, so it is a real disclosure control: keyboard
    // reachable, findable by the browser's own find-in-page, and it remembers
    // nothing we have to manage.
    const summary = ui.el('summary', { class: 'rrx-recap__label', text: 'Previously' });
    const block = ui.el(
      'details',
      { id: BLOCK_ID, class: `rrx-ui rrx-recap rrx-recap--${mode}` },
      [summary, body]
    );
    if (mode === 'hover') openOnHover(block, summary);
    return block;
  }

  /**
   * Open on hover, in JavaScript, because CSS cannot do it.
   *
   * A closed `<details>` hides its contents through `::details-content`, which a
   * rule on a descendant cannot reach: `display: block` on the body of a closed
   * one changes nothing, so a CSS-only hover mode silently behaves as click mode
   * and the setting quietly lies about what it does. Toggling the attribute is
   * the only thing that actually opens it.
   *
   * Clicking still works and wins: a recap opened deliberately stays open when
   * the pointer leaves, because having it shut itself mid-sentence is worse than
   * having to close it by hand.
   */
  function openOnHover(block, summary) {
    // Whether the reader asked for it to stay, as opposed to it being open only
    // because the pointer happens to be over it.
    let pinned = false;

    // The browser's own toggle is taken over rather than worked around. By the
    // time anyone can click, hovering has already opened the block, so letting
    // the default action run would make a click CLOSE the thing the reader was
    // reaching for. Clicking pins it instead, and clicking again lets it go.
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      pinned = !pinned;
      block.open = pinned;
    });

    const reveal = () => {
      if (!pinned) block.open = true;
    };
    const conceal = () => {
      if (!pinned) block.open = false;
    };

    block.addEventListener('mouseenter', reveal);
    block.addEventListener('mouseleave', conceal);
    // Tabbing to it counts as reaching for it, so a keyboard gets there too.
    block.addEventListener('focusin', reveal);
    block.addEventListener('focusout', () => {
      if (!block.contains(document.activeElement)) conceal();
    });
  }

  function anchor() {
    // Not simply the first `.chapter-content`: continuous reading can prepend
    // earlier chapters above this one, and each carries its own. The recap
    // belongs to the chapter that was opened, so anything nested inside an
    // appended chapter is skipped.
    const content = [...document.querySelectorAll(SEL.chapterContent)].find(
      (el) => !el.closest('.rrx-chapter')
    );
    return content && content.parentElement ? content : null;
  }

  let state = { url: null, mode: null, wanted: null, busy: false };

  async function apply(ctx) {
    const mode = ctx.settings['recap.mode'];
    const wanted = ctx.settings['recap.paragraphs'];
    const existing = document.getElementById(BLOCK_ID);

    if (mode === 'off') {
      if (existing) existing.remove();
      state = { url: null, mode: null, wanted: null, busy: false };
      return;
    }

    const url = previousUrl();
    // The first chapter of a fiction has nothing before it, which is not a
    // failure and should say nothing at all.
    if (!url) {
      if (existing) existing.remove();
      return;
    }

    const where = anchor();
    if (!where) return;

    // Already showing exactly this: leave it alone. This runs on every sweep,
    // and rebuilding would collapse an opened recap under the reader.
    if (existing && state.url === url && state.mode === mode && state.wanted === wanted) return;
    if (state.busy) return;

    state.busy = true;
    try {
      const full = await fetchTail(url, wanted);
      if (!full) return;
      const block = render(trim(full, wanted), mode, url);
      const current = document.getElementById(BLOCK_ID);
      if (current) current.replaceWith(block);
      else where.parentElement.insertBefore(block, where);
      state = { url, mode, wanted, busy: false };
    } catch {
      // A recap is a convenience. If Royal Road will not serve the previous
      // chapter, the reader still has the one they came for.
      if (existing) existing.remove();
    } finally {
      state.busy = false;
    }
  }

  features.list.push({
    id: 'recap',
    pages: ['chapter'],
    onPage: (ctx) => {
      apply(ctx);
    },
  });

  RRX.recap = { tailOf, trim, previousUrl, apply, SEPARATOR_ONLY };
})(globalThis);
