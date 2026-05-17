# Source Map

Use this map when the drawing skill needs exact upstream details.

## Official Docs

- Canvas: https://shopify.github.io/react-native-skia/docs/canvas/overview/
- Rendering modes: https://shopify.github.io/react-native-skia/docs/canvas/rendering-modes/
- Contexts: https://shopify.github.io/react-native-skia/docs/canvas/contexts/
- Painting: https://shopify.github.io/react-native-skia/docs/paint/overview/
- Painting properties: https://shopify.github.io/react-native-skia/docs/paint/properties/
- Group: https://shopify.github.io/react-native-skia/docs/group/
- Pictures: https://shopify.github.io/react-native-skia/docs/shapes/pictures/
- Path: https://shopify.github.io/react-native-skia/docs/shapes/path/
- Path migration: https://shopify.github.io/react-native-skia/docs/shapes/path-migration/
- Shapes: https://shopify.github.io/react-native-skia/docs/shapes/polygons/
- Ellipses: https://shopify.github.io/react-native-skia/docs/shapes/ellipses/
- Box: https://shopify.github.io/react-native-skia/docs/shapes/box/
- Patch: https://shopify.github.io/react-native-skia/docs/shapes/patch/
- Atlas: https://shopify.github.io/react-native-skia/docs/shapes/atlas/
- Vertices: https://shopify.github.io/react-native-skia/docs/shapes/vertices/

## Decision Guide

- Stable component tree plus animated props: retained mode.
- Variable draw-command count or generated command lists: `Picture`.
- Static icon or fully opaque Android drawing: consider `androidWarmup`.
- Path morphing or worklet mutation: use Skia animation hooks, not React render loops.
