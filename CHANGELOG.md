# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org):
the patch number for fixes, the minor for new settings, the major for anything that changes
what an existing setting does.

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
