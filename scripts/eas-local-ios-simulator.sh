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

output_path="${1:-./dist/smart-learning-notes-simulator.tar.gz}"
mkdir -p "$(dirname "$output_path")"

export SENTRY_DISABLE_AUTO_UPLOAD="${SENTRY_DISABLE_AUTO_UPLOAD:-true}"
export EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP="${EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP:-1}"

if [[ -z "${EXPO_UPDATES_FINGERPRINT_OVERRIDE:-}" ]]; then
  resolved_runtime="$(
    npx expo-updates runtimeversion:resolve --platform ios --workflow managed |
      node -e "let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const parsed = JSON.parse(input); if (parsed.runtimeVersion) console.log(parsed.runtimeVersion); });"
  )"

  if [[ -n "$resolved_runtime" ]]; then
    export EXPO_UPDATES_FINGERPRINT_OVERRIDE="$resolved_runtime"
  fi
fi

npx eas-cli@latest build \
  --platform ios \
  --profile simulator \
  --local \
  --non-interactive \
  --output "$output_path"
