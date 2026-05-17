---
name: react-native-skia-shaders-filters
description: Implement or debug React Native Skia visual effects. Use when Codex works with shaders, SkSL runtime shaders, gradients, image shaders, Perlin noise, color filters, image filters, backdrop filters, mask filters, masks, path effects, blending, pixel-density handling, or composed Skia effect trees.
---

# React Native Skia Shaders And Filters

## Workflow

1. Identify whether the effect changes geometry, color, image pixels, backdrop pixels, alpha, or paint strokes.
2. Pick the smallest effect primitive: shader for fill generation, color filter for color transforms, image filter for pixel operations, mask for alpha/luminance masking, path effect for stroke/path geometry, and backdrop filter for content behind an area.
3. Compose effects as children only where the docs support child composition.
4. Verify pixel density for runtime shader effects that sample coordinates or textures.
5. Test web separately because some Skia APIs are unsupported on React Native Web.

## Shaders And Gradients

- Use built-in gradients before custom SkSL.
- Use `LinearGradient`, `RadialGradient`, `TwoPointConicalGradient`, and `SweepGradient` with explicit `vec()` start/end/center points.
- Use image shaders when filling geometry with an image texture.
- Use runtime shaders for effects that cannot be represented by built-in gradients or filters.
- Pass uniforms explicitly and keep their coordinate system consistent with canvas size and device pixel ratio.

## Filters And Masks

- Use color filters for color matrix, blend color, interpolation, and gamma conversion.
- Use image filters for blur, shadow, offset, morphology, displacement, or shader-based pixel effects.
- Use backdrop filters for effects applied to content behind a region; keep the filtered area as small as practical.
- Use mask filters for paint mask effects such as blur masks.
- Use `Mask` with alpha or luminance semantics depending on the source image/content.

## Path Effects

- Use dash, discrete, corner, 1D, and 2D path effects for stroke/path presentation.
- Keep path effect parameters stable or animated through shared values instead of recreating complex paths every render.
- Prefer path effects over manually approximating dashed or rounded geometry.

## Web And Performance

- React Native Web currently lacks some APIs such as selected path-effect factories, text path creation from text, and shader filters; check web support before promising parity.
- Runtime shader image filters must account for pixel density when sampling.
- Reduce effect nesting in animated scenes; profile before stacking blur, shadows, and backdrop filters.
- Use offscreen pictures/textures for expensive static effect sources when repeated.

## Reference

Read `references/source-map.md` for official shader, filter, mask, and path-effect docs.
