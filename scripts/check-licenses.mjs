#!/usr/bin/env node
/**
 * License gate (CH-1, Master Patch #5).
 *
 * Runs `pnpm licenses list --json --prod`, flattens it, and applies policy:
 *   DENY  — any license matching /AGPL/, /SSPL/, GPL-2.0-only, GPL-3.0-only,
 *           /BUSL/, UNLICENSED, or UNKNOWN (a package pnpm couldn't classify).
 *   ALLOW — the permissive/weak-copyleft set below.
 *
 * Dual/compound licenses (SPDX expressions like "(MIT OR GPL-3.0)") pass if ANY
 * side is allowed AND no side is explicitly denied — a downstream consumer can
 * elect the permissive side.
 *
 * Exit nonzero and print `pkg@version -> license (path)` for every offender on
 * any DENY or any UNKNOWN not covered by OVERRIDES. Otherwise print a one-line
 * PASS summary.
 *
 *   node scripts/check-licenses.mjs
 */
import { execFileSync } from 'node:child_process';

/**
 * Weak-copyleft note: LGPL-* is allowed because our only LGPL dependency chain
 * (sharp -> @img/sharp-libvips-*) is DYNAMICALLY linked (loaded as a prebuilt
 * shared library, not statically linked into our source), which the LGPL permits
 * without relicensing. MPL-2.0 is file-level copyleft and permissive for our use.
 */
const ALLOW = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'MPL-2.0',
  'LGPL-3.0-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0',
  'LGPL-2.1-or-later',
  'LGPL-2.1-only',
  'LGPL-2.1',
  'CC0-1.0',
  // CC-BY-4.0: attribution-only, used here for non-code DATA assets (caniuse-lite).
  // Attribution is satisfied by THIRD_PARTY_NOTICES.md.
  'CC-BY-4.0',
  'Python-2.0',
  'Unlicense',
  'BlueOak-1.0.0',
]);

const DENY_PATTERNS = [/AGPL/i, /SSPL/i, /BUSL/i];
const DENY_EXACT = new Set(['GPL-2.0-only', 'GPL-3.0-only', 'UNLICENSED']);

/**
 * Known-mislabeled / policy-cleared packages. pnpm reports these as
 * UNKNOWN/misclassified (or with a non-SPDX string), but inspection of the
 * bundled LICENSE file or the license's terms clears them:
 *
 *   khroma           -> MIT   (its bundled LICENSE file is MIT; registry metadata omits it)
 *   slick            -> MIT   (pnpm reports "MIT (http://mootools.net/license.txt)"; it IS MIT)
 *   duck             -> BSD-3-Clause (bundled LICENSE is the 3-clause BSD text)
 *   caniuse-lite     -> CC-BY-4.0 (browser-support DATA, not code; attribution-only, we ship it verbatim)
 *   @sentry/cli      -> MIT   (FSL-1.1-MIT: build-only sourcemap uploader, never imported/shipped at
 *   @sentry/cli-*       runtime — verified no `@sentry/cli` runtime import — and FSL-1.1 auto-converts
 *                       to MIT after 2 years; source-available terms permit our build/CI use)
 */
const OVERRIDES = {
  khroma: 'MIT',
  slick: 'MIT',
  duck: 'BSD-3-Clause',
  'caniuse-lite': 'CC-BY-4.0',
  '@sentry/cli': 'MIT',
  '@sentry/cli-darwin': 'MIT',
  '@sentry/cli-linux-arm64': 'MIT',
  '@sentry/cli-linux-arm': 'MIT',
  '@sentry/cli-linux-i686': 'MIT',
  '@sentry/cli-linux-x64': 'MIT',
  '@sentry/cli-win32-arm64': 'MIT',
  '@sentry/cli-win32-i686': 'MIT',
  '@sentry/cli-win32-x64': 'MIT',
  // url-template -> BSD-3-Clause (its bundled LICENSE is the 3-clause BSD text;
  // package.json reports the legacy non-SPDX "BSD"). Transitive dep pulled in by
  // googleapis via googleapis-common.
  'url-template': 'BSD-3-Clause',
};

function isAllowedAtom(atom) {
  return ALLOW.has(atom);
}

function isDeniedAtom(atom) {
  if (DENY_EXACT.has(atom)) return true;
  return DENY_PATTERNS.some((re) => re.test(atom));
}

/**
 * Classify one SPDX license string. Returns 'allow' | 'deny' | 'unknown'.
 * Handles compound expressions: "(MIT OR GPL-3.0)", "Apache-2.0 AND MIT", etc.
 */
function classify(licenseRaw) {
  if (!licenseRaw) return 'unknown';
  const license = String(licenseRaw).trim();
  if (license === 'UNKNOWN' || license === '') return 'unknown';

  // Split on OR / AND (and parens) into atoms.
  const atoms = license
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((a) => a.trim())
    .filter(Boolean);

  // Any denied atom in an AND is fatal; in an OR we still let an allowed side win
  // ONLY if nothing is denied. Simplest safe rule: deny if any atom is denied.
  if (atoms.some(isDeniedAtom)) return 'deny';
  if (atoms.some(isAllowedAtom)) return 'allow';
  return 'unknown';
}

function main() {
  let raw;
  try {
    raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // pnpm exits nonzero when it finds packages with missing licenses but still
    // emits JSON on stdout; fall back to that before giving up.
    if (err.stdout) raw = err.stdout.toString();
    else {
      console.error('check-licenses: failed to run `pnpm licenses list`:', err.message);
      process.exit(1);
    }
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('check-licenses: could not parse pnpm licenses JSON output.');
    process.exit(1);
  }

  // pnpm shape: { "<license>": [ { name, versions: [...], paths: [...] }, ... ] }
  const offenders = [];
  let total = 0;

  for (const [license, pkgs] of Object.entries(data)) {
    for (const pkg of pkgs) {
      total += 1;
      const name = pkg.name;
      const versions = Array.isArray(pkg.versions) ? pkg.versions : [pkg.version].filter(Boolean);
      const paths = Array.isArray(pkg.paths) ? pkg.paths : [pkg.path].filter(Boolean);
      const version = versions.join(', ') || 'unknown';
      const path = paths[0] || '';

      const effective = OVERRIDES[name] ?? license;
      const verdict = classify(effective);

      if (verdict === 'deny') {
        offenders.push(`  DENY    ${name}@${version} -> ${license} (${path})`);
      } else if (verdict === 'unknown') {
        if (OVERRIDES[name]) continue; // covered by override
        offenders.push(`  UNKNOWN ${name}@${version} -> ${license || 'UNKNOWN'} (${path})`);
      }
    }
  }

  if (offenders.length > 0) {
    console.error(`check-licenses: FAIL — ${offenders.length} offending package(s):`);
    for (const line of offenders) console.error(line);
    console.error(
      '\nAdd an OVERRIDES entry (with justification) if a package is mislabeled, ' +
        'or remove/replace the dependency.',
    );
    process.exit(1);
  }

  console.log(`check-licenses: PASS — ${total} production package(s), all licenses within policy.`);
}

main();
