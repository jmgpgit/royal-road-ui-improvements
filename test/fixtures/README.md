# Fixtures

Real Royal Road HTML. `test/selectors.test.js` asserts every selector in
`src/common/selectors.js` against these, so a Royal Road markup change fails the suite
instead of silently breaking the extension, and the DOM and integration suites run the real
modules over real pages.

**None of these files are in the repository.** They are several megabytes, they go stale, and
a raw capture contains a live `__RequestVerificationToken`. `test/fixtures/` is ignored
wholesale. Suites that need a missing fixture skip themselves with a message naming it, so a
fresh clone still runs green on everything that does not need one.

Captured from build `4.1.20260807.38`.

## What each one is for

| File | Why it is here | Logged in? |
| --- | --- | --- |
| `fictions-rising-stars.new.html` | The canonical list page: 50 cards, all with blurbs, no pagination | no |
| `fictions-rising-stars.legacy.html` | The **old** UI, to prove the extension's selectors match nothing there | no |
| `fictions-latest-updates.new.html` | Cards with no blurb at all (recent chapters instead) | no |
| `fictions-weekly-popular.new.html` | 20 cards plus real pagination | no |
| `fictions-search.new.html` | Random-GUID paginate id, and a paginate widget that sits *after* the results | no |
| `home.new.html` | The three non-list card variants and the blog splash carousel | no |
| `fiction-detail.new.html` | Empty `<div id="recommendations">`: proof the recs carousel is React-rendered | no |
| `fiction-reviews.new.html` | The reviews accordion, its sort control and its paginator | no |
| `chapter.new.html` | A chapter: author notes, the author panel, the support block, the "Load comments" button | no |
| `chapter-comments.new.html` | A comments fragment, shallow: depths 0 and 1 only | no |
| `chapter-comments-deep.new.html` | 45 comments reaching depth 2, and no deeper | no |
| `chapter-comments-nested.new.html` | A thread nested to depth 6, with deep-reply holders | no |
| `card-loggedin.html` | A card with nothing marked: proof the status icons are absent, not missed | **yes** |
| `card-loggedin-marked.html` | A followed + favourited + completed card | **yes** |

### On the three comment captures

The first two stop at depth 2, and that is a property of those two pages, not of Royal Road.
Past depth 2 Royal Road stops using `.comment-replies` and puts the rest of a chain in a
`[data-rr-deep-replies]` holder that starts out `hidden` behind a "N more replies" button, so
a page can carry a six-deep argument and still look three deep at a glance.

Keep all three. Two of them have no deep-reply holder at all, which is the case the
deep-chain code has to survive.

### On the two logged-in captures

Following and Favourited render as passive status icons that Royal Road omits entirely when
unset. A capture of two unmarked fictions therefore shows nothing, which looks exactly like a
parse failure. The pair pins the present *and* the absent case, which is the distinction that
is easy to get wrong.

## Capturing

The redesign is served only when the `beta-ui-v2` cookie is set, so a plain fetch returns the
legacy UI. From PowerShell:

```powershell
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$s.Cookies.Add((New-Object System.Net.Cookie('beta-ui-v2','always','/','.royalroad.com')))
$r = Invoke-WebRequest -Uri 'https://www.royalroad.com/fictions/rising-stars' `
        -UseBasicParsing -UserAgent $ua -WebSession $s
$r.Content | Out-File 'test/fixtures/fictions-rising-stars.new.html' -Encoding utf8
```

Omit the session to capture the legacy page.

**Comment fragments** are loaded by AJAX and are not in the chapter HTML. Fetch the endpoint
the chapter declares in `data-rr-paginate-fetch-url`, which needs an AJAX header:

```powershell
$s.Headers = @{ 'X-Requested-With' = 'XMLHttpRequest' }
Invoke-WebRequest -Uri 'https://www.royalroad.com/fiction/chapter/<id>/comments?sorting=top' `
  -UseBasicParsing -UserAgent $ua -WebSession $s -Headers @{'X-Requested-With'='XMLHttpRequest'} |
  Select-Object -ExpandProperty Content |
  Out-File 'test/fixtures/chapter-comments.new.html' -Encoding utf8
```

**The two logged-in cards** cannot be produced by the recipe above. Open a list page in a
browser where you are signed in, find a fiction you have marked and one you have not, and
copy the outer HTML of each `.fiction-card-expanded` out of the devtools inspector.

## Redacting, every time

A capture carries a live anti-forgery token. Strip it before the file goes anywhere:

```sh
node -e "const fs=require('fs'),d='test/fixtures';for(const f of fs.readdirSync(d)){if(!f.endsWith('.html'))continue;const p=d+'/'+f;fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/(name=\"__RequestVerificationToken\"[^>]*?value=\")[^\"]*/g,'\$1REDACTED'))}"
```

The tests assert structure, never content, so redaction changes nothing they check. Card
counts are the one exception (50 on rising-stars, 20 elsewhere) and follow the page size
rather than which fictions happen to be listed.
