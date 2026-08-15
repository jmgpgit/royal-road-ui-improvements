# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org):
the patch number for fixes, the minor for new settings, the major for anything that changes
what an existing setting does.

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
