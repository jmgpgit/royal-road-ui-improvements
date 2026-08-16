# What is wanted next

Not promises and not a schedule. Ideas with enough reasoning attached that picking one up does
not mean starting from nothing. Everything here is subject to the three rules in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Shipped as of 1.4.0: list filters and layouts, permanent hiding, chapter typography, the
previous-chapter recap, the design switch, chapter facts (posted date, length, catch-up
count), resume where you stopped, and
comments posted since your last visit.

## How to judge anything here

Past the three rules, three questions decide whether an idea is worth its weight.

**What does it cost per use?** Measured, so proposals can be costed rather than guessed at: a
chapter page is ~47.5 KB over the wire (346 KB raw, 11.9 KB of text, ~2,120 words);
`/fictions/chapterlist?id=N` is ~3 KB for a hundred chapters; a fiction page is ~47 KB and carries
its whole table of contents server-rendered. Comment and review fragments are small and answer
to `X-Requested-With`; a chapter page does **not** get lighter with that header, so the trick
is for fragments only.

**Does it need storage that accumulates?** A record that deletes itself, like a reading
position, is cheap. One that only grows needs an expiry — which is why the comment watermark
has 60 days.

**Can it be answered from the page already open?** That is always the better version of a
feature, and usually a smaller one.

## Next up

**Tried and dropped** — a per-fiction mark for something you sampled and stopped: the card dims,
it does not disappear. Hiding is permanent and silent; this is not. Design settled: generated
CSS beside `buildHideCss`, one rule per card group, **no** `display: none`, **no**
`pointer-events: none` — a dropped fiction stays clickable, because changing your mind is the
point. The control is a second `.rrx-card-btn`, so `hide-fictions.js` must select
`[data-rrx-btn="hide"]`, not `:scope > .rrx-card-btn`, or whichever runs first deletes the
other's button. Filtering rides `filters.hideMine`, not a new key.

**Stat deltas on fiction pages** — "since you last looked: +312 followers, +0.02 rating". Read
the six stat tiles by label text, icon as fallback (that page renders FontAwesome under five
different family prefixes, so the glyph is the layer that churns). Take the score from the
tooltip's `4.83`, not the widget's rounded `4.8` — "+0.02" is invisible at one decimal. Two
snapshot slots with a freshness window: a refresh repeats the same answer, tomorrow rolls the
baseline. Nothing on a first visit, nothing when nothing moved.

## Fiction lists

- **Saved filter presets.** A dozen fields, no memory beyond the last state. "Rising Stars,
  4.5+, not LitRPG, under 200 chapters" is worth naming. Probably the highest-value unbuilt
  thing here for anyone who filters, and it is a named list of filter objects in settings — no
  requests, no new machinery.
- **"You are N chapters behind"** on cards for fictions you are reading. The chapter records
  know where you got to, the card carries the current count: a list becomes a reading queue with
  no fetching.
- **Stat deltas from your own history** — "+312 followers since you last saw this". Nobody else
  can offer it: the history is local and never leaves the device.
- **Hide everything by an author** — the same local mechanism as hiding a fiction, keyed by
  author id, for when a whole catalogue is not for you.
- **Sort a list locally.** Royal Road offers the orders it offers; the cards carry ratings,
  followers, views and dates, so re-ordering what is loaded costs nothing. Must be honest about
  infinite scroll: sort what is loaded, and say so.
- **Remember where you were in a list.** Coming back from a fiction page should not drop you at
  the top of a list you scrolled halfway down. Per list, per session.
- **Tag colouring** — a colour on a handful of tags, to spot them while skimming. Pure CSS once
  the tags are on the card.

## Fiction pages

- **Update cadence** — "~2 chapters a week; last three gaps 4d, 9d, 21d", from the publish dates
  in the contents table. Says far more about whether a fiction is alive than the ONGOING chip,
  and pairs with the gone-quiet filter.
- **Your progress, here** — "you are on chapter 89 of 95", linking to where you stopped. The
  records exist; this is presentation.
- **A sticky, searchable table of contents**, with jump-to-next-unread. Trivial at 100 chapters,
  useful at 800.
- **Chapter length in the contents.** Royal Road publishes no per-chapter word count, but every
  chapter you read gives one for free. A partial column still says something ("the ones you have
  read average 2,800 words").
- **Review reading** — filter reviews by score, collapse the single-line-of-praise ones, reusing
  the low-value-comment machinery. Reviews already have their own pager.

## Chapter pages

- **Search inside a fiction.** The big one. A chapter is ~47.5 KB over the wire but only 11.9 KB
  of text, so indexing what you have read costs nothing extra — store the text as each chapter
  opens, reusing the recap's fetch-parse-cache path. Answers "who was this character again?" for
  exactly the chapters where you would ask, and cannot spoil you because it only knows what you
  have read. A full backfill is bulk work: opt-in per fiction, throttled, resumable, stopping on
  the first 429. At ~47.5 KB a chapter, a 500-chapter fiction is ~26 MB — a real cost, so
  explicitly the reader's choice.
- **Continuous chapters** — append the next chapter at the bottom instead of navigating; costs
  exactly what clicking Next costs. `recap.js` already ignores anything inside `.rrx-chapter` in
  anticipation, and the rail's slot ordering was built with it in mind.
- **Keyboard navigation** — `n`/`p` for next and previous chapter, `j`/`k` to scroll, `/` to
  focus the filter panel, `c` to jump to the comments. Accessibility as much as convenience.
- **A progress bar for the chapter**, from the word count already computed, reading "about 4
  minutes left" rather than the total.
- **Time to catch up.** The catch-up count knows how many chapters remain and the word count
  knows how long one takes, so "12 chapters, about 90 minutes" beats "12".
- **Per-fiction typography.** One fiction's terrible formatting should not change your defaults
  everywhere.
- **Notes and highlights** — mark a paragraph, write a note, find it again. Anchoring must
  survive an edited chapter: store a text quote *and* a paragraph index and reconcile the two,
  the way the resume position does.
- **A reading ruler** — a band following the cursor or keyboard, for anyone who loses their line
  in a wall of text.
- **Manual "mark as read".** The automatic rule covers most cases; a control makes it
  predictable when it does not.
- **Chapter themes** — sepia, high contrast, a true dark for readers whose Royal Road theme is
  not dark. Must not fight Royal Road's own reading preferences.

## Comments

- **True unread tracking.** Today's watermark is one timestamp per chapter, so a comment further
  down a ranked list counts as read whether or not you scrolled to it. Storing seen comment ids
  is exact: roughly 1.2 KB per chapter for 137 comments, perhaps 240 KB capped at the most
  recent 200 chapters. Worth doing only if the current behaviour actually annoys in daily use.
- **Sort by newest.** Royal Road ranks comments, which is what makes "new since" awkward. Its
  own endpoint takes a sort parameter — a request the reader could have made themselves — and a
  local re-sort of what is loaded costs nothing.
- **Find in comments** — a filter box over what is loaded. Better than Ctrl-F on a page where
  half the replies are collapsed.
- **Collapse all / expand all threads.** The per-thread control exists; the bulk one does not.
- **Hide comments from specific people** — the same local list as blocked authors, applied to
  comments. Never the fiction's own author.
- **Spoiler guard.** Comments on a chapter ahead of where you have read are the classic way to
  be spoiled, and the chapter records know how far along you are. A warning, or a fold.

## Across the site

- **A local reading dashboard** — chapters read per week, fictions in progress, what has gone
  quiet, what you are behind on. Every number comes from records already kept: nothing fetched,
  nothing sent. This is what makes the stored history pay off.
- **Backup improvements** — merge on import rather than replace, and a nudge when the backup is
  months old. The current import is deliberately wholesale: right for restoring a machine, wrong
  for keeping two in step.
- **Export your library** — follows and favourites as JSON or CSV, built from pages you visit.
- **Recommend from what you have read** — entirely local: the tags and authors of what you
  follow, matched against what turns up in lists. No server, no profile, and no request beyond
  the pages you already opened.
- **Accessibility audit** — focus outlines on every injected control, `prefers-reduced-motion`
  honoured throughout, screen-reader labels checked. Some of this is already true; none of it is
  verified.
- **Make the comment sweep cheaper.** Measured in 1.4.1, the one real performance problem in the
  extension. `syncCards` on a chapter, median of 7 (jsdom, so a browser will be several times
  faster — the *shape* is what matters):

  | comments | sweep |
  |---|---|
  | 49 | 12.8 ms |
  | 196 | 114.8 ms |
  | 490 | 539 ms |

  Superlinear: 4× the comments costs 9× the time, 10× costs 42×. At 490 comments, `comments.js`
  is 521 ms of it; everything else rounds to zero. The suspects are per-comment work repeated on
  every sweep: `repliesOf()` runs a subtree query plus a `.closest()` walk per hidden comment,
  `addCollapseButton` runs a `:scope >` query per comment, `showHiddenCount` runs a document-wide
  `:has()` and then materialises every descendant of the pagination block. Fix: cache per-comment
  answers on the element, the way `data-rrx-rule` and `dataset.rrxFullTitle` do, so a sweep
  re-does nothing it has already decided. Sweeps fire every 200 ms while comments load, so this
  is paid repeatedly.

- **`buildHideCss` at very large hidden lists.** Measured in 1.4.1 and **not** a problem at any
  realistic size: the rule count is constant at 6, building takes 0.05 ms at 100 hidden. The
  output does grow — 52 KB at 100, 256 KB at 500, 1 MB at 2,000 — and each rule is a
  `:has(:is(…))` the engine re-evaluates on every style recalculation. Revisit only if somebody
  hides thousands of fictions.

## Needs a capture before it can be built properly

The rule is to look rather than reason, and these cannot be looked at from the captures in
`test/fixtures/`:

- **The comment summary line** ("Showing 31 to 40 of 137 comments"). Royal Road renders it
  client-side after the comments load, so it is in no server response and has no selector. The
  hidden-comment count finds it by matching `/of \d+ comments?/i` inside `#comments-pagination`,
  and silently does nothing when that fails. A capture of that region, after comments load, would
  pin it with a test.
- **A fiction organised into volumes** — the chapter list may carry header rows.
- **A chapter with an "edited at" stamp.** The facts bar mirrors whatever timestamps it finds, so
  one should appear on its own, but no capture has ever contained one.
- **A fiction with a couple of thousand chapters** — does Royal Road still server-render every
  row of the contents table?
- **A logged-in fiction page** — which markers show what you follow, favourite and have read.

## Known rough edges

- `README.md`'s install section names the version on each store. Update it when 1.4.0 is live,
  not when it is submitted.
- Revisit whether `comments.seen` earns a place in the popup after living with it. Left out
  because the in-page bar already offers Only new, Unfold and Clear the marks exactly where they
  are wanted.
- The dev launcher cannot open the options page in a tab: Firefox gives a temporary add-on a
  fresh `moz-extension://` origin on every install, so the URL cannot be known in advance.
  Abandoned deliberately — do not re-attempt without new information.

## Not going to happen

[`CONTRIBUTING.md`](CONTRIBUTING.md) explains the three rules and why. Requests that will be declined:

- **Whole-fiction EPUB export** — the most requested thing in this space. Hundreds of fetches,
  and it moves reading off the page the author is paid on. Two rules at once.
- **Ad removal, or hiding support blocks.** Rule one.
- **Anything that writes to your Royal Road account** — follow, rate, comment, bookmark.
- **A background poller** for followed fictions. No timers and no background work; Royal Road's
  own notifications already exist.
- **AI chapter summaries.** They need a server, which rule three forbids, and the
  previous-chapter recap already answers the same need honestly, in the author's own words.
- **Anything that sends reading history anywhere**, including "sync" that is not a file you move
  yourself.
