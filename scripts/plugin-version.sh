#!/usr/bin/env bash
# Claude Code keys a plugin's cache dir by the `version` string in
# .claude-plugin/plugin.json, not by commit SHA (that fallback applies only to a
# manifest with no version). An installed 0.15.1 therefore never re-clones while
# main ships 0.15.1, and every consumer runs a frozen skill.
#
# Two callers: the `plugin-version` job in CI, and the PreToolUse hook in
# .claude/settings.json, which runs this before a `git push` so the bump lands in
# the same push instead of a red check.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
base=${1:-${GITHUB_BASE_REF:-main}}

fail() {
	# The annotation only renders in Actions; locally it is noise.
	if [ -n "${GITHUB_ACTIONS:-}" ]; then
		printf '::error file=.claude-plugin/plugin.json::%s\n' "$1" >&2
	else
		printf '%s\n' "$1" >&2
	fi
	exit 1
}

# A stale origin/$base only ever misfires in CI's favor, so an offline push still
# gets the gate rather than a hard error.
git fetch --no-tags -q origin "$base" 2>/dev/null || true
if ! git rev-parse --verify -q "origin/$base" >/dev/null; then
	echo "no origin/$base to diff against; skipping the version gate"
	exit 0
fi

# The installed surface only. src/, public/, and tests/ ride the Worker deploy,
# which is fresh on every push and needs no bump.
changed=$(git diff --name-only "origin/$base...HEAD" -- skills bin .claude-plugin)
if [ -z "$changed" ]; then
	echo "no change to the installed surface; no bump needed"
	exit 0
fi

# Both sides come from git, never the working tree: what CI judges is the commits
# being pushed, so an uncommitted bump has to read as missing here too.
old=$(git show "origin/$base:.claude-plugin/plugin.json" | jq -r .version)
new=$(git show HEAD:.claude-plugin/plugin.json | jq -r .version)

if [ "$new" = "$old" ]; then
	printf '%s\n' "$changed" | sed 's/^/  /' >&2
	fail "installed surface changed but version is still $old - bump it"
fi

# A cache dir is never overwritten, so a version that goes sideways or backwards
# can land on a name someone already has and stay stale.
if [ "$(printf '%s\n%s\n' "$old" "$new" | sort -V | tail -1)" != "$new" ]; then
	fail "version must go up: $old -> $new"
fi

echo "version $old -> $new"
