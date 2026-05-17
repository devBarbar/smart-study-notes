# Source Map

Use this map for exact media behavior and examples.

## Official Docs

- Images: https://shopify.github.io/react-native-skia/docs/images/
- SVG images: https://shopify.github.io/react-native-skia/docs/image-svg/
- Animated images: https://shopify.github.io/react-native-skia/docs/animated-images/
- Video: https://shopify.github.io/react-native-skia/docs/video/
- Skottie: https://shopify.github.io/react-native-skia/docs/skottie/
- Snapshot views: https://shopify.github.io/react-native-skia/docs/snapshot-views/
- Animation textures: https://shopify.github.io/react-native-skia/docs/animations/textures/

## Checklist

- Guard `useImage`, `useSVG`, video, and Skottie loading states.
- Give every media render explicit bounds and fit behavior.
- Verify Android API 26+ before depending on Skia video.
- Prefer Reanimated-backed animated image values for GIF/WebP playback.
- Check SVG feature support before relying on CSS, gradients, embedded images, or complex inline SVGs.
