# Expo EAS builds (runs without dev server)

Use these steps to produce EAS builds that include the JS bundle, so the app runs without `expo start`/Metro.

## Prerequisites
- Install deps: `npm install`
- Expo account (and Apple/Google developer accounts for store uploads)
- CLI: `npm i -g eas-cli` (or prefix commands with `npx`)
- Sign in: `eas login`

## One-time project setup
1) Link the project: `eas init` (creates `eas.json` and registers the app)
2) Add EAS environment variables for production builds and updates:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_SENTRY_DSN`
   - `SENTRY_ORG`
   - `SENTRY_PROJECT`
   - `SENTRY_AUTH_TOKEN` for Sentry source map upload
   Example: `eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value <url>`
   Use plaintext or sensitive visibility for `EXPO_PUBLIC_` values needed by app JavaScript. Secret visibility is not readable when bundling updates.
   Use `secret` visibility for `SENTRY_AUTH_TOKEN` on remote EAS builders. If local builds must upload source maps through `eas env:exec`, use `sensitive` visibility instead because EAS does not expose `secret` values locally.
3) Create/update `eas.json` with non-dev profiles (ensures the bundle is embedded and the matching EAS environment is used):
```json
{
  "cli": { "version": ">= 14.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "developmentClient": false,
      "android": { "buildType": "apk" },
      "ios": { "enterpriseProvisioning": "universal" }
    },
    "production": {
      "channel": "production",
      "environment": "production",
      "developmentClient": false,
      "autoIncrement": true
    }
  },
  "submit": { "production": {} }
}
```
Notes: keep `developmentClient: false` so the JS is bundled; adjust `enterpriseProvisioning`/distribution to match how you sign iOS builds.

## Build (no dev server)
- Internal test (embedded bundle):  
  - Android: `eas build --platform android --profile preview`  
  - iOS: `eas build --platform ios --profile preview`
- Store-ready:  
  - Android: `eas build --platform android --profile production`  
  - iOS: `eas build --platform ios --profile production`
- Local iOS production build: run `npm run build:ios:local:production`. This loads the production EAS environment with `eas env:exec production`; no `.env.local` file is required.

## Install or submit
- Download the artifact from the EAS dashboard; install the APK on Android or distribute the IPA via TestFlight/ad-hoc.
- Submit to stores after a production build:  
  - Android: `eas submit --platform android --profile production --latest`  
  - iOS: `eas submit --platform ios --profile production --latest`

## OTA updates
Once a production/preview build is installed, push JS-only changes with the production EAS environment:

```bash
npm run update:production -- "Your message"
```

This wraps:

```bash
eas update --branch production --environment production --message "Your message"
```

Do not use OTA updates for native changes such as Expo SDK upgrades, added/removed native packages, config plugin changes, or `app.json` native configuration changes. Those require a new build and TestFlight/App Store submission. The app uses Expo Updates' `fingerprint` runtime policy so updates only reach binaries with a matching native runtime.
