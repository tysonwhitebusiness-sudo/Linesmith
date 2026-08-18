/**
 * Ingests the historical odds files the user supplied directly (not fetched
 * from any API): 11 SportsBookReviewsOnline-format spreadsheets (2010-2020,
 * one book, moneyline + total) and one long-format multi-book CSV
 * (2021-2025, 6 real sportsbooks). Both get normalized into the same shape
 * — a de-vigged consensus probability per game — and written to
 * historical_odds.
 *
 * Deliberately does NOT call the MLB API to resolve games to a real
 * gamePk: the (season, date, homeTeamId, awayTeamId) key is enough for
 * modelFit.ts's training walk to join against, since that walk already
 * fetches the real schedule for its own Pythagorean accumulator. Keeping
 * ingestion itself offline-only means it never depends on network access
 * or rate limits, and re-running it is instant.
 */

import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { resolveTeamAbbr } from './teamAliases';
import { devigTwoWay } from '../../odds/devig';
import { americanToDecimal } from '../../odds/display';
import { writeHistoricalOdds, type HistoricalOddsInput } from '../../db/client';
import { getScheduleRange, easternDate } from './statsapi';

export interface IngestSummary {
  source: string;
  rowsRead: number;
  gamesWritten: number;
  unresolvedTeams: string[];
  skippedNoMatchup: number;
}

// ---------------------------------------------------------------------------
// 2010-2020 SBR-format spreadsheets
// ---------------------------------------------------------------------------

/** "404" -> "2010-04-04". SBR's Date column has no year; 3 vs 4 digits both zero-pad to MMDD correctly (MLB's regular + postseason never crosses a calendar year, so no year-rollover to handle). */
function parseSbrDate(raw: number, season: number): string {
  const str = String(raw).padStart(4, '0');
  const month = str.slice(0, 2);
  const day = str.slice(2, 4);
  return `${season}-${month}-${day}`;
}

function findColIndex(header: Array<string | null>, candidates: string[]): number {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  for (const c of candidates) {
    const idx = header.findIndex((h) => h != null && norm(h) === norm(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function ingestSbrXlsx(filePath: string, season: number): IngestSummary {
  const summary: IngestSummary = { source: `sbr-xlsx-${season}`, rowsRead: 0, gamesWritten: 0, unresolvedTeams: [], skippedNoMatchup: 0 };
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as any[][];
  if (rows.length < 2) return summary;

  const header = rows[0] as Array<string | null>;
  const colDate = findColIndex(header, ['Date']);
  const colRot = findColIndex(header, ['Rot']);
  const colVh = findColIndex(header, ['VH']);
  const colTeam = findColIndex(header, ['Team']);
  const colClose = findColIndex(header, ['Close']);
  const colOpen = findColIndex(header, ['Open']);
  const colCloseOU = findColIndex(header, ['Close OU', 'CloseOU']);
  // The price for the Close OU side sits in the column immediately after it (unlabeled in the source file).
  const colCloseOUPrice = colCloseOU !== -1 ? colCloseOU + 1 : -1;
  const colOpenOU = findColIndex(header, ['Open OU', 'OpenOU']);
  const colOpenOUPrice = colOpenOU !== -1 ? colOpenOU + 1 : -1;

  const unresolved = new Set<string>();
  // Rotation numbers reset/repeat every day, so the pair key must be scoped
  // to the date — keying by rotation number alone across the whole season
  // collides on every date that reused the same number and silently drops
  // nearly all games.
  const byRot = new Map<string, any[]>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[colRot] == null) continue;
    summary.rowsRead += 1;
    const rot = Number(r[colRot]);
    // SBR pairs consecutive rotation numbers (e.g. 931/932) into one game — the pair key is the lower of the two.
    const pairKey = `${String(r[colDate])}|${rot % 2 === 0 ? rot - 1 : rot}`;
    const list = byRot.get(pairKey) ?? [];
    list.push(r);
    byRot.set(pairKey, list);
  }

  const entries: HistoricalOddsInput[] = [];
  for (const [, pair] of byRot) {
    if (pair.length !== 2) {
      summary.skippedNoMatchup += 1;
      continue;
    }
    const vRow = pair.find((r) => r[colVh] === 'V');
    const hRow = pair.find((r) => r[colVh] === 'H');
    if (!vRow || !hRow) {
      summary.skippedNoMatchup += 1;
      continue;
    }

    const awayAbbr = String(vRow[colTeam] ?? '');
    const homeAbbr = String(hRow[colTeam] ?? '');
    const awayId = resolveTeamAbbr(awayAbbr);
    const homeId = resolveTeamAbbr(homeAbbr);
    if (!awayId) unresolved.add(awayAbbr);
    if (!homeId) unresolved.add(homeAbbr);
    if (!awayId || !homeId) continue;

    const gameDate = parseSbrDate(Number(vRow[colDate]), season);

    const awayClose = colClose !== -1 ? Number(vRow[colClose]) : NaN;
    const homeClose = colClose !== -1 ? Number(hRow[colClose]) : NaN;
    let mlHomeProb: number | null = null;
    let mlAwayProb: number | null = null;
    if (Number.isFinite(awayClose) && Number.isFinite(homeClose)) {
      const devigged = devigTwoWay(americanToDecimal(awayClose), americanToDecimal(homeClose));
      if (devigged) {
        mlAwayProb = devigged.a;
        mlHomeProb = devigged.b;
      }
    }

    const awayOpen = colOpen !== -1 ? Number(vRow[colOpen]) : NaN;
    const homeOpen = colOpen !== -1 ? Number(hRow[colOpen]) : NaN;
    let mlHomeOpenProb: number | null = null;
    let mlAwayOpenProb: number | null = null;
    if (Number.isFinite(awayOpen) && Number.isFinite(homeOpen)) {
      const devigged = devigTwoWay(americanToDecimal(awayOpen), americanToDecimal(homeOpen));
      if (devigged) {
        mlAwayOpenProb = devigged.a;
        mlHomeOpenProb = devigged.b;
      }
    }

    let totalLine: number | null = null;
    let overProb: number | null = null;
    let underProb: number | null = null;
    if (colCloseOU !== -1 && colCloseOUPrice !== -1) {
      const lineVal = Number(vRow[colCloseOU]);
      const overPrice = Number(vRow[colCloseOUPrice]); // V row carries the Over side, SBR convention
      const underPrice = Number(hRow[colCloseOUPrice]); // H row carries the Under side
      if (Number.isFinite(lineVal)) totalLine = lineVal;
      if (Number.isFinite(overPrice) && Number.isFinite(underPrice)) {
        const devigged = devigTwoWay(americanToDecimal(overPrice), americanToDecimal(underPrice));
        if (devigged) {
          overProb = devigged.a;
          underProb = devigged.b;
        }
      }
    }

    let totalOpenLine: number | null = null;
    let openOverProb: number | null = null;
    let openUnderProb: number | null = null;
    if (colOpenOU !== -1 && colOpenOUPrice !== -1) {
      const openLineVal = Number(vRow[colOpenOU]);
      const openOverPrice = Number(vRow[colOpenOUPrice]);
      const openUnderPrice = Number(hRow[colOpenOUPrice]);
      if (Number.isFinite(openLineVal)) totalOpenLine = openLineVal;
      if (Number.isFinite(openOverPrice) && Number.isFinite(openUnderPrice)) {
        const devigged = devigTwoWay(americanToDecimal(openOverPrice), americanToDecimal(openUnderPrice));
        if (devigged) {
          openOverProb = devigged.a;
          openUnderProb = devigged.b;
        }
      }
    }

    entries.push({
      season,
      gameDate,
      homeTeamId: homeId,
      awayTeamId: awayId,
      homeScore: Number.isFinite(Number(hRow[header.indexOf('Final')])) ? Number(hRow[header.indexOf('Final')]) : null,
      awayScore: Number.isFinite(Number(vRow[header.indexOf('Final')])) ? Number(vRow[header.indexOf('Final')]) : null,
      mlHomeConsensusProb: mlHomeProb,
      mlAwayConsensusProb: mlAwayProb,
      totalLine,
      totalOverConsensusProb: overProb,
      totalUnderConsensusProb: underProb,
      mlHomeOpenProb,
      mlAwayOpenProb,
      totalOpenLine,
      totalOpenOverProb: openOverProb,
      totalOpenUnderProb: openUnderProb,
      source: 'sbr-xlsx',
      bookCount: 1,
    });
  }

  summary.gamesWritten = writeHistoricalOdds(entries);
  summary.unresolvedTeams = [...unresolved];
  return summary;
}

// ---------------------------------------------------------------------------
// 2021-2025 long-format multi-book CSV
// ---------------------------------------------------------------------------

/** Minimal CSV line parser — good enough for this file (no embedded commas inside quoted fields observed in the sampled data; falls back safely if a field is simply empty). */
function parseCsvLine(line: string): string[] {
  return line.split(',');
}

export function ingestLongCsv(filePath: string): IngestSummary {
  // Filename included so a multi-file ingestion run (see ingestAllHistoricalOdds)
  // reports which specific file each summary came from, not an indistinguishable "long-csv" for all of them.
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const summary: IngestSummary = { source: `long-csv:${fileName}`, rowsRead: 0, gamesWritten: 0, unresolvedTeams: [], skippedNoMatchup: 0 };
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const header = parseCsvLine(lines[0]);
  const idx: Record<string, number> = {};
  header.forEach((h, i) => (idx[h.trim()] = i));

  const unresolved = new Set<string>();
  // Group raw book-level rows by (date, home, away).
  const byGame = new Map<
    string,
    {
      season: number;
      gameDate: string;
      homeId: number;
      awayId: number;
      homeScore: number | null;
      awayScore: number | null;
      mlHomeOdds: number[];
      mlAwayOdds: number[];
      totalLines: number[];
      totalOverOdds: number[];
      totalUnderOdds: number[];
      mlHomeOpenOdds: number[];
      mlAwayOpenOdds: number[];
      totalOpenLines: number[];
      totalOpenOverOdds: number[];
      totalOpenUnderOdds: number[];
    }
  >();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const row = parseCsvLine(line);
    summary.rowsRead += 1;

    const dateStr = row[idx.date];
    if (!dateStr) continue;
    const season = Number(dateStr.slice(0, 4));
    const homeAbbr = row[idx.home_team_abbr];
    const awayAbbr = row[idx.away_team_abbr];
    const homeId = resolveTeamAbbr(homeAbbr);
    const awayId = resolveTeamAbbr(awayAbbr);
    if (!homeId) unresolved.add(homeAbbr);
    if (!awayId) unresolved.add(awayAbbr);
    if (!homeId || !awayId) continue;

    const key = `${season}|${dateStr}|${homeId}|${awayId}`;
    const entry =
      byGame.get(key) ??
      {
        season,
        gameDate: dateStr,
        homeId,
        awayId,
        homeScore: row[idx.home_score] !== '' ? Number(row[idx.home_score]) : null,
        awayScore: row[idx.away_score] !== '' ? Number(row[idx.away_score]) : null,
        mlHomeOdds: [],
        mlAwayOdds: [],
        totalLines: [],
        totalOverOdds: [],
        totalUnderOdds: [],
        mlHomeOpenOdds: [],
        mlAwayOpenOdds: [],
        totalOpenLines: [],
        totalOpenOverOdds: [],
        totalOpenUnderOdds: [],
      };

    const market = row[idx.market];
    if (market === 'moneyline') {
      const closeHome = Number(row[idx.close_home]);
      const closeAway = Number(row[idx.close_away]);
      if (Number.isFinite(closeHome) && Number.isFinite(closeAway)) {
        entry.mlHomeOdds.push(closeHome);
        entry.mlAwayOdds.push(closeAway);
      }
      const openHome = Number(row[idx.open_home]);
      const openAway = Number(row[idx.open_away]);
      if (Number.isFinite(openHome) && Number.isFinite(openAway)) {
        entry.mlHomeOpenOdds.push(openHome);
        entry.mlAwayOpenOdds.push(openAway);
      }
    } else if (market === 'total') {
      const closeTotal = Number(row[idx.close_total]);
      const closeHome = Number(row[idx.close_home]); // over price, per this file's own convention (moneyline/total share close_home/close_away column names)
      const closeAway = Number(row[idx.close_away]); // under price
      if (Number.isFinite(closeTotal)) entry.totalLines.push(closeTotal);
      if (Number.isFinite(closeHome) && Number.isFinite(closeAway)) {
        entry.totalOverOdds.push(closeHome);
        entry.totalUnderOdds.push(closeAway);
      }
      const openTotal = Number(row[idx.open_total]);
      const openHome = Number(row[idx.open_home]); // open over price, same convention as close
      const openAway = Number(row[idx.open_away]); // open under price
      if (Number.isFinite(openTotal)) entry.totalOpenLines.push(openTotal);
      if (Number.isFinite(openHome) && Number.isFinite(openAway)) {
        entry.totalOpenOverOdds.push(openHome);
        entry.totalOpenUnderOdds.push(openAway);
      }
    }

    byGame.set(key, entry);
  }

  const entries: HistoricalOddsInput[] = [];
  for (const g of byGame.values()) {
    let mlHomeProb: number | null = null;
    let mlAwayProb: number | null = null;
    let bookCount = 0;
    if (g.mlHomeOdds.length > 0) {
      const homeProbs: number[] = [];
      const awayProbs: number[] = [];
      for (let i = 0; i < g.mlHomeOdds.length; i++) {
        const devigged = devigTwoWay(americanToDecimal(g.mlAwayOdds[i]), americanToDecimal(g.mlHomeOdds[i]));
        if (devigged) {
          awayProbs.push(devigged.a);
          homeProbs.push(devigged.b);
        }
      }
      if (homeProbs.length > 0) {
        mlHomeProb = homeProbs.reduce((s, v) => s + v, 0) / homeProbs.length;
        mlAwayProb = awayProbs.reduce((s, v) => s + v, 0) / awayProbs.length;
        bookCount = homeProbs.length;
      }
    }

    let totalLine: number | null = null;
    let overProb: number | null = null;
    let underProb: number | null = null;
    if (g.totalLines.length > 0) {
      totalLine = g.totalLines.reduce((s, v) => s + v, 0) / g.totalLines.length; // consensus line, averaged across books
      const overProbs: number[] = [];
      const underProbs: number[] = [];
      for (let i = 0; i < g.totalOverOdds.length; i++) {
        const devigged = devigTwoWay(americanToDecimal(g.totalOverOdds[i]), americanToDecimal(g.totalUnderOdds[i]));
        if (devigged) {
          overProbs.push(devigged.a);
          underProbs.push(devigged.b);
        }
      }
      if (overProbs.length > 0) {
        overProb = overProbs.reduce((s, v) => s + v, 0) / overProbs.length;
        underProb = underProbs.reduce((s, v) => s + v, 0) / underProbs.length;
      }
    }

    let mlHomeOpenProb: number | null = null;
    let mlAwayOpenProb: number | null = null;
    if (g.mlHomeOpenOdds.length > 0) {
      const homeOpenProbs: number[] = [];
      const awayOpenProbs: number[] = [];
      for (let i = 0; i < g.mlHomeOpenOdds.length; i++) {
        const devigged = devigTwoWay(americanToDecimal(g.mlAwayOpenOdds[i]), americanToDecimal(g.mlHomeOpenOdds[i]));
        if (devigged) {
          awayOpenProbs.push(devigged.a);
          homeOpenProbs.push(devigged.b);
        }
      }
      if (homeOpenProbs.length > 0) {
        mlHomeOpenProb = homeOpenProbs.reduce((s, v) => s + v, 0) / homeOpenProbs.length;
        mlAwayOpenProb = awayOpenProbs.reduce((s, v) => s + v, 0) / awayOpenProbs.length;
      }
    }

    let totalOpenLine: number | null = null;
    let openOverProb: number | null = null;
    let openUnderProb: number | null = null;
    if (g.totalOpenLines.length > 0) {
      totalOpenLine = g.totalOpenLines.reduce((s, v) => s + v, 0) / g.totalOpenLines.length;
      const openOverProbs: number[] = [];
      const openUnderProbs: number[] = [];
      for (let i = 0; i < g.totalOpenOverOdds.length; i++) {
        const devigged = devigTwoWay(americanToDecimal(g.totalOpenOverOdds[i]), americanToDecimal(g.totalOpenUnderOdds[i]));
        if (devigged) {
          openOverProbs.push(devigged.a);
          openUnderProbs.push(devigged.b);
        }
      }
      if (openOverProbs.length > 0) {
        openOverProb = openOverProbs.reduce((s, v) => s + v, 0) / openOverProbs.length;
        openUnderProb = openUnderProbs.reduce((s, v) => s + v, 0) / openUnderProbs.length;
      }
    }

    entries.push({
      season: g.season,
      gameDate: g.gameDate,
      homeTeamId: g.homeId,
      awayTeamId: g.awayId,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      mlHomeConsensusProb: mlHomeProb,
      mlAwayConsensusProb: mlAwayProb,
      totalLine,
      totalOverConsensusProb: overProb,
      totalUnderConsensusProb: underProb,
      mlHomeOpenProb,
      mlAwayOpenProb,
      totalOpenLine,
      totalOpenOverProb: openOverProb,
      totalOpenUnderProb: openUnderProb,
      source: 'long-csv',
      bookCount,
    });
  }

  summary.gamesWritten = writeHistoricalOdds(entries);
  summary.unresolvedTeams = [...unresolved];
  return summary;
}

/**
 * Matches any yearly long-format file dropped into the import directory —
 * `mlb_games_odds_2021_2025_all_books_long.csv` (the original 2021-2025
 * archive) and any later single- or multi-season file following the same
 * `mlb_games_odds_<...>_all_books_long.csv` shape (e.g. a future
 * `mlb_games_odds_2026_all_books_long.csv`). ingestLongCsv itself is
 * already season-agnostic — it derives each row's season from its own date
 * column — so a new file just needs to exist here with a matching name;
 * no code change needed per season.
 */
const LONG_CSV_PATTERN = /^mlb_games_odds_.*_all_books_long\.csv$/;

// ---------------------------------------------------------------------------
// mlb-odds-scraper JSON (github.com/ArnavSaraogi/mlb-odds-scraper output) —
// a third source alongside the two above, for seasons neither the SBR xlsx
// nor the long CSV cover (2026+). Blocked from running the scrape itself
// inside this app's own environment (SportsBookReview 503s on this
// sandbox's outbound IP range — confirmed against both a raw fetch and a
// real browser, and unrelated to request headers or rate — Google loads
// fine from the same environment). The scraper has to run on a machine
// SportsBookReview doesn't block; this function only consumes its JSON
// output file afterward.
//
// Team names in that JSON are real full names ("Toronto Blue Jays"), not
// abbreviations — resolved against a real schedule fetch for the file's own
// date range rather than a hardcoded name table, since SBR's exact wording
// for a team name isn't guaranteed to match MLB's official one
// character-for-character. Same (date, normalized away/home name) matching
// shape the scraper's own get_mlb_schedule already uses internally, just
// resolving to this app's team IDs instead of gameType.
// ---------------------------------------------------------------------------

interface ScraperOddsLine {
  sportsbook: string;
  openingLine: Record<string, number | null>;
  currentLine: Record<string, number | null>;
}

interface ScraperGame {
  gameView: {
    startDate: string;
    awayTeam: { fullName: string };
    awayTeamScore: number | null;
    homeTeam: { fullName: string };
    homeTeamScore: number | null;
  };
  odds: {
    moneyline?: ScraperOddsLine[];
    totals?: ScraperOddsLine[];
  };
}

type ScraperOutput = Record<string, ScraperGame[]>;

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/-/g, ' ')
    .replace(/&/g, 'and')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Devigs each book's [a, b] American-odds pair independently, then averages the resulting probabilities across books — same shape as ingestLongCsv's own per-market averaging, factored out here since this file has four near-identical instances of it (ML/total x close/open). */
function devigAverage(pairs: Array<[number, number]>): { a: number; b: number } | null {
  const aProbs: number[] = [];
  const bProbs: number[] = [];
  for (const [oddsA, oddsB] of pairs) {
    const devigged = devigTwoWay(americanToDecimal(oddsA), americanToDecimal(oddsB));
    if (devigged) {
      aProbs.push(devigged.a);
      bProbs.push(devigged.b);
    }
  }
  if (aProbs.length === 0) return null;
  return { a: aProbs.reduce((s, v) => s + v, 0) / aProbs.length, b: bProbs.reduce((s, v) => s + v, 0) / bProbs.length };
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

export async function ingestScraperJson(filePath: string): Promise<IngestSummary> {
  const summary: IngestSummary = { source: 'scraper-json', rowsRead: 0, gamesWritten: 0, unresolvedTeams: [], skippedNoMatchup: 0 };
  const data: ScraperOutput = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const dates = Object.keys(data).sort();
  if (dates.length === 0) return summary;

  // One schedule fetch spanning the whole file — team IDs keyed by (date,
  // normalized away name, normalized home name), real ground truth for
  // matching rather than trusting the scraped names alone.
  const scheduleGames = await getScheduleRange(dates[0], dates[dates.length - 1]);
  const scheduleByKey = new Map<string, { homeId: number; awayId: number }>();
  for (const g of scheduleGames) {
    const gameDate = easternDate(new Date(g.gameDate));
    const key = `${gameDate}|${normalizeTeamName(g.teams.away.team.name)}|${normalizeTeamName(g.teams.home.team.name)}`;
    scheduleByKey.set(key, { homeId: g.teams.home.team.id, awayId: g.teams.away.team.id });
  }

  const unresolved = new Set<string>();
  const entries: HistoricalOddsInput[] = [];

  for (const games of Object.values(data)) {
    for (const game of games) {
      summary.rowsRead += 1;
      const gv = game.gameView;
      if (!gv?.startDate || !gv.homeTeam?.fullName || !gv.awayTeam?.fullName) {
        summary.skippedNoMatchup += 1;
        continue;
      }
      const gameDate = easternDate(new Date(gv.startDate));
      const key = `${gameDate}|${normalizeTeamName(gv.awayTeam.fullName)}|${normalizeTeamName(gv.homeTeam.fullName)}`;
      const matched = scheduleByKey.get(key);
      if (!matched) {
        unresolved.add(`${gv.awayTeam.fullName} @ ${gv.homeTeam.fullName} (${gameDate})`);
        summary.skippedNoMatchup += 1;
        continue;
      }

      const mlLines = game.odds?.moneyline ?? [];
      const closeMl = devigAverage(
        mlLines
          .filter((l) => typeof l.currentLine?.awayOdds === 'number' && typeof l.currentLine?.homeOdds === 'number')
          .map((l) => [l.currentLine.awayOdds as number, l.currentLine.homeOdds as number]),
      );
      const openMl = devigAverage(
        mlLines
          .filter((l) => typeof l.openingLine?.awayOdds === 'number' && typeof l.openingLine?.homeOdds === 'number')
          .map((l) => [l.openingLine.awayOdds as number, l.openingLine.homeOdds as number]),
      );
      let bookCount = 0;
      for (const l of mlLines) if (typeof l.currentLine?.homeOdds === 'number' && typeof l.currentLine?.awayOdds === 'number') bookCount += 1;

      const totalLines = game.odds?.totals ?? [];
      const closeTotal = devigAverage(
        totalLines
          .filter((l) => typeof l.currentLine?.overOdds === 'number' && typeof l.currentLine?.underOdds === 'number')
          .map((l) => [l.currentLine.overOdds as number, l.currentLine.underOdds as number]),
      );
      const openTotal = devigAverage(
        totalLines
          .filter((l) => typeof l.openingLine?.overOdds === 'number' && typeof l.openingLine?.underOdds === 'number')
          .map((l) => [l.openingLine.overOdds as number, l.openingLine.underOdds as number]),
      );
      const totalLine = average(totalLines.map((l) => l.currentLine?.total).filter((t): t is number => typeof t === 'number'));
      const totalOpenLine = average(totalLines.map((l) => l.openingLine?.total).filter((t): t is number => typeof t === 'number'));

      entries.push({
        season: Number(gameDate.slice(0, 4)),
        gameDate,
        homeTeamId: matched.homeId,
        awayTeamId: matched.awayId,
        homeScore: typeof gv.homeTeamScore === 'number' ? gv.homeTeamScore : null,
        awayScore: typeof gv.awayTeamScore === 'number' ? gv.awayTeamScore : null,
        mlHomeConsensusProb: closeMl?.b ?? null,
        mlAwayConsensusProb: closeMl?.a ?? null,
        totalLine,
        totalOverConsensusProb: closeTotal?.a ?? null,
        totalUnderConsensusProb: closeTotal?.b ?? null,
        mlHomeOpenProb: openMl?.b ?? null,
        mlAwayOpenProb: openMl?.a ?? null,
        totalOpenLine,
        totalOpenOverProb: openTotal?.a ?? null,
        totalOpenUnderProb: openTotal?.b ?? null,
        source: 'scraper-json',
        bookCount,
      });
    }
  }

  summary.gamesWritten = writeHistoricalOdds(entries);
  summary.unresolvedTeams = [...unresolved];
  return summary;
}

export function ingestAllHistoricalOdds(downloadsDir: string, xlsxSeasons: number[]): IngestSummary[] {
  const summaries: IngestSummary[] = [];
  for (const season of xlsxSeasons) {
    const path = `${downloadsDir}/mlb-odds-${season}.xlsx`;
    if (!fs.existsSync(path)) continue;
    summaries.push(ingestSbrXlsx(path, season));
  }
  if (fs.existsSync(downloadsDir)) {
    const longCsvFiles = fs.readdirSync(downloadsDir).filter((f) => LONG_CSV_PATTERN.test(f));
    for (const file of longCsvFiles) {
      summaries.push(ingestLongCsv(`${downloadsDir}/${file}`));
    }
  }
  return summaries;
}
