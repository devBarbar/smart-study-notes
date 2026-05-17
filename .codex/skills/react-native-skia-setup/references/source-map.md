# Source Map

Use this compact map instead of copying the full upstream docs into context.

## Official Docs

- Installation: https://shopify.github.io/react-native-skia/docs/getting-started/installation/
- Web support: https://shopify.github.io/react-native-skia/docs/getting-started/web/
- Hello World: https://shopify.github.io/react-native-skia/docs/getting-started/hello-world/
- Headless rendering: https://shopify.github.io/react-native-skia/docs/getting-started/headless/
- Bundle size: https://shopify.github.io/react-native-skia/docs/getting-started/bundle-size/
- GitHub docs source: https://github.com/Shopify/react-native-skia/tree/main/apps/docs/docs/getting-started

## Checklist

- Confirm `react`, `react-native`, Expo SDK, and Skia versions.
- Use Expo-aligned installation in Expo apps.
- Confirm Skia postinstall scripts are allowed for the package manager.
- Configure web CanvasKit loading before Skia imports run.
- Add Jest Skia environment/setup when testing Skia components.
- Verify Android NDK/CMake and Proguard rules for native release builds.
