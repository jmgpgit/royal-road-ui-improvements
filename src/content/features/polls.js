'use strict';

/**
 * Chapter polls: a button that lists the options by vote share, and back.
 * Page view only - nothing is stored, and the poll's own form is never touched.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  const BAR_CLASS = 'rrx-poll-sort';

  const share = (row) => parseFloat(row.querySelector(SEL.pollBar)?.style.width);

  /** The option rows, or null when there is no share to sort by: the pre-vote
   *  form, or markup this does not recognise. */
  function optionsOf(poll) {
    const rows = [...poll.querySelectorAll(SEL.pollOptionLabel)].map((h) => h.parentElement);
    const list = rows[0]?.parentElement;
    if (rows.length < 2 || !list) return null;
    if (!rows.every((r) => r.parentElement === list && Number.isFinite(share(r)))) return null;
    // Whitespace or the Total row. It never moves, so inserting every row
    // before it gives back whichever order is asked for.
    return { list, rows, after: rows[rows.length - 1].nextSibling };
  }

  function decorate(scope) {
    for (const anchor of scope.querySelectorAll(SEL.poll)) {
      const heading = anchor.parentElement;
      const poll = heading?.parentElement;
      if (!poll || poll.querySelector(`.${BAR_CLASS}`)) continue;
      const options = optionsOf(poll);
      if (!options) continue;
      const { list, rows, after } = options;
      // Stable, so ties keep the author's order.
      const byVotes = [...rows].sort((a, b) => share(b) - share(a));
      // Already in that order: the button would visibly do nothing.
      if (byVotes.every((r, i) => r === rows[i])) continue;

      const button = ui.toggleButton({
        id: 'pollSort',
        label: 'Sort by votes',
        title: 'Most votes first',
        iconName: 'sort',
        pressed: false,
        onClick: () => {
          const sorted = button.getAttribute('aria-pressed') !== 'true';
          button.setAttribute('aria-pressed', String(sorted));
          for (const row of sorted ? byVotes : rows) list.insertBefore(row, after);
        },
      });
      // Its own row: inside the <h5> it would become part of the heading's name.
      heading.after(ui.el('div', { class: `rrx-ui ${BAR_CLASS}` }, [button]));
    }
  }

  // onPage, not syncCards: a vote is a full form POST, so the poll never
  // arrives after load, and runOnce contains a throw where a sweep would not.
  features.list.push({ id: 'pollSort', pages: ['chapter'], onPage: () => decorate(document) });

  RRX.polls = { decorate, optionsOf };
})(globalThis);
