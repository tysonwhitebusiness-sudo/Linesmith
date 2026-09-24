# P1 · Fix what is broken now

**Lane:** app (TypeScript) + Python. **Deploys:** one Render deploy ⚑ (the
Python fix). **Needs:** P0 done, the operator's green light.
**Goal:** today's odds pages stop showing four known bugs, and game-line
history stops losing line moves. No design change: that is P8.
**Audit findings covered:** F5, F14 (O0).

---

## Root causes (traced 2026-09-24)

| # | bug | root cause |
|---|---|---|
| 1 | Player page "Game line" card says **"No game line yet — No book has priced this matchup"** while the game page shows lines | `components/PlayerDetail.tsx:1682` reads `data.model?.todaysLine`, and **only MLB's adapter sets it** (`lib/sports/mlb/adapters/playerDetailAdapter.ts:535–550`, from MLB's model snapshot). NFL, CFB, NBA, NHL, soccer and tennis never set `model`, so the card is always empty for them. The data exists: `/api/odds/lines?sport=` (a pure read of `game_odds_book_lines` since Phase 6; `useGameLines` in `components/useGameLines.ts`) returns every sport's `UnifiedGameLine`s, keyed by `eventId` = the sport's game id, and the player page already knows the game id as `gamePkStr` (`PlayerDetail.tsx:876`, from the candidate's `subjectMeta.gamePk`). |
| 2 | Raw market keys on the game page (`longest-rush`, `kicking-points`) | Each sport's game-research adapter has its own label map and falls back to the raw key (`FOOTBALL_MARKET_LABELS[p.market] ?? p.market`, `lib/sports/nfl/adapters/footballGameResearch.ts:465, 615, 714`). The football map lacks canonical keys the alias map produces (`longest-rush`, `kicking-points`, `receiving-tds`, `interceptions-thrown`, `longest-completion`, `field-goals-made`, `rush-rec-tds`, `first-td-scorer`, `passing-completions`, `rushing-tds`, …) and spells others differently (`interceptions`, `completions`). The canonical set is `CANONICAL_MARKET_KEYS` in `lib/odds/props/entityResolution.ts:385`: **72 keys**. |
| 3 | Book names: `parx parx`, lower-case `bet365` / `fanatics` | `components/BookLogo.tsx` has labels and logo domains for **15** books; any other id prints raw. `BookLogo` with no logo domain renders its **text label** as the fallback, and two callers print the label again beside it: `components/PropOddsPanel.tsx:56–57` and `components/slate/SlateMarket.tsx:64–65`, hence "parx parx". The app's canonical bookmakers are the **40** values of `BOOKMAKER_ALIASES` (`entityResolution.ts:302`). |
| 4 | A best price with no book name ("Prices by market") | `components/PlayerOddsSection.tsx:120` renders `<BookLogo bookId={q.bookmaker} size={14} />` with no label, so the name exists only in the tooltip, and a generic favicon reads as "no book". |
| 5 | **Game-line history misses line moves** (F5) | `python-odds-service/src/db.py` `write_game_odds_history`: the prior row is read per (event, market, side, book, source) and a row is logged only when `american_odds` differs (`db.py:1997`). −4.5 −110 → −5.5 −110 is never recorded. |

---

## Build

### 1. Game line on every sport's player page

**New file `lib/sports/shared/todaysLine.ts`:**

```ts
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { TodaysLineData } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

/**
 * The player's game's line, from the same game_odds_book_lines read the game
 * page and the Slate use (/api/odds/lines). Sport-agnostic: every sport's
 * UnifiedGameLine.eventId is that sport's game id, the same id a candidate
 * carries as subjectMeta.gamePk. No model fields: the edges are MLB's model
 * and stay on model.todaysLine.
 */
export function todaysLineFromGameLines(
  lines: readonly UnifiedGameLine[] | null | undefined,
  gameId: string | undefined,
): TodaysLineData | null
```

- `gameId` missing, or no line with `eventId === gameId` → `null`.
- `moneyline`: set only if the line's `moneyline.home`, `moneyline.away` and
  `moneyline.book` are all present →
  `{ away, home, book, source: 'game_odds_book_lines' }`, else `null`.
- `total`: set only if `total.point`, `overPrice`, `underPrice` and `book`
  are all present → `{ point, overPrice, underPrice, book, source: 'game_odds_book_lines' }`,
  else `null`.
- `liveScore` and `livePeriod` are copied from the line.
- Neither moneyline nor total → `null`.

**`PlayerDetailData`** (declared in `lib/sports/mlb/adapters/playerDetailAdapter.ts`)
gains:

```ts
/** P1 (odds workstream): the player's game's line for sports without a game model. Every
 *  non-MLB sport's player page showed "No game line yet" because only MLB filled
 *  model.todaysLine. MLB keeps model.todaysLine (it carries the model's edges). */
gameLine?: TodaysLineData | null;
```

**Six adapters set it:** nfl, cfb, nba, nhl, soccer and tennis
(`lib/sports/<sport>/adapters/playerDetailAdapter.ts`, `toPlayerDetailData`).
- Each input type gains `gameLines?: readonly UnifiedGameLine[] | null`.
- Each return gains:
  `gameLine: todaysLineFromGameLines(input.gameLines, gamePkOf(active))`,
  where `gamePkOf` is a new exported helper in `todaysLine.ts`: `subjectMeta.gamePk`
  as a string, or `undefined`.
- Golf is untouched (no game).

**`components/PlayerDetail.tsx`:**
- Call `const gameLines = useGameLines((active?.sport ?? 'mlb') as Sport, snapshot?.fetchedAt ?? null);`
  unconditionally, beside the other data hooks near line 959 (hooks run
  unconditionally; golf's call returns nothing, per `useGameLines`).
- Pass `gameLines: gameLines.result?.lines ?? null` into the six adapter
  calls.
- Line 1682 becomes `const todays = data.model?.todaysLine ?? data.gameLine ?? null;`.
- The card's empty text stays as it is. It is now true only when no book
  prices the game.

### 2. One market-label registry

**New file `lib/odds/props/marketLabels.ts`:**

```ts
export function marketLabel(key: string, sport?: Sport): string   // never returns the raw key for a canonical key
export const MARKET_LABELS: Readonly<Record<string, string>>        // the 72 canonical keys (table below)
export const SPORT_MARKET_LABELS: Readonly<Partial<Record<Sport, Record<string, string>>>>
```

- Lookup order:
  1. `SPORT_MARKET_LABELS[sport]?.[key]`;
  2. `MARKET_LABELS[key]`;
  3. the legacy keys below;
  4. otherwise, a key not in the canonical set is sentence-cased from its
     hyphens (`'first-inning-runs'` → `'First inning runs'`), and a dev-only
     `console.warn` names it. That fallback exists so an unmapped *new* key
     reads as words, never as a slug; the test below keeps every canonical
     key out of it.
- **Legacy keys** (candidate dimensions and older adapter maps; kept so no
  current label changes):

  | legacy key | label |
  |---|---|
  | `completions` | Completions |
  | `passing-attempts` | Pass attempts |
  | `interceptions` | Interceptions thrown |
  | `pass-rush-yards` | Pass + rush yards |

**The 72 canonical labels** (sentence case, the app's existing style):

| key | label | key | label |
|---|---|---|---|
| aces | Aces | pitcher-hits-allowed | Hits allowed |
| anytime-goalscorer | Anytime goalscorer | pitcher-outs | Outs recorded |
| anytime-td | Anytime TD | pitcher-strikeouts | Strikeouts |
| assists | Assists | pitcher-walks-allowed | Walks allowed |
| batter-strikeouts | Batter strikeouts | pitcher-win | Pitcher win |
| blocked-shots | Blocked shots | points | Points |
| blocks | Blocks | points-assists | Points + assists |
| crosses-attempted | Crosses attempted | points-rebounds | Points + rebounds |
| doubles | Doubles | points-rebounds-assists | Points + rebounds + assists |
| dribbles-attempted | Dribbles attempted | rbis | RBIs |
| earned-runs | Earned runs | rebounds | Rebounds |
| field-goals-made | Field goals made | rebounds-assists | Rebounds + assists |
| first-goalscorer | First goalscorer | receiving-tds | Receiving TDs |
| first-home-run | First home run | receiving-yards | Receiving yards |
| first-td-scorer | First TD scorer | receptions | Receptions |
| games-won | Games won | runs | Runs |
| goals | Goals | runs-rbis | Runs + RBIs |
| goals-against | Goals against | rush-rec-tds | Rush + rec TDs |
| goals-assists | Goals + assists | rush-rec-yards | Rush + rec yards |
| hits | Hits | rushing-attempts | Rushing attempts |
| hits-runs-rbis | Hits + runs + RBIs | rushing-tds | Rushing TDs |
| home-runs | Home runs | rushing-yards | Rushing yards |
| interceptions-thrown | Interceptions thrown | sacks | Sacks |
| kicking-points | Kicking points | saves | Saves |
| last-goalscorer | Last goalscorer | shots | Shots |
| longest-completion | Longest completion | shots-on-goal | Shots on goal |
| longest-reception | Longest reception | shots-on-target | Shots on target |
| longest-rush | Longest rush | singles | Singles |
| pass-attempts | Pass attempts | steals | Steals |
| passes-attempted | Passes attempted | stolen-bases | Stolen bases |
| passing-completions | Completions | tackles | Tackles |
| passing-tds | Passing TDs | three-pointers-made | Threes made |
| passing-yards | Passing yards | to-win-a-set | To win a set |
| total-bases | Total bases | triples | Triples |
| turnovers | Turnovers | two-plus-goals | 2+ goals |
| walks | Walks | yellow-cards | Yellow cards |

**Sport overrides** (the same key means something different): `nfl` and `cfb`: `assists` → "Tackle assists" (the football map's current wording; in the NBA and NHL `assists` is assists). Any further override comes only from the diff below, never from guessing.

**Replace every raw-key fallback with `marketLabel(key, sport)`:**
- `lib/sports/nfl/adapters/footballGameResearch.ts`: delete
  `FOOTBALL_MARKET_LABELS` (lines 26–44) and use it at lines 465, 615 and
  714.
- `lib/sports/mlb/adapters/mlbGameResearch.ts`,
  `nba/adapters/nbaGameResearch.ts`, `nhl/adapters/nhlGameResearch.ts`,
  `soccer/adapters/soccerGameResearch.ts`,
  `tennis/adapters/tennisGameResearch.ts` and `lib/sports/propRanking.ts`:
  replace each local map lookup with its `?? key` fallback.
- `lib/sports/nfl/adapter.ts:161` `MARKET_LABELS` and
  `lib/sports/cfb/adapter.ts:34` label entries: replace them. Where a
  sport's adapter needs its own wording, it goes in `SPORT_MARKET_LABELS`,
  not a local map.
- Before deleting each local map, **diff its labels against the table**. Any
  label that differs keeps the current wording as a sport override, so no
  visible label changes except the fills.

### 3. One book registry

**New file `lib/odds/books/registry.ts`:**

```ts
export type BookGroup = 'sharp' | 'exchange' | 'us' | 'nevada' | 'offshore' | 'intl' | 'pickem';
export const BOOK_GROUP_ORDER: readonly BookGroup[] = ['sharp', 'exchange', 'us', 'nevada', 'offshore', 'intl', 'pickem'];  // D18
export interface BookEntry { label: string; group: BookGroup; domain: string | null }
export const BOOKS: Readonly<Record<string, BookEntry>>;           // the table below
export function bookEntry(id: string | null | undefined): BookEntry | null
export function bookLabel(id: string | null | undefined): string   // registry label; unknown id -> id with a dev-only warn
export function bookLogoUrl(id: string | null | undefined, px = 32): string | undefined  // Google favicon proxy, as today
export function bookGroup(id: string | null | undefined): BookGroup // unknown -> 'intl'
```

- The **87 entries** come from the approved mockup's book map
  (`docs/design/odds-rebuild/om-data.js` → `OM.books`, which the scraper's
  `canonical_book` built), plus the 9 canonical books the mockup never met,
  plus `williamhill_us` (already in `BookLogo`). The ids "no — P2 adds it"
  are scraper book keys the app's alias maps do not yet know. Their registry
  rows exist now so P2 only touches the alias maps.

| id | label | group | logo domain | in app alias map today |
|---|---|---|---|---|
| `circa` | Circa | sharp | `circasports.com` | yes |
| `pinnacle` | Pinnacle | sharp | `pinnacle.com` | yes |
| `betfairexchange` | Betfair Exchange | exchange | `betfair.com` | no — P2 adds it |
| `kalshi` | Kalshi | exchange | `kalshi.com` | yes |
| `matchbook` | Matchbook | exchange | `matchbook.com` | yes |
| `novig` | Novig | exchange | `novig.us` | yes |
| `polymarket` | Polymarket | exchange | `polymarket.com` | yes |
| `polymarketus` | Polymarket US | exchange | `polymarket.com` | no — P2 adds it |
| `prophetx` | ProphetX | exchange | `prophetx.co` | yes |
| `smarkets` | Smarkets | exchange | `smarkets.com` | yes |
| `ballybet` | Bally Bet | us | `ballybet.com` | yes |
| `bet365` | bet365 | us | `bet365.com` | yes |
| `betanything` | BetAnything | us | `betanything.com` | no — P2 adds it |
| `betmgm` | BetMGM | us | `betmgm.com` | yes |
| `betparx` | betPARX | us | `betparx.com` | yes |
| `betrivers` | BetRivers | us | `betrivers.com` | yes |
| `caesars` | Caesars | us | `caesars.com` | yes |
| `williamhill_us` | Caesars | us | `caesars.com` | yes |
| `courtside` | Courtside | us | `courtside.com` | no — P2 adds it |
| `draftkings` | DraftKings | us | `draftkings.com` | yes |
| `espnbet` | ESPN BET | us | `espnbet.com` | yes |
| `fanatics` | Fanatics | us | `sportsbook.fanatics.com` | yes |
| `fanduel` | FanDuel | us | `fanduel.com` | yes |
| `fliff` | Fliff | us | `getfliff.com` | yes |
| `hardrockbet` | Hard Rock Bet | us | `hardrock.bet` | yes |
| `parx` | Parx | us | `betparx.com` | yes |
| `rebet` | Rebet | us | — (monogram) | yes |
| `riverscasino` | Rivers | us | `riverscasino.com` | no — P2 adds it |
| `sugarhouse` | SugarHouse | us | `playsugarhouse.com` | no — P2 adds it |
| `thescore` | theScore Bet | us | `thescore.bet` | yes |
| `wynnbet` | WynnBET | us | `wynnbet.com` | yes |
| `betmgmnv` | BetMGM NV | nevada | `betmgm.com` | no — P2 adds it |
| `boomers` | Boomers | nevada | `boomerslv.com` | no — P2 adds it |
| `caesarsnv` | Caesars NV | nevada | `caesars.com` | no — P2 adds it |
| `southpoint` | South Point | nevada | `southpointcasino.com` | no — P2 adds it |
| `stations` | Station Casinos | nevada | `stationcasinos.com` | no — P2 adds it |
| `wynn` | Wynn | nevada | `wynnbet.com` | no — P2 adds it |
| `aceshigh` | Aces High | offshore | `aceshigh.ag` | no — P2 adds it |
| `bet105` | Bet105 | offshore | `bet105.ag` | no — P2 adds it |
| `betanysports` | BetAnySports | offshore | `betanysports.eu` | no — P2 adds it |
| `betonline` | BetOnline | offshore | `betonline.ag` | yes |
| `betus` | BetUS | offshore | `betus.com.pa` | yes |
| `bodog` | Bodog | offshore | `bodog.eu` | yes |
| `bookmaker` | Bookmaker | offshore | `bookmaker.eu` | no — P2 adds it |
| `bovada` | Bovada | offshore | `bovada.lv` | yes |
| `everygame` | Everygame | offshore | `everygame.eu` | no — P2 adds it |
| `gtbets` | GTbets | offshore | `gtbets.ag` | no — P2 adds it |
| `heritage` | Heritage | offshore | `heritagesports.eu` | no — P2 adds it |
| `justbet` | JustBet | offshore | `justbet.cx` | no — P2 adds it |
| `lowvig` | LowVig | offshore | `lowvig.ag` | yes |
| `mybookie` | MyBookie | offshore | `mybookie.ag` | yes |
| `10bet` | 10bet | intl | `10bet.com` | yes |
| `onexbet` | 1xBet | intl | `1xbet.com` | yes |
| `888sport` | 888sport | intl | `888sport.com` | no — P2 adds it |
| `betano` | Betano | intl | `betano.com` | no — P2 adds it |
| `betfairsportsbook` | Betfair Sportsbook | intl | `betfair.com` | no — P2 adds it |
| `betrsportsbook` | Betr | intl | `betr.com.au` | no — P2 adds it |
| `betsson` | Betsson | intl | `betsson.com` | no — P2 adds it |
| `betvictor` | BetVictor | intl | `betvictor.com` | no — P2 adds it |
| `betway` | Betway | intl | `betway.com` | no — P2 adds it |
| `boylesports` | BoyleSports | intl | `boylesports.com` | no — P2 adds it |
| `casumo` | Casumo | intl | `casumo.com` | no — P2 adds it |
| `coolbet` | Coolbet | intl | `coolbet.com` | no — P2 adds it |
| `coral` | Coral | intl | `coral.co.uk` | no — P2 adds it |
| `grosvenor` | Grosvenor | intl | `grosvenorcasinos.com` | no — P2 adds it |
| `ladbrokes` | Ladbrokes | intl | `ladbrokes.com.au` | no — P2 adds it |
| `leovegas` | LeoVegas | intl | `leovegas.com` | no — P2 adds it |
| `livescorebet` | LiveScore Bet | intl | `livescorebet.com` | no — P2 adds it |
| `marathonbet` | Marathonbet | intl | `marathonbet.com` | no — P2 adds it |
| `neds` | Neds | intl | `neds.com.au` | no — P2 adds it |
| `nordicbet` | NordicBet | intl | `nordicbet.com` | no — P2 adds it |
| `paddypower` | Paddy Power | intl | `paddypower.com` | no — P2 adds it |
| `playup` | PlayUp | intl | `playup.com.au` | no — P2 adds it |
| `pointsbet` | PointsBet | intl | `pointsbet.com.au` | yes |
| `sportsbet` | Sportsbet | intl | `sportsbet.com.au` | no — P2 adds it |
| `tab` | TAB | intl | `tab.com.au` | no — P2 adds it |
| `tabau` | TAB (AU) | intl | `tab.com.au` | yes |
| `tabtouch` | TABtouch | intl | `tabtouch.com.au` | no — P2 adds it |
| `tipico` | Tipico | intl | `tipico.com` | no — P2 adds it |
| `unibet` | Unibet | intl | `unibet.com` | yes |
| `virginbet` | Virgin Bet | intl | `virginbet.com` | no — P2 adds it |
| `williamhill` | William Hill | intl | `williamhill.com` | no — P2 adds it |
| `betr` | Betr | pickem | `betr.app` | yes |
| `pick6` | DraftKings Pick6 | pickem | `pick6.draftkings.com` | yes |
| `prizepicks` | PrizePicks | pickem | `prizepicks.com` | yes |
| `sleeper` | Sleeper | pickem | `sleeper.com` | yes |
| `underdog` | Underdog | pickem | `underdogfantasy.com` | yes |

- `components/BookLogo.tsx`: delete `BOOK_DOMAIN`/`BOOK_LABEL`; import
  `bookLabel` and `bookLogoUrl` from the registry and **re-export them**, so
  the 6 files importing `bookLabel` from `./BookLogo` keep working.
- **Fallback without a logo:** when `url` is missing or failed and
  `withLabel` is false, render a 1-letter monogram tile (size × size,
  `bg-ink` / `text-paper`, first alphanumeric of the label). It no longer
  prints the label text. When `withLabel` is true, render the tile plus the
  label.
- **Call sites:**
  - `components/PropOddsPanel.tsx:56–57` becomes `<BookLogo bookId={book} size={14} withLabel />`
    (drop the separate `{bookLabel(book)}`);
  - `components/slate/SlateMarket.tsx:64–65` gets the same;
  - `components/PlayerOddsSection.tsx:120` gains `withLabel`.
- `components/ScanTable.tsx:219` is frozen (D3) and **not** edited. Its only
  visible change is the monogram tile replacing text for a book with no
  logo, which is `BookLogo`'s behaviour, not Scan's markup.
  `tests/slate-shell.test.ts` hashes `ScanTable.tsx`/`ScanCard.tsx`, not
  `BookLogo.tsx`, so it stays green.

### 4. Game-line history logs line moves — `python-odds-service/src/db.py`

In `write_game_odds_history`:
- The prior query selects `american_odds, point`
  (`SELECT DISTINCT ON (...) event_id, market, side, bookmaker, source, american_odds, point`).
- `prior` maps key → `(american_odds, point)`.
- `changed = [r for k, r in latest_in_batch.items() if prior.get(k) != (r.american_odds, r.point)]`.
  Python's `None == None` handles moneyline's null point.
- Add a paragraph to the docstring: *"A line move at the same price is a
  change (P1, 2026-09-24): −4.5 −110 → −5.5 −110 was never logged, so every
  game-line chart missed pure line moves."*
- No schema change.

### 5. Docs

- `CLAUDE.md`: in "API route caching", `app/api/odds/lines/route.ts` is
  still cited as a route with "a documented per-request write side-effect".
  It has been a pure read since Phase 6 (its own comment, line ~169). Move
  it out of that list and cite it as the pattern-2 example instead.
- `docs/CURRENT.md`: a Deploys row for the Render deploy.

---

## Tests (these gate P2)

| test | kind | what it proves |
|---|---|---|
| `tests/todays-line.test.ts` (new) | TS unit | line found by `eventId`; moneyline needs home+away+book; total needs point+both prices+book; neither → `null`; `gameId` undefined → `null`; `gamePkOf` for number and string gamePk |
| `tests/player-game-line.test.ts` (new) | TS | for each of nfl, cfb, nba, nhl, soccer, tennis: the adapter given a fixture candidate (gamePk `G1`) and a fixture `UnifiedGameLine[]` containing `G1` returns `gameLine.moneyline` with the fixture's prices; given lines without `G1` returns `gameLine: null`; golf's adapter output has no `gameLine` |
| `tests/market-labels.test.ts` (new) | TS | every key in `CANONICAL_MARKET_KEYS` (export it from `entityResolution.ts`) gets a label ≠ the key; the football override applies; the 4 legacy keys map; a guard reads the game-research adapter files and fails on the pattern `?? p.market` / `?? marketKey` / `?? key)` next to a label lookup |
| `tests/book-registry.test.ts` (new) | TS | every canonical bookmaker (export `CANONICAL_BOOKMAKERS = new Set(Object.values(BOOKMAKER_ALIASES))`) has an entry with a non-empty label; no two ids share a label except `caesars`/`williamhill_us`; every group is in `BOOK_GROUP_ORDER`; a guard fails if any `.tsx` renders `<BookLogo` immediately followed by `bookLabel(` for the same id |
| `src/test_game_odds_history_point.py` (new) | Python, **live DB**, not CI | writes to `event_id = 'test-p1-point-20260924'`, `source='selftest'`: (a) spread home −4.5 −110 → 1 row; (b) same −4.5 −110 → still 1; (c) −5.5 −110 → 2 rows, the second with point −5.5; (d) −5.5 −115 → 3; (e) moneyline home −140 twice → 1 row (null point). Deletes its rows at start and end. Listed in CI's "Not run here, and why". |
| existing | both | `npm test` (incl. `config-drift`, `slate-shell`, `scan-no-edge`, `game-research-*`), `test_entity_resolution.py`, `test_canonical_bookmaker.py` |
| render | fresh tab, 1440 + 400 | **Player page**, one player per sport (MLB, NFL, CFB, NBA, NHL, soccer, tennis) whose game has lines: the Game line card shows moneyline and total with a book name. **Game page** NFL and CFB: no hyphenated key anywhere in the props lists. **Player page** "Prices by market": every best price shows its book name. **Slate** Market section: no doubled book names. |
| after deploy | live | a real spread move at an unchanged price appears in `game_odds_history` (query by `point` change within 24 h) |

**Exit criteria:**
- every row above passes;
- the deploy is recorded;
- CLAUDE.md is corrected.

## Background checks

None.

## Files touched

- New: `lib/sports/shared/todaysLine.ts`, `lib/odds/props/marketLabels.ts`,
  `lib/odds/books/registry.ts`, and the 4 TS tests and 1 Python test named
  above.
- Edited:
  - `lib/sports/mlb/adapters/playerDetailAdapter.ts` (the type);
  - the six adapters;
  - `components/PlayerDetail.tsx`, `components/BookLogo.tsx`,
    `components/PropOddsPanel.tsx`, `components/slate/SlateMarket.tsx`,
    `components/PlayerOddsSection.tsx`;
  - the seven label-map files listed in §2;
  - `lib/odds/props/entityResolution.ts` (two exports);
  - `python-odds-service/src/db.py`;
  - `CLAUDE.md`, `docs/CURRENT.md`.

## Result

**Built 2026-09-24.** Commit and deploy are recorded in `docs/CURRENT.md` →
Deploys.

- **Game line on every sport's player page:** built as specified.
  `todaysLine.ts` adds `gamePkOf` and `gameSideOf`, and six adapters set
  `gameLine`. Rendered in fresh tabs, the card shows the moneyline:
  - soccer (Matt Edwards, MLS 761830, 1440 + 400): "Polymarket · NYC +212 /
    ATL +133";
  - tennis (Denis Shapovalov, ATP 183412, 400): "DraftKings · Away −386 /
    Home +294".

  Before this, both said "No game line yet". NFL, CFB, NBA and NHL have no
  candidate today whose game has a two-sided moneyline with a book (most
  lines are one book, one side). There, "No game line yet" is true, and the
  data path is covered by `tests/player-game-line.test.ts` for all six.
  MLB: 0 priced lines today; the Skubal page renders without error.
- **Two deviations, both found on the first render:**
  1. **`source`:** the spec said `source: 'game_odds_book_lines'`.
     `OddsChip` (a frozen Scan cell component) reads `source` as provenance,
     and a table name is not one, so every price showed "? Source not
     recorded". The helper now passes the line's own writer
     (`UnifiedGameLine.source`), exactly as MLB does. A merged line is
     tagged `game-odds-book-lines`, which the chip still shows as "?", the
     same as MLB today. Real per-price provenance needs the reader (P5,
     F6) and the rebuilt card (P8 O2); routed there.
  2. **Home/away:** the card labelled `away` with the opponent and `home`
     with the player's team. That is wrong for every player whose team is
     away, and was already wrong on MLB. `TodaysLineData.playerSide` (from
     `subjectMeta.isHome`, set by the helper and by MLB's adapter) now
     labels each price. When the side is unknown (tennis candidates carry
     no `isHome`), it says Away / Home rather than guess a name.
- **Labels:** `marketLabels.ts` holds the 72 canonical labels, the 4 legacy
  keys, and sport overrides taken from a diff of every local map, so no
  existing wording changed:
  - football `assists` → "Tackle assists";
  - MLB "Strikeouts (batter/pitcher)", plus `pitcher-walks`;
  - NBA "Pts + reb" and friends, plus `threes`, `three-pointers`,
    `steals-blocks`;
  - NHL and soccer "Anytime scorer"; soccer "First scorer".

  The six game-research maps are deleted. NFL's and CFB's candidate maps
  were Title Case ("Passing Yards", like every sport's candidates), so they
  use `marketLabelTitle()`. It reproduces all 12 old strings exactly
  (pinned in the test). CFB's map also gated which markets exist; that is
  now `CFB_MARKETS`. `propRanking.ts` had no local map (its label comes from
  the board data), so there was nothing to change. Rendered: NFL game
  401872953 and CFB game 401858234 (400) show no raw market key.
- **Books:** `registry.ts` has 87 entries, generated from §3's table. The
  table named two books "Betr" (`betr` pick'em and `betrsportsbook`
  Australia), which contradicts its own no-duplicates test, so the
  Australian one is "Betr (AU)", like the table's "TAB (AU)". `BookLogo`
  re-exports `bookLabel`/`bookLogoUrl` and draws a monogram tile when there
  is no logo; the three call sites use `withLabel`. Rendered: the NFL
  Slate's outliers read "Parx" (was "parx parx") and "bet365", and the
  player page's "Prices by market" shows "+2200 Fanatics".
- **F5:** `write_game_odds_history` compares `(american_odds, point)`.
  `test_game_odds_history_point.py` passes 6/6 against the live table and
  is listed in CI's "Not run here".
- **CLAUDE.md:** `/api/odds/lines` moved out of the "write side-effect" list
  and cited as the game-line pattern-2 route.
- **Tests:**
  - `npm test` 697/697 before the source/side fixes; re-run after them
    (see the commit);
  - `tsc` clean; `npm run build` clean;
  - `test_entity_resolution` and `test_canonical_bookmaker` pass.
- **Found, not fixed (routed):**
  - **Units bug:** OddsHarvester's bet365 row for NFL 401872950 has
    `awayOdds: 101` beside `homeOdds: 2.6`. Every `BookmakerOdds` price is
    decimal, so 101 is an American price stored as decimal. It is a
    harvester parse or writer bug and needs a ledger row.
  - **Loading state:** the Game line card says "No game line yet" while
    `/api/odds/lines` is still loading, for a few seconds. MLB's card does
    the same; P8's rebuilt card owns its loading state.
