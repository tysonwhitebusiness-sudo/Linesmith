/**
 * Task 3.6 — the upload guards on `/api/odds/import` (finding P4 L5).
 *
 * These are unit tests rather than live requests for a specific reason worth
 * recording: the route sits behind `ADMIN_API_PREFIXES`, so a live 100 MB POST
 * is rejected by middleware with a 401 before the handler ever runs. That is
 * correct defence in depth, and it is exactly why it cannot verify this task —
 * a passing live test would be measuring the auth gate, not the size gate. The
 * guards below are what protects a *signed-in admin* from posting a body that
 * gets fully buffered before anyone looks at its size.
 *
 * The logic is duplicated here rather than imported because the route module
 * pulls in the Next server runtime and the Anthropic SDK at import time. The
 * duplication is the point of failure to watch: if the route's constants
 * change and these do not, these tests keep passing while the route regresses.
 * That is a real limitation, and the honest mitigation is that both live in
 * the same task's diff — not that it cannot happen.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROUTE = path.join(process.cwd(), 'app', 'api', 'odds', 'import', 'route.ts');
const src = readFileSync(ROUTE, 'utf8');

test('the body-size check runs BEFORE request.json()', () => {
  const contentLengthAt = src.indexOf("content-length");
  const parseAt = src.indexOf('await request.json()');
  assert.ok(contentLengthAt > 0, 'no content-length check found in the route');
  assert.ok(parseAt > 0, 'no request.json() found in the route');
  assert.ok(
    contentLengthAt < parseAt,
    'the content-length guard must precede request.json(), or a huge body is ' +
      'fully buffered and parsed before being rejected — which is the entire ' +
      'memory-exhaustion vector P4 L5 describes. The 6MB image check already ' +
      'existed and ran after parsing, which is why it did not close this.',
  );
});

test('both a body cap and a decoded-image cap exist, and the body cap is looser', () => {
  const body = /MAX_BODY_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
  const image = /MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
  assert.ok(body, 'MAX_BODY_BYTES not found');
  assert.ok(image, 'MAX_BYTES not found');
  // Base64 inflates ~4/3 and the JSON envelope carries a `subjects` array, so
  // an equal cap would reject legitimate images at the size limit.
  assert.ok(
    Number(body[1]) > Number(image[1]),
    `the raw-body cap (${body[1]}MB) must exceed the decoded-image cap (${image[1]}MB), ` +
      'or a valid image at the limit is rejected by the body guard',
  );
});

test('a media-type allowlist exists and excludes executables', () => {
  const match = /ALLOWED_MEDIA_TYPES\s*=\s*new Set\(\[([^\]]*)\]/.exec(src);
  assert.ok(match, 'ALLOWED_MEDIA_TYPES not found — mediaType comes straight from the client');
  const allowed = match[1];
  for (const good of ['image/png', 'image/jpeg', 'image/webp']) {
    assert.ok(allowed.includes(good), `${good} should be accepted`);
  }
  for (const bad of ['application/', 'text/html', 'image/svg+xml']) {
    assert.ok(!allowed.includes(bad), `${bad} must not be in the allowlist`);
  }
});
