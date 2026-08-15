# UI Improvements for Royal Road

A Firefox and Chrome extension that adds optional, individually toggleable improvements to
the **redesigned** [royalroad.com](https://www.royalroad.com): filters and layouts for the
fiction lists, permanent per-fiction hiding, chapter typography beyond what the site offers,
and clearer comment threads.

Everything ships off or set to "leave alone" unless noted. Nothing is sent anywhere: there is
no analytics, no server of its own, and no write to your Royal Road account.

> **Not affiliated with Royal Road.** This is an unofficial, independent extension. "Royal
> Road" is the trademark of its owner and is used here only to say what the extension works
> on.

> **Redesign only.** Royal Road currently runs two UIs. This extension targets the new one:
> every selector it uses is anchored either to a `data-rr-*` hook that exists only in the
> redesign or to its own `rrx-` names (enforced by a test), and no visible UI is injected
> until a DOM probe confirms the redesign. The only thing it does on the legacy layout is
> switch you to the redesign, if you have asked it to.

## What it does

**On the fiction lists** (`/fictions/rising-stars`, `trending`, `best-rated`,
`latest-updates`, `weekly-popular`, `search`, …)

- **Expand all descriptions**: a sticky toggle that keeps every blurb open.
- **Expand on hover**: hovering a card opens its blurb after a short settle delay. Click the
  chevron to pin it.
- **Hide fictions**: a `−` on every card removes that fiction from every list, permanently,
  with an undo toast, a browsable manager and an in-place "show hidden" mode.
- **Filters**: rating, followers, views, pages, chapters, tags in and out, status, type,
  last-updated / gone-quiet, and hiding what you already follow, favourited or saved for
  later. None of these exist on Royal Road outside `/fictions/search`.
- **Infinite scroll**: reaching the bottom of a list adds the next page underneath, so a
  list reads as one run rather than twenty at a time. Filters and hidden fictions apply to
  whatever comes in.
- **Alternative layouts**: cards (Royal Road's own), compact rows, two columns, or a cover
  grid, and a maximum list width if you want to use more of a wide screen than Royal Road
  does.
- **Trim tags out of titles**: "Some Title [LitRPG, Dungeon Core]"
  becomes "Some Title". Lists only; the full title stays in the tooltip.

**In a chapter**

- Line height, justification with hyphenation, text colour, an arbitrary local font, and a
  reading width past Royal Road's ceiling: all things its own Reading Preferences omit.
- **Author notes**: collapse cross-promotion ("shoutouts") while keeping the real note, or
  collapse notes entirely, or per-author. Nothing is deleted: a chip always puts it back.
- Hide the About-author panel.
- **A recap of the previous chapter**: the closing paragraphs of the chapter before, at the
  top of this one, for when you are following several fictions at once and cannot remember
  how the last one left off. Always visible, behind a click, on hover, or off. Off ships as
  the default, and while it is off nothing is fetched at all.
- **Comments**: a rule between threads and a thread line down each reply chain (colour is
  yours to pick), a collapse control on any thread with replies, low-content comments
  ("thanks", "tyfc") or a lone Royal Road emoticon collapsed to one dimmed line or hidden
  outright, plus your own patterns, one phrase or regular expression per line, and true
  infinite scroll. Two things are never hidden: a comment that has replies, so the replies
  under it still make sense, and the author's own comments, which are left alone entirely
  unless you say otherwise and are only ever collapsed even then.

**Everywhere on the site**: none of the above works on Royal Road's legacy layout, so the
extension's popup carries a choice of layout — leave it to Royal Road, always the new design,
or always the old one. No account needed. The old-design option really does stop everything
else working, which is why it is there: wanting it back is a fair thing to want.

**On a fiction page**: control each section, in the order it appears. About Fiction,
Statistics, Table of Contents, Leave A Review and Reviews are each left alone, always open or
always closed. Others Also Liked is left alone, shown or hidden. Reviews also get a default
sort order and their own infinite scroll.

### Defaults that change the page

Most settings ship off or as "leave alone". These do something on first run, and each is one
toggle away in options:

- **A toolbar above every fiction list**, with the extension's own controls.
- **Infinite scroll on the lists**: reaching the bottom adds the next page underneath.
- **A `−` button on every card**, for hiding a fiction. Nothing is hidden until you click one.
- **Comment threading**: a divider between conversations, a line down each reply chain, and a
  collapse button on any comment with replies.
- **Hyphenation**, which only applies if you also turn justified text on.

Anything that alters an author's words, such as collapsing a note or a shoutout, is opt-in,
and so is every rule that folds or hides a comment.

The options page is four boxes: which of Royal Road's two layouts to use, then one per part
of the site — fiction lists (including the hidden-fiction manager), fiction pages, and
chapter pages.

## Install

Not yet on addons.mozilla.org or the Chrome Web Store. Until then, install from source.

**Firefox** (temporary, until the browser restarts)

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

Royal Road serves two layouts, and everything here is built on the newer one, so on the
legacy layout the extension does nothing at all.

Pick **Always the new design** under *Royal Road design*, at the top of the extension's popup,
and it will hold on every page from then on — on the page you are looking at straight away, and
on later ones before they are painted. The same setting is first in the options page.

To go back, pick **Always the old design**. Leaving it on *Leave it to Royal Road* will not
undo an earlier choice: Royal Road remembers it in a cookie, and only actively asking for the
old design clears it.

Two things worth knowing. **It needs no account** — which layout you get is decided by a
cookie rather than by being signed in, so this works signed out. And **it is reversible**:
Royal Road's own "Revert To Legacy UI" link still works, though with "always use the new
design" switched on it will be undone on your next page load, so turn that off first.

If you would rather do it by hand, it is one cookie:

```js
document.cookie = 'beta-ui-v2=always; path=/; domain=.royalroad.com';
```

## How it works

A few decisions carry most of the weight.

**The expand features and the comment threading are pure CSS.** Royal Road's "show more" is a
`sr-only` checkbox plus Tailwind `:has(input:checked)` variants, with the collapsed height as
a *non-`!important`* inline style; and every comment already carries `data-depth` and
`data-parent-id`. So both are stylesheets gated behind an `<html>` class: no per-element
JavaScript, no observer, and they apply to lazily-loaded content for free.

**Hiding is generated CSS, not DOM removal.** `buildHideCss()` emits one rule per card group,
each a single `:has()` over an `:is()` list of ids, so rule count stays constant however many
fictions you hide. Doing it in CSS is what lets hiding reach content rendered after us: AJAX pagination, and the React-rendered recommendations carousel.

The rule matches `a[data-vt-trigger="fiction-card"]`, the card's own title link, rather than
any `/fiction/` link inside it. That distinction is load-bearing: author blurbs routinely
link to *other* fictions, and matching those would make hiding fiction A quietly delete every
card whose blurb recommends A.

**Hidden cards never flash.** `browser.storage.local` is async, which would race first paint.
Content scripts run in the page's origin, so a compact copy of the hidden list is mirrored
into `localStorage` and read *synchronously* at `document_start`, before Royal Road's deferred
module scripts run. That also means Embla never measures the carousel slides we are about to
hide, so `/home` carousels lay out correctly around them.

**Infinite scroll appends; Royal Road's own pagination replaces.** Comments and reviews both
use its `clientfetch` paginator, whose "next" swaps the list out, so page 20 leaves no way
back to comment 1. The shared `content/pager.js` fetches the same endpoint Royal Road
declares (`data-rr-paginate-fetch-url`) and appends instead, deduplicating by element id, and
hides Royal Road's own page numbers while it is running: leaving them visible let you click
"2" mid-run and land in the replace-the-list world with the two disagreeing about the page.

**Filters cannot do that**, because they need parsed numbers off each card. So they hold the
list back with `visibility` (not `display`, so no reflow) until the first pass lands, and
only when a filter is actually set, with a 1 s watchdog, because a page that never appears is
far worse than a brief flash.

**The multi-column layouts dissolve the card rather than squeeze it.** A Royal Road card is a
flex *row*: cover left, everything else in a narrow column right. Halve its width and that
column has no room. The title wraps every other word, stat tiles overlap, buttons get
crushed. Hiding parts of it did not help, and nor did swapping in the phone layout, because
both keep the row. So `display: contents` on the card's wrappers promotes cover, title, tags,
stats, blurb and buttons into direct children of one flex container, which can then be
ordered and given full width independently. No DOM is moved. Blocks are matched by what they
contain (`:has(> a > h2)` is the title) rather than by Tailwind classes.

**Personal state on a card uses three different mechanisms.** Read Later is a real form whose
`mark` input says what a click *would* do. Following and Favourited are passive tooltip-wrapped
icons that Royal Road omits entirely when unset, so their absence is the normal case rather
than a parse failure. Two logged-in fixtures pin both the present and the absent case.

**Card extraction is deliberately tolerant.** Anything unreadable becomes `null`, and a
filter never excludes a card on a `null` field. When Royal Road renames something, a filter
stops narrowing rather than emptying the page.

### Layout

```
manifest.json               the Firefox manifest; tools/build.mjs derives Chrome's
src/common/    browser · selectors · schema · model · cards · filters · css · store
src/content/   boot.js (document_start) · main.js · ui.js · panel.js · inject*.css
src/content/features/       one file per feature, registered on RRX.features.list
src/background/             15 lines, only so the toolbar can open the options page
src/options/ src/popup/     settings, hidden-fiction manager, JSON backup
tools/build.mjs             dist/firefox + dist/chrome
test/                       node:test suites + captured Royal Road HTML in fixtures/
```

Two files are deliberately the only place certain things live:

- **`src/common/selectors.js`**: every Royal Road selector. The site is actively changing;
  when something breaks it should break there and nowhere else. `main.js` also logs a warning
  naming the file if a list page stops matching.
- **`src/common/schema.js`**: every setting, declared once. One generic normalizer walks it,
  and the options page builds itself from it, so a setting cannot become unreachable.

### Adding a feature

Drop a file in `src/content/features/`, push a descriptor onto `RRX.features.list`
(`pages: ['chapter']` scopes it), and add it to `manifest.json`. If it is presentational,
gate it behind an `<html>` class in `rootClassesFor` and write CSS: see `view-modes.js`,
which is a descriptor and nothing else.

## Development

```sh
npm test      # node:test
npm run lint    # web-ext lint against the built Firefox tree: must be clean
npm run build   # dist/firefox + dist/chrome
npm run icons   # redraw icons/*.png
npm run package # both store zips into web-ext-artifacts/
```

The icons are generated rather than checked in as artwork. `tools/icons.mjs` draws each size
at its own scale, with the geometry snapped to whole pixels for that size, because a 16px
icon downscaled from a 128px master lands its edges on half pixels and turns into a smudge.
The shapes live in a 128-unit grid that divides evenly by all five sizes, nothing is thinner
than 16 units (two pixels at 16px), and every edge sits on a multiple of eight. It has no
dependencies: shape maths, and `zlib` for the PNG. `--design book` and `--design road` are two
alternative marks, kept so the icon can be changed without starting from nothing.

`npm test` runs four layers, none of which need a browser:

- **pure logic**: `schema`, `model`, `filters`: ~50 cases over settings coercion, the boot
  mirror, backups, and every filter including that a `null` field never excludes.
- **selectors**: string assertions that each hook still exists in the real captured HTML.
- **DOM**: `cards`, `dom`, `author-notes`: the real modules under jsdom against real pages.
  Hiding one fiction matches exactly one card; a near-miss id (`18130` vs `181303`) matches
  none; a blurb's outbound links cannot hide the card they sit in; the `/home` blog carousel
  is never hideable; the shoutout-only note collapses while the genuine note is untouched.
- **integration**: boots *every* content script, in the order `manifest.json` declares,
  against real list, chapter, fiction and legacy pages, and drives the UI: open the filter
  panel, apply, hide a fiction, check the counts.

Fixtures are gitignored (several MB, re-derivable). Suites that need them skip with a message
naming what is missing; `test/fixtures/README.md` documents how to re-capture each one.

## Known limitations

- **View modes are the least tested part.** The selectors are known-good, but these cards are
  built from dense Tailwind utilities and the layouts were verified by reading, not by eye in
  a browser. Two columns needs a window at least 1280px wide; below that it falls back to one
  column.
- **Forcing an accordion open races Royal Road.** It binds its handlers in a deferred script
  and then applies its own remembered state, sometimes closing a section the server sent
  open. The extension therefore watches for the full 8 s rather than stopping as soon as the
  state looks right, and re-asserts whenever it flips. A real click from you always wins, and
  ends the watching for good.
- **Carousel indicators.** Hiding a slide in a `/home` Embla carousel or the react-slick
  recommendations carousel leaves the dot count based on the original slide count. The slides
  themselves lay out fine.
- **Shoutout detection is a heuristic**: "a direct child block of the note that links to a
  different fiction". It cannot catch a shoutout with no link, and it will collapse a block
  that merely mentions another fiction in passing. Both cost one click on the chip.
- **Deep replies start collapsed.** Past depth 2, Royal Road moves the rest of a chain
  into a container it hides behind a "N more replies" button. The thread line and the
  collapse control follow the chain into it, but the button is Royal Road's and this
  extension does not click it for you.
- **The low-effort comment rules are a guess.** They fire on short comments that are nothing
  but an acknowledgement once the filler is stripped ("thanks", "tyfc", "cheers"), a position
  claim ("first"), or a single Royal Road emoticon. Anything with something else left in it
  survives, so "thanks for the chapter, but the pacing dragged" is safe. They dim rather than
  remove by default, and a dimmed comment opens on hover.
- **Fonts are local only.** Royal Road's security policy blocks loading font files from an
  injected stylesheet, so only families already installed on the machine work.
- **The tag vocabulary costs one request.** Opening the filter panel on a page without Royal
  Road's own tag `<select>` fetches `/fictions/search` once to learn the tag list, then caches
  it for a week. On the search page itself it is read from the page for free.
- **Settings changed with no Royal Road tab open** reach the synchronous boot mirror one page
  load late. The authoritative async read corrects it during that same load.
- **Royal Road has its own `hide`** bookmark, server-side and account-bound, reachable from a
  fiction page. This extension's hiding is separate: local, instant, works logged out, and
  exportable. The two do not know about each other.

## Privacy

Everything is stored on the device, in `browser.storage.local`. The extension has no
analytics and talks to no server other than royalroad.com. It makes three kinds of request,
all of them ordinary page loads you could make yourself: the `?page=N` fetch that adds the
next page of a list as you scroll, the same for comments and reviews, and a single request
for the tag vocabulary the first time you open the filter panel. It never writes to your
Royal Road account, and never reads your account pages.

See [PRIVACY.md](PRIVACY.md) for the full statement.

## Contributing

Bug reports and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for how to
run the tests, capture the fixtures they need, and where each kind of change belongs.

Issues: https://github.com/jmgpgit/royal-road-ui-improvements/issues

## Licence

[Mozilla Public License 2.0](LICENSE). You may use, modify and redistribute this, including
in commercial work; changes to the files in this repository must be published under the same
licence.
