#!/usr/bin/env node
'use strict';

/**
 * Emits dist/firefox/ and dist/chrome/ from the one source tree.
 *
 * The checked-in manifest.json is the *Firefox* manifest, deliberately: it can be
 * loaded straight from the repo root with `web-ext run` and lints clean. Chrome's
 * only differences are mechanical, so they are applied here rather than
 * maintained as a second manifest that would drift:
 *
 *   - background.scripts (Firefox event page) -> background.service_worker
 *   - browser_specific_settings dropped (Gecko-only; Chrome warns on it)
 *
 * No bundling, no transforms. The extension is plain classic scripts by design,
 * so "building" is a copy plus a manifest rewrite.
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/**
 * Everything that ships. Anything not listed here stays out of the package, so
 * tests, fixtures, tooling and node_modules cannot reach a store upload.
 *
 * LICENSE is included because the extension is redistributed under it, and both
 * stores show the packaged contents to reviewers.
 */
const PAYLOAD = ['src', 'icons', 'LICENSE'];

/** @param {object} manifest the Firefox manifest, already parsed */
function toChrome(manifest) {
  const next = structuredClone(manifest);
  delete next.browser_specific_settings;
  const [worker] = manifest.background?.scripts ?? [];
  if (!worker) throw new Error('manifest.background.scripts is missing: cannot derive the Chrome service worker');
  next.background = { service_worker: worker };
  return next;
}

async function emit(target, manifest) {
  const out = path.join(DIST, target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const entry of PAYLOAD) {
    await cp(path.join(ROOT, entry), path.join(out, entry), { recursive: true });
  }
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`  dist/${target}`);
}

const firefox = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));

if (firefox.background?.service_worker) {
  throw new Error(
    'The checked-in manifest.json must stay Firefox-only. Remove background.service_worker: ' +
      'this script adds it for the Chrome build.'
  );
}

console.log(`Building ${firefox.name} ${firefox.version}`);
await emit('firefox', firefox);
await emit('chrome', toChrome(firefox));
