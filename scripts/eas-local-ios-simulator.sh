#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

environment="${EAS_LOCAL_SIMULATOR_ENVIRONMENT:-development}"

if [[ "${EAS_LOCAL_SIMULATOR_ENV_LOADED:-}" != "1" ]]; then
  output_path="${1:-./dist/smart-learning-notes-simulator.tar.gz}"
  quoted_output_path="$(printf '%q' "$output_path")"
  exec npx eas-cli@latest env:exec "$environment" \
    "EAS_LOCAL_SIMULATOR_ENV_LOADED=1 EAS_LOCAL_SIMULATOR_ENVIRONMENT=$environment bash ./scripts/eas-local-ios-simulator.sh ${quoted_output_path}" \
    --non-interactive
fi

missing=()
for name in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required local build env vars: %s\n' "${missing[*]}" >&2
  printf 'Load an Expo environment with eas env:exec. EXPO_PUBLIC_* values must use plaintext or sensitive EAS visibility, not secret.\n' >&2
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
