# Privacy

**UI Improvements for Royal Road collects nothing, sends nothing, and has no server.**

This policy is written to be checked against the source rather than taken on trust. Every claim
below names the file that implements it.

## What is stored, and where

Seven kinds of thing, all in `browser.storage.local`, which is local to your browser profile:

- **Your settings.** The list in [`src/common/schema.js`](src/common/schema.js) is exhaustive.
- **Your hidden fictions.** For each one: its Royal Road id, title, cover URL and the time you
  hid it, so the manager can list them. See [`src/common/store.js`](src/common/store.js).
- **The fictions you marked as tried and dropped**, in the same shape and the same file: id,
  title, cover URL and the time you marked it. A separate list from the hidden one, and one a
  fiction only joins when you press the button.
- **Where you stopped reading, and which comments you have seen**, once you switch those on.
  For each chapter you have opened: its Royal Road id, its fiction's id, when you last had it
  open, how far down you were — as a paragraph number, not a scrolled distance — and the time
  of the newest comment you had seen on it. No chapter text, no comment text, no titles. The
  comment date is forgotten after 60 days by default, a reading position is deleted as soon as
  you finish the chapter, and the whole record goes once you have not opened that chapter for a
  year — whether or not either setting is still switched on. See
  [`src/common/model.js`](src/common/model.js) for the exact
  shape.
- **The public numbers on the fiction pages you open**, once you switch on "show what has
  changed since you last looked". For each fiction: its total and average views, followers,
  favourites, ratings, pages, chapters and star scores, and when they were read — twice, so there is something to
  compare today's against. These are Royal Road's own public totals, not anything about you, and the only thing
  the record says about you is that the page was opened. Two readings per fiction, and a fiction
  you have not opened for a year is dropped. Nothing is stored while the setting is off, and
  switching it off deletes what is already there. Nothing is fetched for it either: the numbers
  are read off the page you just opened. See
  [`src/content/features/fiction-stats.js`](src/content/features/fiction-stats.js) for the
  reading and [`src/common/model.js`](src/common/model.js) for the shape.
- **When the housekeeping last ran, and when you last pressed "forget my reading history"** —
  two numbers. The chapter records and the fiction statistics above are aged out once a day
  rather than only while the feature that fills them is switched on; the second number is how a
  Royal Road page learns to clear the `localStorage` copy below, which the options page cannot
  reach itself. Your hidden and dropped lists are not aged out at all; they stay until you remove
  them. See [`src/common/store.js`](src/common/store.js).
- **Royal Road's list of tags**, cached for a week so the filter panel does not refetch it. The
  options page reads the same cache, to name the tags you have given a colour; it never fetches
  it, so on a cold cache a tag colour is stored under its slug alone. This is Royal Road's own
  public vocabulary — "LitRPG", "Progression", and the rest — and says nothing about you.
  See [`src/content/tags.js`](src/content/tags.js).

A compact copy of your settings and the ids of your hidden and dropped fictions is mirrored into
`localStorage` on royalroad.com. This exists only so the extension can apply them before the page
paints: hidden fictions never flash up before they are hidden, dropped ones are dimmed from the
first paint. It is the same data, on the same machine — ids only, no titles.

With the previous-chapter recap switched on, the closing text of each chapter it reads is kept
in `sessionStorage` on royalroad.com, so that moving back and forth does not fetch the same
chapter twice. It is the page's own words, it belongs to that one tab, and it dies with the
tab. See [`src/content/features/recap.js`](src/content/features/recap.js).

With the chapter count switched on, the same place holds the list of chapter ids for each
fiction you have opened a chapter of, so the count costs one request per fiction rather than
one per chapter. Ids only: no titles, and nothing about you.
See [`src/content/features/chapter-meta.js`](src/content/features/chapter-meta.js).

With "come back to where you stopped" switched on, your place in the chapter you are reading is
also written to `localStorage` on royalroad.com as you scroll. Writing it straight to the
extension's own storage would mean rewriting the whole reading record every second or so; this
is the same paragraph number, and it is copied across when you leave the page.
See [`src/common/store.js`](src/common/store.js).

One cookie on royalroad.com is written, and only when you ask for it. Royal Road decides
which of its two layouts to serve you with a `beta-ui-v2` cookie, and this extension only
works on the newer one. Choosing **Always the new design** sets that cookie and reloads;
choosing **Always the old design** deletes it and reloads. On the default, *Leave it to Royal
Road*, the extension reads that one cookie to see whether anything needs doing and never
writes it. It records a preference about Royal Road's own appearance and nothing about you; it
is Royal Road's cookie, and Royal Road's own "Revert To Legacy UI" link overwrites it. The
extension writes no other cookie and reads no cookie except this one.
See [`src/common/design.js`](src/common/design.js).

Nothing is stored anywhere else. There is no account and no identifier of any kind.

Nor is any of it synced. `browser.storage.local` is not carried between devices, and the
extension never uses the `storage.sync` API that would. This is a choice about where your data
lives, not interference with your browser: Firefox Sync and Chrome sync work exactly as they
always did, and the extension neither reads nor affects them. Moving settings between machines
is done with Options -> Backup, a file you export and import yourself.

## What is sent

The extension has no server. It never contacts any host except royalroad.com, and it makes
exactly five kinds of request, all of them things the site itself asks for when you use it:

1. **Adding the next page of a list.** Reaching the bottom of a fiction list fetches the next
   page of that same list (`?page=N`) and adds it underneath. This is on by default, and any
   filter you have set is applied to what comes in.
   See [`src/content/features/list-loadmore.js`](src/content/features/list-loadmore.js).
2. **Adding the next page of comments or reviews.** The same idea, for the paginated comment
   and review lists, and only when you have switched those on.
   See [`src/content/pager.js`](src/content/pager.js).
3. **The tag vocabulary.** The first time you open the filter panel on a page that does not
   already contain Royal Road's tag list, it fetches `/fictions/search` once to learn the
   available tags, then caches them for a week.
   See [`src/content/tags.js`](src/content/tags.js).
4. **The previous chapter, for the recap.** With the recap switched on, opening a chapter
   fetches the chapter before it, once per tab session, and takes its closing paragraphs. This
   is off by default; while it is off nothing is fetched. It only ever follows the "previous
   chapter" link already on the page.
   See [`src/content/features/recap.js`](src/content/features/recap.js).
5. **The fiction's chapter list, for the chapter count.** With the count switched on, opening a
   chapter fetches `/fictions/chapterlist?id=…` once per fiction, to say which chapter of the
   fiction this is and how many come after it. This is the same request Royal Road's own
   "Select a chapter" dropdown makes when you open it, and it is about 3 KB for a hundred
   chapters. It is off by default; while it is off nothing is fetched.
   See [`src/content/features/chapter-meta.js`](src/content/features/chapter-meta.js).

Two of Royal Road's own controls also get pressed for you, and Royal Road then fetches for
itself: the "Load Comments" button, when comment auto-loading is on, and the review sort
dropdown, once you have chosen a default review order. Both fetch the lists in 2, at the same
addresses.

All five are GETs for public pages. None carries anything about you beyond the cookies your
browser would already send to royalroad.com.

## What it never does

- It never writes to your Royal Road account: no follow, no favourite, no rating, no comment,
  no bookmark, no setting. Hiding a fiction, or marking one as tried and dropped, is local to
  this extension; neither is Royal Road's own server-side "hide". The layout cookie described
  above is the one thing it writes that Royal Road can see, and it lives in your browser rather
  than against an account: it works, and is written the same way, whether or not you are signed
  in.
- It never requests your account pages (`/my/follows`, `/my/favorites`, `/my/readlater`).
  Everything it knows about what you follow is read from the page you are already looking at.
- It contains no analytics, no telemetry, no crash reporting and no third-party code.
- It loads no remote script, stylesheet or font. Nothing is evaluated that did not ship in the
  extension package.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `storage` | To save your settings, your hidden and dropped lists, your reading progress and the fiction statistics you have seen, on this device. |
| `*://www.royalroad.com/*` | To read and restyle Royal Road pages. This is the whole extension. |

There are no optional permissions, and the host permission cannot be narrowed: the extension
has to run at `document_start` on the first page load, which is what prevents the flash of
unhidden content.

## Your data is yours

Options -> Backup exports everything the extension holds — settings, hidden fictions, dropped
fictions, reading progress and the fiction statistics you have seen — as a JSON file, and
imports it back. Resetting the settings leaves your hidden fictions, dropped fictions and
reading progress alone, and deletes the fiction statistics: reset returns that setting to its
default, which is off. Options -> Backup also says how much reading history is stored and has
a button that forgets all of it: where you got to in every chapter, which comments you had
seen, and every fiction statistic. The `localStorage` copy of your place in the chapter you are
reading goes with it: at once in any Royal Road tab that is open, and otherwise on the next Royal
Road page you open.

Removing the extension removes everything under the extension. Three things are not under the
extension, because they have to be readable by royalroad.com's own pages, and they outlive it:

- **The two `localStorage` copies** described above — the settings-and-ids mirror, and your
  place in the chapter you are reading. The mirror is a full copy of your settings and of which
  fictions you have hidden and dropped.
- **The `beta-ui-v2` cookie**, if you chose a layout. It lasts a year, so Royal Road may go on
  serving you the design you picked after the extension that asked for it is gone. Royal Road's
  own "Revert To Legacy UI" link undoes it.

Clearing site data for royalroad.com removes all three, and takes the recap and chapter-list
caches with them — though those go when you close the tab in any case.

## Changes

Any change to what is collected or sent will be reflected here in the same commit that makes
it, and called out in the release notes.

## Contact

Please open an issue: <https://github.com/jmgpgit/royal-road-ui-improvements/issues>
