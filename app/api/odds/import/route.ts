import { NextResponse } from 'next/server';
import { extractLegsFromScreenshot, matchLegsToSubjects } from '@/lib/odds/screenshotImport';
import type { SubjectSummary } from '@/lib/core/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cap the decoded image so a huge photo can't stall the request. */
const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Cap on the raw request body, checked BEFORE parsing (task 3.6, P4 L5).
 *
 * Base64 inflates by ~4/3 and the JSON envelope adds the `subjects` array, so
 * this is deliberately looser than MAX_BYTES rather than equal to it — it is a
 * memory guard, not the real image limit. MAX_BYTES below is still what decides
 * whether an image is acceptable.
 */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * What the vision model is actually willing to receive. `mediaType` comes
 * straight from the client — either an explicit field or sliced out of a
 * `data:` URL — and was previously forwarded to the extractor unchecked.
 */
const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function POST(request: Request) {
  try {
    // BEFORE request.json(). The 6MB check further down has always existed,
    // but it ran after the entire body had been read and parsed into memory —
    // so a 100MB post was fully buffered and only then rejected, which is the
    // memory-exhaustion vector P4 L5 is about, not the image size itself.
    // Content-Length can be absent or lied about; this is the cheap first
    // gate, and the decoded-size check below is the one that cannot be.
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }

    const body = (await request.json()) as {
      image?: string;
      mediaType?: string;
      subjects?: SubjectSummary[];
    };

    if (!body.image) {
      return NextResponse.json({ error: 'No image supplied.' }, { status: 400 });
    }

    // Accept either a bare base64 payload or a full data: URL from the client.
    const commaAt = body.image.indexOf(',');
    const isDataUrl = body.image.startsWith('data:');
    const base64 = isDataUrl ? body.image.slice(commaAt + 1) : body.image;
    const mediaType =
      body.mediaType ??
      (isDataUrl ? body.image.slice(5, body.image.indexOf(';')) : 'image/png');

    if (base64.length * 0.75 > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large — keep it under 6MB.' }, { status: 413 });
    }

    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return NextResponse.json(
        { error: `Unsupported image type. Use PNG, JPEG, WebP or GIF.` },
        { status: 415 },
      );
    }

    const { legs, warnings } = await extractLegsFromScreenshot(base64, mediaType);
    const result = matchLegsToSubjects(legs, body.subjects ?? []);

    return NextResponse.json({
      ...result,
      warnings: [...warnings, ...result.warnings],
      extractedCount: legs.length,
    });
  } catch (error) {
    console.error('[api/odds/import]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Screenshot import failed.' },
      { status: 500 },
    );
  }
}
