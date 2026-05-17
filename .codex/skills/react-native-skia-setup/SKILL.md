---
name: react-native-skia-setup
description: Install, configure, upgrade, or debug React Native Skia in Expo and React Native projects. Use when Codex works on @shopify/react-native-skia setup, Expo web CanvasKit loading, Jest mocks, native build failures, Android NDK or CMake issues, iOS pods, Proguard rules, bundle-size tradeoffs, platform compatibility, or Skia package-manager postinstall behavior.
---

# React Native Skia Setup

## Workflow

1. Inspect the project first: `package.json`, Expo config, Jest config, web entrypoints, native folders, package manager files, and existing Skia imports.
2. Match Skia version requirements before changing code. Modern Skia requires React Native 0.79+ and React 19+; older React Native/React projects need `@shopify/react-native-skia` 1.12.4 or below.
3. Prefer `npx expo install @shopify/react-native-skia` in Expo apps so the version aligns with the installed Expo SDK.
4. Preserve package-manager postinstall behavior. Bun and Yarn Berry can block Skia binary setup unless scripts are trusted/enabled.
5. Verify target platforms: iOS 14+, Android API 21+, and Android API 26+ for video or experimental Graphite.

## Expo And Web

- For new Expo projects, prefer the official `with-skia` template.
- For existing Expo web support, ensure `canvaskit.wasm` is available unless CanvasKit is loaded from a version-matched CDN.
- Run or wire `setup-skia-web` after Skia upgrades when serving CanvasKit locally.
- Ensure Skia loads before components importing `@shopify/react-native-skia` evaluate on web.
- In Expo Router dev mode, keep lazily loaded Skia components outside `app/` when using `<WithSkiaWeb />`; router evaluation can happen before CanvasKit loads.
- Use `LoadSkiaWeb()` for deferred root registration when code splitting is not enough.
- Watch WebGL context count on web. Static canvases can use `__destroyWebGLContextAfterRender={true}` when many canvases appear on a page, accepting the performance cost.

## Native Builds

- iOS: run `pod install` in `ios/` for bare/prebuilt native projects after adding Skia.
- Android: verify Android NDK is installed and `ANDROID_NDK` points at the selected SDK NDK path when native builds fail.
- Android CMake errors usually mean the required CMake version is missing from Android Studio SDK Tools.
- Add `-keep class com.shopify.reactnative.skia.** { *; }` when Proguard/R8 is enabled.
- Treat Graphite as experimental; use `@next` only when the request explicitly calls for it and Android API 26+ is acceptable.

## Testing

- Jest needs Skia's custom environment and setup file because mocks load CanvasKit.
- Include `@shopify/react-native-skia` in `transformIgnorePatterns` exceptions.
- Add `testEnvironment: "@shopify/react-native-skia/jestEnv.js"` and `setupFilesAfterEnv: ["@shopify/react-native-skia/jestSetup.js"]` unless the project has an equivalent local mock.
- If existing project tests use a different runner, adapt the same principle: do not transform Skia out of the supported pipeline and load Skia mocks before components import Skia.

## Reference

Read `references/source-map.md` for the official docs pages that informed this skill and the quick setup checklist.
