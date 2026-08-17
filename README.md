# UI Improvements for Royal Road

A Firefox and Chrome extension for the **redesigned** [royalroad.com](https://www.royalroad.com):
list filters and layouts, per-fiction hiding and drop marks, chapter typography the site does
not offer, and clearer comment threads. Every feature is separate and every one can be switched
off.

Unless noted, settings ship off or are set to "leave alone". Nothing leaves your device: no
analytics, no server of its own, and no write to your Royal Road account.

> **Not affiliated with Royal Road.** Unofficial and independent. "Royal Road" is its owner's
> trademark, used here only to say what this works on.

> **Redesign only.** Royal Road runs two UIs and this targets the new one. Every selector is
> anchored to a `data-rr-*` hook that exists only there, or to its own `rrx-` names, and a test
> enforces it. No visible UI is injected until a DOM probe confirms the redesign. On the legacy
> layout it does one thing: switch you across, if you asked it to.

## What it will never do

- **Cost an author their income.** Patreon and Ko-fi links, the Support block, advertising and
  authors' promotion of each other are left alone. Where promotion can be collapsed — a
  shoutout inside an author's note — it is off by default, nothing is deleted, and a chip puts
  it back.
- **Hammer Royal Road.** Every request is one you could have made by opening a page. One at a
  time, cached, never on a timer or in the background.
- **Send your reading anywhere.** No server, no analytics, no telemetry, no third-party code.
  Settings and your own lists stay on your device; royalroad.com is the only site it contacts.
  [`PRIVACY.md`](PRIVACY.md) names the file behind every claim.

It never writes to your Royal Road account — no follow, favourite, rating, comment or
bookmark — and never hides an author's own comments.
[`CONTRIBUTING.md`](CONTRIBUTING.md) has the full list and what enforces each one.

## What it does

**On the fiction lists** (`/fictions/rising-stars`, `trending`, `best-rated`,
`latest-updates`, `weekly-popular`, `search`, …)

- **Expand all descriptions**, or **expand on hover** after a settle delay. Click the chevron
  to pin one open.
- **Hide fictions**: a `−` on every card drops that fiction from every list for good, with an
  undo toast, a browsable manager, and a "show hidden" mode.
- **Tried and dropped**: mark a fiction you gave a go and stopped. Its card dims and says so
  wherever it turns up, but stays in the list and stays clickable, in case you change your mind.
- **Filters**: rating, followers, views, pages, chapters, tags in and out, status, type, last
  updated or gone quiet, and hiding what you already follow, favourited, saved for later or
  dropped. None of these exist on Royal Road outside `/fictions/search`. A list filtered down to
  nothing says so, the panel warns when a tag is in both tag lists — which can never match — and
  after four pages that match nothing the status line points at your own Global Filters, the
  site-wide ones you set on Royal Road, which cut these lists before the extension fetches them.
- **Infinite scroll**: the next page appends as you reach the bottom. Filters and hidden
  fictions apply to whatever arrives, so a strict filter can append a page and show nothing from
  it — Royal Road serves twenty at a time, and one scroll asks for one page rather than fetching
  until the screen is full.
- **Alternative layouts**: Royal Road's cards, compact rows, two columns, or a cover grid,
  plus a maximum list width for wide screens.
- **Trim tags out of titles**: "Some Title [LitRPG, Dungeon Core]" reads as "Some Title". Lists
  only; the full title stays in the tooltip.
- **Every tag on a card**: Royal Road folds all but the first few behind a `+`. Open them while
  the pointer is over the card, or always. Its own `+` still works, so a row can be pinned open
  or closed again.
- **Tag colours**: give a tag a colour and it carries it wherever the tag appears — the lists, a
  fiction's own page, and the home page behind its own switch. Only the tags you pick; the text
  colour is computed from the background, so a dark pick stays readable.

**In a chapter**

- Line height, justified text with hyphenation, colour, a local font of your choosing, and a
  width past Royal Road's ceiling. Its own Reading Preferences offer none of these.
- **The facts about a chapter, above it**: when it was posted, and how long it is as a word
  count, a reading time at your own speed, or both. Royal Road prints the date below the
  chapter, past the author notes, where it cannot tell you how old something is before you
  start it, and never prints the length at all.
- **How far you have to go**: "Chapter 89 of 95 (6 to catch up)", on the same line. The
  numbering is Royal Road's own, fetched once per fiction and kept for the tab.
- **Come back to where you stopped.** Reopening a chapter offers to return you to your
  paragraph, or takes you there. A link to a comment still goes to the comment. Off by default,
  and nothing is recorded while it is off.
- **Author notes**: collapse cross-promotion while keeping the note, collapse notes entirely,
  or do it per author. Nothing is deleted; a chip puts it back.
- Hide the About-author panel.
- **A recap of the previous chapter** at the top of this one, named, for when you are following
  several fictions and cannot remember how the last one ended. Always shown, behind a click, on
  hover, or off. Off by default, and it fetches nothing while off.
- **New comments since your last visit**, marked, with what you have read optionally folded to
  a dimmed line that opens on hover. Anything with a new reply underneath stays open, and
  nothing is ever hidden. A bar above the comments counts them, filters to just the new ones,
  or clears the marks.
- **Comments**: a rule between threads, a thread line down each chain in a colour you pick, a
  collapse control on any thread with replies, and folding or hiding for low-content comments
  ("thanks", "tyfc"), lone emoticons, and your own phrases or regular expressions. Plus real
  infinite scroll. Two things are never hidden: a comment with replies, so the replies still
  make sense, and the author's own comments, which are left alone unless you say otherwise and
  are only ever folded even then.

**Everywhere on the site**: none of the above works on Royal Road's legacy layout, so the
extension's popup carries a choice of layout — leave it to Royal Road, always the new design,
or always the old one. No account needed. The old-design option really does stop everything
else working, which is why it is there: wanting it back is a fair thing to want.

**On a fiction page**: control each section, in the order it appears. About Fiction,
Statistics, Table of Contents, Leave A Review and Reviews are each left alone, always open or
always closed. Others Also Liked is left alone, shown or hidden. Reviews also get a default
sort order and their own infinite scroll. A long tag list can be opened past Royal Road's `+`,
and coloured tags are coloured here too.

- **What has changed since you last looked**. Royal Road only ever shows today's total, which
  cannot tell you whether a fiction is climbing or has gone quiet. Every figure gets its own
  change written under it — `(+312)`, `(−2)`, `(+0.02)` — the six stat tiles and all five star
  ratings; with Statistics shut, the header sums it up. The numbers are read off the page you
  opened — no request — and kept on your device, so nothing is shown on a first visit and
  nothing when nothing moved. Off by default; switching it off again deletes what it recorded.

### Defaults that change the page

Most settings ship off or as "leave alone". These do something on first run, and each is one
toggle away in options:

- **A toolbar above every fiction list**, carrying the extension's own controls.
- **Infinite scroll on the lists.**
- **A `−` button on every card.** Nothing is hidden until you press one.
- **A drop-mark button beside it**, for a fiction you tried and stopped. Nothing is marked until
  you press one, and the two are separate switches.
- **Comment threading**: a divider between conversations, a line down each reply chain, and a
  collapse control on any comment with replies.
- **Hyphenation**, which does nothing unless you also turn on justified text.

Anything that alters an author's words is opt-in, and so is every rule that folds or hides a
comment.

The options page is six boxes, in the order a reader meets the site: which layout to use, fiction
lists (each manager beside the switches that fill it, and the tag-colour editor), fiction pages,
chapter pages, comments, and Backup — export, import, reset the settings, and forget your reading
history. Within a box the order is down the page, so a setting sits where the thing it changes
sits.

## Install

**Chrome / Edge**: on the Chrome Web Store. Review takes as long as it takes, so the published
version can sit a release or two behind this repository; [`CHANGELOG.md`](CHANGELOG.md) is what
this source tree is.

**Firefox**: not yet — still waiting on addons.mozilla.org review. Until it is approved, the only
way onto Firefox is from source, below.

**Firefox from source** (temporary, until the browser restarts)

```sh
npm install
npm start          # web-ext run: launches Firefox with the extension loaded
```

Or load it by hand: `about:debugging#/runtime/this-firefox` -> **Load Temporary Add-on** ->
pick `manifest.json`.

**Chrome / Edge**

```sh
npm install
npm run build
```

Then `chrome://extensions` -> enable **Developer mode** -> **Load unpacked** -> pick
`dist/chrome`.

### Make sure you are on the redesign

Everything here is built on the newer layout. On the legacy one the extension does nothing.

Pick **Always the new design** under *Royal Road design*, at the top of the popup or first in
options. It applies to the page you are on immediately, and to later ones before they paint.

To go back, pick **Always the old design**. *Leave it to Royal Road* will not undo an earlier
choice — the choice lives in a cookie, and only asking for the old design clears it.

**No account needed**: the layout is decided by that cookie, not by being signed in. Royal
Road's own "Revert To Legacy UI" link still works, but with "always the new design" on it is
undone on your next page load, so turn that off first.

By hand, it is one cookie:

```js
document.cookie = 'beta-ui-v2=always; path=/; domain=.royalroad.com';
```

## How it works

A few decisions carry most of the weight.

**Expanding and comment threading are pure CSS.** Royal Road's "show more" is an `sr-only`
checkbox plus Tailwind `:has(input:checked)` variants, with the collapsed height as a
*non-`!important`* inline style. Comments already carry `data-depth` and `data-parent-id`. So
both are stylesheets behind an `<html>` class: no per-element JavaScript, no observer, and they
cover lazily-loaded content for free.

**Hiding is generated CSS, not DOM removal.** `buildHideCss()` emits one rule per card group,
each a single `:has()` over an `:is()` list of ids, so the rule count stays constant however
many fictions you hide. CSS reaches content rendered after us: AJAX pagination, and the
React-rendered recommendations carousel.

The rule matches `a[data-vt-trigger="fiction-card"]`, the card's own title link, not any
`/fiction/` link inside it. Blurbs routinely link to *other* fictions, so matching those would
make hiding fiction A delete every card whose blurb recommends A.

`buildDropCss()` is the same shape for fictions you tried and dropped, dimming rather than
removing: no `display: none`, no `pointer-events: none`, because the mark exists to be
reconsidered.

**Tag colours are one rule per tag**, deliberately unlike hiding. A handful of tags is not the
whole vocabulary, so the trick that keeps the hidden list's rule count constant buys nothing
here. The slug reaches a selector, so it is parsed rather than escaped — anything outside
`[a-z0-9_-]` is dropped — and the match is anchored, because Royal Road links a tag as
`?tagsAdd=<slug>` with nothing after it and `*=` would make "romance" colour "romance_main"
too. Opening a card's folded tags is CSS as well, out-specifying the one `hidden` class with two
classes and an attribute so that Royal Road's own checkbox still toggles underneath.

**Hidden cards never flash.** `browser.storage.local` is async and would race first paint.
Content scripts share the page's origin, so a compact copy of the hidden and dropped lists is
mirrored into `localStorage` and read synchronously at `document_start`, before Royal Road's
deferred modules run. Embla never measures the carousel slides we are about to hide, so `/home` lays out
correctly around them.

**Infinite scroll appends; Royal Road's paginator replaces.** Comments and reviews use its
`clientfetch` paginator, whose "next" swaps the list out — page 20 leaves no way back to
comment 1. `content/pager.js` fetches the same endpoint Royal Road declares
(`data-rr-paginate-fetch-url`), appends, and deduplicates arriving items against the items
already there. Against *every* id in the container it went wrong: a reply tree, a tooltip or a
rating widget could collide with an arriving item and drop it with no trace.

That URL is read once. Royal Road's paginator takes it in its constructor and a re-sort assigns
its own copy without writing the attribute back, so from the first re-sort on it names an order
nobody is looking at. The order comes from the control the reader used instead.

Its page numbers go once something has been appended, not before: until then they are correct
and the only way on from a panel that stays collapsed or never gets scrolled to. After an append
they are a trap, since clicking "2" lands you back in replace-the-list with the two disagreeing
about which page you were on.

**Filters cannot do that**: they need parsed numbers off each card. They hold the list back
with `visibility` (not `display`, so no reflow) until the first pass lands, only when a filter
is set, with a 1 s watchdog — a page that never appears is worse than a brief flash.

**The multi-column layouts dissolve the card rather than squeeze it.** A Royal Road card is a
flex *row*: cover left, everything else in a narrow column right. Halve its width and that
column has no room: the title wraps every other word, stat tiles overlap, buttons get crushed.
Hiding parts of it did not help, nor did swapping in the phone layout — both keep the row. So
`display: contents` on the card's wrappers promotes cover, title, tags, stats, blurb and
buttons into direct children of one flex container, each then ordered and given full width on
its own. No DOM is moved. Blocks are matched by what they contain (`:has(> a > h2)` is the
title), not by Tailwind classes.

**Personal state on a card uses three different mechanisms.** Read Later is a real form whose
`mark` input says what a click *would* do. Following and Favourited are passive tooltip-wrapped
icons that Royal Road omits entirely when unset, so absence is the normal case, not a parse
failure. Two logged-in fixtures pin both the present and the absent case.

**Card extraction is deliberately tolerant.** Anything unreadable becomes `null`, and a filter
never excludes a card on a `null` field. When Royal Road renames something, a filter stops
narrowing rather than emptying the page.

### Layout

```
manifest.json               the Firefox manifest; tools/build.mjs derives Chrome's
src/common/    browser · selectors · schema · model · design · cards · filters · css · store
src/content/   boot.js (document_start) · ui.js · tags.js · pager.js · panel.js · main.js (last)
src/content/features/       one file per feature, registered on RRX.features.list
src/background/             15 lines, only so the toolbar can open the options page
src/options/ src/popup/     settings, the two fiction managers, JSON backup
tools/build.mjs             dist/firefox + dist/chrome
test/                       node:test suites + captured Royal Road HTML in fixtures/
```

Two files are deliberately the only place certain things live:

- **`src/common/selectors.js`**: every Royal Road selector. The site changes constantly; when
  something breaks it should break there and nowhere else. `main.js` logs a warning naming the
  file if a list page stops matching.
- **`src/common/schema.js`**: every setting, declared once. One generic normalizer walks it,
  and the options page builds itself from it, so a setting cannot become unreachable.

### Adding a feature

Drop a file in `src/content/features/`, push a descriptor onto `RRX.features.list`
(`pages: ['chapter']` scopes it), and add it to `manifest.json`. If it is presentational,
gate it behind an `<html>` class in `rootClassesFor` and write CSS: see `view-modes.js`, a
descriptor and nothing else.

## Development

```sh
npm test      # node:test
npm run lint    # web-ext lint against the built Firefox tree: must be clean
npm run build   # dist/firefox + dist/chrome
npm run icons   # redraw icons/*.png
npm run package # both store zips into web-ext-artifacts/
```

Icons are generated, not checked in as artwork. `tools/icons.mjs` draws each size at its own
scale, geometry snapped to whole pixels for that size: a 16px icon downscaled from a 128px
master lands its edges on half pixels and turns into a smudge. The shapes live in a 128-unit
grid that divides evenly by all five sizes, nothing is thinner than 16 units (two pixels at
16px), and every edge sits on a multiple of eight. No dependencies: shape maths, and `zlib`
for the PNG. `--design book` and `--design road` are alternative marks, kept so the icon can
be changed without starting from nothing.

`npm test` runs four layers, none of which need a browser:

- **pure logic**: `schema`, `model`, `filters`: ~50 cases over settings coercion, the boot
  mirror, backups, and every filter including that a `null` field never excludes.
- **selectors**: string assertions that each hook still exists in the real captured HTML.
- **DOM**: `cards`, `dom`, `dropped`, `author-notes`: the real modules under jsdom against real
  pages. Hiding one fiction matches exactly one card; a near-miss id (`18130` vs `181303`)
  matches none; a blurb's outbound links cannot hide the card they sit in; the `/home` blog
  carousel is never hideable; hide and drop controls share a card without deleting each other;
  the shoutout-only note collapses while the genuine note is untouched.
- **integration**: boots *every* content script, in the order `manifest.json` declares,
  against real list, chapter, fiction and legacy pages, and drives the UI: open the filter
  panel, apply, hide a fiction, check the counts.

Fixtures are gitignored (several MB, re-derivable). Suites that need them skip with a message
naming what is missing; `test/fixtures/README.md` covers how to re-capture each one.

## Known limitations

- **View modes are the least tested part.** The selectors are known-good, but these cards are
  dense Tailwind utilities and the layouts were verified by reading, not by eye in a browser.
  Two columns needs a window at least 1280px wide; below that it falls back to one column.
- **Forcing an accordion open races Royal Road.** It binds its handlers in a deferred script
  and then applies its own remembered state, sometimes closing a section the server sent open.
  So the extension watches the full 8 s rather than stopping when the state looks right, and
  re-asserts whenever it flips. A real click from you always wins, and ends the watching for
  good.
- **Carousel indicators.** Hiding a slide in a `/home` Embla carousel or the react-slick
  recommendations carousel leaves the dot count at the original slide count. The slides
  themselves lay out fine.
- **Shoutout detection is a heuristic**: "a direct child block of the note that links to a
  different fiction". It cannot catch a shoutout with no link, and it will collapse a block
  that merely mentions another fiction in passing. Both cost one click on the chip.
- **Deep replies start collapsed.** Past depth 2, Royal Road moves the rest of a chain into a
  container it hides behind a "N more replies" button. The thread line and the collapse
  control follow the chain into it, but the button is Royal Road's and the extension does not
  click it for you.
- **The low-effort comment rules are a guess.** They fire on short comments that are nothing
  but an acknowledgement once the filler is stripped ("thanks", "tyfc", "cheers"), a position
  claim ("first"), or a single Royal Road emoticon. Anything with more left in it survives:
  "thanks for the chapter, but the pacing dragged" is safe. They dim rather than remove by
  default, and a dimmed comment opens on hover.
- **Fonts are local only.** Royal Road's security policy blocks loading font files from an
  injected stylesheet, so only families already installed on the machine work.
- **The tag vocabulary costs one request.** `/fictions/search` is the only page that states it
  in full — 72 tags in its own `<select>`, plus 22 genres on its buttons, which that select
  carries none of. Opening the filter panel anywhere else fetches that page once and caches it
  for a week; on the search page itself it is read for free. Every other page contributes the
  tag links it already carries, which costs nothing but is a sample rather than the list, so it
  fills the vocabulary in without ever standing in for it.
- **A tag colour reaches the home page only once its name is known.** `/home` writes tags as
  plain chips with no slug on them, so they can only be matched by name, and the name comes from
  that cached tag list. Colour a tag before anything has cached it and it is coloured on the
  lists and fiction pages; the options page fills the name in on a later visit, and `/home`
  follows. Colouring `/home` is its own switch because the chip there is a shared element used in
  several places.
- **Your own Global Filters cut the lists first.** They are yours, set on Royal Road — its dialog
  offers to "include or exclude tags across the entire site", and needs you signed in — and Royal
  Road applies them before serving the list, so a filter here can only narrow what is left. After
  four pages that match nothing the status line says so. Only the count is readable: the dialog
  is in the page, but signed out it holds nothing except a login prompt.
- **Settings changed with no Royal Road tab open** reach the synchronous boot mirror one page
  load late. The authoritative async read corrects it during that same load.
- **Royal Road has its own `hide`** bookmark, server-side and account-bound, reachable from a
  fiction page. This extension's hiding is separate: local, instant, works logged out, and
  exportable. The two do not know about each other.

## Privacy

Everything is stored on the device: settings, your lists and your reading history in
`browser.storage.local`, plus two copies in royalroad.com's own `localStorage` — the boot mirror,
and where you are in the chapter you are reading — which a content script can read and write
synchronously. No analytics, and no server other than royalroad.com. It makes five kinds of
request, all of them things the site itself asks for: the `?page=N` fetch that adds the next page
of a list as you scroll, the same for comments and reviews, which it may start by pressing Royal
Road's own "Load Comments" button or its review sort dropdown, a single request for the tag vocabulary the first time you open the
filter panel, and — only once you switch them on — the chapter before the one you are reading,
and the fiction's chapter list behind Royal Road's own "Select a chapter" dropdown. It never
writes to your Royal Road account and never fetches your account pages: what it knows about
what you follow is read from the page in front of you.

See [PRIVACY.md](PRIVACY.md) for the full statement.

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers how to
run the tests, capture the fixtures they need, and where each kind of change belongs.

Issues: https://github.com/jmgpgit/royal-road-ui-improvements/issues

## Licence

[Mozilla Public License 2.0](LICENSE). You may use, modify and redistribute this, including
in commercial work; changes to the files in this repository must be published under the same
licence.
