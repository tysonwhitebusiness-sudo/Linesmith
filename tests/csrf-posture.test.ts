/**
 * Task 3.14 — CSRF posture, encoded as a test rather than an assurance.
 *
 * Finding P4 L4 concluded the risk is low TODAY, and it is right: Supabase's
 * session cookies are `SameSite=Lax`, and every state-changing route in this
 * app reads a JSON body. A cross-site HTML form can only send
 * `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain` —
 * none of which triggers a CORS preflight, and none of which any handler here
 * accepts. `request.json()` on a form-encoded body throws.
 *
 * The problem with that conclusion is that it is a property of the code, not a
 * decision anyone recorded, and nothing stops the next person adding
 * `await request.formData()` to a route and quietly removing the protection.
 * That is what this test is for: it fails the moment the assumption stops
 * being true, which is the only kind of "documented assumption" worth having.
 *
 * It is deliberately a static scan rather than a live request test. A live
 * test would only cover routes someone remembered to enumerate; this covers
 * every route file that exists, including ones added tomorrow.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const API_ROOT = path.join(process.cwd(), 'app', 'api');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts' || entry === 'route.tsx') out.push(full);
  }
  return out;
}

test('no API route reads a form-encoded body', () => {
  const offenders: string[] = [];
  for (const file of routeFiles(API_ROOT)) {
    const src = readFileSync(file, 'utf8');
    // Strip comments so prose about formData doesn't trip the scan.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/\.formData\s*\(/.test(code) || /application\/x-www-form-urlencoded/.test(code)) {
      offenders.push(path.relative(process.cwd(), file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These routes read a form-encoded body, which a cross-site form CAN send without a preflight.\n` +
      `The app's CSRF posture (finding P4 L4) rests on every state-changing route requiring JSON.\n` +
      `If one of these is intentional it needs its own CSRF token — not an exemption here:\n  ` +
      offenders.join('\n  '),
  );
});

test('every API route directory actually contains a route file', () => {
  // Guards the scan above against silently covering nothing — an empty
  // app/api/ or a moved directory would make the first test vacuously pass.
  const files = routeFiles(API_ROOT);
  assert.ok(files.length > 50, `expected the full API surface, found only ${files.length} route files`);
});
