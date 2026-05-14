#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

branch="${EAS_UPDATE_BRANCH:-production}"
environment="${EAS_UPDATE_ENVIRONMENT:-production}"
message="Production update $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if (( $# > 0 )) && [[ "$1" != -* ]]; then
  message="$1"
  shift
fi

export REQUIRE_EXPO_PUBLIC_ENV=true

npx eas-cli@latest update \
  --branch "$branch" \
  --environment "$environment" \
  --message "$message" \
  "$@"
