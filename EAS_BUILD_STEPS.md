# Expo EAS builds (runs without dev server)

Use these steps to produce EAS builds that include the JS bundle, so the app runs without `expo start`/Metro.

## Prerequisites
- Install deps: `npm install`
- Expo account (and Apple/Google developer accounts for store uploads)
- CLI: `npm i -g eas-cli` (or prefix commands with `npx`)
- Sign in: `eas login`

## One-time project setup
1) Link the project: `eas init` (creates `eas.json` and registers the app)
2) Add build-time env vars (used in `lib/openai.ts` and `lib/supabase.ts`):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_OPENAI_API_KEY`
   - `EXPO_PUBLIC_OPENAI_MODEL` (optional, defaults to `gpt-5.1`)
   Example: `eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value <url>`
3) Create/update `eas.json` with non-dev profiles (ensures the bundle is embedded):
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
- Local build (optional): add `--local` if you want to build on your machine.

## Install or submit
- Download the artifact from the EAS dashboard; install the APK on Android or distribute the IPA via TestFlight/ad-hoc.
- Submit to stores after a production build:  
  - Android: `eas submit --platform android --profile production --latest`  
  - iOS: `eas submit --platform ios --profile production --latest`

## OTA updates (optional)
Once a production/preview build is installed, you can push JS-only changes without rebuilding native binaries: `eas update --branch production --message "Your message"`.

