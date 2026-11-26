#!/usr/bin/env bash
set -euo pipefail

# Run the project's own checks if it has them.
root=$(git rev-parse --show-toplevel)
cd "$root"

if [[ ! -f package.json ]]; then
  echo "No package.json; no checks to run."
  exit 0
fi

status=0
for script in typecheck lint test; do
  if node -e "process.exit(require('./package.json').scripts?.['$script'] ? 0 : 1)"; then
    echo "## npm run $script"
    npm run --silent "$script" || status=1
  fi
done
exit "$status"
