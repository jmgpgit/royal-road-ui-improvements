# Contributing

Thanks for looking. Bug reports are as useful as patches, especially "Royal Road changed and
X broke", which is the way this extension is most likely to fail.

## What this extension will not do

Three rules decide what belongs here. A patch that crosses one will be declined however well
it is written, so it is worth reading them before building something.

**1. Nothing that costs an author their income.** Royal Road's writers are paid through the
page: Patreon, Ko-fi and PayPal links, the Support block, the site's advertising, and the
cross-promotion authors run for one another. No feature may strip any of that out, hide it by
default, or make it harder to find in the ordinary course of reading. Where a reader can
collapse something that happens to carry promotion — a shoutout inside an author note, say —
three things must hold: it is off until the reader turns it on, nothing is deleted, and a chip
always puts it back. Injected UI keeps clear of the site's ad slots, which is also why the
design switch lives in the popup rather than in the page.

**2. Nothing that spams Royal Road.** Their bandwidth is the cost of everything we add. Every
request must be one the reader could have made themselves by opening a page. Requests go one
at a time, never as a parallel fan-out, never on a timer, and never in the background: bulk
work is opt-in per fiction, throttled, resumable, abortable, and stops on the first 429 or 403.
Anything fetched is cached so the same page is not asked for twice. The current list is
short on purpose — list `?page=N`, comment and review fragments, the tag vocabulary once a
week, and the previous chapter for the recap — and adding to it is a decision rather than a
detail: `PRIVACY.md` and both stores' permission justifications change with it.

**3. Nothing leaves the device.** There is no server, no analytics, no telemetry, no crash
reporting, no third-party code and no remote script, stylesheet or font. Settings and the
hidden list live in `browser.storage.local`; caches live in the page's own storage; the only
host ever contacted is royalroad.com. Backup is a JSON file the reader saves themselves. `PRIVACY.md`
is written to be checkable against the source, so every claim in it names the file that implements it.

### The rest of what we already keep to

- **Never write to the reader's Royal Road account.** No follow, favourite, rating, comment,
  bookmark or site setting. Hiding a fiction is local to the extension, not Royal Road's own
  server-side hide.
- **Altering an author's words is always opt-in**, and `test/schema.test.js` fails if such a
  setting ships on.
- **Nothing is destroyed, only folded.** Collapsed notes, shoutouts and comments are one click
  from being back.
- **An author's own comments are never hidden**, and neither is any comment with replies under
  it — the replies would stop making sense.
- **Conservative defaults.** Most settings ship off or as "leave alone"; the handful that do
  something on first run are listed in `README.md` and each is one toggle away.
- **The reader's data is portable.** Everything the extension holds exports as JSON, and
  uninstalling takes it with it.
- **Inert rather than broken.** On the legacy layout the extension stops instead of guessing.
- **No remote code.** Every file ships in the package; fetched HTML is parsed and read for its
  text, never adopted as markup and never executed.
- **Unofficial, and says so.** No Royal Road branding, and nothing that implies affiliation.

## Getting set up

```sh
npm install
npm test           # the whole suite, no browser needed
npm start          # launches Firefox with the extension loaded
```

You need Node 20 or newer. There are two dependencies, `jsdom` and `web-ext`, and no build
step for the source: the files that ship are the files in `src/`.

## Reporting a bug

Please include the URL of the page, whether you are on the redesign or the legacy layout, and
which settings are on. If a list page has stopped working, the console will usually carry a
warning from `[rr-ui]` naming the file to look at.

Royal Road serves the redesign only when a cookie is set. To be sure which one you are on:

```js
document.cookie = 'beta-ui-v2=always; path=/; domain=.royalroad.com';
```

## The tests, and the fixtures they need

The suite runs against real captured Royal Road HTML. Those captures are **not** in the
repository: they are several megabytes, they go stale, and a raw capture contains a live
anti-forgery token. So a fresh clone runs the tests that need no fixture and skips the rest
with a message naming exactly what is missing.

To run everything, capture the pages yourself. `test/fixtures/README.md` lists each file, why
it is there, and the exact command. Two of them have to be captured while logged in, which is
noted there.

**Never commit a capture.** `test/fixtures/` is ignored wholesale for that reason. If you add
a fixture, strip its tokens first:

```sh
node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const p='test/fixtures/'+f;fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/(name=\"__RequestVerificationToken\"[^>]*?value=\")[^\"]*/g,'\$1REDACTED'))}" your-new-fixture.html
```

## Where things belong

The layout is deliberate, and two files carry most of the weight:

- **`src/common/selectors.js`** holds every Royal Road selector. Royal Road is actively
  changing this UI, so when it breaks it should break in one file. Do not put a Royal Road
  selector anywhere else.
- **`src/common/schema.js`** declares every setting once. The options page builds itself from
  it, and a test fails if a setting is added without somewhere to set it.

Beyond that:

- Anything purely visual should be CSS gated behind an `<html>` class from `rootClassesFor`,
  not JavaScript. It then applies to content Royal Road loads later for free.
- A new feature is a file in `src/content/features/` that pushes a descriptor onto
  `RRX.features.list`, plus a line in `manifest.json`. Scope it with `pages: ['chapter']`.
- Content scripts cannot be ES modules, so they are classic scripts sharing `globalThis.RRX`
  and the manifest order is load-bearing.

## Style

- Two-space indent, single quotes, semicolons, roughly 100 columns.
- British spelling in anything a reader sees.
- Comments should say **why**, not what, and should describe the code as it is rather than as
  it once was. If a comment would only make sense to someone who watched it change, rewrite
  it as a warning to the next person instead.

## Before opening a pull request

```sh
npm test
npm run build      # both browser trees
npx web-ext lint --source-dir=dist/firefox   # must be clean
```

Please add a test for anything that changes behaviour. If it depends on Royal Road's markup,
assert it against a fixture rather than a hand-built DOM, and say in the test which captured
page you saw it on: one page is a sample, never a guarantee.
