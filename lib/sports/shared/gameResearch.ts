/**
 * The game page, built once for every sport — R8. The game counterpart of
 * `teamResearch.ts`: the hero, the state the page opens in and what it says
 * about it. A sport's adapter adds its sections for each state.
 *
 * Pure and database-free.
 */

import type { GameResearchData, GameResearchPayload, GameState } from './gameResearchShapes';

/**
 * The states a game can show. A game that has begun can also show the research
 * as it stood at kickoff; a live game has no recap yet; nothing that has not
 * begun can show a live or final view. `?state=` picks among these only.
 */
export function gameStates(state: GameState): GameState[] {
  if (state === 'final') return ['pre', 'final'];
  if (state === 'live') return ['pre', 'live'];
  return [state];
}

/** The state to render: the game's own, unless a review override names one the game can show. */
export function resolveState(payload: Pick<GameResearchPayload, 'state'>, requested: string | null | undefined): GameState {
  const allowed = gameStates(payload.state);
  return requested && (allowed as string[]).includes(requested) ? (requested as GameState) : payload.state;
}

export function stateNote(state: GameState, gameState: GameState): string {
  if (state === 'pre') return gameState === 'pre' ? 'Research as of now; nothing from the game itself is used.' : 'Research as it stood at the start; nothing from the game itself is used.';
  if (state === 'live') return 'The game so far, refreshed while it is on.';
  if (state === 'final') return 'The full game, with the research from before the start kept at the bottom.';
  return 'This game did not go ahead as scheduled.';
}

export function gameWhen(startIso: string): string {
  const t = Date.parse(startIso);
  if (!Number.isFinite(t)) return '';
  return `${new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

export function buildGameHero(payload: GameResearchPayload, state: GameState, chips: GameResearchData['hero']['chips']): GameResearchData['hero'] {
  const showScore = state !== 'pre';
  return {
    away: { ...payload.away, score: showScore ? payload.away.score : null },
    home: { ...payload.home, score: showScore ? payload.home.score : null },
    statusText: state === 'pre' && payload.state !== 'pre' ? 'Before the start' : payload.statusText,
    when: gameWhen(payload.start),
    place: [payload.venue, payload.conditions].filter(Boolean).join(' · ') || null,
    lineScore: showScore ? payload.lineScore : null,
    notes: state === 'pre' ? payload.notes.filter((n) => /^Probable/.test(n)) : payload.notes,
    chips,
  };
}
