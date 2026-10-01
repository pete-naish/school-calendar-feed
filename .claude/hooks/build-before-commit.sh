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
GENERATED=(docs/assets/calendar.js tool/app.js tool/appHelpers.js tool/page/*.js)

# Whether a `git add` in the command itself (which runs after this hook) will
# stage file $1: it names the file, a folder it's in (tool/page, ./tool/page/),
# or everything (`.`, or -A/--all with no paths). Other options are skipped.
added_by_command() {
  local f=$1 segment arg all paths
  while read -r segment; do
    all=0
    paths=0
    for arg in $segment; do
      case $arg in
        -A | --all) all=1; continue ;;
        -*) continue ;;
      esac
      paths=1
      arg=${arg#./}
      arg=${arg%/}
      [[ $arg == "" || $arg == "." || $f == "$arg" || $f == "$arg"/* ]] && return 0
    done
    ((all && !paths)) && return 0
  done < <(grep -oE '\bgit[[:space:]]+add\b[^;&|]*' <<<"$command" | sed -E 's/^git[[:space:]]+add//')
  return 1
}

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
    # Unchanged and tracked (a new page module's .js must be added too).
    git diff --quiet -- "$f" && [ -z "$(git ls-files --others --exclude-standard -- "$f")" ] && continue
    added_by_command "$f" && continue
    stale+=("$f")
  done
  if ((${#stale[@]})); then
    echo "npm run build changed ${stale[*]} - git add the rebuilt .js before committing." >&2
    exit 2
  fi
else
  # Pushing: what's committed must match what the current .ts builds to.
  untracked=$(git ls-files --others --exclude-standard -- "${GENERATED[@]}")
  if [ -n "$untracked" ]; then
    echo "npm run build made $(tr '\n' ' ' <<<"$untracked")- commit the new .js before pushing." >&2
    exit 2
  fi
  if ! git diff --quiet HEAD -- "${GENERATED[@]}"; then
    echo "The committed .js is out of date with its .ts: npm run build changed $(git diff --name-only HEAD -- "${GENERATED[@]}" | tr '\n' ' ')- commit the rebuilt .js before pushing." >&2
    exit 2
  fi
fi
exit 0
