'use strict';

/**
 * The facts about a chapter, above it rather than under it. Royal Road prints
 * the posted date at the bottom, past the author notes and the About-author
 * panel - the one place a reader cannot see it before deciding to read. It
 * knows the length too and prints that nowhere. Nothing leaves Royal Road:
 * its own markup, plus its own chapter-list endpoint.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  const BLOCK_ID = 'rrx-chapter-meta';

  /** Above this, minutes stop being a useful unit on their own. */
  const HOUR_AT_MINUTES = 90;

  /**
   * Royal Road's own chapter list. `#chapterSelect` on the chapter page is
   * empty markup it fills from this endpoint on focus; ~3 KB for a hundred
   * chapters against 47 KB for the fiction page, which would still need
   * parsing out of a table. Cached per fiction for the tab: it only changes
   * when the author posts, and a stale one announces itself (`looksStale`).
   */
  const LIST_URL = (fictionId) => `/fictions/chapterlist?id=${fictionId}`;
  const LIST_CACHE = 'rrx:chapters:';

  /**
   * Every timestamp Royal Road prints for *this chapter*, oldest first. Scoped
   * to `chapterCard`, the only thing separating a chapter's own stamp from the
   * author's join date and one stamp per comment - see selectors.js. Mirrors
   * whatever is there: today there is one labelled "Created At", but an edited
   * chapter may carry a second and hard-coding "posted" would drop it.
   * @returns {{unix: number, title: string, label: string}[]}
   */
  function stamps(scope) {
    const card = (scope || document).querySelector(SEL.chapterCard);
    if (!card) return [];

    return [...card.querySelectorAll(SEL.chapterTime)]
      .filter((time) => !time.closest(SEL.authorPanel))
      // Never re-read our own copies: this runs inside `.chapter`, where a
      // future rail block might carry a <time>.
      .filter((time) => !time.closest('.' + RRX.UI_CLASS))
      .map((time) => {
        const wrap = time.closest('[data-rr-tooltip]');
        const label = wrap && wrap.querySelector(SEL.chapterTimeLabel);
        return {
          unix: Number(time.getAttribute('unixtime')),
          title: time.getAttribute('title') || '',
          label: label ? label.textContent.trim() : '',
        };
      })
      .filter((stamp) => Number.isFinite(stamp.unix) && stamp.unix > 0)
      .sort((a, b) => a.unix - b.unix);
  }

  /** A name for a stamp Royal Road did not label. Positional, and vague where
   *  it guesses: the oldest stamp is when the chapter went up, a later one can
   *  only be a change to it. */
  const nameFor = (stamp, index) => stamp.label || (index === 0 ? 'Posted' : 'Updated');

  let wordCache = { length: -1, words: 0 };

  /**
   * Words in the chapter itself, cached on text length: this runs on every
   * sweep and every settings change. `.chapter-content` is the right boundary
   * - author notes are siblings of it, and the ad placeholders inside are
   * empty divs whose iframes hold no text. Two impurities left alone: the
   * chapter's own title heading, and a hidden anti-scraping sentence Royal
   * Road sometimes injects. A heuristic for either could eat real prose.
   */
  function wordCount() {
    const content = RRX.chapterTop && RRX.chapterTop.content();
    if (!content) return 0;

    const text = content.textContent || '';
    if (text.length === wordCache.length) return wordCache.words;

    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    wordCache = { length: text.length, words };
    return words;
  }

  /** @returns {string} e.g. "~9 min" or "~1 h 12 min" */
  function readingTime(words, wpm) {
    const minutes = Math.max(1, Math.round(words / (wpm || 250)));
    if (minutes < HOUR_AT_MINUTES) return `~${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `~${hours} h ${rest} min` : `~${hours} h`;
  }

  /** The reader's own locale, not Royal Road's. `dateStyle: 'medium'` fits a
   *  chip and is unambiguous about the month, which "8/4/2026" is not. */
  function formatDate(unix) {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(unix * 1000));
    } catch {
      return new Date(unix * 1000).toDateString();
    }
  }

  // --- where this chapter sits in its fiction --------------------------------

  function cacheGet(key) {
    try {
      const raw = root.sessionStorage.getItem(LIST_CACHE + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // blocked or corrupt storage just costs a request
    }
  }

  function cacheSet(key, ids) {
    try {
      root.sessionStorage.setItem(LIST_CACHE + key, JSON.stringify(ids));
    } catch {
      /* quota or blocked storage: not worth reporting for a cache */
    }
  }

  /**
   * Every chapter id of a fiction, in reading order. Ids only: the titles and
   * slugs Royal Road also sends would treble the cache for nothing we ask.
   * @returns {Promise<number[]>} empty when the list cannot be had
   */
  async function chapterIds(fictionId, { refresh = false } = {}) {
    if (!refresh) {
      const cached = cacheGet(fictionId);
      if (cached) return cached;
    }

    const response = await fetch(LIST_URL(fictionId), { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Royal Road returned ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) return [];

    // Sorted by `order`, not trusted to arrive sorted, as Royal Road's own dropdown does.
    const ids = list
      .filter((entry) => entry && Number.isFinite(entry.order) && Number.isFinite(entry.id))
      .sort((a, b) => a.order - b.order)
      .map((entry) => Number(entry.id));

    if (ids.length) cacheSet(fictionId, ids);
    return ids;
  }

  /** @returns {{number: number, total: number, after: number}|null} null when
   *   this chapter is not in the list we hold, which means the list is old */
  function positionIn(ids, chapterId) {
    const index = ids.indexOf(chapterId);
    if (index < 0) return null;
    return { number: index + 1, total: ids.length, after: ids.length - 1 - index };
  }

  /** Royal Road drops the next-chapter link on the latest chapter, so a list
   *  claiming this is the last one while the page offers a next is stale. */
  const looksStale = (place) => !!place && place.after === 0 && !!document.querySelector(SEL.chapterNext);

  /** Cached across the sweep: `onPage` re-runs on every settings change. */
  let progress = { fictionId: null, chapterId: null, place: null, busy: false, refreshed: false };

  /** One item, not two: "how far in am I" and "how much is left" are the same
   *  answer read twice, and a separator each makes the bar read as unrelated
   *  numbers. On the latest chapter the parenthetical drops; "Chapter 95 of 95"
   *  has already said it.
   *  @returns {{text: string, title: string}[]} the position, as one fact */
  function progressItems() {
    const place = progress.place;
    if (!place) return [];

    const left =
      place.after > 0 ? ` (${place.after} to catch up)` : '';
    return [
      {
        text: `Chapter ${place.number} of ${place.total}${left}`,
        title: 'Counted from Royal Road’s own chapter list for this fiction',
      },
    ];
  }

  /** Fire and forget: it re-renders itself when the list lands, as the recap does. */
  async function loadProgress(ctx) {
    if (!ctx.settings['chapter.catchUp']) {
      progress = { fictionId: null, chapterId: null, place: null, busy: false, refreshed: false };
      return;
    }

    const fictionId = RRX.fictionIdFromHref(location.pathname);
    const chapterId = RRX.chapterIdFromHref(location.pathname);
    if (!fictionId || !chapterId) return;

    const known = progress.fictionId === fictionId && progress.chapterId === chapterId;
    if ((known && progress.place) || progress.busy) return;

    progress.busy = true;
    try {
      const ids = await chapterIds(fictionId);
      let place = positionIn(ids, chapterId);

      // One retry, past the cache, when the list cannot explain this page: a
      // chapter published since we cached, or a fiction restructured under us.
      if ((!place || looksStale(place)) && !progress.refreshed) {
        progress.refreshed = true;
        place = positionIn(await chapterIds(fictionId, { refresh: true }), chapterId);
      }

      progress = { fictionId, chapterId, place, busy: false, refreshed: progress.refreshed };
      if (place) apply(ctx);
    } catch (err) {
      // A convenience. If Royal Road will not answer, the chapter is still there.
      RRX.warn('could not read the chapter list', err);
      progress.busy = false;
    } finally {
      progress.busy = false;
    }
  }

  /** Data, not DOM: the signature guarding the rebuild is computed from the
   *  same values the reader sees, and this stays testable without a layout.
   *  @returns {{text: string, title: string}[]} */
  function itemsFor(ctx, scope) {
    const settings = ctx.settings;
    const items = [];

    if (settings['chapter.topTimestamp']) {
      stamps(scope).forEach((stamp, index) => {
        items.push({
          text: `${nameFor(stamp, index)} ${formatDate(stamp.unix)}`,
          // Royal Road's own full-precision string, from its bottom-of-page tooltip.
          title: stamp.title,
        });
      });
    }

    if (settings['chapter.catchUp']) items.push(...progressItems());

    const mode = settings['chapter.wordCount'];
    if (mode && mode !== 'off') {
      const words = wordCount();
      if (words > 0) {
        if (mode === 'words' || mode === 'both') {
          items.push({ text: `${words.toLocaleString()} words`, title: '' });
        }
        if (mode === 'time' || mode === 'both') {
          const wpm = settings['chapter.wpm'];
          items.push({
            text: readingTime(words, wpm),
            title: `At ${wpm} words a minute`,
          });
        }
      }
    }

    return items;
  }

  function render(items, signature) {
    return ui.el(
      'div',
      { id: BLOCK_ID, class: 'rrx-ui rrx-chapter-meta', 'data-rrx-sig': signature },
      items.map((item) =>
        ui.el('span', {
          class: 'rrx-chapter-meta__item',
          text: item.text,
          title: item.title || null,
        })
      )
    );
  }

  function apply(ctx) {
    const items = itemsFor(ctx);
    const existing = document.getElementById(BLOCK_ID);

    if (!items.length) {
      if (existing) RRX.chapterTop.clear(RRX.chapterTop.SLOTS.meta);
      return;
    }

    // `onPage` re-runs on every settings change, so without this the bar is
    // rewritten for changes that cannot affect it. The rendered data covers
    // every text node and attribute at once; a textContent check would not.
    const signature = JSON.stringify(items);
    if (existing && existing.dataset.rrxSig === signature && existing.isConnected) return;

    RRX.chapterTop.place(render(items, signature), RRX.chapterTop.SLOTS.meta);
  }

  features.list.push({
    id: 'chapterMeta',
    pages: ['chapter'],
    onPage: (ctx) => {
      apply(ctx);
      loadProgress(ctx);
    },
  });

  RRX.chapterMeta = {
    stamps,
    nameFor,
    wordCount,
    readingTime,
    formatDate,
    itemsFor,
    chapterIds,
    positionIn,
    loadProgress,
    apply,
    BLOCK_ID,
  };
})(globalThis);
