/**
 * Court surface + venue coordinates for ATP/WTA tournaments.
 *
 * ESPN's tennis feeds carry no `surface` field anywhere — checked live
 * against the scoreboard event, competition and venue objects — so this is
 * the same shape of gap `golf/venues.ts`/`golf/tournamentLogos.ts` already
 * hand-fill: a small static table, keyed by normalized tournament name.
 *
 * The ATP half of this table is keyed on the REAL, live 2026 ATP season
 * names (all 60 events), pulled directly from `?dates=2026` while building
 * this rather than guessed — ESPN's tennis naming carries title-sponsor
 * prefixes/suffixes that vary every season ("Rio Open presented by Claro",
 * "BMW Open by Bitpanda", "Abierto Mexicano Telcel presentado por HSBC"),
 * and a guessed generic name ("Mexican Open", "Munich Open") silently
 * missed almost every one of them on the first pass — caught live by
 * checking the actual rendered page against this table, not assumed. The
 * WTA half is not yet build against real WTA names the same way — that's
 * this table's next real gap to close when WTA gets built.
 *
 * `tournamentSurface`/`tournamentVenueCoords` both degrade to `null` for
 * anything not in the table — the caller renders nothing, never a guess.
 */

import { geocode, type Coordinates } from '../../weather/openMeteo';

export type CourtSurface = 'hard' | 'clay' | 'grass';

const SURFACES: Record<string, CourtSurface> = {
  // Grand Slams (shared ATP/WTA naming)
  'australian open': 'hard',
  'french open': 'clay',
  'roland garros': 'clay',
  wimbledon: 'grass',
  'us open': 'hard',

  // Real 2026 ATP season, in calendar order — see this file's header for why
  // these are the live names, not generic guesses.
  'brisbane international': 'hard',
  'asb classic': 'hard',
  'bank of china hong kong tennis open': 'hard',
  'adelaide international': 'hard',
  'open occitanie': 'hard',
  'abn amro open': 'hard',
  'ieb argentina open': 'clay',
  'nexo dallas open': 'hard',
  'dubai duty free tennis championships': 'hard',
  'qatar exxonmobil open': 'hard',
  'delray beach open': 'hard',
  'rio open': 'clay',
  'bci seguros chile open': 'clay',
  'abierto mexicano telcel': 'hard',
  'bnp paribas open': 'hard', // Indian Wells
  'miami open': 'hard',
  'fayez sarofim co us mens clay court championship': 'clay', // Houston
  'grand prix hassan ii': 'clay',
  'tiriac open': 'clay', // Bucharest
  'rolex montecarlo masters': 'clay',
  'bmw open': 'clay', // Munich
  'barcelona open banc sabadell': 'clay',
  'mutua madrid open': 'clay',
  'internazionali bnl ditalia': 'clay', // Rome
  'gonet geneva open': 'clay',
  'bitpanda hamburg open': 'clay',
  'boss open': 'grass', // Stuttgart
  'libema open': 'grass', // s-Hertogenbosch — "Libéma Open" folds to this via normalize()'s diacritic strip
  'terra wortmann open': 'grass', // Halle
  'hsbc championships': 'grass', // Queen's Club
  'lexus eastbourne open': 'grass',
  'vanda pharmaceuticals mallorca championships': 'grass',
  'nordea open': 'clay', // Bastad
  'efg swiss open gstaad': 'clay',
  'plava laguna croatia open umag': 'clay',
  'generali open': 'clay', // Kitzbuhel
  'millennium estoril open': 'clay',
  'mifel tennis open': 'hard', // Los Cabos
  'mubadala dc open': 'hard', // Washington
  'national bank open': 'hard', // Toronto/Montreal
  'cincinnati open': 'hard',
  'winstonsalem open': 'hard',
  'chengdu open': 'hard',
  'hangzhou open': 'hard',
  'kinoshita group japan open tennis championships': 'hard', // Tokyo
  'china open': 'hard', // Beijing
  'rolex shanghai masters': 'hard',
  'bnp paribas fortis european open': 'hard', // Belgium, indoor
  'grand prix auvergnerhonealpes': 'hard', // Lyon, indoor
  'almaty open': 'hard', // indoor
  'erste bank open': 'hard', // Vienna, indoor
  'swiss indoors basel': 'hard', // indoor
  'rolex paris masters': 'hard', // indoor
  'bybit stockholm open': 'hard', // indoor
  'nitto atp finals': 'hard', // Turin, indoor
  'next gen atp finals': 'hard', // indoor

  // WTA-only stops confirmed against the real 2026 WTA season (`?dates=2026`
  // on the wta scoreboard) — the majors and combined ATP/WTA 1000s above
  // (Indian Wells, Miami, Madrid, Rome, Canada, Cincinnati) already cover
  // WTA too since both tours use the identical event name for those. This
  // section is deliberately NOT exhaustive — the real WTA calendar runs
  // 90+ events a year once $125k/ITF-adjacent stops are counted, and only
  // the Premier/500-level, more recognizable ones are covered here; the rest
  // fall through to `null` honestly rather than a guess.
  'workday canberra international': 'hard',
  'hobart international': 'hard',
  'credit one charleston open': 'clay',
  'porsche tennis grand prix': 'clay', // Stuttgart, indoor
  'lexus birmingham open': 'grass',
  'vanda pharmaceuticals berlin tennis open': 'grass',
  'lexus nottingham open': 'grass',
  'lexus ilkley open': 'grass',
};

/**
 * Lowercase, fold diacritics (Libéma → libema, Rhône → rhone), strip a
 * trailing title-sponsor tail ("presented by X" / "presentado por X" / "by
 * X"), strip remaining punctuation (including hyphens — "Winston-Salem"
 * fuses to "winstonsalem", not "winston salem", confirmed live this is what
 * ESPN's own naming needs to match against), collapse whitespace.
 */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bpresentado por.*$/i, '')
    .replace(/\bpresented by.*$/i, '')
    .replace(/\bpowered by.*$/i, '')
    .replace(/\bpres\.? by.*$/i, '')
    .replace(/\bby\s+.+$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Real, hand-curated surface for a known tournament — `null` when not in the table yet, never a guess. */
export function tournamentSurface(tournamentName: string): CourtSurface | null {
  return SURFACES[normalize(tournamentName)] ?? null;
}

const VENUE_COORDS: Record<string, { latitude: number; longitude: number }> = {
  'melbourne australia': { latitude: -37.8136, longitude: 144.9631 },
  'paris france': { latitude: 48.8472, longitude: 2.2494 }, // Roland Garros
  'london great britain': { latitude: 51.4343, longitude: -0.214 }, // Wimbledon / Queen's
  'new york usa': { latitude: 40.7498, longitude: -73.8459 }, // US Open (Flushing Meadows)
  'indian wells usa': { latitude: 33.7206, longitude: -116.305 },
  'miami usa': { latitude: 25.9581, longitude: -80.2389 },
  'monte carlo monaco': { latitude: 43.7384, longitude: 7.4246 },
  'madrid spain': { latitude: 40.4459, longitude: -3.7295 },
  'rome italy': { latitude: 41.9331, longitude: 12.4828 },
  'toronto canada': { latitude: 43.6629, longitude: -79.3957 },
  'montreal canada': { latitude: 45.5304, longitude: -73.5518 },
  'cincinnati usa': { latitude: 39.227, longitude: -84.4383 },
  'shanghai china': { latitude: 31.1979, longitude: 121.3903 },
  'basel switzerland': { latitude: 47.5386, longitude: 7.5964 },
  'vienna austria': { latitude: 48.1904, longitude: 16.4189 },
  'turin italy': { latitude: 45.0703, longitude: 7.6869 }, // ATP Finals
  'dubai united arab emirates': { latitude: 25.2117, longitude: 55.2668 },
  'doha qatar': { latitude: 25.2761, longitude: 51.525 },
  'rotterdam netherlands': { latitude: 51.9007, longitude: 4.4831 },
  'barcelona spain': { latitude: 41.3927, longitude: 2.1518 },
  'halle germany': { latitude: 51.9169, longitude: 8.333 },
  'eastbourne great britain': { latitude: 50.7684, longitude: 0.2905 },
  'washington usa': { latitude: 38.9134, longitude: -77.0725 },
  'tokyo japan': { latitude: 35.6437, longitude: 139.7565 },
  'winstonsalem usa': { latitude: 36.0999, longitude: -80.2442 },
  'houston usa': { latitude: 29.7174, longitude: -95.4018 },
  'munich germany': { latitude: 48.1785, longitude: 11.5469 },
  'geneva switzerland': { latitude: 46.2044, longitude: 6.1432 },
  'estoril portugal': { latitude: 38.7071, longitude: -9.3977 },
  'umag croatia': { latitude: 45.4342, longitude: 13.5253 },
  'bastad sweden': { latitude: 56.4283, longitude: 12.8508 },
  'newport usa': { latitude: 41.4901, longitude: -71.3128 },
  'adelaide australia': { latitude: -34.9285, longitude: 138.6007 },
  'brisbane australia': { latitude: -27.4698, longitude: 153.0251 },
  'auckland new zealand': { latitude: -36.8485, longitude: 174.7633 },
};

/**
 * Coordinates for a tournament's venue — exact, hand-curated for the venues
 * above; falls back to a live city-level geocode of ESPN's own
 * `venue.displayName` (e.g. "New York, USA") for anything not in this table,
 * same graceful-degrade chain `golf/venues.ts` uses for its own courses.
 */
export async function tournamentVenueCoords(venueCity: string | null): Promise<Coordinates | null> {
  if (!venueCity) return null;
  const key = normalize(venueCity);
  const hit = VENUE_COORDS[key];
  if (hit) return { ...hit, resolvedName: venueCity, approximate: false };

  const [city, country] = venueCity.split(',').map((s) => s.trim());
  return geocode({ city: city || venueCity, country });
}
