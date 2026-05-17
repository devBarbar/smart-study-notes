# Source Map

Use this map for exact text APIs and examples.

## Official Docs

- Text: https://shopify.github.io/react-native-skia/docs/text/text/
- Paragraph: https://shopify.github.io/react-native-skia/docs/text/paragraph/
- Glyphs: https://shopify.github.io/react-native-skia/docs/text/glyphs/
- Text Blob: https://shopify.github.io/react-native-skia/docs/text/blob/
- Text Path: https://shopify.github.io/react-native-skia/docs/text/path/

## Checklist

- Load fonts before rendering custom-font text.
- Use `Text` for simple baselines, `Paragraph` for wrapping/rich text, and glyph/blob APIs for precise low-level control.
- Layout paragraphs with an explicit width before depending on size.
- Mirror meaningful canvas text with accessibility labels.
