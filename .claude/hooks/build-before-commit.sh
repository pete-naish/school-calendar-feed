#!/usr/bin/env bash
# PreToolUse hook (Bash): before Claude runs `git commit` or `git push`, rebuild
# the pages' .js from their .ts (npm run build) and block the command if the
# committed/staged .js is out of date. The pages are served straight from the
# repo with no build step, so a .ts change without its rebuilt .js ships stale.
set -u

command=$(jq -r '.tool_input.command // ""')
# `git` then, within the same simple command, `commit` or `push` - so options
# in between (git -c x=y push, git -C dir commit) still count.
if ! grep -Eq '\bgit\b[^;&|]*[[:space:]](commit|push)\b' <<<"$command"; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0
GENERATED=(docs/assets/calendar.js tool/app.js tool/appHelpers.js)

if ! build_output=$(npm run -s build 2>&1); then
  echo "npm run build failed - fix it before committing or pushing:" >&2
  echo "$build_output" >&2
  exit 2
fi

if grep -Eq '\bgit\b[^;&|]*[[:space:]]commit\b' <<<"$command"; then
  # Committing: the rebuilt .js must be staged (no unstaged changes left in it).
  # A `git add` earlier in the same command hasn't run yet, so allow the files
  # it names.
  stale=()
  for f in "${GENERATED[@]}"; do
    git diff --quiet -- "$f" && continue
    grep -Eq "git[[:space:]]+add\b.*(\s|^)(-A|--all|\.|$f)(\s|$|;|&)" <<<"$command" && continue
    stale+=("$f")
  done
  if ((${#stale[@]})); then
    echo "npm run build changed ${stale[*]} - git add the rebuilt .js before committing." >&2
    exit 2
  fi
else
  # Pushing: what's committed must match what the current .ts builds to.
  if ! git diff --quiet HEAD -- "${GENERATED[@]}"; then
    echo "The committed .js is out of date with its .ts: npm run build changed $(git diff --name-only HEAD -- "${GENERATED[@]}" | tr '\n' ' ')- commit the rebuilt .js before pushing." >&2
    exit 2
  fi
fi
exit 0
