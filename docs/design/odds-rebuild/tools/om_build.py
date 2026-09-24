"""Shape om_raw.json + om_mlb_raw.json into docs/design/odds-rebuild/om-data.js
for the Track O mockups. Everything here is a real scraper row; the only
computed values are what the app would compute (best, hold, no-vig fair,
first mover), done the same way the plan describes.
Inputs in OM_WORK: om_raw.json (om_extract.py), om_mlb_raw.json
(om_extract_mlb.py) and espn_mlb_0924.json (ESPN's MLB scoreboard for the day,
fetched by hand: probables, records, logos). Game keys and dates are pinned
in the extractors -- change them to refresh the snapshot for another day."""
import os, json, sys, collections, datetime as dt
sys.path.insert(0, r"C:\Users\occy3\Documents\odds-scraper")
from scraper.entities import canonical_book

SP = os.environ.get("OM_WORK", os.path.dirname(os.path.abspath(__file__)))  # where the raw extracts go
OUT = r"C:\Users\occy3\Documents\line-buddy\docs\design\odds-rebuild\om-data.js"

# ---------------------------------------------------------------- books
G_SHARP, G_EXCH, G_US, G_NV, G_OFF, G_INTL, G_PICK = "sharp", "exchange", "us", "nevada", "offshore", "intl", "pickem"
BOOKS = {
    "pinnacle": ("Pinnacle", G_SHARP, "pinnacle.com"), "circa": ("Circa", G_SHARP, "circasports.com"),
    "kalshi": ("Kalshi", G_EXCH, "kalshi.com"), "polymarket": ("Polymarket", G_EXCH, "polymarket.com"),
    "polymarketus": ("Polymarket US", G_EXCH, "polymarket.com"), "novig": ("Novig", G_EXCH, "novig.us"),
    "prophetx": ("ProphetX", G_EXCH, "prophetx.co"), "prophetexchange": ("ProphetX", G_EXCH, "prophetx.co"),
    "betfairexchange": ("Betfair Exchange", G_EXCH, "betfair.com"), "matchbook": ("Matchbook", G_EXCH, "matchbook.com"),
    "draftkings": ("DraftKings", G_US, "draftkings.com"), "fanduel": ("FanDuel", G_US, "fanduel.com"),
    "betmgm": ("BetMGM", G_US, "betmgm.com"), "caesars": ("Caesars", G_US, "caesars.com"),
    "fanatics": ("Fanatics", G_US, "sportsbook.fanatics.com"), "bet365": ("bet365", G_US, "bet365.com"),
    "hardrockbet": ("Hard Rock Bet", G_US, "hardrock.bet"), "betrivers": ("BetRivers", G_US, "betrivers.com"),
    "thescore": ("theScore Bet", G_US, "thescore.bet"), "espnbet": ("ESPN Bet", G_US, "espnbet.com"),
    "ballybet": ("Bally Bet", G_US, "ballybet.com"), "betparx": ("betPARX", G_US, "betparx.com"),
    "parx": ("betPARX", G_US, "betparx.com"), "fliff": ("Fliff", G_US, "getfliff.com"),
    "sugarhouse": ("SugarHouse", G_US, "playsugarhouse.com"), "riverscasino": ("Rivers", G_US, "riverscasino.com"),
    "courtside": ("Courtside", G_US, "courtside.com"), "betanything": ("BetAnything", G_US, "betanything.com"),
    "wynn": ("Wynn", G_NV, "wynnbet.com"), "southpoint": ("South Point", G_NV, "southpointcasino.com"),
    "stations": ("Station Casinos", G_NV, "stationcasinos.com"), "boomers": ("Boomers", G_NV, "boomerslv.com"),
    "westgate": ("Westgate", G_NV, "westgateresorts.com"), "caesarsnv": ("Caesars NV", G_NV, "caesars.com"),
    "betmgmnv": ("BetMGM NV", G_NV, "betmgm.com"),
    "bovada": ("Bovada", G_OFF, "bovada.lv"), "betonline": ("BetOnline", G_OFF, "betonline.ag"),
    "mybookie": ("MyBookie", G_OFF, "mybookie.ag"), "bookmaker": ("Bookmaker", G_OFF, "bookmaker.eu"),
    "lowvig": ("LowVig", G_OFF, "lowvig.ag"), "betus": ("BetUS", G_OFF, "betus.com.pa"),
    "everygame": ("Everygame", G_OFF, "everygame.eu"), "gtbets": ("GTbets", G_OFF, "gtbets.ag"),
    "betanysports": ("BetAnySports", G_OFF, "betanysports.eu"), "heritage": ("Heritage", G_OFF, "heritagesports.eu"),
    "justbet": ("JustBet", G_OFF, "justbet.cx"), "bet105": ("Bet105", G_OFF, "bet105.ag"),
    "aceshigh": ("Aces High", G_OFF, "aceshigh.ag"),
    "underdog": ("Underdog", G_PICK, "underdogfantasy.com"), "sleeper": ("Sleeper", G_PICK, "sleeper.com"),
    "prizepicks": ("PrizePicks", G_PICK, "prizepicks.com"),
    "unibet": ("Unibet", G_INTL, "unibet.com"), "888sport": ("888sport", G_INTL, "888sport.com"),
    "betsson": ("Betsson", G_INTL, "betsson.com"), "betvictor": ("BetVictor", G_INTL, "betvictor.com"),
    "ladbrokes": ("Ladbrokes", G_INTL, "ladbrokes.com.au"), "coral": ("Coral", G_INTL, "coral.co.uk"),
    "paddypower": ("Paddy Power", G_INTL, "paddypower.com"), "williamhill": ("William Hill", G_INTL, "williamhill.com"),
    "boylesports": ("BoyleSports", G_INTL, "boylesports.com"), "leovegas": ("LeoVegas", G_INTL, "leovegas.com"),
    "nordicbet": ("NordicBet", G_INTL, "nordicbet.com"), "casumo": ("Casumo", G_INTL, "casumo.com"),
    "grosvenor": ("Grosvenor", G_INTL, "grosvenorcasinos.com"), "livescorebet": ("LiveScore Bet", G_INTL, "livescorebet.com"),
    "virginbet": ("Virgin Bet", G_INTL, "virginbet.com"), "tabtouch": ("TABtouch", G_INTL, "tabtouch.com.au"),
    "tab": ("TAB", G_INTL, "tab.com.au"), "sportsbet": ("Sportsbet", G_INTL, "sportsbet.com.au"),
    "neds": ("Neds", G_INTL, "neds.com.au"), "playup": ("PlayUp", G_INTL, "playup.com.au"),
    "pointsbet": ("PointsBet", G_INTL, "pointsbet.com.au"), "betrsportsbook": ("Betr", G_INTL, "betr.com.au"),
    "onexbet": ("1xBet", G_INTL, "1xbet.com"), "marathonbet": ("Marathonbet", G_INTL, "marathonbet.com"),
    "coolbet": ("Coolbet", G_INTL, "coolbet.com"), "tipico": ("Tipico", G_INTL, "tipico.com"),
    "betway": ("Betway", G_INTL, "betway.com"), "bookmakereu": ("Bookmaker.eu", G_OFF, "bookmaker.eu"),
    "betfair": ("Betfair", G_INTL, "betfair.com"), "betano": ("Betano", G_INTL, "betano.com"),
    "dafabet": ("Dafabet", G_INTL, "dafabet.com"), "paddy": ("Paddy Power", G_INTL, "paddypower.com"),
    "novibet": ("Novibet", G_INTL, "novibet.com"), "betsensation": ("BetSensation", G_INTL, "betsensation.com"),
    "efbetnet": ("Efbet", G_INTL, "efbet.net"), "sbobet": ("SBOBET", G_INTL, "sbobet.com"),
}
# never a price on the board: a relay's own fair line, the consensus/open rows, unnamed feeds
NOT_A_BOOK = {"comparenbet_fair", "anconsensus", "anopen", "4c", "4cx", "3et", "sharpbookc", "sharpag", "apex",
              "vertex", "amapola", "buckeye", "pph", "playersfantasy", "hard", "predictfun"}
DIRECT = ["pinnacle", "kalshi", "polymarket", "draftkings", "fanduel", "betmgm", "betrivers", "underdog", "sleeper"]
RELAY_PRI = ["comparenbet", "theoddsgap", "actionnetwork", "4codds", "scoresandodds", "steezanomics", "mbodds",
             "oddstrader", "vsin", "betmonitor", "livesportsodds"]
used_books = set()


def canon(src, raw):
    if src in DIRECT:
        return src
    k = canonical_book(raw)[0]
    return {"prophetexchange": "prophetx", "parx": "betparx", "paddy": "paddypower"}.get(k, k)


def ts(s):
    return dt.datetime.fromisoformat(s[:19]).replace(tzinfo=dt.timezone.utc)


def side_norm(s):
    s = (s or "").lower()
    return {"yes": "over", "no": "under", "higher": "over", "lower": "under"}.get(s, s)


def dec(a):
    return 1 + (a / 100 if a > 0 else 100 / -a)


def prob(a):
    return 1 / dec(a)


def novig(a, b):
    pa, pb = prob(a), prob(b)
    return pa / (pa + pb)


from om_core import market_state, used_books, NOT_A_BOOK, RELAY_PRI, ts, prob, dec

# ================================================================ NFL
raw = json.load(open(SP + r"\om_raw.json"))
checked = raw["checked"]
now = max(ts(v) for v in checked.values() if v)
GM_SIDES = {"fg_sp": ("home", "away"), "1h_sp": ("home", "away"), "1q_sp": ("home", "away"),
            "fg_ml": ("home", "away"), "1h_ml": ("home", "away"), "1q_ml": ("home", "away"),
            "fg_tot": ("over", "under"), "1h_tot": ("over", "under"), "1q_tot": ("over", "under"),
            "tt_home": ("over", "under"), "tt_away": ("over", "under")}
RAWMK = {"ml": "fg_ml", "sp": "fg_sp", "tot": "fg_tot", "1h_ml": "1h_ml", "1h_h2h": "1h_ml", "p1_ml": "1h_ml",
         "1h_sp": "1h_sp", "1h_spreads": "1h_sp", "p1_sp": "1h_sp", "1h_tot": "1h_tot", "1h_totals": "1h_tot",
         "p1_tot": "1h_tot", "tt_home": "tt_home", "tt_away": "tt_away", "1q_sp": "1q_sp", "1q_spreads": "1q_sp",
         "1q_tot": "1q_tot", "1q_totals": "1q_tot", "1q_ml": "1q_ml", "1q_h2h": "1q_ml"}
gev = collections.defaultdict(list)
for e in raw["offer_events"]:
    t, src, kind, reason, mk, side, book, line, price, prev, pm = e
    if pm is None and mk in RAWMK:
        gev[RAWMK[mk]].append((t, src, kind, canon(src, book), side_norm(side), line))
gm = collections.defaultdict(list)
for _id, s, b, mk, side, line, price, fp, fpt, d, at in raw["game_rows"]:
    if s == "betmonitor" or s == "livesportsodds":
        continue
    gm[mk].append([s, canon(s, b) if s not in DIRECT else s, side_norm(side), line, price, at, d])
game_markets = {mk: market_state(rows, gev[mk], now, checked, GM_SIDES[mk]) for mk, rows in gm.items()}
print({k: len(v["cur"]) for k, v in game_markets.items()})

# props (Drake London + the props table players)
pev = collections.defaultdict(list)
for e in raw["offer_events"]:
    t, src, kind, reason, mk, side, book, line, price, prev, pm = e
    if pm:
        pev[pm].append((t, src, kind, canon(src, book), side_norm(side), line))
PLAYERS = {}
for who, P in raw["props"].items():
    bym = collections.defaultdict(list)
    evm = collections.defaultdict(list)
    for _id, s, b, mk, side, line, price, fp, fpt, d, at, pm in P["rows"]:
        if s in ("betmonitor",):
            continue
        sd = side_norm(side)
        if mk == "anytime_td" and line not in (0.5, None):
            continue
        bym[mk].append([s, canon(s, b), sd, 0.5 if mk == "anytime_td" else line, price, at, d])
        for e in pev.get(pm, []):
            evm[mk].append(e)
    mkts = {mk: market_state(rows, list(set(evm[mk])), now, checked, ("over", "under")) for mk, rows in bym.items()}
    cov = collections.defaultdict(set)
    for src, stat, mk in P["stats"]:
        cov[mk or ("~" + stat)].add(src)
    PLAYERS[who] = {"markets": mkts, "coverage": {k: sorted(v) for k, v in cov.items()}}
    print(who, {k: len(v["cur"]) for k, v in mkts.items()})

# splits for the game and London's props
splits = raw["splits"]
latest_split = {}
for s in splits:
    at, src, kind, book, mk, side, line, pb, pmn, cnt, ctot, pop, pm, det = s
    k = (src, kind, book, mk, side, pm)
    latest_split[k] = [at[:16], src, kind, book, mk, side, line, pb, pmn, cnt, ctot, pm]
split_hist = collections.defaultdict(list)   # DK money% over time for the spread home side
for s in splits:
    at, src, kind, book, mk, side, line, pb, pmn, cnt, ctot, pop, pm, det = s
    if pm is None and kind == "bets_money" and side in ("home", "over"):
        split_hist[f"{src}|{book}|{mk}"].append([at[:16], line, pb, pmn])
london_pm = set(r[11] for r in raw["props"]["drake london"]["rows"])
ref = raw["reference"]
openers = [json.loads(r[4]) for r in ref if r[2] == "vsin_opener"]
power = {r[3]: json.loads(r[4]) for r in ref if r[2] == "nfl_power_rating"}

nfl = {
    "game": raw["game"], "asof": now.isoformat()[:16], "checked": checked,
    "markets": game_markets,
    "splits": [v for v in latest_split.values() if v[11] is None],
    "splitHist": {k: v[-400:] for k, v in split_hist.items()},
    "propSplits": [v for v in latest_split.values() if v[11] in london_pm],
    "openers": openers, "power": power,
    "players": PLAYERS,
}

# ================================================================ MLB
mraw = json.load(open(SP + r"\om_mlb_raw.json"))
espn = json.load(open(SP + r"\espn_mlb_0924.json"))
MLB_SIDES = {"ml": ("home", "away"), "sp": ("home", "away"), "tot": ("over", "under")}
mlb = []
for g in mraw["games"]:
    ev = collections.defaultdict(list)
    for at, src, kind, reason, mk, side, book, line, price, prev in g["events"]:
        m = {"ml": "ml", "sp": "sp", "tot": "tot", "rl": "sp", "spreads": "sp", "totals": "tot", "h2h": "ml"}.get(mk)
        if m:
            ev[m].append((at[:19], src, kind, canon(src, book), side_norm(side), line))
    bym = collections.defaultdict(list)
    for s, b, mk, side, line, price, fp, d, at in g["rows"]:
        if s in ("betmonitor", "livesportsodds"):
            continue
        bym[mk].append([s, canon(s, b) if s not in DIRECT else s, side_norm(side), line, price, at, d])
    start = ts(g["start"])
    final = start < now - dt.timedelta(hours=6)
    gnow = start if final else now
    ck = {k: (gnow.isoformat()[:19] if final else v) for k, v in checked.items()}
    if final:   # the close: everything up to first pitch
        for mk in bym:
            bym[mk] = [r for r in bym[mk] if ts(r[5]) <= start]
    mk_state = {mk: market_state(rows, [e for e in ev[mk] if ts(e[0]) <= gnow], gnow, ck, MLB_SIDES[mk]) for mk, rows in bym.items()}
    # strikeout props
    kp = collections.defaultdict(list)
    for src, b, player, stat, side, ln, price, at in g["kprops"]:
        if not player or src == "betmonitor":
            continue
        if src in ("betrivers",) and stat == "Strikeouts":
            continue   # BetRivers' "Strikeouts" is the batter market
        bk = canon(src, b) if src not in DIRECT else src
        if src == "4codds" and bk == src:
            continue
        kp[player.strip()].append([src, bk, side_norm(side), ln, price, at, None])
    kprops = {}
    for pl, rows in kp.items():
        st = market_state(rows, [], now, checked, ("over", "under"))
        if len({c[0] for c in st["cur"]}) >= 4:
            kprops[pl] = {"cur": st["cur"], "open": st["open"], "moves": st["moves"][-20:]}
    sp_latest = {}
    for at, src, kind, book, mk, side, line, pb, pmn, cnt, ctot in g["splits"]:
        sp_latest[(src, kind, book, mk, side)] = [at[:16], src, kind, book, mk, side, line, pb, pmn, cnt, ctot]
    ops = [json.loads(r[4]) for r in g["ref"] if r[2] == "vsin_opener"]
    live = [json.loads(r[4]) for r in g["ref"] if r[2] == "cnb_live"]
    e = next((x for x in espn if abs((ts(x["date"].replace("T", " ").replace("Z", "")) - start).total_seconds()) < 3600
              and x["home"]["name"].split()[-1] in g["home"]), None)
    mlb.append({"key": g["key"], "away": g["away"], "home": g["home"], "start": g["start"][:16], "final": final,
                "espn": e, "markets": mk_state, "kprops": kprops, "splits": list(sp_latest.values()),
                "openers": ops, "live": live[-1] if live else None})
    print(g["away"], "@", g["home"], {k: len(v["cur"]) for k, v in mk_state.items()}, len(kprops), "k-props")

# ---------------------------------------------------------------- game props card (every rostered player)
praw = json.load(open(os.path.join(SP, "om_props_raw.json")))
card = {}
for who, rows in praw["players"].items():
    bym = collections.defaultdict(list)
    for src, b, side, line, price, at, d, mk in rows:
        b = canon(src, b) if src not in DIRECT else src
        bym[mk].append([src, b, side_norm(side), line, price, at, d])
    mk_out = {}
    for mk, rr in bym.items():
        st = market_state(rr, [], now, checked, ("over", "under"))
        main = [c for c in st["cur"] if c[7] == "main"]
        if len({c[0] for c in main}) < 3:
            continue
        first = st["steam"][-1] if st["steam"] else None
        mk_out[mk] = {"cur": [c[:7] for c in main], "open": st["open"], "moves": len(st["moves"]),
                      "first": {"book": first["books"][0], "t": first["t"], "n": len(first["books"]) - 1, "from": first["from"], "to": first["to"][0]} if first else None}
    if mk_out:
        r = praw["roster"][who]
        card[who] = {"team": r["team"], "pos": r["pos"], "head": r["head"], "markets": mk_out}
nfl["card"] = card
print("props card:", len(card), "players,", sum(len(v["markets"]) for v in card.values()), "markets")
probs = json.load(open(os.path.join(SP, "espn_mlb_probables.json")))
for g in mlb:
    for pl, kp in g["kprops"].items():
        hit = next((v for k, v in probs.items() if k and k.lower() == pl.lower()), None)
        if hit:
            kp["head"] = hit["head"]; kp["team"] = hit["team"]

# ---------------------------------------------------------------- finished game: props vs the box score
fp = json.load(open(os.path.join(SP, "om_final_props_raw.json")))
fcl = collections.defaultdict(list)
for name, mk, line, side, b, price, at, src in fp["close"]:
    b = canon(src, b) if src not in DIRECT else src
    if b in NOT_A_BOOK or not b:
        continue
    used_books.add(b)
    fcl[(name, mk)].append([b, side, line, price, at, src])
final_props = []
for p in fp["players"]:
    for (name, mk), qs in fcl.items():
        if name != p["name"]:
            continue
        final_props.append({"name": name, "mk": mk, "q": qs})
mlb_final = next(g for g in mlb if g["final"])
mlb_final["props"] = {"players": fp["players"], "markets": final_props}
print("final props:", len(final_props), "player-markets")

books = {k: {"n": v[0], "g": v[1], "d": v[2]} for k, v in BOOKS.items() if k in used_books}
for k in used_books - set(BOOKS):
    books[k] = {"n": k, "g": G_INTL, "d": None}
    print("unlabelled book", k)
import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Track O mockup data -- a frozen snapshot of real scraper rows, " + now.isoformat()[:16] + " UTC.\n")
    f.write("// Generated by the OM extractor; do not edit by hand.\n")
    f.write("window.OM = " + json.dumps({"asof": now.isoformat()[:16], "books": books, "nfl": nfl, "mlb": mlb},
                                        separators=(",", ":"), default=str) + ";\n")
print("wrote", os.path.getsize(OUT) // 1024, "KB")
