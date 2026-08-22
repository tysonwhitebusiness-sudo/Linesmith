"""Direct port of lib/sports/golf/historyIngest.ts — not a
reimplementation.

Persists one poll's completed hole/round/tournament-result data into the
golf_* history tables. Forward accumulation only. Idempotent (INSERT ...
ON CONFLICT DO NOTHING on the natural key), so handing it every completed
hole on every poll — not just newly completed ones — is correct and
cheap; Postgres silently no-ops the rows already stored.

Deliberately fire-and-forget from the caller's side (see jobs.py's golf
job): a DB write failure here must never take down the rest of the poll.
Errors are logged via db.log_system_event, not raised.
"""
from datetime import datetime, timezone

import db
from predict.golf_espn import EspnGolfEvent


def _parse_relative(value: str | None) -> float | None:
    """Same parse golf_candidates.py's category derivation does —
    duplicated locally rather than imported, matching this codebase's
    existing convention of duplicating small pure helpers per file."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if trimmed in ("", "-"):
        return None
    if trimmed.upper() == "E":
        return 0.0
    try:
        return float(trimmed.replace("+", ""))
    except ValueError:
        return None


def _category_for(relative_to_par: float) -> str:
    if relative_to_par < 0:
        return "birdie"
    if relative_to_par == 0:
        return "par"
    return "bogey"


def _made_cut_from(position_display_name: str | None) -> bool:
    """ESPN's leaderboard convention: a cut/withdrawn/disqualified
    golfer's position displayName becomes the status word itself instead
    of a rank."""
    if not position_display_name:
        return True
    return position_display_name.strip().upper() not in ("CUT", "WD", "DQ")


async def ingest_golf_history(event: EspnGolfEvent, wind_mph: float | None, temp_f: float | None, precip_prob: float | None) -> None:
    try:
        course = event.course
        now = datetime.now(timezone.utc)

        await db.write_golf_tournament(
            db.GolfTournamentInput(
                event_id=event.id,
                name=event.name,
                course_name=course.name if course else None,
                season=now.year,
                # ESPN's merged leaderboard/scoreboard objects never carry
                # the event's own start date, only per-round tee times —
                # left None rather than guessed from today's date.
                start_date=None,
                holes_json=_holes_json(course),
                field_size=len(event.golfers),
            )
        )

        hole_rows: list[db.GolfHoleScoreInput] = []
        round_rows: list[db.GolfRoundScoreInput] = []
        result_rows: list[db.GolfTournamentResultInput] = []

        for golfer in event.golfers:
            for round_ in golfer.rounds:
                # ESPN sends total:0 (not None) for a round that hasn't
                # started yet.
                round_started = round_.total is not None and round_.total > 0 and len(round_.holes) > 0
                if not round_started:
                    continue

                holes_scored = 0
                for h in round_.holes:
                    relative = _parse_relative(h.relative_to_par)
                    if relative is None or h.strokes is None:
                        continue
                    par = next((ch.shots_to_par for ch in (course.holes if course else []) if ch.number == h.hole), None)
                    hole_rows.append(
                        db.GolfHoleScoreInput(
                            event_id=event.id,
                            espn_id=golfer.id,
                            round=round_.period,
                            hole=h.hole,
                            par=int(par) if par is not None else None,
                            strokes=h.strokes,
                            relative_to_par=relative,
                            category=_category_for(relative),
                        )
                    )
                    holes_scored += 1

                # Only a fully-played round gets a round_scores row —
                # storing a still-live round's partial total now would
                # understate its actual relative-to-par.
                if holes_scored == 18 and round_.total is not None:
                    par = course.shots_to_par if course else None
                    round_rows.append(
                        db.GolfRoundScoreInput(
                            event_id=event.id,
                            espn_id=golfer.id,
                            round=round_.period,
                            total_strokes=round_.total,
                            relative_to_par=(round_.total - par) if par is not None else holes_scored,
                            # True AM/PM wave needs the course's own local
                            # timezone, not available yet — left unset.
                            tee_wave=None,
                            wind_mph=wind_mph,
                            temp_f=temp_f,
                            precip_prob=precip_prob,
                        )
                    )

        # Results are only meaningful once the whole tournament is over —
        # event.completed is the one field ESPN commits to for this.
        if event.completed:
            for golfer in event.golfers:
                position_display = golfer.status.position_display_name
                total_score = sum(r.total for r in golfer.rounds if r.total is not None and r.total > 0)
                result_rows.append(
                    db.GolfTournamentResultInput(
                        event_id=event.id,
                        espn_id=golfer.id,
                        position=position_display,
                        made_cut=_made_cut_from(position_display),
                        total_score=total_score or None,
                    )
                )

        await db.write_golf_hole_scores(hole_rows)
        await db.write_golf_round_scores(round_rows)
        if result_rows:
            await db.write_golf_tournament_results(result_rows)
    except Exception as err:  # noqa: BLE001 — never let a history-write failure break the caller
        await db.log_system_event("error", "golf/historyIngest", "Failed to persist golf history for this poll", str(err))


def _holes_json(course) -> str | None:
    import json

    if course is None:
        return None
    return json.dumps([{"number": h.number, "shotsToPar": h.shots_to_par, "totalYards": h.total_yards} for h in course.holes])
