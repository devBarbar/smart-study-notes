#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

output_path="${1:-./dist/smart-learning-notes-production.ipa}"

bash ./scripts/eas-local-ios-production.sh "$output_path"

npx eas-cli@latest submit \
  --platform ios \
  --profile production \
  --path "$output_path" \
  --non-interactive
