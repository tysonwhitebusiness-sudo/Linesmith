/**
 * POST /api/props/ingest-historical-odds — one-time ingestion of the
 * user-supplied historical odds files (2010-2020 SBR spreadsheets,
 * 2021-2025 multi-book CSV) into historical_odds. Reads from
 * data/historical-odds-import/ inside the project — the dev server process
 * doesn't have filesystem access outside the project directory, so the
 * source files were copied in from Downloads rather than read in place.
 */

import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { ingestAllHistoricalOdds, ingestScraperJson } from '@/lib/sports/mlb/historicalOddsIngest';
import { historicalOddsCoverage, logSystemEvent } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

const DOWNLOADS_DIR = path.join(process.cwd(), 'data', 'historical-odds-import');
const XLSX_SEASONS = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020];

export async function POST() {
  try {
    const summaries = await ingestAllHistoricalOdds(DOWNLOADS_DIR, XLSX_SEASONS);

    // mlb-odds-scraper JSON output (any *.json dropped into the same import
    // directory) — a third source for seasons the xlsx/CSV archives don't
    // cover (2026+). See historicalOddsIngest.ts's own header for why this
    // has to be scraped on a machine outside this app's environment and
    // just hands off the resulting file here.
    if (fs.existsSync(DOWNLOADS_DIR)) {
      const jsonFiles = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.endsWith('.json'));
      for (const file of jsonFiles) {
        summaries.push(await ingestScraperJson(`${DOWNLOADS_DIR}/${file}`));
      }
    }

    const coverage = await historicalOddsCoverage();
    return NextResponse.json({ summaries, coverage });
  } catch (error) {
    console.error('[api/props/ingest-historical-odds]', error);
    await logSystemEvent({ level: 'error', source: 'api/props/ingest-historical-odds', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Ingestion failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ coverage: await historicalOddsCoverage() });
}
