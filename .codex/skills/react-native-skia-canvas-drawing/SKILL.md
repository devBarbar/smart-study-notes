---
name: react-native-skia-canvas-drawing
description: Build, refactor, or review React Native Skia drawing code. Use when Codex works with Canvas sizing, retained versus immediate rendering, groups, paint inheritance, transforms, clipping, zIndex, paths, path migration, shapes, vertices, atlas, pictures, snapshots, accessibility, or low-level drawing primitives.
---

# React Native Skia Canvas Drawing

## Drawing Workflow

1. Start from layout: define the `Canvas` size with a React Native style, `onSize` shared value, or `useCanvasSize()` depending on whether JS or UI-thread sizing is needed.
2. Keep static or property-animated scenes declarative. Skia's default retained mode is best when component count is stable and props change.
3. Use immediate-mode `Picture` APIs only when the number of draw commands changes frequently or the drawing is generated outside React.
4. Use `Group` for shared paint properties, transforms, clipping, layer effects, and z-order grouping.
5. Use `Paint` inheritance deliberately. Child paint props inherit through groups unless overridden.

## Canvas Sizing

- Use `onSize={sharedValue}` when size drives UI-thread derived values or Reanimated worklets.
- Use `useCanvasSize()` when JS needs measured width and height.
- Avoid hard-coded dimensions for responsive surfaces unless the drawing is intentionally fixed-size.
- When taking snapshots, use a canvas ref and wait until assets/fonts/images are loaded.
- For accessibility, treat Canvas as a React Native view and expose surrounding accessible labels/controls when the drawing represents meaningful content.

## Paths And Shapes

- Prefer simple shape components (`Rect`, `RoundedRect`, `Circle`, `Oval`, `Line`, `Points`) before custom paths.
- Paths can be SVG path strings or `SkPath` objects. Use SVG notation for static icons and `Skia.Path.Make()` or `PathBuilder` for programmatic geometry.
- Newer path APIs are immutable. Avoid mutating stored `SkPath` instances in regular React render paths; build a new path or use `usePathValue()` in worklets for animated mutation.
- Use `start` and `end` path trim values in `[0, 1]` for reveal animations.
- Use vertices, patches, or atlas only when the drawing needs mesh-like texture mapping, sprite batches, or non-rectangular image warps.

## Groups, Transforms, And Clipping

- Apply transforms at the `Group` level when several children move together.
- Set transform origins explicitly when rotation or scale must happen around a visual center.
- Use rectangular, rounded-rect, or path clips based on the simplest shape that expresses the mask.
- Use inverted clips sparingly and keep the clipped subtree small.
- Use `zIndex` only when drawing order cannot be represented by JSX order cleanly.

## Performance Defaults

- Minimize large React tree churn inside a `Canvas`; animate values directly instead of recreating many nodes.
- Use `Picture` for repeated static command lists and generated drawings.
- Use `androidWarmup` only for static icons or fully opaque Android drawings; avoid it for animated or translucent canvases.
- Keep image/font loading state outside drawing primitives so the canvas never renders with invalid resources.

## Reference

Read `references/source-map.md` for official docs links and component coverage.
