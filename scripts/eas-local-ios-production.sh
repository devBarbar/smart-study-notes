#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

output_path="${1:-./dist/smart-learning-notes-production.ipa}"

if [[ "${EAS_LOCAL_PRODUCTION_ENV_LOADED:-}" != "1" && "${SKIP_EAS_ENV_EXEC:-}" != "1" ]]; then
  quoted_output_path="$(printf '%q' "$output_path")"
  exec npx eas-cli@latest env:exec production \
    "EAS_LOCAL_PRODUCTION_ENV_LOADED=1 bash ./scripts/eas-local-ios-production.sh ${quoted_output_path}" \
    --non-interactive
fi

load_missing_env_file() {
  local env_file="$1"
  local name
  local value

  while IFS='=' read -r name value || [[ -n "$name" ]]; do
    name="${name#export }"
    if [[ -z "$name" || "$name" == \#* ]]; then
      continue
    fi
    if [[ -z "${!name:-}" ]]; then
      export "$name=$value"
    fi
  done < "$env_file"
}

if [[ -f .env.local ]]; then
  load_missing_env_file .env.local
fi

missing=()
for name in \
  EXPO_PUBLIC_SUPABASE_URL \
  EXPO_PUBLIC_SUPABASE_ANON_KEY \
  EXPO_PUBLIC_SENTRY_DSN \
  SENTRY_ORG \
  SENTRY_PROJECT; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required local production build env vars: %s\n' "${missing[*]}" >&2
  printf 'Load Expo production env with eas env:exec and provide local secret-only values in .env.local.\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$output_path")"

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  export SENTRY_DISABLE_AUTO_UPLOAD="${SENTRY_DISABLE_AUTO_UPLOAD:-true}"
  printf 'SENTRY_AUTH_TOKEN is not available locally; Sentry source map upload will be skipped.\n' >&2
else
  export SENTRY_DISABLE_AUTO_UPLOAD="${SENTRY_DISABLE_AUTO_UPLOAD:-false}"
fi
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
  --profile production \
  --local \
  --non-interactive \
  --output "$output_path"
