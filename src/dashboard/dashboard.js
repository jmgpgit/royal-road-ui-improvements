'use strict';

/**
 * The reading dashboard: what the reading log holds, in plain DOM and CSS.
 *
 * The first half is pure date arithmetic and totals, exported for node. The
 * second draws the page and runs only where the page is.
 *
 * Days are local `YYYY-MM-DD` keys (model.js, `dayKey`). Arithmetic goes
 * through the Date constructor's day field, never through 86,400,000 ms: a
 * DST day is 23 or 25 hours long.
 */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('../common/model.js') : root.RRX);
  if (node) module.exports = api;
  else root.RRX.dashboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  const { dayKey } = model;

  const parse = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const addDays = (key, n) => {
    const at = parse(key);
    return dayKey(new Date(at.getFullYear(), at.getMonth(), at.getDate() + n));
  };

  /** Weeks start on Monday. */
  const weekStart = (key) => addDays(key, -((parse(key).getDay() + 6) % 7));

  /** Days from `from` to `to`, both counted. */
  const spanDays = (from, to) => Math.round((parse(to) - parse(from)) / 86400000) + 1;

  const firstDay = (log) => Object.keys(log.d).sort()[0] || '';

  // Royal Road's search page, "Number of Pages": "Each page is counted as 275 words".
  const WORDS_PER_PAGE = 275;

  const pages = (words) => Math.round(words / WORDS_PER_PAGE);

  /** Chapters, words, seconds reading and days with a chapter in them, over
   *  `from`..`to`. */
  function tally(log, from, to) {
    const out = { c: 0, w: 0, t: 0, days: 0 };
    for (const [day, [c, w, t]] of Object.entries(log.d)) {
      if (day < from || day > to) continue;
      out.c += c;
      out.w += w;
      out.t += t;
      if (c) out.days += 1;
    }
    return out;
  }

  /** "45 min", "3 h 5 min", "1,204 h". Measured time, so no "~". Past 100
   *  hours the minutes are noise, and wrapped the tile. */
  function duration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    if (minutes >= 6000) return `${Math.round(minutes / 60).toLocaleString()} h`;
    const rest = minutes % 60;
    return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
  }

  /** The last `count` weeks, oldest first, this one included. */
  function weeks(log, today, count = 12) {
    const last = weekStart(today);
    return Array.from({ length: count }, (_, i) => {
      const start = addDays(last, (i - count + 1) * 7);
      return { start, ...tally(log, start, addDays(start, 6)) };
    });
  }

  /** Every month from the first recorded day to this one, newest first. Empty
   *  months are listed: a gap is part of the answer. */
  function months(log, today) {
    const first = firstDay(log);
    if (!first) return [];
    const out = [];
    let y = Number(first.slice(0, 4));
    let m = Number(first.slice(5, 7));
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      out.push({ month: key, ...tally(log, `${key}-01`, `${key}-31`) });
      if (key >= today.slice(0, 7)) break;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out.reverse();
  }

  /** The same by year, from the year totals, which outlive the days. */
  function years(log, today) {
    const first = Object.keys(log.y).sort()[0];
    if (!first) return [];
    const out = [];
    for (let year = Number(first); ; year += 1) {
      const [c, w, t, days] = log.y[year] || [0, 0, 0, 0];
      out.push({ year: String(year), c, w, t, days });
      if (year >= Number(today.slice(0, 4))) break;
    }
    return out.reverse();
  }

  /** Runs of days with a chapter read. Today not read yet leaves yesterday's
   *  run standing: a streak should not read 0 every morning. */
  function streaks(log, today) {
    const read = Object.keys(log.d)
      .filter((day) => log.d[day][0] > 0)
      .sort();
    const set = new Set(read);

    let longest = 0;
    let run = 0;
    read.forEach((day, i) => {
      run = i && addDays(read[i - 1], 1) === day ? run + 1 : 1;
      longest = Math.max(longest, run);
    });

    let current = 0;
    let day = set.has(today) ? today : addDays(today, -1);
    while (set.has(day)) {
      current += 1;
      day = addDays(day, -1);
    }
    return { current, longest };
  }

  /** Chapters per day, week and month since the first recorded day. The
   *  current week and month count whole, so a young log reads a little low. */
  function averages(log, today) {
    const first = firstDay(log);
    if (!first || first > today) return null;
    const { c } = tally(log, first, today);
    const weekCount = (spanDays(weekStart(first), weekStart(today)) - 1) / 7 + 1;
    const monthCount =
      (Number(today.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
      Number(today.slice(5, 7)) -
      Number(first.slice(5, 7)) +
      1;
    return {
      since: first,
      day: c / spanDays(first, today),
      week: c / weekCount,
      month: c / monthCount,
    };
  }

  /** 53 Monday-first columns of seven days, ending with this week. */
  function year(log, today) {
    const start = addDays(weekStart(today), -52 * 7);
    return Array.from({ length: 53 * 7 }, (_, i) => {
      const day = addDays(start, i);
      return { day, c: log.d[day] ? log.d[day][0] : 0, future: day > today };
    });
  }

  function summary(log, today) {
    const all = { c: 0, w: 0, t: 0 };
    for (const [c, w, t] of Object.values(log.y)) {
      all.c += c;
      all.w += w;
      all.t += t;
    }
    return {
      today: tally(log, today, today),
      week: tally(log, weekStart(today), today),
      month: tally(log, `${today.slice(0, 7)}-01`, today),
      all,
      averages: averages(log, today),
      streaks: streaks(log, today),
    };
  }

  /**
   * The log's fictions, joined with the chapters resume has a position for,
   * most recent first. A fiction the log holds only a title for is listed only
   * once something of it is part-read.
   *
   * @param {object} chapters resume's records; only those with a position count
   * @param {object} names fiction id to title, for a fiction the log has not seen
   */
  function fictions(log, chapters, names) {
    const out = new Map();
    const entry = (id) => {
      if (!out.has(id)) out.set(id, { id, title: '', read: 0, open: 0, last: 0 });
      return out.get(id);
    };
    for (const [id, rec] of Object.entries(log.f)) {
      Object.assign(entry(Number(id)), { title: rec.t, read: rec.c, last: rec.a });
    }
    for (const rec of Object.values(chapters || {})) {
      if (rec.p === undefined || !rec.f) continue;
      const fiction = entry(rec.f);
      fiction.open += 1;
      fiction.last = Math.max(fiction.last, rec.a || 0);
    }
    for (const fiction of out.values()) {
      fiction.title = fiction.title || (names && names[fiction.id]) || `Fiction ${fiction.id}`;
    }
    return [...out.values()].filter((f) => f.read || f.open).sort((a, b) => b.last - a.last);
  }

  return {
    parse,
    addDays,
    weekStart,
    spanDays,
    tally,
    WORDS_PER_PAGE,
    pages,
    duration,
    weeks,
    months,
    years,
    streaks,
    averages,
    year,
    summary,
    fictions,
  };
});

(function (root) {
  const RRX = root.RRX;
  if (!RRX || !RRX.dashboard || typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);
  if (!$('dash-tiles')) return;

  const D = RRX.dashboard;
  const KEY = 'history.log';
  const KEEP = 'history.keep';

  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children || []) if (child) node.appendChild(child);
    return node;
  }

  const num = (n) => n.toLocaleString();
  const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
  const pages = (words) => plural(D.pages(words), 'page');
  const date = (key, opts) => D.parse(key).toLocaleDateString(undefined, opts);
  const SHORT = { day: 'numeric', month: 'short' };
  const LONG = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  const MONTH = { month: 'short', year: 'numeric' };
  const DATED = { ...SHORT, year: 'numeric' };
  const fromUnix = (s) => new Date(s * 1000).toLocaleDateString(undefined, DATED);

  // --- the switches ------------------------------------------------------------

  const SWITCHES = { 'dash-on': KEY, 'dash-keep': KEEP };
  for (const [id, key] of Object.entries(SWITCHES)) {
    $(`${id}-label`).textContent = RRX.COPY[key].label;
    $(`${id}-note`).textContent = RRX.COPY[key].note;
    $(id).addEventListener('change', async (event) => {
      await RRX.store.saveSettings({ [key]: event.target.checked });
      load();
    });
  }

  /** There is no history from before the switch: finishes were never stored. */
  function statusFor(on, hasData, kept) {
    if (!hasData && on) {
      return (
        'Counting since you switched the log on. Read a chapter to the end on Royal Road and ' +
        'it shows up here.'
      );
    }
    if (!hasData) {
      return (
        'Nothing counted yet. Switch the log on and the chapters you read to the end are ' +
        'counted from then on. There is no history from before it.'
      );
    }
    if (!on) {
      return (
        'Paused: nothing new is counted. What is here ' +
        (kept ? 'is kept until you forget it' : 'still ages out, or you can forget it now') +
        ' in Options → Backup.'
      );
    }
    return '';
  }

  // --- drawing -----------------------------------------------------------------

  /** One line per sub, so "1 h 9 min" never breaks across two. */
  function tile(label, value, ...subs) {
    return el('div', { class: 'tile' }, [
      el('div', { class: 'tile__label', text: label }),
      el('div', { class: 'tile__value', text: value }),
      ...subs.filter(Boolean).map((sub) => el('div', { class: 'tile__sub', text: sub })),
    ]);
  }

  function renderTiles(s) {
    const host = $('dash-tiles');
    const words = (t) => [plural(t.w, 'word'), pages(t.w), t.t ? D.duration(t.t) : ''];
    const avg = s.averages;
    const streak = s.streaks;
    const one = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    host.replaceChildren(
      tile('Today', num(s.today.c), ...words(s.today)),
      tile('This week', num(s.week.c), ...words(s.week)),
      tile('This month', num(s.month.c), ...words(s.month)),
      // null when the clock is behind every recorded day
      ...(avg
        ? [
            tile('Per day', one(avg.day), `on average since ${date(avg.since, SHORT)}`),
            tile('Per week', one(avg.week), 'on average'),
            tile('Per month', one(avg.month), 'on average'),
          ]
        : []),
      tile(
        'Streak',
        plural(streak.current, 'day'),
        streak.longest && `longest ${plural(streak.longest, 'day')}`
      ),
      tile('Words read', num(s.all.w), pages(s.all.w), `in ${plural(s.all.c, 'chapter')}`),
      tile('Time reading', D.duration(s.all.t), 'on chapter pages, while active')
    );
  }

  function renderWeeks(weeks) {
    const max = Math.max(1, ...weeks.map((w) => w.c));
    $('dash-weeks').replaceChildren(
      ...weeks.map((w) => {
        const bar = el('span', { class: 'bars__bar' });
        bar.style.setProperty('--v', String(w.c / max));
        const label = `Week of ${date(w.start, SHORT)}: ${plural(w.c, 'chapter')}`;
        return el('li', { class: 'bars__col', title: label, 'aria-label': label }, [
          el('span', { class: 'bars__value', text: w.c ? num(w.c) : '', 'aria-hidden': 'true' }),
          bar,
          el('span', { class: 'bars__label', text: date(w.start, SHORT), 'aria-hidden': 'true' }),
        ]);
      })
    );
  }

  function renderYear(cells) {
    const max = Math.max(1, ...cells.map((cell) => cell.c));
    const grid = $('dash-year-grid');
    const labels = $('dash-year-months');
    grid.replaceChildren();
    labels.replaceChildren();

    cells.forEach((cell, i) => {
      const level = cell.c ? Math.min(4, Math.ceil((4 * cell.c) / max)) : 0;
      grid.appendChild(
        el('span', {
          class: `heat__cell${cell.future ? ' heat__cell--future' : ''}`,
          'data-l': level,
          title: cell.future ? null : `${date(cell.day, LONG)}: ${plural(cell.c, 'chapter')}`,
        })
      );
      // A month is named over the first column whose Monday falls in it.
      const column = i / 7;
      if (i % 7 || !column || cells[i - 7].day.slice(0, 7) === cell.day.slice(0, 7)) return;
      const label = el('span', { text: date(cell.day, { month: 'short' }) });
      label.style.gridColumn = String(column + 1);
      labels.appendChild(label);
    });

    const scroller = $('dash-year-scroll');
    scroller.scrollLeft = scroller.scrollWidth; // this week is the end people look for
  }

  /** Months or years: `head` names the row. */
  function renderRows(id, rows, head) {
    // No month is left once every day has aged out; the years still are.
    $(id).closest('section').hidden = !rows.length;
    $(id).replaceChildren(
      ...rows.map((row) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: head(row) }),
          el('td', { text: num(row.c) }),
          el('td', { text: num(row.w) }),
          el('td', { text: num(D.pages(row.w)) }),
          el('td', { text: num(row.days) }),
          el('td', { text: D.duration(row.t) }),
        ])
      )
    );
  }

  function renderFictions(list) {
    $('dash-fictions-card').hidden = !list.length;
    $('dash-fictions').replaceChildren(
      ...list.map((f) => {
        const meta = [
          f.read ? `${plural(f.read, 'chapter')} read` : '',
          f.open ? `${num(f.open)} part-read` : '',
          f.last ? `last ${fromUnix(f.last)}` : '',
        ].filter(Boolean);
        return el('li', { class: 'fic-item' }, [
          el('div', { class: 'fic-item__body' }, [
            el('a', {
              class: 'fic-item__title',
              href: `https://www.royalroad.com/fiction/${f.id}`,
              target: '_blank',
              rel: 'noreferrer',
              text: f.title,
            }),
            el('div', { class: 'fic-item__meta', text: meta.join(' · ') }),
          ]),
        ]);
      })
    );
  }

  function render({ settings, log, chapters, names }) {
    const today = RRX.dayKey(new Date());
    const on = !!settings[KEY];
    const days = Object.keys(log.d).length > 0;
    // Two idle years can leave only the year totals.
    const hasData = days || Object.keys(log.y).length > 0;

    $('dash-on').checked = on;
    $('dash-keep').checked = !!settings[KEEP];
    // The year totals never age out; the days and fictions do, unless kept.
    const kept = !!settings[KEEP] || !(days || Object.keys(log.f).length);
    const status = statusFor(on, hasData, kept);
    $('dash-status').textContent = status;
    $('dash-status').hidden = !status;
    $('dash-data').hidden = !hasData;

    if (hasData) {
      renderTiles(D.summary(log, today));
      renderWeeks(D.weeks(log, today));
      renderYear(D.year(log, today));
      // Drawn from the days, like the month table, so empty without them.
      $('dash-weeks').closest('section').hidden = !days;
      $('dash-year-grid').closest('section').hidden = !days;
      renderRows('dash-months', D.months(log, today), (row) => date(`${row.month}-01`, MONTH));
      renderRows('dash-years', D.years(log, today), (row) => row.year);
    }
    renderFictions(D.fictions(log, chapters, names));
  }

  async function load() {
    const [{ settings, hidden, dropped }, log, chapters] = await Promise.all([
      RRX.store.load(),
      RRX.store.loadLog(),
      RRX.store.loadChapters(),
    ]);
    const names = {};
    for (const [id, rec] of Object.entries({ ...dropped, ...hidden })) names[id] = rec.title;
    render({ settings, log, chapters, names });
  }

  RRX.ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('log' in changes || 'settings' in changes)) load();
  });
  load();
})(globalThis);
