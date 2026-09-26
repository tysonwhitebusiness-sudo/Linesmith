#!/usr/bin/env bash
# Saves one real /api/game-research payload for the game-page mockup.
#   bash docs/design/game-page/capture.sh <sport> <gameId> <label> [replay-timecode]
# Needs a dev server; BASE defaults to :3001.
BASE=${BASE:-http://localhost:3001}
q="sport=$1&gameId=$2${4:+&replay=$4}"
out="docs/design/game-page/raw/$1-$3.json"
curl -s -m 240 "$BASE/api/game-research?$q" -o "$out"
python -c "import json,sys;j=json.load(open('$out',encoding='utf-8'));print('$out',j.get('state'),j.get('statusText'),j['away']['abbr'],j['away'].get('score'),j['home']['abbr'],j['home'].get('score'))"
