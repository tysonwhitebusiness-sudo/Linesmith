/**
 * Standalone port of lib/sports/mlb/historicalOddsIngest.ts — the Next.js
 * dev server process couldn't read these files directly (sandboxed), so
 * this runs the same logic outside it, writing straight to SQLite. Kept
 * logically identical to the TS module; that module remains the reference
 * implementation for anyone re-running this later from inside the app.
 */
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', 'node_modules', 'xlsx'));
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const DB_PATH = path.join(__dirname, '..', 'data', 'linebuddy.db');
const IMPORT_DIR = path.join(__dirname, '..', 'data', 'historical-odds-import');
const XLSX_SEASONS = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020];

// --- team aliases (mirrors lib/sports/mlb/teamAliases.ts) ---
const TEAM_ID_BY_ABBR = {
  LAA: 108, ANA: 108, ARI: 109, AZ: 109, BAL: 110, BOS: 111, BRS: 111, CHC: 112, CUB: 112, CIN: 113,
  CLE: 114, COL: 115, DET: 116, HOU: 117, KC: 118, KCR: 118, KAN: 118, LAD: 119, LOS: 119,
  WSH: 120, WSN: 120, WAS: 120, NYM: 121, OAK: 133, ATH: 133, PIT: 134, SD: 135, SDP: 135, SDG: 135,
  SEA: 136, SF: 137, SFG: 137, SFO: 137, STL: 138, TB: 139, TBD: 139, TBR: 139, TAM: 139, TEX: 140,
  TOR: 141, MIN: 142, PHI: 143, ATL: 144, CWS: 145, CHW: 145, FLA: 146, MIA: 146,
  NYY: 147, MIL: 158,
};
function resolveTeamAbbr(raw) {
  if (!raw) return null;
  return TEAM_ID_BY_ABBR[String(raw).trim().toUpperCase()] ?? null;
}

// --- devig (mirrors lib/odds/devig.ts + display.ts's americanToDecimal) ---
function americanToDecimal(american) {
  if (american == null || !Number.isFinite(american)) return null;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}
function devigTwoWay(aDecimal, bDecimal) {
  if (aDecimal == null || bDecimal == null || !Number.isFinite(aDecimal) || !Number.isFinite(bDecimal)) return null;
  if (aDecimal <= 1 || bDecimal <= 1) return null;
  const rawA = 1 / aDecimal, rawB = 1 / bDecimal;
  const total = rawA + rawB;
  if (total <= 0) return null;
  return { a: rawA / total, b: rawB / total };
}

// --- DB ---
const db = new Database(DB_PATH);
const upsert = db.prepare(`
  INSERT INTO historical_odds
    (season, game_date, home_team_id, away_team_id, home_score, away_score,
     ml_home_consensus_prob, ml_away_consensus_prob, total_line,
     total_over_consensus_prob, total_under_consensus_prob, source, book_count)
  VALUES (@season, @gameDate, @homeTeamId, @awayTeamId, @homeScore, @awayScore,
          @mlHomeConsensusProb, @mlAwayConsensusProb, @totalLine,
          @totalOverConsensusProb, @totalUnderConsensusProb, @source, @bookCount)
  ON CONFLICT (season, game_date, home_team_id, away_team_id) DO UPDATE SET
    home_score = excluded.home_score, away_score = excluded.away_score,
    ml_home_consensus_prob = excluded.ml_home_consensus_prob,
    ml_away_consensus_prob = excluded.ml_away_consensus_prob,
    total_line = excluded.total_line,
    total_over_consensus_prob = excluded.total_over_consensus_prob,
    total_under_consensus_prob = excluded.total_under_consensus_prob,
    source = excluded.source, book_count = excluded.book_count
`);
function writeRows(rows) {
  const run = db.transaction((items) => { for (const r of items) upsert.run(r); });
  run(rows);
  return rows.length;
}

// --- SBR xlsx (2010-2020) ---
function parseSbrDate(raw, season) {
  const str = String(raw).padStart(4, '0');
  return `${season}-${str.slice(0, 2)}-${str.slice(2, 4)}`;
}
function findColIndex(header, candidates) {
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  for (const c of candidates) {
    const i = header.findIndex((h) => h != null && norm(h) === norm(c));
    if (i !== -1) return i;
  }
  return -1;
}
function ingestSbrXlsx(filePath, season) {
  const summary = { source: `sbr-xlsx-${season}`, rowsRead: 0, gamesWritten: 0, unresolvedTeams: new Set(), skippedNoMatchup: 0 };
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (rows.length < 2) return summary;

  const header = rows[0];
  const colDate = findColIndex(header, ['Date']);
  const colRot = findColIndex(header, ['Rot']);
  const colVh = findColIndex(header, ['VH']);
  const colTeam = findColIndex(header, ['Team']);
  const colFinal = findColIndex(header, ['Final']);
  const colClose = findColIndex(header, ['Close']);
  const colCloseOU = findColIndex(header, ['Close OU', 'CloseOU']);
  const colCloseOUPrice = colCloseOU !== -1 ? colCloseOU + 1 : -1;

  // Rotation numbers reset/repeat daily, so the pair key must be scoped to
  // the date — keying by rotation number alone across the whole season
  // collides every day that reused the same number and silently drops
  // nearly all games (caught via a written-count sanity check).
  const byRot = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[colRot] == null) continue;
    summary.rowsRead += 1;
    const rot = Number(r[colRot]);
    const dateKey = String(r[colDate]);
    const pairKey = `${dateKey}|${rot % 2 === 0 ? rot - 1 : rot}`;
    const list = byRot.get(pairKey) ?? [];
    list.push(r);
    byRot.set(pairKey, list);
  }

  const entries = [];
  for (const [, pair] of byRot) {
    if (pair.length !== 2) { summary.skippedNoMatchup += 1; continue; }
    const vRow = pair.find((r) => r[colVh] === 'V');
    const hRow = pair.find((r) => r[colVh] === 'H');
    if (!vRow || !hRow) { summary.skippedNoMatchup += 1; continue; }

    const awayAbbr = String(vRow[colTeam] ?? '');
    const homeAbbr = String(hRow[colTeam] ?? '');
    const awayId = resolveTeamAbbr(awayAbbr);
    const homeId = resolveTeamAbbr(homeAbbr);
    if (!awayId) summary.unresolvedTeams.add(awayAbbr);
    if (!homeId) summary.unresolvedTeams.add(homeAbbr);
    if (!awayId || !homeId) continue;

    const gameDate = parseSbrDate(Number(vRow[colDate]), season);

    const awayClose = colClose !== -1 ? Number(vRow[colClose]) : NaN;
    const homeClose = colClose !== -1 ? Number(hRow[colClose]) : NaN;
    let mlHomeProb = null, mlAwayProb = null;
    if (Number.isFinite(awayClose) && Number.isFinite(homeClose)) {
      const d = devigTwoWay(americanToDecimal(awayClose), americanToDecimal(homeClose));
      if (d) { mlAwayProb = d.a; mlHomeProb = d.b; }
    }

    let totalLine = null, overProb = null, underProb = null;
    if (colCloseOU !== -1 && colCloseOUPrice !== -1) {
      const lineVal = Number(vRow[colCloseOU]);
      const overPrice = Number(vRow[colCloseOUPrice]);
      const underPrice = Number(hRow[colCloseOUPrice]);
      if (Number.isFinite(lineVal)) totalLine = lineVal;
      if (Number.isFinite(overPrice) && Number.isFinite(underPrice)) {
        const d = devigTwoWay(americanToDecimal(overPrice), americanToDecimal(underPrice));
        if (d) { overProb = d.a; underProb = d.b; }
      }
    }

    const homeFinal = Number(hRow[colFinal]);
    const awayFinal = Number(vRow[colFinal]);

    entries.push({
      season, gameDate, homeTeamId: homeId, awayTeamId: awayId,
      homeScore: Number.isFinite(homeFinal) ? homeFinal : null,
      awayScore: Number.isFinite(awayFinal) ? awayFinal : null,
      mlHomeConsensusProb: mlHomeProb, mlAwayConsensusProb: mlAwayProb,
      totalLine, totalOverConsensusProb: overProb, totalUnderConsensusProb: underProb,
      source: 'sbr-xlsx', bookCount: 1,
    });
  }

  summary.gamesWritten = writeRows(entries);
  summary.unresolvedTeams = [...summary.unresolvedTeams];
  return summary;
}

// --- long CSV (2021-2025) ---
function parseCsvLine(line) { return line.split(','); }
function ingestLongCsv(filePath) {
  const summary = { source: 'long-csv', rowsRead: 0, gamesWritten: 0, unresolvedTeams: new Set(), skippedNoMatchup: 0 };
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const header = parseCsvLine(lines[0]);
  const idx = {};
  header.forEach((h, i) => (idx[h.trim()] = i));

  const byGame = new Map();
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
    if (!homeId) summary.unresolvedTeams.add(homeAbbr);
    if (!awayId) summary.unresolvedTeams.add(awayAbbr);
    if (!homeId || !awayId) continue;

    const key = `${season}|${dateStr}|${homeId}|${awayId}`;
    const entry = byGame.get(key) ?? {
      season, gameDate: dateStr, homeId, awayId,
      homeScore: row[idx.home_score] !== '' ? Number(row[idx.home_score]) : null,
      awayScore: row[idx.away_score] !== '' ? Number(row[idx.away_score]) : null,
      mlHomeOdds: [], mlAwayOdds: [], totalLines: [], totalOverOdds: [], totalUnderOdds: [],
    };

    const market = row[idx.market];
    if (market === 'moneyline') {
      const closeHome = Number(row[idx.close_home]);
      const closeAway = Number(row[idx.close_away]);
      if (Number.isFinite(closeHome) && Number.isFinite(closeAway)) {
        entry.mlHomeOdds.push(closeHome);
        entry.mlAwayOdds.push(closeAway);
      }
    } else if (market === 'total') {
      const closeTotal = Number(row[idx.close_total]);
      const closeHome = Number(row[idx.close_home]);
      const closeAway = Number(row[idx.close_away]);
      if (Number.isFinite(closeTotal)) entry.totalLines.push(closeTotal);
      if (Number.isFinite(closeHome) && Number.isFinite(closeAway)) {
        entry.totalOverOdds.push(closeHome);
        entry.totalUnderOdds.push(closeAway);
      }
    }
    byGame.set(key, entry);
  }

  const entries = [];
  for (const g of byGame.values()) {
    let mlHomeProb = null, mlAwayProb = null, bookCount = 0;
    if (g.mlHomeOdds.length > 0) {
      const homeProbs = [], awayProbs = [];
      for (let i = 0; i < g.mlHomeOdds.length; i++) {
        const d = devigTwoWay(americanToDecimal(g.mlAwayOdds[i]), americanToDecimal(g.mlHomeOdds[i]));
        if (d) { awayProbs.push(d.a); homeProbs.push(d.b); }
      }
      if (homeProbs.length > 0) {
        mlHomeProb = homeProbs.reduce((s, v) => s + v, 0) / homeProbs.length;
        mlAwayProb = awayProbs.reduce((s, v) => s + v, 0) / awayProbs.length;
        bookCount = homeProbs.length;
      }
    }

    let totalLine = null, overProb = null, underProb = null;
    if (g.totalLines.length > 0) {
      totalLine = g.totalLines.reduce((s, v) => s + v, 0) / g.totalLines.length;
      const overProbs = [], underProbs = [];
      for (let i = 0; i < g.totalOverOdds.length; i++) {
        const d = devigTwoWay(americanToDecimal(g.totalOverOdds[i]), americanToDecimal(g.totalUnderOdds[i]));
        if (d) { overProbs.push(d.a); underProbs.push(d.b); }
      }
      if (overProbs.length > 0) {
        overProb = overProbs.reduce((s, v) => s + v, 0) / overProbs.length;
        underProb = underProbs.reduce((s, v) => s + v, 0) / underProbs.length;
      }
    }

    entries.push({
      season: g.season, gameDate: g.gameDate, homeTeamId: g.homeId, awayTeamId: g.awayId,
      homeScore: g.homeScore, awayScore: g.awayScore,
      mlHomeConsensusProb: mlHomeProb, mlAwayConsensusProb: mlAwayProb,
      totalLine, totalOverConsensusProb: overProb, totalUnderConsensusProb: underProb,
      source: 'long-csv', bookCount,
    });
  }

  summary.gamesWritten = writeRows(entries);
  summary.unresolvedTeams = [...summary.unresolvedTeams];
  return summary;
}

// --- run ---
const summaries = [];
for (const season of XLSX_SEASONS) {
  const p = path.join(IMPORT_DIR, `mlb-odds-${season}.xlsx`);
  if (!fs.existsSync(p)) { console.log('missing:', p); continue; }
  summaries.push(ingestSbrXlsx(p, season));
}
const longCsvPath = path.join(IMPORT_DIR, 'mlb_games_odds_2021_2025_all_books_long.csv');
if (fs.existsSync(longCsvPath)) summaries.push(ingestLongCsv(longCsvPath));

for (const s of summaries) {
  console.log(`${s.source}: read=${s.rowsRead} written=${s.gamesWritten} skippedPairs=${s.skippedNoMatchup} unresolvedTeams=${JSON.stringify(s.unresolvedTeams)}`);
}

const coverage = db.prepare('SELECT season, source, COUNT(*) AS games FROM historical_odds GROUP BY season, source ORDER BY season').all();
console.log('\ncoverage:', JSON.stringify(coverage, null, 1));
db.close();
