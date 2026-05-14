#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

missing=()
for name in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required local build env vars: %s\n' "${missing[*]}" >&2
  printf 'Add them to .env.local or export them before running this script.\n' >&2
  exit 1
fi

output_path="${1:-./dist/smart-learning-notes-production.ipa}"
mkdir -p "$(dirname "$output_path")"

export SENTRY_DISABLE_AUTO_UPLOAD="${SENTRY_DISABLE_AUTO_UPLOAD:-true}"
export SENTRY_ORG="${SENTRY_ORG:-devbarbar}"
export SENTRY_PROJECT="${SENTRY_PROJECT:-smart-learning-notes}"
export EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP="${EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP:-1}"

npx eas-cli@latest build \
  --platform ios \
  --profile production \
  --local \
  --non-interactive \
  --output "$output_path"
