#!/usr/bin/env bash
# Stop hook — warn when docs/CURRENT.md has gone stale.
#
# Why: this project is worked across three rotating Claude accounts that hit
# usage limits mid-task, so sessions end abruptly. docs/CURRENT.md is the
# handoff baton, and nothing updates it automatically — it depends on whoever
# is driving remembering. This is the backstop.
#
# Deliberately a REMINDER, not a blocker. A Stop hook that refuses to let the
# session end would be worse than the problem: it would fire during ordinary
# pauses and get disabled within a day. It prints, and printing is enough,
# because the failure it guards against is forgetting rather than disagreeing.
#
# Prints nothing when there is nothing to say — a hook that speaks every time
# is noise, and noise is how a warning stops being read (the same lesson as
# the permanently-red health check in Phase 0.8).
#
# Reads the Stop hook's JSON on stdin and ignores it; it needs no payload.
set -u

cd "C:/Users/occy3/Documents/line-buddy" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0

# Commits made since CURRENT.md was itself last committed. If work has landed
# and the baton wasn't updated, the next account starts from a stale picture.
last_baton=$(git log -1 --format=%ct -- docs/CURRENT.md 2>/dev/null || echo 0)
[ -n "$last_baton" ] || last_baton=0
commits_since=$(git log --oneline --since="@$last_baton" 2>/dev/null | wc -l | tr -d ' ')
[ -n "$commits_since" ] || commits_since=0

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
unpushed=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)

problems=""
[ "$commits_since" -gt 1 ] 2>/dev/null && problems="${problems}${commits_since} commit(s) since docs/CURRENT.md was last updated. "
[ "$dirty" -gt 0 ] 2>/dev/null && problems="${problems}${dirty} uncommitted file(s). "
[ "$unpushed" -gt 0 ] 2>/dev/null && problems="${problems}${unpushed} unpushed commit(s) — the next account reads git, so unpushed work is invisible. "

[ -z "$problems" ] && exit 0

printf '{"systemMessage":"HANDOFF CHECK: %s Rewrite docs/CURRENT.md, commit, and push before this session ends."}\n' "$problems"
