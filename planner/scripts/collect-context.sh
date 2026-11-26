#!/usr/bin/env bash
set -euo pipefail

# Print read-only repository context for the planner agent.
root=$(git rev-parse --show-toplevel)
cd "$root"

echo "## Branch"
git branch --show-current || true
echo
echo "## Recent commits"
git log --oneline -10 || true
echo
echo "## Changed files"
git status --short
