"""Per-game detail for the streak / hit-rate rows of the slate-polish mockup.
Each candidate's own last-15 results (what the app ranks on), dated from
player_game_history where the values line up game for game.
  cd python-odds-service && python ../docs/design/slate-polish/build-games.py
"""
import asyncio, json, sys
sys.path.insert(0, 'src')
import db

D = '../docs/design/slate-polish/'
STAT = {  # market -> player_game_history stat, to check the alignment
    'hit-in-game': lambda s: s.get('bat_hits'), 'batter-strikeouts': lambda s: s.get('bat_strikeOuts'),
    'walks': lambda s: s.get('bat_baseOnBalls'), 'rbis': lambda s: s.get('bat_rbi'),
    'total-bases': lambda s: s.get('bat_totalBases'), 'runs': lambda s: s.get('bat_runs'),
    'singles': lambda s: (s.get('bat_hits') or 0) - (s.get('bat_doubles') or 0) - (s.get('bat_triples') or 0) - (s.get('bat_homeRuns') or 0) if 'bat_hits' in s else None,
    'pitcher-hits-allowed': lambda s: s.get('pit_hits'), 'pitcher-strikeouts': lambda s: s.get('pit_strikeOuts'),
}

def num(x):
    """A result is a number, or 'H-AB' for hit-in-game."""
    return float(str(x).split('-')[0])


async def main():
    api = json.load(open(D + 'raw-api-mlb.json', encoding='utf-8'))
    want = set()
    src = open(D + 'mockup-data.js', encoding='utf-8').read()
    sp = json.loads(src[src.index('=') + 1:].rstrip().rstrip(';'))
    for c in sp['spotlights']:
        if c['id'] in ('hit-rate-leaders', 'active-streaks'):
            for r in c['rows']:
                want.add(r['key'])
    cands = {f"{c['subjectId']}:{c['dimension']}:{c['category']}": c for c in api['candidates']}
    pool = await db.get_pool()
    out = {}
    for key in sorted(want):
        c = cands.get(key)
        if not c:
            print('no candidate', key); continue
        hist = c['history'][-10:]
        rows = await pool.fetch("select game_date, opponent_id, is_home, stats from player_game_history "
                                "where sport='mlb' and athlete_id=$1 order by game_date desc limit 15", c['subjectId'])
        rows = list(reversed(rows))[-len(hist):]
        f = STAT.get(c['dimension'])
        dated = False
        if f and len(rows) == len(hist):
            vals = [f(json.loads(r['stats']) if isinstance(r['stats'], str) else r['stats']) for r in rows]
            dated = all(v is not None and float(v) == num(h['result']) for v, h in zip(vals, hist))
        out[key] = {'line': c['line'], 'dim': c['dimension'], 'games': [
            {'v': num(h['result']), 'txt': str(h['result']), 'hit': h['category'] == c['category'],
             **({'d': str(r['game_date']), 'opp': r['opponent_id'], 'home': r['is_home']} if dated else {})}
            for h, r in zip(hist, rows if dated else [None] * len(hist))]}
        print(key, 'dated' if dated else 'UNDATED', [g['v'] for g in out[key]['games']])
    await pool.close()
    open(D + 'games.js', 'w', encoding='utf-8').write('window.GAMES = ' + json.dumps(out) + ';\n')

asyncio.run(main())
