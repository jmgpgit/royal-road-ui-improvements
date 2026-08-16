# What is wanted next

Not promises, and not a schedule: a list of what has been thought about, with enough of the
reasoning attached that picking one up does not mean starting from nothing. Anything here is
subject to the three rules in [`CONTRIBUTING.md`](CONTRIBUTING.md), which decide whether a
feature gets built at all.

## Next up

**Tried and dropped** — a per-fiction mark for something you sampled and stopped reading, shown
as a dimmed card in the lists rather than removed. Distinct from hiding, which is permanent and
silent. The design is settled: the dimming is generated CSS beside `buildHideCss`, one rule per
card group, with **no** `display: none` and **no** `pointer-events: none` — a dropped fiction
stays clickable, because changing your mind is the point. The control is a second
`.rrx-card-btn`, which means `hide-fictions.js` has to stop selecting `:scope > .rrx-card-btn`
and use `[data-rrx-btn="hide"]` instead, or whichever feature runs first deletes the other's
button. Filtering rides the existing `filters.hideMine` vocabulary rather than a new key.

**Stat deltas on fiction pages** — "since you last looked: +312 followers, +0.02 rating". Read
the six stat tiles by their label text with the icon as a fallback (that page renders
FontAwesome under five different family prefixes, so the glyph is the layer that churns), and
take the score from the tooltip's `4.83`, not the rounded `4.8` on the widget — a headline
claim of "+0.02" is invisible at one decimal. Two snapshot slots with a freshness window, so a
refresh shows the same still-true answer and tomorrow rolls the baseline. Nothing at all on a
first visit, and nothing when nothing moved.

## Wanted, unscheduled

- **Search inside a fiction.** Measured: a chapter is ~47.5 KB over the wire but only 11.9 KB
  of text, so indexing what you have already read costs nothing extra — store the text as each
  chapter is opened, reusing the recap's fetch-parse-cache path. That answers "who was this
  character again?" for exactly the chapters where you would ask it, and cannot spoil you. A
  full backfill is possible but is bulk work: opt-in per fiction, throttled, resumable, and it
  stops on the first 429.
- **Keyboard navigation** — `n`/`p` for next and previous chapter, `/` to open the filter panel.
  The links are already in the DOM; this is mostly an accessibility win.
- **A progress bar for the chapter**, using the word count that is already computed.
- **True unread tracking for comments.** Today's watermark is one timestamp per chapter, so a
  comment further down a ranked list counts as read whether or not you scrolled to it. Storing
  seen comment ids would be exact, at roughly 1.2 KB per chapter for 137 comments — perhaps
  240 KB capped at the most recent 200 chapters. Worth doing only if the current behaviour
  actually annoys in daily use.
- **Update cadence on a fiction page** — "~2 chapters a week; last three gaps 4d, 9d, 21d",
  from the publish dates already in the table of contents. A natural companion to the
  gone-quiet filter.
- **Stat deltas from your own history**, on list cards: "+312 followers since you last saw
  this". Nobody else can offer it, because it is your browsing history and it never leaves the
  device.
- **A sticky, searchable table of contents** with jump-to-next-unread.
- **Continuous chapters** — append the next chapter at the bottom, as the lists already do.
  `recap.js` already skips anything inside `.rrx-chapter` in anticipation of this.
- **Per-fiction typography overrides**, and a reading ruler for anyone who wants one.
- **Export your library** — follows and favourites as JSON, built from pages you visit.

## Needs a capture before it can be built properly

The rule is to look rather than reason, and these cannot be looked at from the captures in
`test/fixtures/`:

- **The comment summary line** ("Showing 31 to 40 of 137 comments"). Royal Road renders it
  client-side after the comments load, so it is in no server response and has no selector. The
  hidden-comment count finds it by matching `/of \d+ comments?/i` inside `#comments-pagination`
  and silently does nothing when that fails. A capture of that region, after comments load,
  would let it be pinned with a test.
- **A fiction organised into volumes** — the chapter list may carry header rows.
- **A chapter with an "edited at" stamp.** The facts bar mirrors whatever timestamps it finds,
  so one should appear on its own, but no capture has ever contained one.
- **A fiction with a couple of thousand chapters** — does Royal Road still server-render every
  row of the contents table?

## Housekeeping

- `README.md`'s install section names the version on each store. Update it when 1.4.0 is
  actually live rather than when it is submitted.
- Revisit whether `comments.seen` earns a place in the popup after living with it. It was left
  out because the in-page bar already offers Only new, Unfold and Clear the marks exactly where
  they are wanted.

## Not going to happen

`CONTRIBUTING.md` explains the three rules and why. The requests that keep coming and keep
being declined: whole-fiction EPUB export (hundreds of fetches, and it moves reading off the
page the author is paid on), ad or support-block removal, anything that writes to your Royal
Road account, a background poller for followed fictions, and AI chapter summaries — which need
a server, and which the previous-chapter recap already answers honestly with the author's own
words.
