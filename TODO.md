# What is wanted next

Not promises, and not a schedule: a list of what has been thought about, with enough of the
reasoning attached that picking one up does not mean starting from nothing. Anything here is
subject to the three rules in [`CONTRIBUTING.md`](CONTRIBUTING.md), which decide whether a
feature gets built at all.

Shipped as of 1.4.0: list filters and layouts, permanent hiding, chapter typography, the
previous-chapter recap, the design switch, chapter facts (posted date, length, catch-up count),
resume where you stopped, and comments posted since your last visit.

## How to judge anything here

Past the three rules, three questions decide whether an idea is worth its weight.

**What does it cost per use?** Measured, so proposals can be costed rather than guessed at: a
chapter page is ~47.5 KB over the wire (346 KB raw, 11.9 KB of text, ~2,120 words);
`/fictions/chapterlist?id=N` is ~3 KB for a hundred chapters; a fiction page is ~47 KB and
carries its whole table of contents server-rendered. Comment and review fragments are small and
answer to `X-Requested-With` — a chapter page does **not** get lighter with that header, so that
trick is for fragments only.

**Does it need storage that accumulates?** A record that deletes itself — a reading position,
which goes when the chapter is finished — is cheap. One that only ever grows, like a per-chapter
watermark, needs an expiry, which is why the comment one is capped at 60 days.

**Can it be answered from the page the reader already opened?** That is always the best version
of a feature, and usually a smaller one.

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

## Fiction lists

- **Saved filter presets.** The panel has a dozen fields and no memory beyond the last state.
  "Rising Stars, 4.5+, not LitRPG, under 200 chapters" is a search worth naming and coming back
  to. Probably the highest-value unbuilt thing here for anyone who filters at all, and it is a
  named list of filter objects in settings — no requests, no new machinery.
- **"You are N chapters behind"** on cards for fictions you are reading. The chapter records
  already know where you got to and the card carries the current count, so this turns a list
  into a reading queue without fetching anything.
- **Stat deltas from your own history** — "+312 followers since you last saw this". Nobody else
  can offer it, because the history is local and never leaves the device.
- **Hide everything by an author** — the same local mechanism as hiding a fiction, keyed by
  author id, for when a whole catalogue is not for you.
- **Sort a list locally.** Royal Road offers the orders it offers; the cards already carry
  ratings, followers, views and dates, so re-ordering what is loaded costs nothing. It has to
  interact honestly with infinite scroll: sort what is loaded, and say that is what it did.
- **Remember where you were in a list.** Coming back from a fiction page should not drop you at
  the top of a list you had scrolled halfway down. Per list, per session.
- **Tag colouring** — give a handful of tags a colour so they can be spotted while skimming.
  Pure CSS once the tags are on the card.

## Fiction pages

- **Update cadence** — "~2 chapters a week; last three gaps 4d, 9d, 21d", computed from the
  publish dates already in the contents table. Says far more about whether a fiction is alive
  than the ONGOING chip does, and pairs with the gone-quiet filter.
- **Your progress, here** — "you are on chapter 89 of 95", linking straight to where you
  stopped. The records exist; this is presentation.
- **A sticky, searchable table of contents**, with jump-to-next-unread. Trivial at 100 chapters
  and genuinely useful at 800.
- **Chapter length in the contents.** Royal Road publishes no per-chapter word count, but every
  chapter you read gives one for free. A partial column still says something useful ("the ones
  you have read average 2,800 words").
- **Review reading** — filter reviews by score, and collapse the ones that are a single line of
  praise, reusing the low-value-comment machinery. Reviews already have their own pager.

## Chapter pages

- **Search inside a fiction.** The big one. A chapter is ~47.5 KB over the wire but only 11.9 KB
  of text, so indexing what you have already read costs nothing extra — store the text as each
  chapter is opened, reusing the recap's fetch-parse-cache path. That answers "who was this
  character again?" for exactly the chapters where you would ask it, and cannot spoil you
  because it only knows what you have read. A full backfill is possible but is bulk work:
  opt-in per fiction, throttled, resumable, and it stops on the first 429. At ~47.5 KB a
  chapter, a 500-chapter fiction is ~26 MB — a real cost, and so explicitly the reader's choice.
- **Continuous chapters** — append the next chapter at the bottom instead of navigating, which
  costs exactly what clicking Next costs. `recap.js` already ignores anything inside
  `.rrx-chapter` in anticipation, and the rail's slot ordering was built with it in mind.
- **Keyboard navigation** — `n`/`p` for next and previous chapter, `j`/`k` to scroll, `/` to
  focus the filter panel, `c` to jump to the comments. Accessibility as much as convenience.
- **A progress bar for the chapter**, using the word count already computed, reading "about 4
  minutes left" rather than the total.
- **Time to catch up.** The catch-up count knows how many chapters remain and the word count
  knows roughly how long one takes, so "12 chapters, about 90 minutes" beats "12".
- **Per-fiction typography.** One fiction's terrible formatting should not have to change your
  defaults everywhere.
- **Notes and highlights** — mark a paragraph, write a note, find it again. Anchoring has to
  survive an edited chapter, so store a text quote *and* a paragraph index and reconcile the
  two, the way the resume position already does.
- **A reading ruler** — a band following the cursor or keyboard, for anyone who loses their line
  in a wall of text.
- **Manual "mark as read".** The automatic rule covers most cases; a control makes it
  predictable when it does not.
- **Chapter themes** — sepia, high contrast, a true dark for readers whose Royal Road theme is
  not dark. Careful: it must not fight Royal Road's own reading preferences.

## Comments

- **True unread tracking.** Today's watermark is one timestamp per chapter, so a comment further
  down a ranked list counts as read whether or not you scrolled to it. Storing seen comment ids
  is exact, at roughly 1.2 KB per chapter for 137 comments — perhaps 240 KB capped at the most
  recent 200 chapters. Worth doing only if the current behaviour actually annoys in daily use.
- **Sort by newest.** Royal Road ranks comments, which is what makes "new since" awkward in the
  first place. Its own endpoint takes a sort parameter, so this is a request the reader could
  have made themselves — and a local re-sort of what is already loaded costs nothing at all.
- **Find in comments** — a filter box over what is loaded. Much better than Ctrl-F on a page
  where half the replies are collapsed.
- **Collapse all / expand all threads.** The per-thread control exists; the bulk one does not.
- **Hide comments from specific people** — the same local list as blocked authors, applied to
  comments. Never the fiction's own author.
- **Spoiler guard.** Comments on a chapter ahead of where you have read are the classic way to
  be spoiled, and the chapter records know how far along you are. A warning, or a fold.

## Across the site

- **A local reading dashboard** — chapters read per week, fictions in progress, what has gone
  quiet, what you are behind on. Every number comes from records already kept: nothing fetched,
  nothing sent. This is the feature that makes the stored history pay off.
- **Backup improvements** — merge on import rather than replace, and a nudge when the backup is
  months old. The current import is deliberately wholesale, which is right for restoring a
  machine and wrong for keeping two in step.
- **Export your library** — follows and favourites as JSON or CSV, built from pages you visit.
- **Recommend from what you have read** — entirely local: the tags and authors of what you
  follow, matched against what turns up in lists. No server, no profile, and no request beyond
  the pages you already opened.
- **Accessibility audit** — focus outlines on every injected control, `prefers-reduced-motion`
  honoured throughout, screen-reader labels checked. Some of this is already true; none of it
  is verified.
- **Make the comment sweep cheaper.** Measured in 1.4.1, and it is the one real performance
  problem in the extension. `syncCards` on a chapter, median of 7 (jsdom, so a browser will be
  several times faster — the *shape* is what matters):

  | comments | sweep |
  |---|---|
  | 49 | 12.8 ms |
  | 196 | 114.8 ms |
  | 490 | 539 ms |

  Superlinear: 4× the comments costs 9× the time, 10× costs 42×. Broken down by feature at 490
  comments, `comments.js` is 521 ms of it and everything else rounds to zero. The suspects are
  all per-comment work repeated on every sweep: `repliesOf()` runs a subtree query plus a
  `.closest()` walk per hidden comment, `addCollapseButton` runs a `:scope >` query per comment,
  and `showHiddenCount` runs a document-wide `:has()` and then materialises every descendant of
  the pagination block. The fix is to cache per-comment answers on the element, the way
  `data-rrx-rule` and `dataset.rrxFullTitle` already do, so a sweep re-does nothing it has
  already decided. Sweeps fire every 200 ms while comments load, so this is paid repeatedly.

- **`buildHideCss` at very large hidden lists.** Measured in 1.4.1 and **not** a problem at any
  realistic size: the rule count is constant at 6 and building takes 0.05 ms at 100 hidden. The
  output does grow — 52 KB at 100, 256 KB at 500, 1 MB at 2,000 — and each rule is a
  `:has(:is(…))` the engine re-evaluates on every style recalculation. Worth revisiting only if
  somebody actually hides thousands of fictions.

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
- **A logged-in fiction page** — which markers show what you follow, favourite and have read.

## Known rough edges

- `README.md`'s install section names the version on each store. Update it when 1.4.0 is
  actually live rather than when it is submitted.
- Revisit whether `comments.seen` earns a place in the popup after living with it. It was left
  out because the in-page bar already offers Only new, Unfold and Clear the marks exactly where
  they are wanted.
- The dev launcher cannot open the options page in a tab: Firefox gives a temporary add-on a
  fresh `moz-extension://` origin on every install, so the URL cannot be known in advance.
  Abandoned deliberately — do not re-attempt without new information.

## Not going to happen

[`CONTRIBUTING.md`](CONTRIBUTING.md) explains the three rules and why. The requests that will be declined are:

- **Whole-fiction EPUB export** — the most requested thing in this space. Hundreds of fetches,
  and it moves reading off the page the author is paid on. Two rules at once.
- **Ad removal, or hiding support blocks.** Rule one.
- **Anything that writes to your Royal Road account** — follow, rate, comment, bookmark.
- **A background poller** for followed fictions. No timers and no background work; Royal Road's
  own notifications already exist.
- **AI chapter summaries.** They need a server, which rule three forbids, and the
  previous-chapter recap already answers the same need honestly, in the author's own words.
- **Anything that sends reading history anywhere**, including "sync" that is not a file you
  move yourself.
