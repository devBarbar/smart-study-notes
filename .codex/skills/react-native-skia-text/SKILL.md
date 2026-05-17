---
name: react-native-skia-text
description: Render, style, measure, or troubleshoot text in React Native Skia. Use when Codex works with Skia Text, Paragraph, fonts, system fonts, glyphs, text blobs, text on paths, paragraph bounding boxes, inline styling, text paints, font loading, or low-level text APIs.
---

# React Native Skia Text

## Workflow

1. Choose the text primitive by complexity: `Text` for simple positioned strings, `Paragraph` for wrapping/rich text, `Glyphs` or text blobs for low-level glyph placement, and `TextPath` for path-following text.
2. Load fonts before rendering text that depends on custom font files.
3. Use paragraph measurement and bounding boxes when layout depends on wrapped text size.
4. Apply paint, filters, and shaders to text only after basic font loading and positioning work.

## Fonts

- Use `useFont()` for bundled font files and guard against `null` while loading.
- Use system font helpers when the design should follow platform fonts.
- Keep font size, family, weight, and style explicit for paragraph styles.
- Avoid measuring or snapshotting text before fonts are ready.

## Simple Text And Glyphs

- Use `Text` for a single baseline-positioned string.
- Use glyph APIs for precise glyph IDs, positions, vertical text, or effects not covered by high-level text components.
- Use text blobs when repeatedly drawing pre-shaped text.
- Use `TextPath` when text must follow an `SkPath`; ensure the path and font are loaded and sized before rendering.

## Paragraphs

- Use `Paragraph` for multiline text, wrapping, alignment, max lines, and rich spans.
- Build paragraph styles and text styles deliberately; keep style construction close to the component or memoized when expensive.
- Use paragraph bounding box information when aligning decorations or fitting text into a canvas.
- Apply child paints/effects to paragraph text only when the visual effect should affect glyph rendering, not the canvas background.

## Common Failure Modes

- Missing text usually means the font is not loaded, the baseline is outside the canvas, or paragraph layout was not calculated with a width.
- Clipped text usually means the canvas or paragraph bounds are too small.
- Poor web fidelity can come from unsupported font loading or CanvasKit not being initialized before Skia imports.
- For accessibility, mirror meaningful rendered text with React Native accessible labels outside or around the canvas.

## Reference

Read `references/source-map.md` for official docs links for Text, Paragraph, Glyphs, Text Blob, and Text Path.
