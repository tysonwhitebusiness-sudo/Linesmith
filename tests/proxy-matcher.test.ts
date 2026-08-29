/**
 * Guards the failure that produced this file.
 *
 * `proxy.ts` (Next 16's rename of `middleware.ts`) decides access with two
 * separate lists: `ADMIN_API_PREFIXES` / `PROTECTED_API_PREFIXES` say what
 * needs auth, and `config.matcher` says which paths the proxy runs on at all.
 * **A prefix in the first list does nothing unless the second also routes it.**
 *
 * That is not hypothetical. Phase 1.5 wrote a comment saying exactly this.
 * Task 2.9 then added `/api/mlb/refresh-hr-matchup` to `ADMIN_API_PREFIXES`,
 * missed the matcher entry three lines below the warning, and shipped a commit
 * claiming the route was gated. It answered an unauthenticated POST with 200
 * until task 3.13 tested it by request rather than by reading the constant.
 *
 * A comment could not prevent that, because a comment had already failed to.
 * This test can: it fails whenever a protected prefix has no matcher entry
 * covering it, including for prefixes added long after this was written.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const src = readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8');

/**
 * Pulls a string-array literal out of proxy.ts by name. Accepts both
 * `const NAME = [...]` and the object-property form `matcher: [...]`, which is
 * why the separator is `[:=]` — an earlier version accepted only `=` and could
 * not find `matcher`. It failed loudly rather than reporting "nothing
 * unrouted", which is what the vacuity guard below is for.
 */
function arrayLiteral(name: string): string[] {
  const m = new RegExp(name + String.raw`\s*[:=][^\[]*\[([\s\S]*?)\]`).exec(src);
  assert.ok(m, `${name} not found in proxy.ts`);
  // Strip line comments first — the matcher list is heavily commented and
  // those comments contain apostrophes that would parse as entries.
  const body = m[1].replace(/^[ \t]*\/\/.*$/gm, '');
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Does any matcher pattern actually route this path? `/x/:path*` covers `/x` and below. */
function isRouted(prefix: string, matchers: string[]): boolean {
  return matchers.some((pattern) => {
    const base = pattern.replace('/:path*', '');
    return prefix === base || prefix.startsWith(base + '/') || base.startsWith(prefix + '/') || base === prefix;
  });
}

test('every protected and admin prefix is actually routed by config.matcher', () => {
  const matchers = arrayLiteral('matcher');
  const guarded = [...arrayLiteral('PROTECTED_API_PREFIXES'), ...arrayLiteral('ADMIN_API_PREFIXES')];
  assert.ok(guarded.length > 0, 'no guarded prefixes parsed — this test would pass vacuously');

  const unrouted = guarded.filter((p) => !isRouted(p, matchers));
  assert.deepEqual(
    unrouted,
    [],
    'These paths are listed as requiring auth but config.matcher never routes the proxy over them, ' +
      'so the listing has NO EFFECT and the route is open:\n  ' +
      unrouted.join('\n  ') +
      '\nAdd a matcher entry. This exact mistake shipped once already (task 2.9).',
  );
});

test('the admin page prefixes are routed too', () => {
  const matchers = arrayLiteral('matcher');
  for (const p of arrayLiteral('PROTECTED_PAGE_PREFIXES')) {
    assert.ok(isRouted(p, matchers), `${p} is protected but not routed by config.matcher`);
  }
});
