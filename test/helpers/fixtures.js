'use strict';

/**
 * Fixture access for the suites that run against real Royal Road HTML.
 *
 * The captures are gitignored (several MB, and re-derivable: see
 * test/fixtures/README.md), so a fresh clone has none of them. Rather than
 * failing, those suites skip with a message naming what is missing and how to
 * get it. The pure-logic suites never touch this and always run.
 */

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'fixtures');

const cache = new Map();

const has = (name) => fs.existsSync(path.join(DIR, name));

/** Memoised: several suites read the same 1.8 MB capture. */
function read(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(DIR, name), 'utf8'));
  return cache.get(name);
}

/**
 * A node:test `skip` value: `false` when every named fixture is present,
 * otherwise a reason string naming the absent ones.
 */
function need(...names) {
  const absent = names.filter((name) => !has(name));
  if (!absent.length) return false;
  return `missing fixture(s): ${absent.join(', ')}: see test/fixtures/README.md to re-capture`;
}

/**
 * Every number a fiction page shows, read from its raw HTML by position rather
 * than by the label-first walk the extension does, so a recapture moves the
 * expectation with the page. A tile is `<span>33,805</span> <span>Followers</span>`
 * (Pages wraps its label in a div, for the help tooltip); a score is its
 * heading, then its tooltip's "4.68 out of 5".
 */
function fictionFigures(html) {
  const num = (match) => (match ? Number(match[1].replace(/,/g, '')) : NaN);
  const tile = (label) =>
    num(new RegExp(`>([\\d,]+)</span>\\s*(?:<div[^>]*>)?<span[^>]*>${label}</span>`).exec(html));
  const score = (label) =>
    num(new RegExp(`>${label}</h[34]>[\\s\\S]*?>\\s*([\\d.]+) out of 5\\s*<`).exec(html));
  return {
    v: tile('Total Views'),
    w: tile('Avg\\. Views'),
    f: tile('Followers'),
    m: tile('Favorites'),
    r: tile('Ratings'),
    p: tile('Pages'),
    s: score('Overall Score'),
    sty: score('Style'),
    sto: score('Story'),
    gra: score('Grammar'),
    cha: score('Character'),
    c: num(/id="chapters"[^>]*data-chapters="(\d+)"/.exec(html)),
  };
}

module.exports = { DIR, has, read, need, fictionFigures };
