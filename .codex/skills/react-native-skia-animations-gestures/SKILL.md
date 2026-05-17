---
name: react-native-skia-animations-gestures
description: Animate React Native Skia scenes and connect them to gestures. Use when Codex works with Reanimated shared values or derived values passed directly to Skia props, Skia animation hooks, path interpolation, usePathValue, useClock, gesture-handler integration, animated colors, animated textures, UI-thread worklets, or Skia performance during animation.
---

# React Native Skia Animations And Gestures

## Workflow

1. Use Reanimated shared and derived values directly as Skia props. Do not wrap Skia components with `createAnimatedComponent` or use `useAnimatedProps` unless a local pattern proves it is necessary.
2. Keep animation math on the UI thread with `useDerivedValue`, worklets, and Skia hooks.
3. Use React state for structural changes and Reanimated values for high-frequency visual changes.
4. Add gestures with `react-native-gesture-handler`, updating shared values from gesture callbacks.
5. Confirm the target platform supports the animated feature, especially on web.

## Reanimated Values

- Pass shared values into numeric, vector, color-array, path, transform, and paint props when supported.
- Use Skia `interpolateColors`, not Reanimated `interpolateColor`, because Skia stores colors differently.
- Use `useClock()` for time-based procedural animation.
- Use `withTiming`, `withSpring`, and `withRepeat` for ordinary timing and spring transitions.

## Path And Geometry Hooks

- Use `usePathInterpolation()` only with paths that have matching command structure. If shapes differ, normalize with a path morphing tool before passing paths to Skia.
- Use `usePathValue()` when a path must be mutated efficiently inside a worklet.
- Use `processTransform3d()` for 3D-style transforms applied to paths.
- Use `useRectBuffer()` and `useRSXformBuffer()` for animated arrays used by atlas and sprite-like rendering.

## Gestures

- Update shared values in gesture callbacks and pass them straight to Skia props or derived values.
- Keep gesture hit targets in React Native views when the canvas content itself is not accessible.
- For draggable elements, derive drawing positions from shared values rather than re-rendering React components on each move.
- Use element tracking patterns when a gesture must follow a Skia-drawn object.

## Textures

- Use `useTexture()` to render React elements into a texture when they must be consumed by Skia.
- Use `useImageAsTexture()` for image sources uploaded to the GPU.
- Use `usePictureAsTexture()` when drawing commands are generated as an `SkPicture`.
- Keep texture dimensions stable and avoid rebuilding textures each frame.

## Reference

Read `references/source-map.md` for official animation, gesture, hook, and texture docs.
