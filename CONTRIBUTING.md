# Contributing

Bug reports are as useful as patches, especially "Royal Road changed and X broke" — the way
this extension is most likely to fail.

## What this extension will not do

Three rules decide what belongs here. A patch that crosses one is declined however well it is
written.

**1. Nothing that costs an author their income.** Royal Road's writers are paid through the
page: Patreon, Ko-fi and PayPal links, the Support block, the site's advertising, and the
cross-promotion authors run for one another. No feature may strip that out, hide it by default,
or make it harder to find while reading. Where a reader can collapse something carrying
promotion — a shoutout inside an author note — three things must hold: off until they turn it
on, nothing deleted, and a chip that puts it back. Injected UI keeps clear of the ad slots,
which is why the design switch lives in the popup rather than in the page.

**2. Nothing that spams Royal Road.** Their bandwidth is the cost of everything we add. Every
request must be one the reader could have made by opening a page. One at a time, never a
parallel fan-out, never on a timer, never in the background. Bulk work is opt-in per fiction,
throttled, resumable, abortable, and stops on the first 429 or 403. Anything fetched is cached, so the same page is not asked for twice.
The list is short on purpose — list `?page=N`, comment and review fragments, the tag vocabulary
once a week, and the previous chapter for the recap — and adding to it changes `PRIVACY.md` and
both stores' permission justifications.

**3. Nothing leaves the device.** No server, no analytics, no telemetry, no crash reporting, no
third-party code, no remote script, stylesheet or font. Settings and the hidden list live in
`browser.storage.local`, caches in the page's own storage, and royalroad.com is the only host
contacted. Backup is a JSON file the reader saves. `PRIVACY.md` names the file behind every
claim it makes.

### The rest of what we already keep to

- **Never write to the reader's Royal Road account.** No follow, favourite, rating, comment,
  bookmark or site setting. Hiding a fiction is local, not Royal Road's own server-side hide.
- **Altering an author's words is always opt-in**; `test/schema.test.js` fails if such a
  setting ships on.
- **Nothing is destroyed, only folded.** Collapsed notes, shoutouts and comments are one click
  from back.
- **An author's own comments are never hidden**, nor any comment with replies under it — the
  replies would stop making sense.
- **Conservative defaults.** Most settings ship off or as "leave alone"; the few that act on
  first run are listed in `README.md`, each one toggle away.
- **The reader's data is portable.** Everything the extension holds exports as JSON;
  uninstalling takes it with it.
- **Inert rather than broken.** On the legacy layout the extension stops instead of guessing.
- **No remote code.** Every file ships in the package; fetched HTML is parsed and read for its
  text, never adopted as markup and never executed.
- **Unofficial, and says so.** No Royal Road branding, nothing implying affiliation.

## Getting set up

```sh
npm install
npm test           # the whole suite, no browser needed
npm start          # launches Firefox on royalroad.com, already on the redesign
npm start -- --legacy   # ...on the OLD layout instead, to test the design switch
```

Node 20 or newer. Two dependencies, `jsdom` and `web-ext`. No build step: the files that ship
are the files in `src/`.

`npm start` keeps its Firefox profile in `.dev-profile/` (gitignored), so you log into Royal
Road once, not every launch. The redesign cookie is a session cookie, so it is *not* kept: the
dev script re-sets it and reloads once on the first page of each run — the flicker you see.
`-- --fresh` gives a throwaway profile, for first-run behaviour. Other flags pass through to
`web-ext run`, so `npm start -- --devtools` works.

`-- --legacy` does the opposite: it removes the opt-in cookie so Royal Road serves the legacy
layout. That is the only way to test **Always use Royal Road's new design** from a profile
that has already opted in — which `.dev-profile` becomes after one ordinary launch. It clears
the cookie **once per tab**, deliberately: on every load it would fight the extension's own
switch, each undoing the other in a reload loop. So the first load is legacy, and what the
extension does next is yours to watch.

It runs from a generated copy of the tree in `dist/dev/`, not `src/`, because it adds one
dev-only content script that sets the cookie below. That script exists only in `dist/dev/` and
cannot reach a package; `tools/dev.mjs` explains why. Edits under `src/` mirror across live,
so the extension reloads as you save — but that re-registers content scripts without
re-running them in open tabs, so reload the page too.

## Reporting a bug

Include the page URL, whether you are on the redesign or the legacy layout, and which settings
are on. If a list page has stopped working, the console usually carries an `[rr-ui]` warning
naming the file to look at.

Royal Road serves the redesign only when a cookie is set. To be sure which you are on:

```js
document.cookie = 'beta-ui-v2=always; path=/; domain=.royalroad.com';
```

(`npm start` sets that for you; paste this in a browser you are only using to reproduce a
report.)

## The tests, and the fixtures they need

The suite runs against real captured Royal Road HTML. The captures are **not** in the
repository: several megabytes, they go stale, and a raw capture contains a live anti-forgery
token. A fresh clone runs the tests needing no fixture and skips the rest, naming what is
missing.

To run everything, capture the pages yourself. `test/fixtures/README.md` lists each file, why
it is there, and the exact command. Two must be captured while logged in; it says which.

**Never commit a capture** — `test/fixtures/` is ignored wholesale for that reason. If you add
one, strip its tokens first:

```sh
node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const p='test/fixtures/'+f;fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/(name=\"__RequestVerificationToken\"[^>]*?value=\")[^\"]*/g,'\$1REDACTED'))}" your-new-fixture.html
```

## Where things belong

Two files carry most of the weight:

- **`src/common/selectors.js`** holds every Royal Road selector. Royal Road is actively
  changing this UI, so when it breaks it should break in one file. Put a Royal Road selector
  nowhere else.
- **`src/common/schema.js`** declares every setting once. The options page builds itself from
  it, and a test fails if a setting is added with nowhere to set it.

Beyond that:

- Anything purely visual is CSS gated behind an `<html>` class from `rootClassesFor`, not
  JavaScript. It then covers content Royal Road loads later for free.
- A new feature is a file in `src/content/features/` that pushes a descriptor onto
  `RRX.features.list`, plus a line in `manifest.json`. Scope it with `pages: ['chapter']`.
- Content scripts cannot be ES modules, so they are classic scripts sharing `globalThis.RRX`
  and the manifest order is load-bearing.

## Style

- Two-space indent, single quotes, semicolons, roughly 100 columns.
- British spelling in anything a reader sees.
- Comments say **why**, not what, and describe the code as it is rather than as it once was.
  If a comment would only make sense to someone who watched it change, rewrite it as a
  warning to the next person.

## Before opening a pull request

```sh
npm test
npm run build      # both browser trees
npx web-ext lint --source-dir=dist/firefox   # must be clean
```

Add a test for anything that changes behaviour. If it depends on Royal Road's markup, assert
against a fixture rather than a hand-built DOM, and name in the test which captured page you
saw it on: one page is a sample, never a guarantee.
