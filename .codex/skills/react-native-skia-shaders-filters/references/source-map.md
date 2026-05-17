# Source Map

Use this map for exact effect APIs and examples.

## Official Docs

- Shader language: https://shopify.github.io/react-native-skia/docs/shaders/overview/
- Gradients: https://shopify.github.io/react-native-skia/docs/shaders/gradients/
- Image shaders: https://shopify.github.io/react-native-skia/docs/shaders/images/
- Blending and colors: https://shopify.github.io/react-native-skia/docs/shaders/colors/
- Perlin noise: https://shopify.github.io/react-native-skia/docs/shaders/perlin-noise/
- Image filters overview: https://shopify.github.io/react-native-skia/docs/image-filters/overview/
- Blur: https://shopify.github.io/react-native-skia/docs/image-filters/blur/
- Displacement map: https://shopify.github.io/react-native-skia/docs/image-filters/displacement-map/
- Morphology: https://shopify.github.io/react-native-skia/docs/image-filters/morphology/
- Offset: https://shopify.github.io/react-native-skia/docs/image-filters/offset/
- Runtime shader filters: https://shopify.github.io/react-native-skia/docs/image-filters/runtime-shader/
- Shadows: https://shopify.github.io/react-native-skia/docs/image-filters/shadows/
- Backdrop filters: https://shopify.github.io/react-native-skia/docs/backdrop-filters/
- Color filters: https://shopify.github.io/react-native-skia/docs/color-filters/
- Mask filters: https://shopify.github.io/react-native-skia/docs/mask-filters/
- Mask: https://shopify.github.io/react-native-skia/docs/mask/
- Path effects: https://shopify.github.io/react-native-skia/docs/path-effects/

## Decision Guide

- Fill content: shader or gradient.
- Transform colors: color filter.
- Transform pixels: image filter.
- Affect content behind a region: backdrop filter.
- Change alpha/luminance composition: mask.
- Change stroke/path rendering: path effect.
