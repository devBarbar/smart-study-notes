---
name: react-native-skia-images-media
description: Load, render, animate, or troubleshoot images and media in React Native Skia. Use when Codex works with Skia Image, SVG images, animated GIF or WebP, video, Skottie/Lottie animations, native view snapshots, image sampling, image fit modes, texture loading, encoded image data, or media asset lifecycle issues.
---

# React Native Skia Images And Media

## Workflow

1. Identify the source type: bundled asset, remote URI, encoded bytes, native view snapshot, SVG, animated image, video, or Skottie JSON.
2. Choose the narrowest Skia API for that source and handle the loading/null state before rendering.
3. Give media components explicit drawing bounds. Do not assume image dimensions match canvas dimensions.
4. Choose `fit` and sampling intentionally for resize behavior and quality.
5. Verify platform support and native requirements before adding video or web media behavior.

## Images

- Use `useImage()` for typical React asset and URI loading.
- Use encoded-image constructors when bytes are already available and should not go through React Native asset resolution.
- Render with `Image` bounds (`x`, `y`, `width`, `height`) or `rect`; use `fit` values such as `contain`, `cover`, `fill`, `fitWidth`, `fitHeight`, `scaleDown`, or `none`.
- Tune sampling only when scaling quality or performance is visibly relevant.
- Return `null`, a fallback, or a non-Skia placeholder while `useImage()` returns no image.

## SVG And Snapshots

- Use Skia SVG APIs for supported SVG content and test unsupported SVG features early.
- Be careful with inline SVGs, gradients, CSS styles, embedded images, and unsupported elements; simplify or rasterize when fidelity matters more than editability.
- Use native view snapshots when the source content is a React Native view that needs to become a Skia image.
- Wait for snapshot readiness before drawing or composing effects.

## Animated Images, Video, And Skottie

- Use `useAnimatedImageValue()` with Reanimated for GIF and animated WebP playback; pass a shared pause value when controls are needed.
- Use the manual animated image API only when controlling frames yourself.
- Video requires Android API 26+ and should be treated as a platform-sensitive feature.
- For Skottie, load animation JSON/assets, expose playback controls through Reanimated values, and use dynamic slots/properties for color, text, opacity, and transforms when customization is required.

## Texture Pitfalls

- Use animation texture hooks when the output must live on the UI thread or GPU.
- Keep texture dimensions stable and derived from layout/window size.
- Avoid recreating GPU textures every render; tie creation to resource and size changes.
- For web, confirm CanvasKit loading before rendering any media component that imports Skia.

## Reference

Read `references/source-map.md` for official image, SVG, animated image, video, Skottie, and snapshot docs.
