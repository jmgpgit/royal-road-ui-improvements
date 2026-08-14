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

module.exports = { DIR, has, read, need };
