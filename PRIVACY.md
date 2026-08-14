# Privacy

**UI Improvements for Royal Road collects nothing, sends nothing, and has no server.**

This document is the privacy policy for the extension, and is written to be checkable against
the source rather than taken on trust. Every claim below names the file that implements it.

## What is stored, and where

Two things, both in `browser.storage.local`, which is local to your browser profile:

- **Your settings.** The list in [`src/common/schema.js`](src/common/schema.js) is exhaustive.
- **Your hidden fictions.** For each one: its Royal Road id, title, cover URL and the time you
  hid it, so the manager can list them. See [`src/common/store.js`](src/common/store.js).

A compact copy of both is mirrored into `localStorage` on royalroad.com. This exists only so
the extension can read your settings before the page paints, which is what stops hidden
fictions flashing up before they are hidden. It is the same data, on the same machine.

Nothing is stored anywhere else. There is no account, no sync, and no identifier of any kind.

## What is sent

The extension has no server. It never contacts any host except royalroad.com, and it makes
exactly three kinds of request, all of them ordinary page loads you could make yourself:

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

All three are GETs for public pages. None carries anything about you beyond the cookies your
browser would already send to royalroad.com.

## What it never does

- It never writes to your Royal Road account: no follow, no favourite, no rating, no comment,
  no bookmark, no setting. Hiding a fiction is local to this extension and is not Royal Road's
  own server-side "hide".
- It never requests your account pages (`/my/follows`, `/my/favorites`, `/my/readlater`).
  Everything it knows about what you follow is read from the page you are already looking at.
- It contains no analytics, no telemetry, no crash reporting and no third-party code.
- It loads no remote script, stylesheet or font. Nothing is evaluated that did not ship in the
  extension package.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `storage` | To save your settings and hidden list on this device. |
| `*://www.royalroad.com/*` | To read and restyle Royal Road pages. This is the whole extension. |

There are no optional permissions, and the host permission cannot be narrowed: the extension
has to run at `document_start` on the first page load, which is what prevents the flash of
unhidden content.

## Your data is yours

Options -> Backup exports everything the extension holds as a JSON file, and imports it back.
Removing the extension removes its stored settings with it. The `localStorage` copy described
above lives under royalroad.com rather than under the extension, so clearing site data for
royalroad.com is what removes that one.

## Changes

Any change to what is collected or sent will be reflected here in the same commit that makes
it, and called out in the release notes.

## Contact

Please open an issue: <https://github.com/jmgpgit/royal-road-ui-improvements/issues>
