# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org):
the patch number for fixes, the minor for new settings, the major for anything that changes
what an existing setting does.

## 1.5.2

**Fixes**

- **The options page stays where you left it in Chrome.** It rebuilt its whole form after every
  write, so the control you were using was destroyed and replaced mid-change — and Chrome uses
  the focused element to decide where to hold the page, so it nudged upwards each time you
  changed a setting. The form is built once now and the controls are updated in place.
- **The popup waits for Chrome before closing itself.** Opening the settings page returns a
  promise there, so the window could shut before the request had been accepted, and a refusal
  went nowhere. It now stays open long enough to be sure, and says so if it fails.

**Elsewhere**

- Both the options page and the popup show which version you are running, read from the
  extension itself. Worth having when it is the one thing you cannot tell by looking — after a
  store update, or with a copy you installed yourself sitting alongside a listed one.

## 1.5.1

**Fixes**

- **The cover grid lines up again when you follow or favourite things.** Royal Road puts those
  two icons in the same row as the title, and this view takes that row apart so the buttons,
  cover, rating and title can be placed independently — but the icons were never given a place,
  so they landed above everything and pushed the whole tile down. Only marked fictions have them,
  so only some covers moved, which is what made a grid of them look shuffled.
- The icons now sit on the tile's own edge, stacked, over the border and the gutter rather than
  over the cover: a view made of pictures should not spend the pictures on badges.

## 1.5.0

**Tried and dropped**

- Mark a fiction you gave a go and stopped. Its card dims and is labelled Dropped wherever it
  turns up, but stays in the list and stays clickable: hiding already answers "never show me
  this again", and a mark you cannot click through is no use for changing your mind.
- On by default, beside hiding, which has shipped on since 1.0. The two are the same gesture on
  the same card and the difference is only whether you might change your mind, so shipping one
  and hiding the other meant the pair was found only by going looking in options. The whole cost
  is a second button: nothing is marked, recorded or fetched until you press one. It is still its
  own switch, so the button can go without taking hiding with it.
- Dropped joins follows, favourites and read later as a chip in the filter panel's "Hide mine",
  for when you do want them out of the way.
- Its own manager in options, searchable and clearable, beside the hidden one, and exported and
  imported with everything else. A separate list from the hidden one, because a fiction can be
  on both and the two answer different questions.

**What has changed since you last looked**

- Royal Road only ever prints today's total, so "32,866 followers" cannot say whether a fiction
  is climbing or has gone quiet. Each figure on a fiction page now carries the change since your
  last visit — `(+312)`, `(−2)`, `(+0.02)` — across the six stat tiles and all five star ratings,
  and the Statistics header sums it up while that section is shut.
- No request: the numbers are already on the page you opened. Two readings per fiction are kept,
  so a reload repeats the same answer rather than erasing the delta you just read. Twelve hours
  between visits rolls the baseline forward, and nothing is measured against a reading more than
  a week old — visits closer together than that used to chain into one look that never ended.
- Nothing on a first visit, and nothing when nothing moved. Off by default: nothing is recorded
  while it is off, switching it off deletes what it recorded, and a fiction you have not opened
  for a year is dropped.

**Every tag on a card**

- Royal Road folds all but the first few tags behind a `+`. Two settings open them without the
  click: on the lists, while the pointer is over the card or always; on a fiction's own page,
  always. Cards get taller, so both ship off.
- Pure CSS, and Royal Road's own `+` goes on working underneath — a row that opened on hover can
  be pinned open, and one that opened on its own can be closed.
- The `+` goes where it has nothing left to reveal, on a fiction page as well as on the lists.
  It stays on hover, where pressing it is the only way to keep the row open once the pointer
  leaves.

**Tag colours**

- Give a tag a colour and it carries it everywhere it appears: the fiction lists, a fiction's own
  page, and — behind its own switch — the home page. Only the tags you pick; every other tag is
  left as Royal Road styles it, and picking none means no stylesheet at all.
- The text colour is computed from the background you chose, because a dark pick otherwise keeps
  Royal Road's own light-on-dark chip text and the tag becomes unreadable at exactly the moment
  you marked it to stand out.
- The home page writes its tags as plain chips with no slug on them, so there they are matched by
  name — and the name comes from Royal Road's own tag list. A colour chosen before that list has
  been cached is stored with the slug alone and still works on the lists and fiction pages; the
  options page fills the name in as soon as it has both halves, and the tag starts colouring on
  the home page too.
- The editor is its own card in options, beside the two fiction managers, and the colours are
  settings: exported, imported and reset with everything else.

**Filters that say what they are doing**

- **A list filtered down to nothing now says so.** An empty list looks exactly like a page that
  genuinely has no matches.
- **A tag in "must have" and "must not have" at once** can never match anything, and the empty
  list it produces reads as a filter that is merely strict. The panel says so, in the Tags group
  where both lists are. It checks on open too: a saved filter can already contradict itself
  before you type anything.
- **Your own Global Filters get a mention** after four pages in a row that match nothing. They
  are yours, set on Royal Road, and Royal Road applies them before serving the list — so a filter
  here that looks broken may be working correctly on what is left. Read off the badge on Royal
  Road's button; the button itself is there signed out, so its presence proves nothing.
- Infinite scroll no longer walks to its 25-page ceiling on a list where nothing matches, and
  Royal Road's own page numbers no longer disappear along with it, which used to leave an empty
  list with no way on at all. The scan ahead stays: a match can be on page five, and giving up on
  the first empty page would guarantee never finding it.

**The recap names its chapter**

- "Previously" now says which chapter it is previously *of*, beside the label. Not remembering
  how the last chapter went is the whole reason the recap is there, so leaving the reader to work
  out which one it was asked the one thing they cannot answer.
- It costs no request: the recap already fetches that page, and this reads its title on the way
  past. A chapter whose name cannot be read shows the label alone — a wrong name would be worse
  than none, and the recap itself is unaffected either way.

**Your reading history**

- Options -> Backup says how much is stored and has a button that forgets it: where you got to
  in every chapter, which comments you had seen, and every fiction statistic. Hidden and dropped
  fictions each have a manager; the half you accumulate by reading rather than by choosing could
  not be seen at all, and the only way to be rid of it was to uninstall.
- A chapter record now goes once you have not opened that chapter for a year, whether or not the
  settings that wrote it are still on. Both expiries lived inside their own write path, so
  switching reading positions or seen comments off stopped the pruning along with the writing,
  and whatever had accumulated stayed for good. Housekeeping runs once a day from any Royal Road
  page.

**The options page**

- Reordered on one rule: a setting sits beside the thing it changes, in the order you meet it.
  Box order already did that; inside the boxes it was mostly the order the features were built.
  Comments becomes its own box — chapter pages carried 26 of the 51 rows, 13 under a single
  heading. No box now holds more than 16, and no group more than 7.
- Headings that did not predict what was under them are gone. The toolbar switch was filed under
  "Descriptions and layout"; infinite scroll under "Filters"; "show what has changed" under a
  heading identical to the label of the row three lines above it.
- Every row is one shape now: label left, control right, note beneath. Three different geometries
  shared the name, so no two kinds of setting lined up down the page. A note longer than about
  three lines clamps and opens on click.
- Each of the two fiction managers moved beside the switches that fill it, instead of both being
  appended after every group in the box.
- A strip of links across the top, one per box.
- The note under a checkbox used to be part of the checkbox's own accessible name — 427
  characters of it, in one case, read out before the control itself. The notes under the other
  three kinds of row were associated with nothing at all. Both fixed, and a disabled row keeps
  its note readable rather than fading it with everything else.
- The two comment-pattern rows say "regular expression" in their labels, where the note beneath
  was the only thing that mentioned it.
- The buttons that open this page — in the popup and on the in-page toolbar — name all three
  things behind it: the hidden list, the tried-and-dropped list, and forgetting your reading
  history. Naming one of the three is how the other two stay undiscovered. Neither uses Royal
  Road's own "favourites" or "read later" wording, so neither can be read as a claim that the
  extension reaches your account pages.

**The popup**

- **The maximum list width is a slider here too**, beside Layout, which is the setting it
  qualifies. Unset it parks at the low end and reads "default", the same way the two reader
  widths already do.
- **"Show every tag on a card" joins it.** Which tags a card shows is a decision you make while
  scrolling a list, and the popup is where the list settings you change mid-scroll live.

**Fixes**

- **Both colour settings can be set from the options page again.** "Text colour" and the comment
  thread colour were listed in their groups, had a label and a note, and rendered no control at
  all: the row builder dispatches on a setting's type and quietly built nothing for a type it did
  not know. The only way to set either was to export a backup, edit the JSON and import it back.
  A test now walks every setting the page claims to show and fails on one whose type has no row.

- **The tag filters offer every tag, not the first eight.** Opening "must have tags" listed eight
  of about seventy, alphabetically, which reads as a list that failed to load. The picker asked
  for eight matches, which is right while typing and wrong before it. Its menu already scrolled.
- **And every tag Royal Road has, not the ones that happened to scroll past.** The list was taken
  as complete once it held 72 entries — but a single Rising Stars page carries 73 tags on its
  cards, so a busy page passed for the whole vocabulary and the real list was never fetched. A
  rare tag simply could not be typed, and a reader with Royal Road's global filters set saw fewer
  still. The 22 genres are in it now too: they are a separate thing on Royal Road, and not on the
  cards, where "Fantasy" is a chip that filters exactly like any tag.
- Tag names are also learnt from the pages you already have open, which costs no request at all —
  a fiction list carries a few hundred tag links. Before this, nothing learnt a single tag name
  until the filter panel was opened, which many readers never do; and until a name is known, a
  tag colour cannot reach the home page, where the chips carry no tag id to match on.
- **Enter in an empty tag field no longer adds a tag.** With nothing typed it took the head of
  the catalogue and added it — and Enter in a filter field is exactly what you would press
  meaning "apply".
- **"Forget my reading history" now reaches the copy the options page cannot.** Where you are in
  a chapter is written to royalroad.com's own storage as you scroll, which only a page script can
  clear, so forgetting was delegated to whichever Royal Road tab happened to be open. With none
  open, the daily housekeeping was the backstop — and it deliberately keeps anything written in
  the last day, so a position could outlive the press by two days and then be handed back. The
  press is stamped, and every Royal Road page acts on a stamp it has not seen.
- **Re-sorting comments or reviews no longer stops infinite scroll.** Royal Road refetches page
  one and swaps the list, taking every page appended under it, while our counters went on
  believing the run was deep in the list and already finished — so nothing further loaded and
  the rest of the comments were simply gone. The run now restarts from the sort control itself:
  what was appended is cleared, Royal Road's page numbers come back until there is something to
  hide again, and loading resumes where you are rather than waiting for you to scroll to the
  bottom of a list one page tall.
- **The next page is fetched in the order you are actually looking at.** Royal Road's paginator
  reads its fetch URL once, when it starts, and a re-sort updates its own copy without ever
  writing that URL back — so from the first re-sort onwards the page advertises an order nobody
  is looking at. Asking for page two of it returned rows already on screen, which deduplicated
  away to nothing and ended the run. The order now comes from the control you used. A default
  review sort of your own travels the same path, instead of being forced onto every page long
  after you had picked something else.
- **Infinite scroll carries on from the page you are on.** It always started at page two:
  arriving on page five through Royal Road's own pagination fetched page two and appended the
  middle of the list underneath, and arriving on page two refetched what was already on screen
  — every row a duplicate, nothing added, and the run over before it began.
- **A review no longer goes missing when the list is reordered.** The duplicate check compared
  an arriving item's id against every id in the container — a reply tree, a tooltip, a rating
  widget — so any collision dropped that item with no trace. Twelve reviews before the reorder,
  eleven after. Item ids are compared against item ids now.
- **"Where I stopped reading" and "which comments I have seen" stop recording the moment you
  switch them off**, in the tab you switched them off in. Their handlers are attached once and
  never removed, so until the next page load scrolling went on writing positions and leaving the
  page went on moving the comment watermark. Both settings promise nothing is recorded while
  they are off, and that held on the next page load but not in the tab where it was asked for.
- **The cached tag list refreshes weekly again.** Its week ran from the last write of the cache,
  and a read writes the cached copy straight back — so anyone who opened the filter panel more
  often than weekly never refreshed it, and it only aged while it went unused. The clock now
  runs from the fetch.

**Privacy policy**

- Names seven kinds of stored thing rather than four: the dropped list, the fiction statistics,
  and the two numbers saying when housekeeping last ran and when you last pressed forget.
- Says what uninstalling does not remove. Three things live under royalroad.com rather than
  under the extension, because its own pages have to read them: the `localStorage` mirror, your
  place in the chapter you are reading, and the layout cookie — which lasts a year, so Royal
  Road can go on serving the design you picked long after the extension that asked for it is
  gone. Royal Road's own "Revert To Legacy UI" link undoes it.
- The mirror is described for what it is: a full copy of your settings, plus the ids — no titles
  — of your hidden and dropped fictions.

## 1.4.2

Shorter prose, nothing else. No behaviour changed and no setting moved.

- Comments across `src/` cut from 2,497 lines to 1,701, about a third. What went was padding:
  scaffolding sentences, the same point made twice, and blocks longer than the function they
  sat above. What stayed was every reason a thing is done a particular way, every past bug worth
  not repeating, and everything learned by reading Royal Road's real markup — those cost hours
  to work out again.
- `README.md`, `CONTRIBUTING.md`, `TODO.md` and `PRIVACY.md` given the same treatment, more
  gently: about 350 words, with every measured figure, file path, link and enumerated claim
  intact. `PRIVACY.md` deliberately barely moved. It doubles as the policy both stores link to,
  where the enumeration is the claim.
- One error fixed on the way through: a reference to `src/common/model.js` in `PRIVACY.md` had
  been dangling under the tag-cache bullet instead of the reading-progress one it documents.

## 1.4.1

**Fixes**

- The scratchpad that holds your reading position kept the newest 300 chapters — except it
  never actually sorted them. It compared a field no writer has ever set, so every comparison
  came out equal and the cap dropped the *lowest chapter id* rather than the oldest entry. The
  cap always worked, which is why this stayed hidden: it kept 300 chapters, just not the right
  300.
- **"Remember which comments I have seen for N days" was honoured on one path and ignored on the
  other.** Leaving a chapter prunes the whole record, and that write did not carry your setting,
  so it pruned at the built-in 60 days no matter what you had chosen.
- **Scrolling a chapter is much cheaper.** Reading your position forces the browser to lay the
  page out, and it ran on every single scroll event — rebuilding the chapter's entire text each
  time, about 12 KB, purely to count its length. It now runs once per frame, and the length is
  measured once per chapter.
- **The comments bar no longer crowds Royal Road's Post button.** It sits at the top of the
  comment pagination block, directly below the editor, and its controls are right-aligned — so
  Unfold landed a few pixels under Post, two blue buttons in a column reading as one on top of
  the other. It now clears it.
- **Hidden comments have a way back.** Hiding removes a comment from the page outright, so
  unlike folding there is no dimmed line left to hover — and nothing offered a way to see them.
  The comment count was annotated "(N hidden)" and that was the end of it. The bar now offers
  **Show hidden** whenever anything is being hidden, named for the half you cannot see. It
  appears on a chapter you have already read, where nothing is new and nothing folds, and it
  appears when a later page of comments brings the first hidden one — the case infinite scroll
  makes ordinary.
- Royal Road's page numbers no longer reappear under a list that is still being appended to.
  They were hidden once, at the end of a load, and anything that re-rendered the pagination took
  that with it — after which nothing put them back, since only a load ever hid them and once
  every page was in there were no more loads. It is now re-applied as the pager checks.
- Reloading a chapter straight after reading its comments no longer folds them all. Reading is
  what sets the watermark, so a reload a moment later is technically right to call them seen —
  and collapsing the page somebody is still looking at is no use to them. A reload within
  fifteen minutes counts as the same sitting: anything genuinely new is still marked, nothing
  folds, and coming back tomorrow behaves as it always did.
- The comments bar no longer says "Comments older than 1 Jan 1970 are folded" on a chapter you
  have never opened. There is no previous visit to date it from, so it does not try.
- "thanks for the meal" and its relatives fold. So do "for the story" and "for the tale".
- An emoticon no longer rescues a comment from the filter. Punctuation is stripped to spaces,
  so ":D" left a bare "d" behind and "Thanks for the chapter! :D" stayed while the same comment
  with ":)" folded. `:P`, `xD`, `<3`, `:3` and `^^` are handled the same way.
- **"4" is read as "for" in the acknowledgement filter**, so `t4tc` and `ty4tc` fold alongside
  `tftc` and `tyftc`. `tyvm` and `thanx` are recognised too. Catching one spelling and not its
  obvious twin looked arbitrary to whoever wrote it.
- **"Unfold" now unfolds everything, as it always claimed to.** Two separate things fold
  comments — the ones you have already read, and the low-effort ones like "tftc" — and the
  button only ever cleared the first, so pressing something labelled "show every comment in
  full" left half of them collapsed. It is also offered now whenever anything is folded, rather
  than only when something was folded for having been read.
- **The previous-chapter recap's cache no longer grows without limit.** It kept every chapter it
  fetched for the life of the tab, in a storage budget shared with Royal Road itself. Once full,
  every further write failed silently and the recap refetched the same chapters for the rest of
  the session. It now keeps the 40 most recent and drops the oldest to make room.

**Privacy policy**

- Says four things are stored, which is the true number: the tag list Royal Road publishes was
  cached but never documented. It is Royal Road's own public vocabulary and says nothing about
  you.
- Says plainly that nothing is synced and, just as importantly, that this is a choice about
  where your data lives rather than any interference with Firefox Sync or Chrome sync, which
  work exactly as they always did.

## 1.4.0

**Comments**

- Comments that have arrived since your last visit are marked with a "New" badge and an accent
  down the edge, and — if you want — everything you have already seen collapses to one dimmed
  line that opens again on hover. Nothing is
  ever hidden: a comment you have read is not one you asked to have removed, and the new reply
  may be underneath it.
- A comment stays open whenever there is anything new anywhere below it, so a new reply never
  arrives inside a folded conversation. One with a reply box open in it is left alone too.
- Royal Road ranks its comments rather than ordering them by time, so there is no "new from
  here" line — it would land in an arbitrary place. Each comment is judged on its own
  timestamp instead.
- A bar above the comments says how many are new and since when, folds everything else out of
  the way, or marks the lot as read.
- Your last visit is only recorded once the comments have actually been on screen for a few
  seconds, and it is set to the newest comment on the page rather than to the current time —
  so a comment posted while the tab sat open, or a second page you never loaded, is not
  written off as read.
- This compares when a comment was posted against when you last had the chapter open. It does
  not follow which comments you actually read, so an older one further down a ranked list
  counts as read whether or not you scrolled to it — the setting says so plainly.
- Forgotten after 60 days, which you can change. A chapter you come back to much later shows
  its comments afresh, and it stops the one cumulative thing here — one date per chapter —
  growing without limit.
- The bar above the comments appears when there is something new, or when comments have been
  folded — in which case it says so and gives the date it is folding from, with an Unfold
  button for reading the lot. That date is the newest comment that was there when you last
  read the chapter, which is what everything else is measured against, and is usually a little
  earlier than the visit itself. It says nothing on a first visit, and nothing when there is
  nothing to report. How many comments your own rules hid is added to Royal Road's own
  "showing 31 to 40 of 137 comments" instead.
- Off by default. Nothing is recorded while it is off.

**Fixed**

- Reading a chapter's comments, moving on to the next chapter and coming back no longer showed
  the whole conversation as unread again. Finishing a chapter forgot where you were in it, and
  took the record of which comments you had seen with it: they share one record, and only the
  reading half should have gone.
- Which comments you had seen is now recorded as soon as you have looked at them, rather than
  as the page is being closed — a write started that late often never finished.

## 1.3.0

**Chapter facts**

- When a chapter was posted, above it. Royal Road prints this below the chapter, past the
  author notes and the About-author panel, which is the one place it cannot answer "how old is
  this?" before you start reading. Whatever dates Royal Road shows are mirrored, so if a
  chapter ever carries an edited date that appears too.
- How long the chapter is: a word count, an estimated reading time, or both. Counted from the
  chapter text alone, so author notes and comments are not included, and the estimate uses a
  reading speed you can set.
- How many chapters you have left: which chapter of the fiction this one is, and how many come
  after it. Royal Road already knows — its own "Select a chapter" dropdown numbers them — but it
  ships that dropdown empty and only fills it when you open it. This asks for the same list,
  once per fiction, and keeps it for the tab.
- All three are off by default. The first two read what Royal Road already sent; the third is
  the only one that fetches anything, and it fetches nothing while it is off.

**Coming back to a chapter**

- Where you stopped reading, remembered: reopening a chapter either offers to take you back to
  the paragraph you were on, or takes you straight there. Off by default, and nothing is
  recorded while it is off.
- How far through you are is measured against the chapter text itself, not the page, so the
  comments loading underneath it neither hold you short of the end nor push you past it.
- Nothing is remembered before you reach the chapter text or after you have read to the end of
  it, and moving on to the next chapter forgets the one behind you — but only when you got
  there through Royal Road's own next-chapter link, so opening chapter 40 from the contents
  does not lose your place in 39.
- The position is a paragraph, not a scroll distance, so it survives the recap arriving late,
  a different window width, and your own font and width settings. If the chapter has been
  rewritten since, it says so rather than claiming the same place.

**Under the hood**

- Everything the extension puts above a chapter now shares one strip, ordered by declaration
  rather than by whichever finished first. The recap is fetched, so before this the reading
  order depended on whether it came from the cache.

## 1.2.0

**Royal Road's two layouts**

- Royal Road serves an old layout and a new one, and this extension only works on the new one:
  on the old one it does nothing at all, with nothing to say why. There is now a choice of
  layout at the top of the extension's popup, and first in its options: leave it to Royal Road
  (the default, which changes nothing), always the new design, or always the old one.
- Choosing a layout applies to the page you are looking at straight away, and to every page
  after that before it is painted. It is re-applied on every load rather than only when you
  change it, so a hard refresh lands on the layout you asked for and Royal Road cannot quietly
  put you back.
- Three states rather than a switch, because Royal Road remembers your choice in a cookie: "I
  have not chosen" and "put me back on the old one" are different things, and only the second
  can undo an earlier opt-in. A switch that merely turned off would leave you on the new design
  for ever with no way back.
- Always the old design is a real option, and it stops the rest of the extension working. That
  is the point: wanting the old layout back is a legitimate thing to want.
- Switching needs no account — the layout is decided by a cookie, not by being signed in, so
  this works signed out.
- No new permission: the cookie belongs to royalroad.com, whose pages the extension can
  already read.

## 1.1.0

**Chapters**

- A recap of how the previous chapter ended, at the top of this one: always visible, behind a
  click, on hover, or off. Off by default, and while it is off nothing is fetched. When it is
  on, the chapter before is fetched once and kept for the tab, so reading forward costs one
  request per chapter and going back over chapters costs none. The recap is the author's words
  as text: no images, no scripts, no end-of-chapter shoutouts. Its length is adjustable, and
  a chapter ending on a line of asterisks does not spend a paragraph on it.

**The popup**

- The popup now shows the controls for the kind of page it was opened over, rather than every
  section at once. It reads the page type from the active tab with the same function the
  content script uses, so the two cannot disagree, and it says so plainly when you are not on
  Royal Road instead of offering dead controls. No new permission: the tab's URL is already
  readable for a tab the extension can reach.
- Turning filters off, and the list toolbar on, are both in the popup now. A list filtered
  down to nothing with the toolbar switched off had no way back except the options page.
- Expand all, hover expand and hiding have gone from the popup, and are still in options. The
  first two are one click away on the toolbar, on the only page they affect; the third is set
  once.

## 1.0.0

First public release.

**Fiction lists**

- Expand every description, or expand one on hover after a settle delay.
- Hide a fiction from every list, permanently, with an undo, a browsable manager and an
  in-place "show hidden" mode.
- Filters Royal Road does not offer outside its search page: rating, followers, views, pages,
  chapters, tags in and out, status, type, last updated or gone quiet, and hiding what you
  already follow, favourited or saved for later.
- Infinite scroll: reaching the bottom adds the next page underneath.
- Alternative layouts: compact rows, two columns, or a cover grid.
- An adjustable maximum list width, and trimming bracketed tags out of titles.

**Chapters**

- Line height, justification with hyphenation, text colour, a local font, and a reading width
  past Royal Road's ceiling.
- Collapse cross-promotion inside author notes, or whole notes, per author. Nothing is
  deleted: a chip always puts it back.
- Hide the About-author panel.
- Comment threading: a divider between conversations at an adjustable strength, a thread line
  down each reply chain, and a collapse control on any comment with replies.
- Fold or hide low-effort comments: acknowledgements, position claims, lone emoticons, and
  your own patterns. The author's own comments are never hidden.
- Infinite scroll for comments.

**Fiction pages**

- Force each section open or closed, choose the default review sort, and load reviews as you
  scroll.

**Everything else**

- Settings, hidden fictions and a JSON backup, stored on the device and nowhere else.
- Firefox and Chrome from one source tree.
