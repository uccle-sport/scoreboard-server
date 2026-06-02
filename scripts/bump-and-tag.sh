#!/usr/bin/env bash
#
# Bump one level above the highest existing git tag, then push the new tag.
#
#   bump-and-tag.sh patch   # vX.Y.Z   → vX.Y.(Z+1)
#   bump-and-tag.sh minor   # vX.Y.Z   → vX.(Y+1).0
#
# The next version is derived from the highest vX.Y.Z tag (not package.json), so it
# can never collide with an existing tag even if package.json lagged behind. The
# resulting version is written to package.json and tagged with `bun pm version`,
# keeping the two in sync (see .github/workflows/docker-publish.yml, which fails a
# build whose tag does not match package.json).
set -euo pipefail

level="${1:?usage: bump-and-tag.sh <patch|minor>}"

# Make sure we know about every tag the remote has.
git fetch --tags --quiet

# Highest semver tag of the form vX.Y.Z, semver-sorted. Default to v0.0.0 if none.
latest="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -V | tail -1)"
latest="${latest:-v0.0.0}"

# Split "X.Y.Z" (tag without the leading v) and bump the requested component.
IFS=. read -r major minor patch <<EOF
${latest#v}
EOF
case "$level" in
  patch) next="${major}.${minor}.$((patch + 1))" ;;
  minor) next="${major}.$((minor + 1)).0" ;;
  *) echo "error: unknown bump level '$level' (expected patch or minor)" >&2; exit 1 ;;
esac

echo "Highest tag: ${latest} → new version: v${next}"

# Writes package.json, commits, and creates the matching tag v<next>.
bun pm version "${next}" --message "Release v%s"

# Push the commit and the new tag, triggering the publish workflow.
git push --follow-tags
