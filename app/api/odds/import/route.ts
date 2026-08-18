import { NextResponse } from 'next/server';
import { extractLegsFromScreenshot, matchLegsToSubjects } from '@/lib/odds/screenshotImport';
import type { SubjectSummary } from '@/lib/core/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cap the upload so a huge photo can't stall the request. */
const MAX_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request) {
  try {
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
