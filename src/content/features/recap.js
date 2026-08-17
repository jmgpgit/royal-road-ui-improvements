'use strict';

/**
 * The end of the previous chapter, at the top of this one.
 *
 * Reading several fictions at once, the hard thing to recover is not the plot but
 * how the last chapter actually ended. Royal Road offers nothing for that.
 *
 * The previous chapter is fetched once and cached in `sessionStorage`, so moving
 * forward costs one request per chapter and going back costs none. The cache dies
 * with the tab session. Nothing is fetched while the feature is off.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  const BLOCK_ID = 'rrx-recap';
  const CACHE_PREFIX = 'rrx:recap:';

  /** Paragraphs that are only a scene break. Chapters very often end on a line of
   *  asterisks or dashes, and counting those spends the reader's paragraphs on
   *  punctuation. */
  const SEPARATOR_ONLY = /^[\s*\-_~=.·•—–]+$/;

  // The cache key. Shared with the rest of the extension: several features now
  // need the chapter id, so one regex answers for all of them.
  const chapterKey = (url) => RRX.chapterIdFromHref(String(url));

  function cacheGet(key) {
    try {
      return root.sessionStorage.getItem(CACHE_PREFIX + key);
    } catch {
      return null; // storage can be blocked; the feature just costs a fetch
    }
  }

  /** How many chapters to keep. Each is a chapter's whole text, ~12 KB, and the
   *  ~5 MB sessionStorage budget is shared with royalroad.com itself. */
  const CACHE_MAX = 40;

  /** Keep the cache under its ceiling, oldest first. Without this it only grew,
   *  and the failure was invisible: once the quota was gone every `setItem` threw,
   *  the catch below swallowed it, and every chapter refetched thereafter. */
  function evict(max = CACHE_MAX) {
    const keys = [];
    for (let i = 0; i < root.sessionStorage.length; i += 1) {
      const key = root.sessionStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    if (keys.length <= max) return;
    // Insertion order is oldest-first here because an entry is never rewritten.
    for (const key of keys.slice(0, keys.length - max)) {
      root.sessionStorage.removeItem(key);
    }
  }

  function cacheSet(key, html) {
    try {
      // Room for this entry, not just down to the ceiling: trimming to the cap
      // and then adding one leaves it exceeded by one, for ever.
      evict(CACHE_MAX - 1);
      root.sessionStorage.setItem(CACHE_PREFIX + key, html);
    } catch {
      // Out of room even after evicting, or storage is blocked. Drop what we
      // hold rather than keeping a cache that can never accept another entry.
      try {
        evict(0);
      } catch {
        /* the recap just costs a fetch each time */
      }
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

    // Rebuilt as text, not adopted as markup: a recap wants the author's words,
    // not their images, scripts, or end-of-chapter shoutout blocks.
    return kept.map((p) => p.textContent.trim()).filter(Boolean).join('\n\n');
  }

  /** @returns {string|null} the previous chapter's URL, if there is one */
  const previousUrl = () => {
    const link = document.querySelector(SEL.chapterPrev);
    return link ? link.getAttribute('href') : null;
  };

  /** The fiction's own title, off the one link on a chapter page that points at
   *  the fiction root and nothing deeper. */
  function fictionTitleIn(doc) {
    for (const link of doc.querySelectorAll('a[href*="/fiction/"]')) {
      const href = link.getAttribute('href') || '';
      if (!/^(?:https?:\/\/[^/]+)?\/fiction\/\d+\/[^/?#]+\/?$/.test(href)) continue;
      const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }

  /**
   * A chapter's own title, taken off the page's `<title>`.
   *
   * A chapter page has no `h1` at all, and the heading that does carry the title
   * is an `h3` known only by Tailwind classes. `<title>` is
   * "<chapter> - <fiction>" on both captures, so the fiction title read off the
   * page removes the half we do not want by exact match rather than by splitting
   * on " - ", which appears inside both halves in real titles.
   *
   * @returns {string} '' when it cannot be worked out, which shows the label alone
   */
  function titleOf(doc) {
    const full = (doc.title || '').replace(/\s+/g, ' ').trim();
    const fiction = fictionTitleIn(doc);
    if (!full || !fiction) return '';
    const suffix = ` - ${fiction}`;
    return full.endsWith(suffix) ? full.slice(0, -suffix.length).trim() : '';
  }

  /**
   * The cache holds `{t, x}` now rather than the tail alone. A tab open across
   * an update still holds the old plain strings, so anything that does not parse
   * is read as the text it used to be: the recap keeps working and simply has no
   * name to show until that entry is refetched.
   */
  function unpack(raw) {
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && typeof data.x === 'string') {
        return { title: typeof data.t === 'string' ? data.t : '', text: data.x };
      }
    } catch {
      /* written before this shape existed */
    }
    return { title: '', text: raw };
  }

  async function fetchTail(url, wanted) {
    const key = chapterKey(url);
    if (!key) return { title: '', text: '' };

    const cached = cacheGet(key);
    if (cached !== null) return unpack(cached);

    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Royal Road returned ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

    // Cached whole, so changing the paragraph count does not refetch.
    const full = { title: titleOf(doc), text: tailOf(doc, 999) };
    cacheSet(key, JSON.stringify({ t: full.title, x: full.text }));
    return full;
  }

  const trim = (text, wanted) => text.split('\n\n').slice(-wanted).join('\n\n');

  /** "Previously", and the chapter it is previously *of* when that is known.
   *  The name is a child rather than part of the label's own text, because the
   *  label is uppercased and letter-spaced and a title set in that is shouting. */
  const label = (tag, title) =>
    ui.el(
      tag,
      { class: 'rrx-recap__label', text: 'Previously' },
      title ? [ui.el('span', { class: 'rrx-recap__chapter', text: title })] : []
    );

  /** Build the block. `mode` decides whether it starts open and what opens it. */
  function render(text, mode, href, title) {
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
        label('p', title),
        body,
      ]);
    }

    // `<details>` for click: a real disclosure control, keyboard reachable and
    // findable by the browser's own find-in-page.
    const summary = label('summary', title);
    const block = ui.el(
      'details',
      { id: BLOCK_ID, class: `rrx-ui rrx-recap rrx-recap--${mode}` },
      [summary, body]
    );
    if (mode === 'hover') openOnHover(block, summary);
    return block;
  }

  /**
   * Open on hover in JavaScript, because CSS cannot. A closed `<details>` hides
   * its contents through `::details-content`, which a rule on a descendant cannot
   * reach - `display: block` on a closed one's body changes nothing, so a CSS-only
   * hover mode silently behaves as click mode. Only the attribute opens it.
   *
   * A click pins it open: shutting itself mid-sentence is worse than closing it
   * by hand.
   */
  function openOnHover(block, summary) {
    // The reader asked for it to stay, as opposed to the pointer being over it.
    let pinned = false;

    // The browser's own toggle is taken over: by the time anyone can click,
    // hovering has already opened the block, so the default action would close
    // the thing the reader was reaching for.
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
    // Tabbing to it counts as reaching for it.
    block.addEventListener('focusin', reveal);
    block.addEventListener('focusout', () => {
      if (!block.contains(document.activeElement)) conceal();
    });
  }

  // The recap sits in the shared rail above the chapter, below the meta bar.
  // `chapterTop` owns the order, because this block arrives after a fetch and so
  // cannot rely on being inserted in the order it should be read in.
  const anchor = () => RRX.chapterTop && RRX.chapterTop.content();

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
    // The first chapter has nothing before it: not a failure, so say nothing.
    if (!url) {
      if (existing) existing.remove();
      return;
    }

    const where = anchor();
    if (!where) return;

    // Already showing exactly this. Runs on every sweep, and rebuilding would
    // collapse an opened recap under the reader.
    if (existing && state.url === url && state.mode === mode && state.wanted === wanted) return;
    if (state.busy) return;

    state.busy = true;
    try {
      const full = await fetchTail(url, wanted);
      if (!full.text) return;
      const block = render(trim(full.text, wanted), mode, url, full.title);
      if (!RRX.chapterTop.place(block, RRX.chapterTop.SLOTS.recap)) return;
      state = { url, mode, wanted, busy: false };
    } catch {
      // A recap is a convenience; the reader still has the chapter they came for.
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

  RRX.recap = {
    tailOf,
    titleOf,
    fictionTitleIn,
    trim,
    previousUrl,
    apply,
    cacheSet,
    CACHE_MAX,
    SEPARATOR_ONLY,
  };
})(globalThis);
