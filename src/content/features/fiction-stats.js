'use strict';

/**
 * What has moved on a fiction since the reader last looked.
 *
 * Royal Road only shows today's totals, so "32,866 followers" answers nothing
 * on its own. Every figure is already on the page: no request, just a reading
 * kept on the device.
 *
 * Read label-first. The tiles carry no id and no `data-rr-` hook, only Tailwind
 * classes, so anything positional mispairs silently when one moves.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, FICTION_STATS, FICTION_SCORES, ui } = RRX;

  const BLOCK_ID = 'rrx-stat-delta';

  /** A bare count, as Royal Road writes it: "27,778,323". */
  const COUNT = /^[\d,]+$/;

  /** How far up from a label to look for its number. One covers the usual tile,
   *  two covers Pages, whose label sits in a div with a help tooltip. Three
   *  would let the Overall Score panel's own `<h3>Ratings</h3>` reach Total
   *  Views. */
  const MAX_CLIMB = 2;

  const isLeaf = (el) => !el.firstElementChild;
  const textOf = (el) => el.textContent.trim();

  /** The element holding a label's number, or null. Climbs to the first
   *  ancestor holding exactly one bare count: two means it has gone too far up
   *  to know which is meant, so it declines rather than guess. */
  function valueElNear(label) {
    let node = label.parentElement;
    for (let climb = 0; node && climb < MAX_CLIMB; climb += 1, node = node.parentElement) {
      const counts = [...node.querySelectorAll('*')].filter((el) => isLeaf(el) && COUNT.test(textOf(el)));
      if (counts.length === 1) return counts[0];
    }
    return null;
  }

  const valueNear = (label) => {
    const el = valueElNear(label);
    return el ? RRX.parseCount(textOf(el)) : null;
  };

  /** Every stat tile we understand, as field -> the element showing its number.
   *  One traversal, used both to read the numbers and to annotate them. */
  function statCells() {
    const scope = document.querySelector(SEL.statsAccordion);
    const cells = new Map();
    if (!scope) return cells;

    for (const el of scope.querySelectorAll('*')) {
      if (!isLeaf(el)) continue;
      const field = FICTION_STATS[textOf(el)];
      // First match wins: the tile comes before the Overall Score panel, which
      // repeats "Ratings" as its own heading.
      if (!field || cells.has(field)) continue;
      const value = valueElNear(el);
      if (value) cells.set(field, value);
    }
    return cells;
  }

  /** Every star rating, as field -> its widget, found through the heading each
   *  sits beside. By position, a reorder would report Style's movement as
   *  Grammar's. */
  function scoreWidgets() {
    const scope = document.querySelector(SEL.statsAccordion);
    const out = new Map();
    if (!scope) return out;

    for (const el of scope.querySelectorAll('*')) {
      if (!isLeaf(el)) continue;
      const field = FICTION_SCORES[textOf(el)];
      if (!field || out.has(field)) continue;
      const parent = el.parentElement;
      const widget = parent && parent.querySelector(SEL.ratingWidget);
      if (widget) out.set(field, widget);
    }
    return out;
  }

  /** "4.83 out of 5" -> 4.83. The widget's own attribute and its stars are both
   *  rounded to 4.8, and +0.02 is invisible at one decimal. */
  function scoreOf(widget) {
    const el = widget && widget.querySelector(SEL.ratingValue);
    const match = el && /(\d+(?:\.\d+)?)/.exec(textOf(el));
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /** The overall score. JSON-LD first, a number rather than text to parse, then
   *  the panel's tooltip, then the one beside the title. */
  function readScore(widgets) {
    for (const script of document.querySelectorAll(SEL.ratingLd)) {
      try {
        const data = JSON.parse(script.textContent);
        const value = Number(data && data.aggregateRating && data.aggregateRating.ratingValue);
        if (Number.isFinite(value) && value > 0) return value;
      } catch {
        /* not our JSON; try the next one */
      }
    }
    const inPanel = scoreOf((widgets || scoreWidgets()).get('s'));
    if (inPanel !== null) return inPanel;

    const hero = document.querySelector(SEL.ratingTooltip);
    const text = hero ? Number(textOf(hero)) : NaN;
    return Number.isFinite(text) && text > 0 ? text : null;
  }

  /** Chapters is not a stat tile: the count lives on the table of contents. */
  function readChapters() {
    const el = document.querySelector(SEL.chaptersCount);
    if (!el) return null;
    const n = Number(el.getAttribute('data-chapters'));
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  /** Everything the page says about itself right now. Missing fields are left
   *  out rather than zeroed - a stat that could not be read must not look like a
   *  fiction that lost all its followers. */
  function readStats() {
    const out = {};
    for (const [field, el] of statCells()) {
      const value = RRX.parseCount(textOf(el));
      if (value !== null) out[field] = value;
    }

    const widgets = scoreWidgets();
    for (const [field, widget] of widgets) {
      const value = field === 's' ? readScore(widgets) : scoreOf(widget);
      if (value !== null) out[field] = value;
    }
    // The one figure with a source outside the panel.
    if (out.s === undefined) {
      const score = readScore(widgets);
      if (score !== null) out.s = score;
    }

    const chapters = readChapters();
    if (chapters !== null) out.c = chapters;

    return Object.keys(out).length ? out : null;
  }

  // --- saying it -------------------------------------------------------------

  const group = (n) => Math.abs(n).toLocaleString('en-US');
  const sign = (n) => (n < 0 ? '−' : '+');

  /** Singular and plural, since "+1 chapters" reads as a bug. */
  const WORDS = {
    v: ['view', 'views'],
    w: ['average view', 'average views'],
    f: ['follower', 'followers'],
    m: ['favourite', 'favourites'],
    r: ['rating', 'ratings'],
    p: ['page', 'pages'],
    c: ['chapter', 'chapters'],
  };

  /** The scores name themselves, and never take a plural. */
  const SCORES = { s: 'score', sty: 'style', sto: 'story', gra: 'grammar', cha: 'character' };

  /** Shown only under their own stars, never on the header: four more items
   *  would turn a line meant to be glanced at into a paragraph. */
  const DETAIL = new Set(['sty', 'sto', 'gra', 'cha']);

  function phrase([field, change]) {
    if (SCORES[field]) return `${sign(change)}${Math.abs(change).toFixed(2)} ${SCORES[field]}`;
    const [one, many] = WORDS[field];
    return `${sign(change)}${group(change)} ${Math.abs(change) === 1 ? one : many}`;
  }

  /** A baseline from earlier today reads as a time: "Since 17 Aug" on the 17th
   *  looks like a bug. */
  function formatSince(unixSeconds) {
    const date = new Date(unixSeconds * 1000);
    const today = date.toDateString() === new Date().toDateString();
    try {
      const options = today ? { timeStyle: 'short' } : { dateStyle: 'medium' };
      return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch {
      return today ? date.toTimeString().slice(0, 5) : date.toDateString();
    }
  }

  /** The compact form written under a number: "(+312)", "(−2)", "(+0.03)". */
  function beside([field, change]) {
    const body = SCORES[field] ? Math.abs(change).toFixed(2) : group(change);
    return `(${sign(change)}${body})`;
  }

  const CELL_ATTR = 'data-rrx-delta';

  const direction = (n) => (n < 0 ? 'down' : n > 0 ? 'up' : 'flat');

  /** One "(+312)", written under the number it belongs to. */
  function cell(change) {
    return ui.el('span', {
      class: `rrx-ui rrx-stat-cell rrx-stat-cell--${direction(change[1])}`,
      [CELL_ATTR]: change[0],
      text: beside(change),
    });
  }

  const placed = () => document.querySelectorAll(`[${CELL_ATTR}]`);

  /** Where each changed field's number is, when it has one on screen. Chapters
   *  never does: its count is on the table of contents. */
  function anchors(changes) {
    const cells = statCells();
    const widgets = scoreWidgets();
    const out = [];
    for (const change of changes) {
      const field = change[0];
      // A score goes under its own stars: Royal Road writes no number for it.
      const anchor = SCORES[field] ? widgets.get(field) : cells.get(field);
      if (anchor) out.push([change, anchor]);
    }
    return out;
  }

  function render(delta) {
    const signature = JSON.stringify(delta);
    // Cheapest check first: this runs on every sweep, and the two walks of the
    // panel below are only needed when something is actually being rebuilt. The
    // cell count is recorded on the node rather than recomputed.
    const existing = document.getElementById(BLOCK_ID);
    if (
      existing &&
      existing.dataset.rrxSig === signature &&
      existing.isConnected &&
      placed().length === Number(existing.dataset.rrxCells)
    ) {
      return;
    }

    const item = document.querySelector(SEL.statsAccordionItem);
    const content = document.querySelector(SEL.statsAccordionContent);
    if (!item || !content || content.parentElement !== item) return;

    const beside = anchors(delta.changes);
    clear();

    // Each number carries its own delta; the header covers what has none, and
    // stays the whole summary while the panel is shut. Which half shows is CSS:
    // opening the panel changes an attribute, which no sweep would see.
    for (const [change, anchor] of beside) {
      anchor.insertAdjacentElement('afterend', cell(change));
    }

    const node = ui.el(
      'div',
      {
        id: BLOCK_ID,
        class: 'rrx-ui rrx-stat-delta',
        'data-rrx-sig': signature,
        'data-rrx-cells': String(beside.length),
      },
      [
        ui.el('span', {
          class: 'rrx-stat-delta__since',
          text: `Since ${formatSince(delta.since)}`,
        }),
        // Only what moved: the summary is a line to glance at, and "+0" on it
        // says nothing. Under a figure it says something - that the figure was
        // read and has not moved.
        ...delta.changes
          .filter((change) => change[1] !== 0 && !DETAIL.has(change[0]))
          .map((change) =>
            ui.el('span', {
              class: `rrx-stat-delta__item rrx-stat-delta__item--${direction(change[1])}`,
              'data-rrx-field': change[0],
              text: phrase(change),
            })
          ),
      ]
    );

    // Between the trigger and the collapsing content: Royal Road ships
    // Statistics closed, so anything inside the panel is invisible by default,
    // and anything inside the trigger toggles the panel when clicked.
    item.insertBefore(node, content);
  }

  function clear() {
    const existing = document.getElementById(BLOCK_ID);
    if (existing) existing.remove();
    for (const node of placed()) node.remove();
  }

  // --- lifecycle -------------------------------------------------------------

  /** Once per page load, not once per sweep: re-reading on every mutation would
   *  roll the baseline forward against a page the reader never left. */
  let taken = false;
  let recording = false;
  let delta = null;

  async function record() {
    recording = true;
    try {
      const id = RRX.fictionIdFromHref(root.location.pathname);
      const reading = readStats();
      // Nothing readable yet. Left un-taken so a later sweep can try again,
      // rather than deciding on one pass that this page has no numbers.
      if (!id || !reading) return;

      taken = true;
      delta = RRX.statsDelta(await RRX.store.markFictionStats(id, reading));
      if (delta) render(delta);
    } finally {
      recording = false;
    }
  }

  function apply(ctx) {
    if (!ctx.settings['fiction.statDeltas']) {
      clear();
      // Switching it off deletes the readings this was computed from, so the
      // answer goes with them rather than waiting in module scope to be drawn
      // again if it is switched back on.
      taken = false;
      delta = null;
      return;
    }
    if (taken) {
      if (delta) render(delta);
      return;
    }
    if (!recording) record().catch((err) => RRX.warn('could not record fiction statistics', err));
  }

  features.list.push({
    id: 'fictionStats',
    pages: ['fiction'],
    onPage: apply,
    // onPage does not re-run on a sweep, and Royal Road fills this column late,
    // so the readout is re-asserted here. render compares its signature first.
    syncCards: (scope, ctx) => apply(ctx),
  });

  RRX.fictionStats = {
    readStats,
    statCells,
    valueNear,
    scoreWidgets,
    scoreOf,
    readScore,
    readChapters,
    phrase,
    beside,
    formatSince,
    render,
    clear,
    apply,
  };
})(globalThis);
