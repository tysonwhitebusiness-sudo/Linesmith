/**
 * Return an already-serialised JSON string as a response body, untouched.
 *
 * The snapshot cache stores JSON text. Handing it to `NextResponse.json`
 * means parsing it into objects and immediately re-serialising them to get
 * back the same bytes — which on these payloads (an MLB slate is 500+
 * candidates each carrying a full game log; golf's is larger still) costs
 * seconds of CPU per request and was enough to keep the dev server pegged.
 */
export function jsonPassthrough(payload: string, cacheState: 'hit' | 'stale'): Response {
  return new Response(payload, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-cache': cacheState,
    },
  });
}
