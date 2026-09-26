// Lists the sections and card kinds each captured payload renders through the app's adapters.
import { readFileSync, readdirSync } from 'node:fs';
import { toGameResearchData as mlb } from '../../../lib/sports/mlb/adapters/mlbGameResearch';
import { toGameResearchData as football } from '../../../lib/sports/nfl/adapters/footballGameResearch';
import { toGameResearchData as soccer } from '../../../lib/sports/soccer/adapters/soccerGameResearch';
import { toGameResearchData as tennis } from '../../../lib/sports/tennis/adapters/tennisGameResearch';
import { toGameResearchData as nba } from '../../../lib/sports/nba/adapters/nbaGameResearch';
import { toGameResearchData as nhl } from '../../../lib/sports/nhl/adapters/nhlGameResearch';
const A: Record<string, any> = { mlb, nfl: football, cfb: football, soccer_epl: soccer, soccer_mls: soccer, tennis_atp: tennis, tennis_wta: tennis, nba, nhl };
const R = 'docs/design/game-page/raw/';
for (const f of readdirSync(R).filter((f) => f.endsWith('.json') && !f.startsWith('colors'))) {
  const p = JSON.parse(readFileSync(R + f, 'utf8'));
  const d = A[p.sport]({ payload: p, requestedState: null });
  console.log(`\n${f} → ${d.state}`);
  for (const s of d.sections) console.log(`  ${s.id.padEnd(14)} ${s.state.kind.padEnd(6)} ${s.rows.flat().map((c: any) => `${c.kind}${c.surface ? ':' + c.surface : ''}(${c.key})`).join(' ')}`);
}
