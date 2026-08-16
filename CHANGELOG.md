# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org):
the patch number for fixes, the minor for new settings, the major for anything that changes
what an existing setting does.

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
