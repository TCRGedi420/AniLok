/**
 * scripts/patch-aniwatch.js
 *
 * Runs automatically after `npm install` via the `postinstall` hook.
 *
 * The aniwatch scraper hardcodes the source domain. When that domain goes
 * down or blocks certain regions, every scrape returns empty HTML and
 * cheerio.load() throws "expects a string" → 500 on every episode source.
 *
 * Fix: rewrite the domain string in the compiled output before Vercel
 * bundles it. aniwatchtv.to is the current working mirror.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const TARGETS = [
  // Primary compiled output (aniwatch ≥1.x)
  'node_modules/aniwatch/dist/index.js',
  // Some versions split into cjs too
  'node_modules/aniwatch/dist/index.cjs',
];

// Old domain → new working domain
const REPLACEMENTS = [
  ['hianime.to',   'aniwatchtv.to'],
  ['hianimez.to',  'aniwatchtv.to'],
  ['hianimes.se',  'aniwatchtv.to'],  // the PR domain, patch it too just in case
];

let patched = false;

for (const target of TARGETS) {
  const filePath = resolve(target);
  if (!existsSync(filePath)) continue;

  let src = readFileSync(filePath, 'utf8');
  let changed = false;

  for (const [from, to] of REPLACEMENTS) {
    if (src.includes(from)) {
      const count = (src.match(new RegExp(from.replace('.', '\\.'), 'g')) || []).length;
      src = src.replaceAll(from, to);
      console.log(`[patch-aniwatch] ${target}: replaced "${from}" → "${to}" (${count} occurrence${count !== 1 ? 's' : ''})`);
      changed = true;
      patched = true;
    }
  }

  if (changed) writeFileSync(filePath, src, 'utf8');
}

if (!patched) {
  console.warn('[patch-aniwatch] Warning: no target files found or no replacements made.');
  console.warn('  Checked:', TARGETS.join(', '));
}
